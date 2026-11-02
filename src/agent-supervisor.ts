import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { PidaError, type PidaRuntime, type Principal } from "./runtime.js";
import { savePrivate, isId } from "./private-state.js";
import type { RunResult, StreamEvent, TraceEvent } from "./protocol.js";

export interface AgentProfile {
  id: string; owner: string; name: string; role: string; persona?: string;
  paused: boolean; sessionId?: string; needsReconciliation?: boolean;
  createdAt: string; updatedAt: string;
}
export interface AgentJob {
  id: string; agentId: string; owner: string; requestId: string; input: string;
  status: "queued" | "running" | "completed" | "failed" | "limited" | "cancelled" | "interrupted";
  depth: number; parentJobId?: string; sessionId?: string; runId?: string;
  createdAt: string; startedAt?: string; finishedAt?: string;
  result?: RunResult; code?: string; currentTool?: string; lastSignalAt?: string;
  latestText: string; activity: TraceEvent[]; memoryRefs?: string[]; memoryWarning?: string;
  reconciliation?: { at: string; by: string; note?: string };
}
export interface AgentSupervisorOptions {
  directory: string;
  maxConcurrent?: number;
  maxAgents?: number;
  maxJobs?: number;
  maxDelegationDepth?: number;
  /** Host policy only. Profiles contain no supplied paths, tool grants or provider credentials. */
  createRuntime(profile: AgentProfile): Promise<PidaRuntime> | PidaRuntime;
  /** Re-resolved when a job starts. Saved permissions are never replayed. */
  resolvePrincipal(owner: string): Promise<Principal | undefined> | Principal | undefined;
  /** Equal keys share one writer. Default serializes every agent against the same host workspace. */
  workspaceKey?(profile: AgentProfile): string;
  /** Host-selected configuration revision; changed idle runtimes reopen with preserved sessions. */
  runtimeKey?(profile: AgentProfile): string;
  memory?: {
    context(profile: AgentProfile, sessionId: string): Promise<{ text: string; refs?: string[] }> | { text: string; refs?: string[] };
    /** Observed job outcome only; do not invent an understanding/relationship-state transition. */
    checkpoint?(profile: AgentProfile, job: AgentJob, result: RunResult): Promise<void> | void;
  };
}
interface State { version: 1; profiles: AgentProfile[]; jobs: AgentJob[] }
interface Active { agentId: string; workspaceKey: string; controller: AbortController; done: Promise<void> }
const now = () => new Date().toISOString();
const copy = <T>(value: T): T => structuredClone(value);
const statuses = new Set(["queued", "running", "completed", "failed", "limited", "cancelled", "interrupted"]);
const validText = (s: unknown, max: number, empty = false): s is string => typeof s === "string" && s.length <= max && (empty || !!s.trim());
const errorCode = (e: unknown) => e instanceof PidaError && /^[A-Z][A-Z0-9_]+$/.test(e.code) ? e.code : "AGENT_EXECUTION_FAILED";
const denied = (code: string, status = 400): never => { throw new PidaError(code, status); };

/** Durable local scheduling around Pi sessions. This class never implements a model/tool loop. */
export class AgentSupervisor {
  readonly directory: string;
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly lockValue = JSON.stringify({ pid: process.pid, host: hostname(), nonce: randomUUID() });
  private state: State = { version: 1, profiles: [], jobs: [] };
  private readonly runtimes = new Map<string, Promise<PidaRuntime>>();
  private readonly active = new Map<string, Active>();
  private readonly runtimeKeys = new Map<string, string>();
  private pendingRuntimeLoads = 0;
  private readonly maxConcurrent: number;
  private started = false;
  private closed = false;
  private faulted = false;
  private scheduled = false;
  private retryTimer?: ReturnType<typeof setTimeout>;

