import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PidaError, type Principal } from "./runtime.js";
import { OutputCollector } from "./vendor/deepseek-output.js";
import { ProgramOutputStore, type ProgramOutputCapture, type ProgramOutputReference, utf8Window } from "./program-output.js";
import { createPiProcessExecutor, projectCommandEnvironment, type CommandSandbox, type ProcessCapabilities, type ProcessExecutor, type ProcessExit } from "./process-executor.js";

export type CommandStatus = "running" | "stopping" | "completed" | "failed" | "cancelled" | "timed_out" | "interrupted" | "unknown";
export interface CommandView {
  id: string; sessionId: string; runId: string; commandPreview: string; status: CommandStatus;
  createdAt: string; deadlineAt: string; finishedAt?: string; exitCode: number | null; error?: string;
  backend: string; directExited: boolean | "unknown"; rangeExited: boolean | "unknown";
  totalBytes: number; requiresRecovery: boolean; recoveryAcknowledged: boolean;
  outputStream: "combined"; artifact?: ProgramOutputReference;
}
interface SavedCommand extends Omit<CommandView, "requiresRecovery" | "outputStream"> {
  version: 1; principalId: string; requestId?: string; commandDigest: string; outputTail: string;
}
interface TrackedCommand {
  saved: SavedCommand; controller?: AbortController; collector?: OutputCollector; capture?: ProgramOutputCapture;
  done?: Promise<void>; settled?: () => void; deadline?: ReturnType<typeof setTimeout>; persistTimer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>; stopReason?: "cancelled" | "timed_out";
  waiters?: Set<() => void>;
}
export interface CommandStart {
  sessionId: string; runId: string; command: string; deadlineMs?: number; requestId?: string;
  pty?: boolean; sandbox?: CommandSandbox;
}
export interface CommandManagerOptions {
  root: string; stateDirectory: string; shell?: "bash" | "powershell";
  defaultDeadlineMs?: number; maxDeadlineMs?: number; maxConcurrent?: number; maxRecords?: number;
  /** Host-owned adapter only. No model-selected module paths, native executables or backend names. */
  executor?: ProcessExecutor;
}
const ID = /^cmd_[a-f0-9]{32}$/;
const STATES: CommandStatus[] = ["running", "stopping", "completed", "failed", "cancelled", "timed_out", "interrupted", "unknown"];
const terminal = (status: CommandStatus) => status !== "running" && status !== "stopping";
const uncertain = (status: CommandStatus) => ["cancelled", "timed_out", "interrupted", "unknown"].includes(status);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1000 && !value.includes("\0");
function permission(principal: Principal, name: string) { if (!principal.permissions.includes(name)) throw new PidaError("FORBIDDEN", 403); }

/** Persistent command metadata around Pi's real executor. This is not another agent/model loop. */
export class CommandManager {
  private readonly root: string;
  private readonly directory: string;
  private readonly executor: ProcessExecutor;
  private readonly outputStore: ProgramOutputStore;
  private readonly records = new Map<string, TrackedCommand>();
  private readonly defaultDeadlineMs: number;
  private readonly maxDeadlineMs: number;
  private readonly maxConcurrent: number;
  private readonly maxRecords: number;
  private closed = false;
  private closing?: Promise<void>;

  constructor(options: CommandManagerOptions) {
    if (!isAbsolute(options.root) || lstatSync(options.root).isSymbolicLink() || !lstatSync(options.root).isDirectory()) throw new PidaError("PROJECT_ROOT_INVALID", 400);
    this.root = realpathSync(options.root); this.directory = resolve(options.stateDirectory);
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? 120_000; this.maxDeadlineMs = options.maxDeadlineMs ?? 600_000;
    this.maxConcurrent = options.maxConcurrent ?? 1; this.maxRecords = options.maxRecords ?? 64;
    if (![this.defaultDeadlineMs, this.maxDeadlineMs, this.maxConcurrent, this.maxRecords].every(n => Number.isSafeInteger(n) && n > 0) || this.defaultDeadlineMs > this.maxDeadlineMs || this.maxDeadlineMs > 86_400_000 || this.maxConcurrent > 8 || this.maxRecords < this.maxConcurrent || this.maxRecords > 512) throw new PidaError("COMMAND_CONFIG_INVALID", 400);
    this.executor = options.executor ?? createPiProcessExecutor(options.shell ?? (process.platform === "win32" ? "powershell" : "bash"));
    const c = this.executor.capabilities;
    if (!c || typeof c.backend !== "string" || c.backend.length > 100 || !Array.isArray(c.sandboxModes) || c.sandboxModes.some(m => !["none", "read-only", "workspace-write"].includes(m))) throw new PidaError("COMMAND_EXECUTOR_INVALID", 400);
    this.outputStore = new ProgramOutputStore(join(this.directory, "output"));
    this.ensureDirectory(); this.restore();
  }

