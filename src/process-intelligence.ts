import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { canonical, savePrivate, sha256 } from "./private-state.js";
import { PidaError, type PidaRuntime, type Principal, type BusinessTool, type ToolContext } from "./runtime.js";
import { validateObservationBundle } from "./integration-contract.js";
import { validPixWorkerRequest, type PixPort, type PixWorkerRequest, type PixWorkerResult } from "./pix-port.js";
import type { PersonaProvider } from "./persona-provider.js";

export const piMappingVersion = "pida.sequential-tool-lifecycle/1";
export const piPermissions = ["pi:read", "pi:analyze", "pi:remember"] as const;
export interface PiRunRef { sessionId: string; runId: string; digest: string }
type DfgModel = NonNullable<PixWorkerRequest["model"]>;
type WorkerTrace = NonNullable<PixWorkerRequest["traces"]>[number];
export type PiModelKind = "empirical" | "aspirational" | "mandatory";
interface Cohort {
  agentId: string; personaId: string | null; scopeId: string | null; role: string | null;
  binding: "managed" | "unbound-legacy";
  models: string[]; configurations: string[]; toolsets: string[];
}
interface Snapshot {
  ref: PiRunRef; trace: WorkerTrace; cohort: Cohort; cohortDigest: string;
  status: string; eligible: boolean; exclusions: string[]; sourceRefs: string[];
  firstAt: string; lastAt: string; artifactDigest: string;
}
export interface PiCoverage {
  selectedCases: number; includedCases: number; excludedCases: number; failedCases: number;
  outcomeCounts: Record<"completed" | "failed" | "cancelled" | "limited" | "interrupted" | "unknown", number>;
  observationCoverage: number; sourceCoverage: "selected-runs-only";
  exclusions: { run: PiRunRef; reasons: string[] }[];
}
export interface PiAnalysisResult {
  schemaVersion: "pida.pi.analysis/1";
  kind: "reflection" | "awareness";
  status: "computed" | "partial" | "unavailable" | "unsupported";
  processJudgment: "conforms" | "deviates" | "pending" | "unknown";
  businessAcceptance: "UNKNOWN";
  modelKind: PiModelKind;
  mapping: typeof piMappingVersion;
  profile: "completed-sequential-batch";
  inputDigest: string;
  inputs: PiRunRef[];
  cohortDigest?: string;
  coverage: PiCoverage;
  modelRef?: string;
  modelDigest?: string;
  resultRef?: string;
  resultDigest?: string;
  variants?: { activities: string[]; frequency: number; proportion: number; selected: boolean }[];
  selectedCaseCount?: number;
  selectedCaseCoverage?: number;
  selectionRule?: { targetCaseCoverage: number; tieBreak: "frequency-desc-activities-codepoint" };
  alignments?: NonNullable<PixWorkerResult["alignments"]>;
  mandatoryDeviation?: boolean;
  empiricalDeviationIsViolation: false;
  automaticCorrection: false;
  native?: PixWorkerResult;
  limits: string[];
  issues: string[];
  durationMs: number;
  analysisCost: { elapsedMs: number; billingCost: null; billingMeasured: false };
}
interface ModelArtifact {
  kind: PiModelKind; model: DfgModel; mapping: typeof piMappingVersion;
  cohort: Cohort; cohortDigest: string; training: PiRunRef[]; trainingTasks: string[];
  sourceRefs: string[]; engine: PixWorkerResult["engine"]; createdAt: string;
  policyRef?: string; policyDigest?: string;
}
interface Stored<T> { schemaVersion: 1; owner: string; hostAgentId: string; digest: string; value: T }
export interface ProcessIntelligenceOptions {
  directory: string;
  agentId: string;
  runtime(): PidaRuntime;
  port?: PixPort;
  personaProvider?: PersonaProvider;
  /** Execution profile pin from host configuration, never selected by a model tool. */
  enginePin?: { sourceCommit: string; sourceDigest: string };
  maxRuns?: number; maxEvents?: number; maxCallsPerRun?: number; maxArtifacts?: number;
  unavailableReason?: string;
}
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const refKey = (r: Pick<PiRunRef, "sessionId" | "runId">) => `${r.sessionId}/${r.runId}`;
const unique = (values: string[]) => [...new Set(values)].sort();
const fail = (code: string, status = 409): never => { throw new PidaError(code, status); };
const refSchema = Type.Object({ sessionId: Type.String({ pattern: idPattern.source }), runId: Type.String({ pattern: idPattern.source }), digest: Type.String({ pattern: hashPattern.source }) }, { additionalProperties: false });
const runsSchema = Type.Array(refSchema, { minItems: 1, maxItems: 64 });
const emptySchema = Type.Object({}, { additionalProperties: false });
const reflectionSchema = Type.Object({ runs: runsSchema, targetCoverage: Type.Optional(Type.Number({ minimum: 0.01, maximum: 1 })) }, { additionalProperties: false });
const awarenessSchema = Type.Object({ runs: runsSchema, modelRef: Type.String({ pattern: "^pi-model:[a-f0-9]{64}$" }) }, { additionalProperties: false });
const rememberSchema = Type.Object({ resultRef: Type.String({ pattern: "^pi-result:[a-f0-9]{64}$" }), expectedContextRevision: Type.String({ pattern: hashPattern.source }) }, { additionalProperties: false });
const readSchema = Type.Object({ resultRef: Type.String({ pattern: "^pi-result:[a-f0-9]{64}$" }) }, { additionalProperties: false });