  private constructor(private readonly options: AgentSupervisorOptions) {
    this.directory = resolve(options.directory);
    this.statePath = join(this.directory, "supervisor.json");
    this.lockPath = join(this.directory, "supervisor.lock");
    this.maxConcurrent = options.maxConcurrent ?? 2;
    for (const value of [this.maxConcurrent, options.maxAgents ?? 32, options.maxJobs ?? 2000])
      if (!Number.isSafeInteger(value) || value < 1 || value > 10000) denied("AGENT_LIMIT_INVALID");
    const depth = options.maxDelegationDepth ?? 2;
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > 8) denied("AGENT_DELEGATION_LIMIT_INVALID");
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink()) denied("AGENT_STORAGE_UNSAFE");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (existsSync(this.statePath) && (lstatSync(this.statePath).isSymbolicLink() || lstatSync(this.statePath).nlink !== 1)) denied("AGENT_STORAGE_UNSAFE");
    this.acquireLock();
    try {
      if (existsSync(this.statePath)) {
        if (lstatSync(this.statePath).size > 32 * 1024 * 1024) denied("AGENT_STATE_INVALID", 500);
        this.state = JSON.parse(readFileSync(this.statePath, "utf8"));
        this.validateState();
      }
      for (const job of this.state.jobs) if (job.status === "running") {
        job.status = "interrupted"; job.code = "AGENT_PROCESS_INTERRUPTED"; job.finishedAt = now(); delete job.currentTool;
        const profile = this.state.profiles.find(p => p.id === job.agentId)!;
        profile.paused = true; profile.needsReconciliation = true; profile.updatedAt = now();
      }
      this.persist();
    } catch (e) { this.releaseLock(); throw e instanceof PidaError ? e : new PidaError("AGENT_STATE_INVALID", 500); }
  }

  static async open(options: AgentSupervisorOptions): Promise<AgentSupervisor> { return new AgentSupervisor(options); }
  private acquireLock() {
    // Recover only a demonstrably dead process on this host. Unknown/remote/live owners fail closed.
    try { writeFileSync(this.lockPath, this.lockValue, { flag: "wx", mode: 0o600 }); return; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") denied("AGENT_STORAGE_FAILED", 500); }
    try {
      if (lstatSync(this.lockPath).isSymbolicLink()) denied("AGENT_STORAGE_UNSAFE");
      const previous = readFileSync(this.lockPath, "utf8"), owner = JSON.parse(previous);
      if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) denied("AGENT_SUPERVISOR_LOCKED", 409);
      let dead = false;
      try { process.kill(owner.pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === "ESRCH"; }
      if (!dead || readFileSync(this.lockPath, "utf8") !== previous) denied("AGENT_SUPERVISOR_LOCKED", 409);
      // Separate recovery lock excludes competing stale-lock recovery attempts.
      const recovery = this.lockPath + ".recover";
      writeFileSync(recovery, this.lockValue, { flag: "wx", mode: 0o600 });
      try {
        if (readFileSync(this.lockPath, "utf8") !== previous) denied("AGENT_SUPERVISOR_LOCKED", 409);
        renameSync(this.lockPath, this.lockPath + ".stale-" + randomUUID());
        writeFileSync(this.lockPath, this.lockValue, { flag: "wx", mode: 0o600 });
      } finally { rmSync(recovery, { force: true }); }
    } catch (e) { throw e instanceof PidaError ? e : new PidaError("AGENT_SUPERVISOR_LOCKED", 409); }
  }
  private releaseLock() {
    try { if (readFileSync(this.lockPath, "utf8") === this.lockValue) rmSync(this.lockPath); } catch { /* preserve unknown owner */ }
  }
  private validateState() {
    const s = this.state;
    if (!s || s.version !== 1 || !Array.isArray(s.profiles) || !Array.isArray(s.jobs) || s.profiles.length > 10000 || s.jobs.length > 10000) denied("AGENT_STATE_INVALID", 500);
    const ids = new Set<string>(), jobs = new Set<string>(), requests = new Set<string>();
    for (const p of s.profiles) {
      if (!p || !isId(p.id) || ids.has(p.id) || !validText(p.owner, 256) || !validText(p.name, 100) || !validText(p.role, 4000, true)
        || (p.persona !== undefined && !validText(p.persona, 8000, true)) || typeof p.paused !== "boolean" || (p.sessionId !== undefined && !isId(p.sessionId))
        || typeof p.createdAt !== "string" || typeof p.updatedAt !== "string") denied("AGENT_STATE_INVALID", 500);
      ids.add(p.id);
    }
    for (const j of s.jobs) {
      const p = s.profiles.find(p => p.id === j.agentId), key = `${j.agentId}:${j.requestId}`;
      if (!j || !isId(j.id) || jobs.has(j.id) || !p || p.owner !== j.owner || !validText(j.requestId, 128) || requests.has(key)
        || !validText(j.input, 12000) || !statuses.has(j.status) || !Number.isSafeInteger(j.depth) || j.depth < 0 || j.depth > 8
        || !Array.isArray(j.activity) || j.activity.length > 60 || !validText(j.latestText, 16000, true)
        || (j.sessionId !== undefined && !isId(j.sessionId)) || (j.runId !== undefined && !isId(j.runId))) denied("AGENT_STATE_INVALID", 500);
      jobs.add(j.id); requests.add(key);
    }
    for (const j of s.jobs) if (j.parentJobId !== undefined) {
      const parent = s.jobs.find(p => p.id === j.parentJobId);
      if (!parent || parent.owner !== j.owner || j.depth !== parent.depth + 1) denied("AGENT_STATE_INVALID", 500);
    }
  }
  private persist() {
    try { savePrivate(this.statePath, this.state); }
    catch { this.faulted = true; denied("AGENT_STORAGE_FAILED", 500); }
  }
  private usable() { if (this.closed || this.faulted) denied(this.faulted ? "AGENT_STORAGE_FAILED" : "AGENT_SUPERVISOR_CLOSED", 503); }
  private principal(principal: Principal) { if (!principal || !validText(principal.id, 256) || !Array.isArray(principal.permissions)) denied("UNAUTHORIZED", 401); }
  private owned(agentId: string, principal: Principal) {
    this.principal(principal);
    const p = this.state.profiles.find(p => p.id === agentId && p.owner === principal.id);
    if (!p) return denied("AGENT_NOT_FOUND", 404); return p;
  }
  private ownedJob(jobId: string, principal: Principal) {
    this.principal(principal);
    const j = this.state.jobs.find(j => j.id === jobId && j.owner === principal.id);
    if (!j) return denied("AGENT_JOB_NOT_FOUND", 404); return j;
  }
  register(principal: Principal, input: { name: string; role?: string; persona?: string }): AgentProfile {
    this.usable(); this.principal(principal);
    if (!input || Object.keys(input).some(k => !["name", "role", "persona"].includes(k)) || !validText(input.name, 100)
      || (input.role !== undefined && !validText(input.role, 4000, true)) || (input.persona !== undefined && !validText(input.persona, 8000, true))) denied("AGENT_PROFILE_INVALID");
    if (this.state.profiles.length >= (this.options.maxAgents ?? 32)) denied("AGENT_PROFILE_LIMIT", 429);
    const profile: AgentProfile = { id: randomUUID(), owner: principal.id, name: input.name.trim(), role: input.role ?? "", ...(input.persona === undefined ? {} : { persona: input.persona }), paused: false, createdAt: now(), updatedAt: now() };
    this.state.profiles.push(profile); this.persist(); return copy(profile);
  }
  list(principal: Principal): AgentProfile[] { this.principal(principal); return this.state.profiles.filter(p => p.owner === principal.id).map(copy); }
  get(agentId: string, principal: Principal): AgentProfile { return copy(this.owned(agentId, principal)); }
  jobs(agentId: string, principal: Principal): AgentJob[] { this.owned(agentId, principal); return this.state.jobs.filter(j => j.agentId === agentId).map(copy); }
  getJob(jobId: string, principal: Principal): AgentJob { return copy(this.ownedJob(jobId, principal)); }
  enqueue(agentId: string, principal: Principal, input: { input: string; requestId: string; parentJobId?: string }): AgentJob {
    this.usable(); const profile = this.owned(agentId, principal);
    if (!input || Object.keys(input).some(k => !["input", "requestId", "parentJobId"].includes(k)) || !validText(input.input, 12000) || !validText(input.requestId, 128)) denied("AGENT_JOB_INVALID");
    const duplicate = this.state.jobs.find(j => j.agentId === agentId && j.requestId === input.requestId);
    if (duplicate) {
      if (duplicate.input !== input.input || duplicate.parentJobId !== input.parentJobId) denied("AGENT_REQUEST_CONFLICT", 409);
      return copy(duplicate);
    }
    if (this.state.jobs.length >= (this.options.maxJobs ?? 2000)) denied("AGENT_JOB_LIMIT", 429);
    let depth = 0;
    if (input.parentJobId !== undefined) depth = this.ownedJob(input.parentJobId, principal).depth + 1;
    if (depth > (this.options.maxDelegationDepth ?? 2)) denied("AGENT_DELEGATION_LIMIT", 409);
    const job: AgentJob = { id: randomUUID(), agentId, owner: profile.owner, requestId: input.requestId, input: input.input, status: "queued", depth,
      ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}), createdAt: now(), latestText: "", activity: [] };
    this.state.jobs.push(job); this.persist(); this.kick(); return copy(job);
  }
  pause(agentId: string, principal: Principal): AgentProfile {
    this.usable(); const p = this.owned(agentId, principal); p.paused = true; p.updatedAt = now(); this.persist(); return copy(p);
  }
  async resume(agentId: string, principal: Principal): Promise<AgentProfile> {
    this.usable(); const p = this.owned(agentId, principal);
    if (p.needsReconciliation) denied("AGENT_RECOVERY_REQUIRED", 409);
    this.usable(); p.paused = false; p.needsReconciliation = false; p.updatedAt = now(); this.persist(); this.kick(); return copy(p);
  }
  /** Trusted user/host decision after inspecting effects. This operation is never a model tool. */
  async reconcile(agentId: string, principal: Principal, input: { inspected: true; effects: { id: string; state: "applied" | "not_applied" }[]; note?: string }): Promise<AgentProfile> {
    this.usable(); const p = this.owned(agentId, principal);
    if (!principal.permissions.includes("pida:recover")) denied("FORBIDDEN", 403);
    if (!input || input.inspected !== true || !Array.isArray(input.effects) || input.effects.length > 100
      || input.effects.some(e => !e || !isId(e.id) || !["applied", "not_applied"].includes(e.state))
      || (input.note !== undefined && !validText(input.note, 1000, true))) denied("AGENT_RECOVERY_INVALID");
    if ([...this.active.values()].some(a => a.agentId === agentId)) denied("SESSION_BUSY", 409);
    if (p.sessionId) {
      const runtime = await this.getRuntime(agentId, principal);
      const pending = new Set(runtime.getRecovery(p.sessionId, principal).pendingEffects.map(e => e.id));
      if (input.effects.some(e => !pending.has(e.id))) denied("AGENT_RECOVERY_INVALID");
      for (const effect of input.effects) runtime.reconcileEffect(p.sessionId, principal, effect.id, effect.state);
      if (runtime.getRecovery(p.sessionId, principal).pendingEffects.length) denied("EFFECT_STATE_UNKNOWN", 409);
    } else if (input.effects.length) denied("AGENT_RECOVERY_INVALID");
    this.usable();
    const record = { at: now(), by: principal.id, ...(input.note === undefined ? {} : { note: input.note }) };
    for (const job of this.state.jobs) if (job.agentId === agentId && !job.reconciliation && (job.status === "interrupted" || job.result?.recovery)) job.reconciliation = record;
    p.needsReconciliation = false; p.updatedAt = now(); this.persist(); this.kick(); return copy(p);
  }
  /** Host-only integration with the main runtime's shared-project lease. Never return paths in public metadata. */
  blockedWorkspaceKeys(): string[] {
    return [...new Set(this.state.profiles.filter(p => p.needsReconciliation).map(p => this.options.workspaceKey?.(copy(p)) ?? "shared-host-workspace"))];
  }
  async cancel(jobId: string, principal: Principal): Promise<AgentJob> {
    this.usable(); const j = this.ownedJob(jobId, principal);
    if (j.status === "queued") { j.status = "cancelled"; j.code = "CANCELLED"; j.finishedAt = now(); this.persist(); }
    else if (j.status === "running") {
      j.code = "CANCELLED"; this.persist(); const running = this.active.get(jobId);
      running?.controller.abort(); if (running) await running.done;
    }
    return copy(j);
  }
  async getRuntime(agentId: string, principal: Principal): Promise<PidaRuntime> {
    this.usable(); const p = this.owned(agentId, principal);
    let runtime = this.runtimes.get(agentId);
    const key = this.options.runtimeKey?.(copy(p)) ?? "";
    if (!runtime || this.runtimeKeys.get(agentId) !== key) {
      const previous = runtime;
      this.pendingRuntimeLoads++;
      runtime = Promise.resolve().then(async () => {
        if (previous) await (await previous).close();
        return this.options.createRuntime(copy(p));
      }).finally(() => { this.pendingRuntimeLoads--; });
      this.runtimeKeys.set(agentId, key);
      this.runtimes.set(agentId, runtime);
      runtime.catch(() => { if (this.runtimes.get(agentId) === runtime) { this.runtimes.delete(agentId); this.runtimeKeys.delete(agentId); } });
    }
    return runtime;
  }
  assertIdle(): void {
    this.usable();
    if (this.active.size || this.pendingRuntimeLoads) denied("PROVIDER_BUSY", 409);
  }
  start(): void { this.usable(); this.started = true; this.kick(); }
  private kick() {
    if (!this.started || this.closed || this.faulted || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; try { this.pump(); } catch { this.faulted = true; } });
  }
  private pump() {
    if (this.closed || this.faulted || !this.started) return;
    for (const job of this.state.jobs) {
      if (this.active.size >= this.maxConcurrent) break;
      const profile = this.state.profiles.find(p => p.id === job.agentId)!;
      if (job.status !== "queued" || profile.paused || profile.needsReconciliation) continue;
      if (job.code === "WORKSPACE_BUSY" && this.retryTimer) continue;
      const workspaceKey = this.options.workspaceKey?.(copy(profile)) ?? "shared-host-workspace";
      if (!validText(workspaceKey, 2000)) throw new Error("Invalid host workspace key");
      if (this.blockedWorkspaceKeys().includes(workspaceKey)) continue;
      if ([...this.active.values()].some(a => a.agentId === profile.id || a.workspaceKey === workspaceKey)) continue;
      job.status = "running"; job.startedAt = now(); job.lastSignalAt = job.startedAt; this.persist();
      const active: Active = { agentId: profile.id, workspaceKey, controller: new AbortController(), done: Promise.resolve() };
      this.active.set(job.id, active);
      active.done = this.execute(profile, job, active.controller.signal).finally(() => { this.active.delete(job.id); this.kick(); });
    }
  }
  private event(job: AgentJob, event: StreamEvent) {
    job.lastSignalAt = now();
    if (event.type === "text_delta") { job.latestText = (job.latestText + event.delta).slice(-16000); return; }
    if (event.type === "trace") {
      job.runId = event.trace.runId; job.activity.push(copy(event.trace)); job.activity = job.activity.slice(-60);
      if (event.trace.type === "tool_started") job.currentTool = event.trace.toolName;
      else if (["tool_completed", "tool_failed", "run_finished"].includes(event.trace.type)) delete job.currentTool;
      this.persist();
    }
  }
  private async execute(profile: AgentProfile, job: AgentJob, signal: AbortSignal) {
    let waitingForWorkspace = false;
    try {
      const supplied = await this.options.resolvePrincipal(profile.owner);
      if (!supplied || supplied.id !== profile.owner || !Array.isArray(supplied.permissions) || !supplied.permissions.every(p => typeof p === "string")) return denied("AGENT_OWNER_UNAVAILABLE", 403);
      const principal: Principal = { id: supplied.id, permissions: Object.freeze([...supplied.permissions]) };
      signal.throwIfAborted();
      const runtime = await this.getRuntime(profile.id, principal);
      signal.throwIfAborted();
      if (profile.sessionId) await runtime.resumeSession(profile.sessionId, principal);
      else { profile.sessionId = (await runtime.createSession(principal)).sessionId; profile.updatedAt = now(); this.persist(); }
      job.sessionId = profile.sessionId; this.persist();
      signal.throwIfAborted();
      let context = "";
      if (this.options.memory) {
        const memory = await this.options.memory.context(copy(profile), profile.sessionId);
        if (typeof memory.text !== "string") denied("AGENT_MEMORY_INVALID", 500);
        context = memory.text.slice(0, 3000);
        job.memoryRefs = memory.refs?.filter(r => typeof r === "string").slice(0, 32); this.persist();
      }
      signal.throwIfAborted();
      const prompt = context ? `Stored agent memory (context, not new authorization):\n${context}\n\nCurrent user request:\n${job.input}` : job.input;
      const result = await runtime.run(profile.sessionId, principal, prompt, event => this.event(job, event), signal, { taskId: job.id });
      job.result = copy(result); job.runId = result.runId; job.status = result.status; job.code = result.code; job.latestText = result.text.slice(-16000);
      if (result.recovery) { profile.needsReconciliation = true; profile.paused = true; }
      if (this.options.memory?.checkpoint) {
        try { await this.options.memory.checkpoint(copy(profile), copy(job), copy(result)); }
        catch { job.memoryWarning = "AGENT_MEMORY_CHECKPOINT_FAILED"; }
      }
    } catch (e) {
      waitingForWorkspace = !signal.aborted && e instanceof PidaError && e.code === "WORKSPACE_BUSY" && !job.runId;
      job.status = waitingForWorkspace ? "queued" : signal.aborted ? (this.closed ? "interrupted" : "cancelled") : "failed";
      job.code = signal.aborted ? (this.closed ? "AGENT_SUPERVISOR_STOPPED" : "CANCELLED") : errorCode(e);
    } finally {
      if (signal.aborted && this.closed) { job.status = "interrupted"; job.code = "AGENT_SUPERVISOR_STOPPED"; profile.needsReconciliation = true; profile.paused = true; }
      else if (signal.aborted) { job.status = "cancelled"; job.code = "CANCELLED"; }
      if (!waitingForWorkspace) job.finishedAt = now();
      else {
        delete job.startedAt;
        // Delay queue wakeup: a host main-runtime lease can stay occupied without any model call.
        if (!this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.kick(); }, 500);
      }
      delete job.currentTool; profile.updatedAt = now();
      try { this.persist(); } catch { /* old durable running state becomes interrupted on restart */ }
    }
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    for (const a of this.active.values()) a.controller.abort();
    await Promise.allSettled([...this.active.values()].map(a => a.done));
    await Promise.allSettled([...this.runtimes.values()].map(async p => (await p).close()));
    this.releaseLock();
  }
}