  capabilities(): ProcessCapabilities & { persistentHandles: true; restartExecution: false; defaultDeadlineMs: number; maxDeadlineMs: number; maxConcurrent: number } {
    return { ...structuredClone(this.executor.capabilities), pty: false, stdin: false, persistentHandles: true, restartExecution: false, defaultDeadlineMs: this.defaultDeadlineMs, maxDeadlineMs: this.maxDeadlineMs, maxConcurrent: this.maxConcurrent };
  }
  hasActive(): boolean { return [...this.records.values()].some(r => !terminal(r.saved.status)); }
  hasRecoveryRequired(): boolean { return [...this.records.values()].some(r => uncertain(r.saved.status) && !r.saved.recoveryAcknowledged); }
  /** Host lifecycle guards disclose no command content and do not grant execution permission. */
  assertSessionIdle(principalId: string, sessionId: string): void {
    if ([...this.records.values()].some(r => r.saved.principalId === principalId && r.saved.sessionId === sessionId && (!terminal(r.saved.status) || (uncertain(r.saved.status) && !r.saved.recoveryAcknowledged)))) throw new PidaError("PROJECT_COMMAND_ACTIVE", 409);
  }
  assertRunAllowed(principalId: string, sessionId: string): void {
    if (this.hasRecoveryRequired()) throw new PidaError("COMMAND_RECOVERY_REQUIRED", 409);
    if ([...this.records.values()].some(r => !terminal(r.saved.status) && (r.saved.principalId !== principalId || r.saved.sessionId !== sessionId))) throw new PidaError("PROJECT_COMMAND_ACTIVE", 409);
  }
  async cancelSession(principal: Principal, sessionId: string): Promise<void> {
    permission(principal, "project:execute");
    for (const record of this.records.values()) if (record.saved.principalId === principal.id && record.saved.sessionId === sessionId && !terminal(record.saved.status)) await this.cancel(principal, sessionId, record.saved.id);
  }
  assertCanMutate(): void {
    if (this.hasActive()) throw new PidaError("PROJECT_COMMAND_ACTIVE", 409);
    if (this.hasRecoveryRequired()) throw new PidaError("COMMAND_RECOVERY_REQUIRED", 409);
  }