/** Optional consumer of PIX. Stores computation evidence, never a second canonical persona database. */
export class ProcessIntelligence {
  private readonly root: string;
  private readonly inflight = new Map<string, Promise<PiAnalysisResult>>();
  private readonly calls = new Map<string, number>();
  private readonly active = new Set<string>();
  private readonly maxRuns: number;
  private readonly maxEvents: number;
  private readonly maxCalls: number;
  private readonly maxArtifacts: number;
  constructor(private readonly options: ProcessIntelligenceOptions) {
    this.root = resolve(options.directory);
    this.maxRuns = options.maxRuns ?? 32; this.maxEvents = options.maxEvents ?? 4096;
    this.maxCalls = options.maxCallsPerRun ?? 2; this.maxArtifacts = options.maxArtifacts ?? 512;
    if (!options.agentId || ![this.maxRuns, this.maxEvents, this.maxCalls, this.maxArtifacts].every(n => Number.isSafeInteger(n) && n > 0)
      || this.maxRuns > 64 || this.maxEvents > 10000 || this.maxCalls > 8 || this.maxArtifacts > 4096) fail("PI_CONFIG_INVALID", 400);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (lstatSync(this.root).isSymbolicLink()) fail("PI_STORAGE_UNSAFE");
  }
  private authorize(principal: Principal, permission: string): void {
    if (!principal?.id || !principal.permissions.includes(permission)) fail("FORBIDDEN", 403);
  }
  private path(kind: "model" | "result" | "request", id: string): string {
    if (!hashPattern.test(id)) fail("PI_REFERENCE_INVALID", 400);
    const path = join(this.root, `${kind}-${id}.json`);
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size > 8_388_608)) fail("PI_ARTIFACT_INVALID");
    return path;
  }
  private save<T>(kind: "model" | "result", principal: Principal, value: T): { ref: string; digest: string } {
    if (Buffer.byteLength(canonical(value)) > 8_000_000) fail("PI_ARTIFACT_SIZE_LIMIT", 413);
    const digest = sha256(canonical(value));
    const id = sha256(canonical({ owner: principal.id, hostAgentId: this.options.agentId, digest }));
    const path = this.path(kind, id);
    if (existsSync(path)) this.load<T>(kind, `pi-${kind}:${id}`, principal);
    else {
      if (readdirSync(this.root).length >= this.maxArtifacts) fail("PI_ARTIFACT_CAPACITY", 409);
      savePrivate(path, { schemaVersion: 1, owner: principal.id, hostAgentId: this.options.agentId, digest, value });
    }
    return { ref: `pi-${kind}:${id}`, digest };
  }
  private load<T>(kind: "model" | "result", ref: string, principal: Principal): Stored<T> {
    const prefix = `pi-${kind}:`;
    if (typeof ref !== "string" || !ref.startsWith(prefix)) fail("PI_REFERENCE_INVALID", 400);
    const path = this.path(kind, ref.slice(prefix.length));
    if (!existsSync(path)) fail("PI_ARTIFACT_NOT_FOUND", 404);
    let data: Stored<T>;
    try { data = JSON.parse(readFileSync(path, "utf8")); } catch { fail("PI_ARTIFACT_INVALID"); }
    if (data!.owner !== principal.id || data!.hostAgentId !== this.options.agentId) fail("PI_ARTIFACT_NOT_FOUND", 404);
    if (data!.schemaVersion !== 1 || data!.digest !== sha256(canonical(data!.value))
      || ref.slice(prefix.length) !== sha256(canonical({ owner: data!.owner, hostAgentId: data!.hostAgentId, digest: data!.digest }))) fail("PI_ARTIFACT_DIGEST_MISMATCH");
    return data!;
  }
  private snapshot(principal: Principal, ref: Pick<PiRunRef, "sessionId" | "runId"> & { digest?: string }): Snapshot {
    if (!idPattern.test(ref.sessionId) || !idPattern.test(ref.runId)) fail("PI_RUN_REFERENCE_INVALID", 400);
    const bundle = this.options.runtime().exportRun(ref.sessionId, ref.runId, principal);
    const digest = sha256(canonical(bundle));
    if (ref.digest !== undefined && ref.digest !== digest) fail("PI_STALE_CUT");
    const checked = validateObservationBundle(bundle), exclusions: string[] = [];
    if (!checked.valid) exclusions.push(...checked.issues.map(issue => `EXPORT_${issue}`));
    if (!bundle.complete || !bundle.manifest || bundle.events.at(-1)?.activity !== "run_finished") exclusions.push("INCOMPLETE_OR_NON_RUN_SNAPSHOT");
    const seen = new Set<string>(), active = new Set<string>(), events: WorkerTrace["events"] = [];
    const requests = bundle.events.filter(e => e.activity === "model_request");
    const descriptorEvent = bundle.events.find(e => e.activity === "context_input_included");
    let binding: any;
    try { binding = descriptorEvent ? JSON.parse(String(descriptorEvent.payload.descriptor)).personaBinding : undefined; } catch { /* invalid export excluded */ }
    const cohort: Cohort = {
      agentId: bundle.events[0]?.agent_id ?? "unknown", personaId: binding?.personaId ?? null,
      scopeId: binding?.scopeId ?? null, role: binding?.role ?? null,
      binding: binding ? "managed" : "unbound-legacy",
      models: unique(requests.map(e => `${e.payload.api}:${e.payload.model}`)),
      configurations: unique(requests.map(e => String(e.payload.effective_config_digest ?? "unobserved"))),
      toolsets: unique(requests.map(e => String(e.payload.tools_digest ?? "unobserved"))),
    };
    for (const event of bundle.events) {
      const sourceRef = `${event.source_id}/${event.source_event_id}`;
      if (seen.has(sourceRef)) continue; seen.add(sourceRef);
      const tool = String(event.payload.tool_name ?? "unknown"), call = String(event.payload.tool_call_id ?? "");
      if (event.activity.startsWith("tool_") && tool.startsWith("pi_")) exclusions.push("ANALYSIS_RUN_EXCLUDED_RECURSION");
      if (event.payload.parent_tool_call_id) exclusions.push("NESTED_TOOL_ORDER_UNSUPPORTED");
      if (event.activity === "tool_started") {
        if (!call || active.size) exclusions.push("CONCURRENT_TOOL_ORDER_UNSUPPORTED");
        active.add(call);
      }
      if (["tool_completed", "tool_failed"].includes(event.activity)) {
        if (!active.has(call)) exclusions.push("TOOL_LIFECYCLE_INCOMPLETE"); active.delete(call);
      }
      let activity: string | undefined;
      if (event.activity === "run_started") activity = "request";
      if (["tool_started", "tool_completed", "tool_failed"].includes(event.activity)) activity = `${tool}:${event.activity.slice(5)}${event.payload.code ? ":" + event.payload.code : ""}`;
      if (event.activity === "run_finished") activity = `outcome:${event.payload.status}`;
      if (activity) events.push({ eventId: sourceRef, activity });
    }
    if (active.size) exclusions.push("TOOL_LIFECYCLE_INCOMPLETE");
    if (!requests.length) exclusions.push("MODEL_COHORT_UNOBSERVED");
    const first = bundle.events[0], last = bundle.events.at(-1);
    return { ref: { sessionId: ref.sessionId, runId: ref.runId, digest }, trace: { caseId: refKey(ref), events },
      cohort, cohortDigest: sha256(canonical(cohort)), status: bundle.manifest?.reported_status ?? "unknown",
      eligible: !exclusions.length, exclusions: unique(exclusions), sourceRefs: [...seen],
      firstAt: first?.occurred_at ?? "", lastAt: last?.occurred_at ?? "",
      artifactDigest: sha256(canonical(bundle.manifest?.current_artifact_refs ?? [])) };
  }
  private selection(principal: Principal, refs: PiRunRef[]): Snapshot[] {
    if (!Value.Check(runsSchema, refs) || refs.length > this.maxRuns) fail("PI_SELECTION_INVALID", 400);
    if (new Set(refs.map(refKey)).size !== refs.length) fail("PI_DUPLICATE_RUN", 400);
    const snapshots = refs.map(ref => this.snapshot(principal, ref));
    if (snapshots.reduce((n, s) => n + s.trace.events.length, 0) > this.maxEvents) fail("PI_EVENT_BUDGET", 400);
    return snapshots;
  }
  history(principal: Principal): unknown {
    this.authorize(principal, "pi:read");
    const runtime = this.options.runtime(), items: unknown[] = [];
    let truncated = false;
    for (const session of runtime.listSessions(principal)) {
      for (const runId of runtime.listRuns(session.sessionId, principal)) {
        if (items.length >= 128) { truncated = true; break; }
        const snapshot = this.snapshot(principal, { sessionId: session.sessionId, runId });
        items.push({ ...snapshot.ref, cohort: snapshot.cohort, cohortDigest: snapshot.cohortDigest, status: snapshot.status, eligible: snapshot.eligible, exclusions: snapshot.exclusions });
      }
      if (truncated) break;
    }
    return { configured: !!this.options.port, mapping: piMappingVersion, profile: "completed-sequential-batch", items, truncated, maxSelection: this.maxRuns };
  }
  read(principal: Principal, resultRef: string): PiAnalysisResult {
    this.authorize(principal, "pi:read");
    const saved = this.load<PiAnalysisResult>("result", resultRef, principal);
    // Revoked/deleted source ownership also revokes derived results; no metadata-only bypass.
    for (const ref of saved.value.inputs) this.snapshot(principal, ref);
    if (saved.value.modelRef) {
      const model = this.load<ModelArtifact>("model", saved.value.modelRef, principal);
      if (model.digest !== saved.value.modelDigest) fail("PI_MODEL_DIGEST_MISMATCH");
      for (const ref of model.value.training) this.snapshot(principal, ref);
    }
    return { ...structuredClone(saved.value), resultRef, resultDigest: saved.digest };
  }
  private coverage(snapshots: Snapshot[]): PiCoverage {
    const included = snapshots.filter(s => s.eligible);
    const outcomeCounts: PiCoverage["outcomeCounts"] = { completed: 0, failed: 0, cancelled: 0, limited: 0, interrupted: 0, unknown: 0 };
    for (const snapshot of snapshots) {
      const status = snapshot.status as keyof typeof outcomeCounts;
      outcomeCounts[Object.hasOwn(outcomeCounts, status) ? status : "unknown"]++;
    }
    return { selectedCases: snapshots.length, includedCases: included.length, excludedCases: snapshots.length - included.length,
      failedCases: outcomeCounts.failed, outcomeCounts, observationCoverage: included.length / snapshots.length,
      sourceCoverage: "selected-runs-only", exclusions: snapshots.filter(s => !s.eligible).map(s => ({ run: s.ref, reasons: s.exclusions })) };
  }
  private async bounded(principal: Principal, context: ToolContext | undefined, requestKey: string, work: () => Promise<PiAnalysisResult>): Promise<PiAnalysisResult> {
    const scope = canonical([principal.id, this.options.agentId]), runKey = context ? canonical([scope, context.sessionId, context.runId]) : undefined;
    if (context && (context.runId === "" || context.principal.id !== principal.id)) fail("PI_CONTEXT_INVALID", 400);
    if (this.active.has(scope)) fail("PI_RECURSION_OR_CONCURRENT_CALL", 409);
    const existing = this.inflight.get(requestKey); if (existing) return existing;
    if (runKey && (this.calls.get(runKey) ?? 0) >= this.maxCalls) fail("PI_CALL_BUDGET", 429);
    if (runKey) {
      if (this.calls.size >= 1024 && !this.calls.has(runKey)) fail("PI_BUDGET_LEDGER_CAPACITY", 429);
      this.calls.set(runKey, (this.calls.get(runKey) ?? 0) + 1);
    }
    this.active.add(scope);
    const pending = work(); this.inflight.set(requestKey, pending);
    try { return await pending; } finally { this.inflight.delete(requestKey); this.active.delete(scope); }
  }
  private async analyze(principal: Principal, refs: PiRunRef[], kind: "reflection" | "awareness", modelRef: string | undefined, targetCoverage: number, context?: ToolContext): Promise<PiAnalysisResult> {
    this.authorize(principal, "pi:analyze");
    if (!Number.isFinite(targetCoverage) || targetCoverage <= 0 || targetCoverage > 1) fail("PI_COVERAGE_INVALID", 400);
    const snapshots = this.selection(principal, refs), included = snapshots.filter(s => s.eligible), coverage = this.coverage(snapshots);
    const fixed = modelRef ? this.load<ModelArtifact>("model", modelRef, principal) : undefined;
    if (fixed) for (const ref of fixed.value.training) this.snapshot(principal, ref);
    const modelKind = fixed?.value.kind ?? "empirical", inputDigest = sha256(canonical(refs));
    const key = sha256(canonical({ owner: principal.id, hostAgentId: this.options.agentId, kind, inputDigest, modelRef, targetCoverage, mapping: piMappingVersion, engine: this.options.enginePin ?? null }));
    return this.bounded(principal, context, key, async () => {
      context?.signal.throwIfAborted();
      const cachedPath = this.path("request", key);
      if (existsSync(cachedPath)) {
        let cached: { resultRef: string }; try { cached = JSON.parse(readFileSync(cachedPath, "utf8")); } catch { fail("PI_CACHE_INVALID"); }
        const result = this.read({ ...principal, permissions: [...principal.permissions, "pi:read"] }, cached!.resultRef);
        if (result.kind !== kind || result.inputDigest !== inputDigest || result.mapping !== piMappingVersion
          || (kind === "awareness" && result.modelRef !== modelRef)
          || (kind === "reflection" && result.selectionRule?.targetCaseCoverage !== targetCoverage)) fail("PI_CACHE_REQUEST_MISMATCH");
        return result;
      }
      const started = performance.now();
      const base: PiAnalysisResult = {
        schemaVersion: "pida.pi.analysis/1", kind, status: "unavailable", processJudgment: "unknown", businessAcceptance: "UNKNOWN", modelKind,
        mapping: piMappingVersion, profile: "completed-sequential-batch", inputDigest, inputs: structuredClone(refs), coverage,
        ...(fixed ? { modelRef, modelDigest: fixed.digest } : {}), empiricalDeviationIsViolation: false, automaticCorrection: false,
        limits: ["SELECTED_RUNS_ONLY", "SEQUENTIAL_TOOL_LIFECYCLE_PROJECTION", "NO_BUSINESS_ACCEPTANCE", "NO_LIVE_CURRENT_CUT", "NO_CAUSAL_IMPROVEMENT_CLAIM"], issues: [], durationMs: 0,
        analysisCost: { elapsedMs: 0, billingCost: null, billingMeasured: false },
      };
      const finish = (issues: string[], status: PiAnalysisResult["status"] = "unavailable"): PiAnalysisResult => {
        const durationMs = performance.now() - started;
        return { ...base, issues, status, durationMs, analysisCost: { elapsedMs: durationMs, billingCost: null, billingMeasured: false } };
      };
      if (!this.options.port) return finish([this.options.unavailableReason ?? "PIX_NOT_CONFIGURED"]);
      if (!included.length) return finish(["NO_SUPPORTED_COMPLETE_CASES"]);
      const cohorts = unique(included.map(s => s.cohortDigest));
      if (cohorts.length !== 1) return finish(["COHORT_MISMATCH_SELECT_ONE_ROLE_MODEL_TOOLSET"], "unsupported");
      base.cohortDigest = cohorts[0]!;
      if (fixed) {
        if (fixed.value.mapping !== piMappingVersion || fixed.value.cohortDigest !== base.cohortDigest) return finish(["MODEL_COHORT_OR_MAPPING_MISMATCH"], "unsupported");
        if (this.options.enginePin && (fixed.value.engine?.sourceCommit !== this.options.enginePin.sourceCommit || fixed.value.engine?.sourceDigest !== this.options.enginePin.sourceDigest)) return finish(["MODEL_ENGINE_PIN_CHANGED"], "unsupported");
        if (refs.some(ref => fixed.value.training.some(train => refKey(train) === refKey(ref)))) return finish(["TRAIN_EVALUATION_OVERLAP"], "unsupported");
        // Same task across attempts is not a holdout task even when run IDs differ.
        const tasks = included.map(s => this.options.runtime().exportRun(s.ref.sessionId, s.ref.runId, principal).manifest!.task_id);
        if (tasks.some(task => fixed.value.trainingTasks.includes(task))) return finish(["TRAIN_EVALUATION_TASK_OVERLAP"], "unsupported");
      }
      const request: PixWorkerRequest = { schemaVersion: "pida.pix.worker.v1", operation: kind === "reflection" ? "reflect" : "awareness", traces: included.map(s => s.trace),
        ...(fixed ? { model: fixed.value.model } : {}), limits: { maxEvents: this.maxEvents, maxVariants: 256, maxStates: 100000, maxEventPairs: 10000 } };
      let native: PixWorkerResult;
      try { native = await this.options.port.compute(request, context?.signal); }
      catch (error) {
        context?.signal.throwIfAborted();
        return finish([error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "PIX_COMPUTATION_FAILED"]);
      }
      context?.signal.throwIfAborted();
      // Exports are immutable expected cuts. Any source change during compute invalidates the result.
      for (const ref of refs) this.snapshot(principal, ref);
      if (fixed) this.load<ModelArtifact>("model", modelRef!, principal);
      base.native = native;
      base.limits.push(...native.limits);
      if (!["computed", "partial"].includes(native.status) || !native.engine?.sourceVerified) return finish(native.issues.map(i => i.code).concat("PIX_RESULT_NOT_COMPUTED"));
      if (this.options.enginePin && (native.engine.sourceCommit !== this.options.enginePin.sourceCommit || native.engine.sourceDigest !== this.options.enginePin.sourceDigest)) return finish(["PIX_ENGINE_PIN_MISMATCH"]);
      base.status = native.status === "partial" || coverage.excludedCases ? "partial" : "computed";
      base.issues = native.issues.map(i => i.code);
      if (kind === "reflection") {
        if (!native.model || !native.variants || native.sampleCount !== included.length || native.variants.reduce((n, v) => n + v.frequency, 0) !== included.length) return finish(["PIX_VARIANT_DENOMINATOR_MISMATCH"]);
        const caseIds = native.variants.flatMap(v => v.caseIds);
        if (caseIds.length !== included.length || new Set(caseIds).size !== included.length
          || native.variants.some(v => v.frequency !== v.caseIds.length || v.caseIds.some(id => {
            const trace = included.find(s => s.trace.caseId === id)?.trace;
            return !trace || canonical(trace.events.map(e => e.activity)) !== canonical(v.activities);
          }))) return finish(["PIX_VARIANT_CASE_MISMATCH"]);
        let selected = 0;
        base.selectionRule = { targetCaseCoverage: targetCoverage, tieBreak: "frequency-desc-activities-codepoint" };
        const sorted = [...native.variants].sort((a, b) => b.frequency - a.frequency || (canonical(a.activities) < canonical(b.activities) ? -1 : canonical(a.activities) > canonical(b.activities) ? 1 : 0));
        base.variants = sorted.map(v => {
          const use = selected / coverage.selectedCases < targetCoverage;
          if (use) selected += v.frequency;
          return { activities: v.activities, frequency: v.frequency, proportion: v.frequency / coverage.selectedCases, selected: use };
        });
        base.selectedCaseCount = selected; base.selectedCaseCoverage = selected / coverage.selectedCases;
        if (base.selectedCaseCoverage < targetCoverage) base.limits.push("TARGET_COVERAGE_UNREACHABLE_WITH_EXCLUSIONS");
        const model: ModelArtifact = { kind: "empirical", model: native.model, mapping: piMappingVersion,
          cohort: included[0]!.cohort, cohortDigest: base.cohortDigest!, training: included.map(s => s.ref),
          trainingTasks: included.map(s => this.options.runtime().exportRun(s.ref.sessionId, s.ref.runId, principal).manifest!.task_id),
          sourceRefs: included.flatMap(s => s.sourceRefs), engine: native.engine, createdAt: new Date().toISOString() };
        const stored = this.save("model", principal, model); base.modelRef = stored.ref; base.modelDigest = stored.digest;
        base.limits.push("DFG_MAY_ALLOW_UNOBSERVED_RECOMBINATIONS", "VARIANT_SELECTION_DOES_NOT_LIMIT_DISCOVERED_MODEL");
      } else {
        if (!native.alignments || native.alignments.length !== included.length || new Set(native.alignments.map(a => a.caseId)).size !== included.length
          || native.alignments.some(a => !included.some(s => s.trace.caseId === a.caseId))) return finish(["PIX_ALIGNMENT_COVERAGE_MISMATCH"]);
        base.alignments = native.alignments;
        const unknown = native.status !== "computed" || coverage.excludedCases > 0 || native.alignments.some(a => a.status !== "optimal" || a.cost === null);
        const deviation = native.alignments.some(a => a.status === "optimal" && a.cost !== null && a.cost > 0);
        base.processJudgment = unknown ? "unknown" : deviation ? "deviates" : "conforms";
        if (modelKind === "mandatory" && !unknown) base.mandatoryDeviation = deviation;
        if (unknown) base.status = "partial";
      }
      base.durationMs = performance.now() - started; base.analysisCost.elapsedMs = base.durationMs;
      const saved = this.save("result", principal, base);
      if (readdirSync(this.root).length >= this.maxArtifacts) fail("PI_ARTIFACT_CAPACITY", 409);
      savePrivate(cachedPath, { resultRef: saved.ref });
      return { ...base, resultRef: saved.ref, resultDigest: saved.digest };
    });
  }
  reflect(principal: Principal, runs: PiRunRef[], targetCoverage = 0.8, context?: ToolContext): Promise<PiAnalysisResult> {
    return this.analyze(principal, runs, "reflection", undefined, targetCoverage, context);
  }
  awareness(principal: Principal, runs: PiRunRef[], modelRef: string, context?: ToolContext): Promise<PiAnalysisResult> {
    return this.analyze(principal, runs, "awareness", modelRef, 1, context);
  }
  /** Host-only registration. Policy ownership is separate from a model's empirical discovery. */
  registerReferenceModel(principal: Principal, input: { model: DfgModel; kind: "aspirational" | "mandatory"; cohortFrom: PiRunRef; policyRef: string; policyDigest: string; engine: NonNullable<PixWorkerResult["engine"]> }): { ref: string; digest: string } {
    this.authorize(principal, "pi:policy:register");
    if (!["aspirational", "mandatory"].includes(input.kind) || !hashPattern.test(input.policyDigest) || !/^[a-z][a-z0-9+.-]*:[^\s]{1,256}$/.test(input.policyRef)) fail("PI_POLICY_INVALID", 400);
    if (!validPixWorkerRequest({ schemaVersion: "pida.pix.worker.v1", operation: "awareness", traces: [], model: input.model })) fail("PI_POLICY_MODEL_INVALID", 400);
    const cohort = this.snapshot(principal, input.cohortFrom);
    if (!cohort.eligible) fail("PI_POLICY_COHORT_UNAVAILABLE");
    return this.save<ModelArtifact>("model", principal, { kind: input.kind, model: structuredClone(input.model), mapping: piMappingVersion,
      cohort: cohort.cohort, cohortDigest: cohort.cohortDigest, training: [], trainingTasks: [], sourceRefs: [input.policyRef], engine: input.engine,
      createdAt: new Date().toISOString(), policyRef: input.policyRef, policyDigest: input.policyDigest });
  }
  async remember(context: ToolContext, resultRef: string, expectedContextRevision: string, onDispatch?: () => void): Promise<unknown> {
    this.authorize(context.principal, "pi:remember");
    this.authorize(context.principal, "agent:memory:write");
    if (!hashPattern.test(expectedContextRevision)) fail("PI_CONTEXT_REVISION_INVALID", 400);
    const result = this.read({ ...context.principal, permissions: [...context.principal.permissions, "pi:read"] }, resultRef);
    if (!result.modelRef || !result.modelDigest || !result.resultDigest || !["computed", "partial"].includes(result.status)) fail("PI_RESULT_NOT_STORABLE");
    if (!this.options.personaProvider?.appendAnalysis) fail("PERSONA_ANALYSIS_STORAGE_UNAVAILABLE");
    const model = this.load<ModelArtifact>("model", result.modelRef!, context.principal);
    for (const ref of model.value.training) this.snapshot(context.principal, ref);
    const source = this.options.runtime().exportRun(context.sessionId, context.runId, context.principal);
    const taskId = source.events[0]?.task_id;
    if (!taskId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId)) fail("PI_TASK_CONTEXT_REQUIRED");
    if ("taskId" in context && context.taskId !== undefined && context.taskId !== taskId) fail("PI_TASK_CONTEXT_MISMATCH");
    context.signal.throwIfAborted();
    const provider = this.options.personaProvider!;
    onDispatch?.();
    const receipt = await provider.appendAnalysis!({
      principal: context.principal, agentId: this.options.agentId, sessionId: context.sessionId, runId: context.runId, taskId: taskId!,
      signal: context.signal, expectedRevision: expectedContextRevision, idempotencyKey: resultRef,
      record: { kind: result.kind, modelKind: result.modelKind, modelRef: result.modelRef!, modelDigest: result.modelDigest!,
        resultRef, resultDigest: result.resultDigest!, snapshotDigest: result.inputDigest,
        evidenceRefs: [resultRef, result.modelRef!] },
    });
    return { ok: true, effectState: "applied", receipt, identityChanged: false, activation: "reference-only", actualPersonaIntegration: provider.authority === "external" ? "provider-receipt" : "pida-local" };
  }
  tools(): BusinessTool<any>[] {
    const summary = (result: PiAnalysisResult) => {
      const { native, variants, alignments, ...rest } = result;
      return { ...rest, ...(native ? { engine: native.engine, nativeResultCount: native.nativeResults.length } : {}),
        ...(variants ? { variants: variants.slice(0, 16), variantsTruncated: variants.length > 16 } : {}),
        ...(alignments ? { alignments: alignments.slice(0, 16).map(({ caseId, status, cost, lowerBoundCost }) => ({ caseId, status, cost, lowerBoundCost })), alignmentsTruncated: alignments.length > 16 } : {}),
        fullEvidence: result.resultRef ?? null };
    };
    const read = (name: string, description: string, parameters: any, permission: string, execute: (args: any, context: ToolContext) => unknown): BusinessTool<any> => ({
      name, description, parameters, permission, effect: "read", async execute(args, context) {
        if (!Value.Check(parameters, args)) fail("PI_ARGUMENT_INVALID", 400);
        context.signal.throwIfAborted(); return execute(args, context);
      },
    });
    return [
      read("pi_history", "List this agent's owned run snapshots, exact digests, role/model/toolset cohorts and exclusions. No prompt text. Select small complete runs from one cohort; this is not all historical activity.", emptySchema, "pi:read", (_a, c) => ({ ...this.history(c.principal) as object, currentContextRevision: this.options.runtime().getSession(c.sessionId, c.principal).contextDescriptor?.personaBinding?.contextRevision ?? null })),
      read("pi_reflect", "Use actual configured PIX to discover variants and a fixed empirical DFG from selected completed runs. Include failures; coverage denominator includes exclusions. Same-role/model/toolset cohort only. No identity or behavior modification. Incomplete, concurrent and analysis runs are excluded. At most two analysis calls per run.", reflectionSchema, "pi:analyze", async (a, c) => summary(await this.reflect(c.principal, a.runs, a.targetCoverage, c))),
      read("pi_awareness", "Use actual PIX to align separate completed runs against a fixed model. Training cases/tasks are forbidden for evaluation. Raw optimal edit cost is not normalized fitness or business success. Empirical deviation is not a mandatory violation. Batch only; no live-current-cut claim.", awarenessSchema, "pi:analyze", async (a, c) => summary(await this.awareness(c.principal, a.runs, a.modelRef, c))),
      read("pi_analysis_read", "Read an owned PI result summary with exact evidence references. Source access and snapshot digests are checked again. Full native evidence remains in the host-owned PI artifact.", readSchema, "pi:read", (a, c) => summary(this.read(c.principal, a.resultRef))),
      { name: "pi_analysis_remember", description: "Append a PI result reference to the selected Persona provider using the expected context revision. Separate write permission is required. This records evidence, not identity replacement, behavior activation or proof of improvement.", parameters: rememberSchema,
        permission: "pi:remember", effect: "idempotent", effectResult: (v: any) => v?.effectState ?? "unknown",
        classifyResult: (value: any) => ({ status: value?.ok ? "completed" : "failed", ...(value?.code ? { code: value.code } : {}) }),
        execute: async (args: any, context) => {
          let dispatched = false;
          try {
            if (!Value.Check(rememberSchema, args)) fail("PI_ARGUMENT_INVALID", 400);
            return await this.remember(context, args.resultRef, args.expectedContextRevision, () => { dispatched = true; });
          } catch (error) {
            const code = error instanceof PidaError ? error.code : context.signal.aborted ? "CANCELLED" : "PERSONA_APPEND_FAILED";
            const knownLocalRejection = this.options.personaProvider?.authority === "pida-local" && error instanceof PidaError
              && ["PERSONA_CONTEXT_REVISION_CONFLICT", "PERSONA_ANALYSIS_IDEMPOTENCY_CONFLICT", "MEMORY_BUSY", "MEMORY_CAPACITY_EXCEEDED", "MEMORY_CORRUPT", "INVALID_PERSONA_ANALYSIS_REFERENCE", "INVALID_MEMORY_SOURCE_REF", "INVALID_ANALYSIS_REFERENCE", "FORBIDDEN", "PERSONA_SCOPE_DENIED"].includes(code);
            return { ok: false, effectState: !dispatched || knownLocalRejection ? "not_applied" : "unknown", code };
          }
        } },
    ];
  }
}