  private ensureDirectory(): void {
    for (let path = this.directory; ; path = dirname(path)) {
      try { const st = lstatSync(path); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("unsafe directory"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PidaError("COMMAND_STATE_UNSAFE", 503); }
      if (path === dirname(path)) break;
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (realpathSync(this.directory) !== this.directory) throw new PidaError("COMMAND_STATE_UNSAFE", 503);
    if (process.platform !== "win32") chmodSync(this.directory, 0o700);
  }
  private persist(record: TrackedCommand): void {
    if (record.collector) { const snapshot = record.collector.snapshot(); record.saved.totalBytes = snapshot.totalBytes; record.saved.outputTail = snapshot.bytes.toString("base64"); }
    this.ensureDirectory();
    const file = join(this.directory, record.saved.id + ".json"), temporary = file + "." + randomUUID() + ".tmp";
    try { writeFileSync(temporary, JSON.stringify(record.saved), { flag: "wx", mode: 0o600 }); renameSync(temporary, file); }
    catch { try { unlinkSync(temporary); } catch {} throw new PidaError("COMMAND_STATE_FAILED", 503); }
  }
  private restore(): void {
    const names = readdirSync(this.directory).filter(n => n.endsWith(".json"));
    if (names.length > this.maxRecords) throw new PidaError("COMMAND_STATE_LIMIT", 503);
    for (const name of names) {
      try {
        if (!/^cmd_[a-f0-9]{32}\.json$/.test(name)) throw new Error("invalid command state");
        const path = join(this.directory, name), st = lstatSync(path);
        if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 128_000) throw new Error("invalid command state");
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let saved: SavedCommand;
        try { saved = JSON.parse(readFileSync(fd, "utf8")); } finally { closeSync(fd); }
        if (saved.version !== 1 || !ID.test(saved.id) || saved.id + ".json" !== name || !STATES.includes(saved.status) || ![saved.principalId, saved.sessionId, saved.runId].every(textId) || !Number.isSafeInteger(saved.totalBytes) || saved.totalBytes < 0 || typeof saved.outputTail !== "string" || saved.outputTail.length > 88_000 || Buffer.from(saved.outputTail, "base64").toString("base64") !== saved.outputTail || typeof saved.commandPreview !== "string" || saved.commandPreview.length > 300 || typeof saved.commandDigest !== "string" || !/^[a-f0-9]{64}$/.test(saved.commandDigest)) throw new Error("invalid command state");
        const record = { saved };
        if (!terminal(saved.status)) {
          saved.status = "interrupted"; saved.error = "COMMAND_PROCESS_LOST"; saved.directExited = "unknown"; saved.rangeExited = "unknown"; saved.exitCode = null; saved.finishedAt = new Date().toISOString(); saved.recoveryAcknowledged = false;
          this.persist(record);
        }
        this.records.set(saved.id, record);
      } catch { throw new PidaError("COMMAND_STATE_INVALID", 503); }
    }
  }
  private view(record: TrackedCommand): CommandView {
    const r = record.saved;
    return { id: r.id, sessionId: r.sessionId, runId: r.runId, commandPreview: r.commandPreview, status: r.status, createdAt: r.createdAt, deadlineAt: r.deadlineAt,
      ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}), exitCode: r.exitCode, ...(r.error ? { error: r.error } : {}), backend: r.backend,
      directExited: r.directExited, rangeExited: r.rangeExited, totalBytes: record.collector?.snapshot().totalBytes ?? r.totalBytes,
      requiresRecovery: uncertain(r.status) && !r.recoveryAcknowledged, recoveryAcknowledged: r.recoveryAcknowledged, outputStream: "combined", ...(r.artifact ? { artifact: structuredClone(r.artifact) } : {}) };
  }
  private owned(principal: Principal, sessionId: string, id: string, required = "project:read"): TrackedCommand {
    permission(principal, required);
    const r = this.records.get(id);
    if (!r || r.saved.principalId !== principal.id || r.saved.sessionId !== sessionId) throw new PidaError("COMMAND_NOT_FOUND", 404);
    return r;
  }
  list(principal: Principal, sessionId: string): CommandView[] {
    permission(principal, "project:read");
    return [...this.records.values()].filter(r => r.saved.principalId === principal.id && r.saved.sessionId === sessionId).map(r => this.view(r));
  }

  start(principal: Principal, request: CommandStart, signal?: AbortSignal): CommandView {
    permission(principal, "project:execute");
    if (this.closed) throw new PidaError("COMMAND_MANAGER_CLOSED", 503);
    if (signal?.aborted) throw new PidaError("COMMAND_CANCELLED", 400);
    const deadlineMs = request.deadlineMs ?? this.defaultDeadlineMs, sandbox = request.sandbox ?? "none";
    if (!textId(principal.id) || ![request.sessionId, request.runId].every(textId) || typeof request.command !== "string" || !request.command.trim() || request.command.length > 16000 || request.command.includes("\0") || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > this.maxDeadlineMs || (request.requestId !== undefined && !textId(request.requestId)) || (request.pty !== undefined && typeof request.pty !== "boolean") || !["none", "read-only", "workspace-write"].includes(sandbox)) throw new PidaError("COMMAND_ARGUMENT_INVALID", 400);
    if (request.pty) throw new PidaError("COMMAND_PTY_UNSUPPORTED", 422); // No interactive stdin/resize handle is exposed in this release.
    if (!this.executor.capabilities.sandboxModes.includes(sandbox)) throw new PidaError("COMMAND_SANDBOX_UNSUPPORTED", 422);
    const commandDigest = digest({ command: request.command, deadlineMs, sandbox });
    if (request.requestId) {
      const existing = [...this.records.values()].find(r => r.saved.principalId === principal.id && r.saved.sessionId === request.sessionId && r.saved.requestId === request.requestId);
      if (existing) { if (existing.saved.commandDigest !== commandDigest) throw new PidaError("COMMAND_REQUEST_CONFLICT", 409); return this.view(existing); }
    }
    if (this.hasRecoveryRequired()) throw new PidaError("COMMAND_RECOVERY_REQUIRED", 409);
    if ([...this.records.values()].filter(r => !terminal(r.saved.status)).length >= this.maxConcurrent) throw new PidaError("COMMAND_LIMIT", 409);
    if (realpathSync(this.root) !== this.root || lstatSync(this.root).isSymbolicLink()) throw new PidaError("PROJECT_ROOT_INVALID", 409);
    while (this.records.size >= this.maxRecords) {
      const old = [...this.records.values()].find(r => terminal(r.saved.status) && (!uncertain(r.saved.status) || r.saved.recoveryAcknowledged));
      if (!old) throw new PidaError("COMMAND_STATE_LIMIT", 409);
      unlinkSync(join(this.directory, old.saved.id + ".json")); this.records.delete(old.saved.id);
    }
    const now = Date.now(), id = "cmd_" + randomUUID().replaceAll("-", "");
    const record: TrackedCommand = { saved: { version: 1, id, principalId: principal.id, sessionId: request.sessionId, runId: request.runId,
      ...(request.requestId ? { requestId: request.requestId } : {}), commandDigest, commandPreview: request.command.slice(0, 240), status: "running", createdAt: new Date(now).toISOString(), deadlineAt: new Date(now + deadlineMs).toISOString(), exitCode: null,
      backend: this.executor.capabilities.backend, directExited: "unknown", rangeExited: "unknown", totalBytes: 0, outputTail: "", recoveryAcknowledged: false }, controller: new AbortController(), collector: new OutputCollector(65536, "combined", undefined) };
    // Persist admission before invoking any executable. On failure no command is launched.
    this.persist(record); this.records.set(id, record);
    record.capture = this.outputStore.begin({ principalId: principal.id, sessionId: request.sessionId, programId: "project-command" });
    record.done = new Promise(resolve => { record.settled = resolve; });
    record.deadline = setTimeout(() => this.stop(record, "timed_out"), deadlineMs);
    const onData = (data: Buffer) => {
      if (terminal(record.saved.status)) return;
      record.collector!.push(data); record.capture!.push("stdout", data);
      record.persistTimer ??= setTimeout(() => {
        record.persistTimer = undefined;
        try { this.persist(record); } catch { this.stop(record, "cancelled"); record.saved.error = "COMMAND_STATE_FAILED"; }
      }, 250);
    };
    try {
      void this.executor.execute({ command: request.command, cwd: this.root, env: projectCommandEnvironment(process.env), signal: record.controller!.signal, onData, pty: false, sandbox })
        .then(result => this.finish(record, result), () => this.finish(record, { exitCode: null, error: "COMMAND_EXECUTION_FAILED", directExited: "unknown", rangeExited: "unknown" }));
    } catch { this.finish(record, { exitCode: null, error: "COMMAND_START_FAILED", directExited: "unknown", rangeExited: "unknown" }); }
    return this.view(record);
  }

  private stop(record: TrackedCommand, reason: "cancelled" | "timed_out"): void {
    if (terminal(record.saved.status) || record.stopReason) return;
    record.stopReason = reason; record.saved.status = "stopping";
    record.controller?.abort(new Error(reason === "timed_out" ? "COMMAND_DEADLINE" : "COMMAND_CANCELLED"));
    try { this.persist(record); } catch { record.saved.error = "COMMAND_STATE_FAILED"; }
    record.stopTimer = setTimeout(() => this.finish(record, { exitCode: null, directExited: "unknown", rangeExited: "unknown" }, true), 2000);
  }
  private finish(record: TrackedCommand, result: ProcessExit, unconfirmed = false): void {
    if (terminal(record.saved.status)) return;
    clearTimeout(record.deadline); clearTimeout(record.persistTimer); clearTimeout(record.stopTimer);
    record.saved.status = unconfirmed ? "unknown" : record.stopReason ?? (result.error && result.directExited === "unknown" && result.error !== "COMMAND_START_FAILED" ? "unknown" : result.error || result.exitCode !== 0 ? "failed" : "completed");
    record.saved.exitCode = result.exitCode;
    record.saved.directExited = result.directExited; record.saved.rangeExited = result.rangeExited;
    record.saved.error ??= unconfirmed ? "COMMAND_CLEANUP_UNCONFIRMED" : record.stopReason === "timed_out" ? "COMMAND_DEADLINE" : record.stopReason === "cancelled" ? "COMMAND_CANCELLED" : result.error ?? (result.exitCode !== 0 ? "COMMAND_EXIT_FAILED" : undefined);
    record.saved.finishedAt = new Date().toISOString();
    const output = record.capture?.finish().stdout;
    if (output?.artifact) record.saved.artifact = output.artifact;
    try { this.persist(record); } catch { record.saved.status = "unknown"; record.saved.error = "COMMAND_STATE_FAILED"; }
    record.settled?.();
    for (const waiter of record.waiters ?? []) waiter();
    record.waiters?.clear();
  }

  read(principal: Principal, sessionId: string, id: string, options: { offset?: number; maxBytes?: number } = {}) {
    const record = this.owned(principal, sessionId, id), offset = options.offset ?? 0, maxBytes = options.maxBytes ?? 8192;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > 16384) throw new PidaError("COMMAND_ARGUMENT_INVALID", 400);
    if (record.saved.artifact) {
      let archiveBytes = maxBytes;
      while (true) {
        const archived = this.outputStore.read({ principalId: principal.id, sessionId, programId: "project-command" }, record.saved.artifact.id, offset, archiveBytes);
        if (!archived.ok) break;
        const response = { command: this.view(record), output: { ...archived, stream: "combined" } };
        if (JSON.stringify(response).length <= 26000) return response;
        archiveBytes = Math.max(4, Math.floor(archiveBytes * .75));
      }
    }
    const snapshot = record.collector?.snapshot() ?? { bytes: Buffer.from(record.saved.outputTail, "base64"), totalBytes: record.saved.totalBytes };
    if (offset > snapshot.totalBytes) throw new PidaError("COMMAND_ARGUMENT_INVALID", 400);
    const earliest = snapshot.totalBytes - snapshot.bytes.length, from = Math.max(offset, earliest);
    let length = maxBytes;
    while (true) {
      const end = Math.min(snapshot.totalBytes, from + length), slice = snapshot.bytes.subarray(from - earliest, end - earliest);
      const window = utf8Window(slice, from > 0, end < snapshot.totalBytes || !terminal(record.saved.status));
      const output = { text: window.text, stream: "combined", offset: from + window.start, nextOffset: from + window.end, totalBytes: snapshot.totalBytes, lossy: offset < earliest, eof: terminal(record.saved.status) && from + window.end === snapshot.totalBytes };
      const response = { command: this.view(record), output };
      if (JSON.stringify(response).length <= 26000) return response;
      length = Math.max(4, Math.floor(length * .75));
    }
  }
  async wait(principal: Principal, sessionId: string, id: string, waitTimeoutMs = 1000, signal?: AbortSignal): Promise<{ command: CommandView; waitExpired: boolean }> {
    const record = this.owned(principal, sessionId, id);
    if (!Number.isInteger(waitTimeoutMs) || waitTimeoutMs < 1 || waitTimeoutMs > 30_000) throw new PidaError("COMMAND_ARGUMENT_INVALID", 400);
    if (signal?.aborted) throw new PidaError("COMMAND_WAIT_CANCELLED", 400);
    if ((record.waiters?.size ?? 0) >= 32) throw new PidaError("COMMAND_WAIT_LIMIT", 429);
    if (!terminal(record.saved.status)) await new Promise<void>((resolveWait, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); record.waiters?.delete(complete); };
      const complete = () => { cleanup(); resolveWait(); };
      const aborted = () => { cleanup(); reject(new PidaError("COMMAND_WAIT_CANCELLED", 400)); };
      const timer = setTimeout(complete, waitTimeoutMs);
      record.waiters ??= new Set(); record.waiters.add(complete);
      signal?.addEventListener("abort", aborted, { once: true });
    });
    return { command: this.view(record), waitExpired: !terminal(record.saved.status) };
  }
  cancel(principal: Principal, sessionId: string, id: string): { command: CommandView; disposition: "requested" | "already_finished" } {
    const record = this.owned(principal, sessionId, id, "project:execute");
    const disposition = terminal(record.saved.status) ? "already_finished" : "requested";
    this.stop(record, "cancelled"); return { command: this.view(record), disposition };
  }
  /** Host/API recovery only. The model cannot acknowledge uncertain process state with a tool call. */
  acknowledgeRecovery(principal: Principal, sessionId: string, id: string): CommandView {
    permission(principal, "pida:recover");
    const record = this.owned(principal, sessionId, id, "project:execute");
    if (!terminal(record.saved.status)) throw new PidaError("COMMAND_STILL_RUNNING", 409);
    record.saved.recoveryAcknowledged = true; this.persist(record); return this.view(record);
  }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const active = [...this.records.values()].filter(r => !terminal(r.saved.status));
    for (const record of active) this.stop(record, "cancelled");
    this.closing = Promise.all(active.map(r => r.done)).then(() => undefined);
    return this.closing;
  }
}
