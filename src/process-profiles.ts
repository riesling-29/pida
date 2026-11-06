import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { canonical, savePrivate, sha256 } from "./private-state.js";
import { PidaError, type Principal, type ToolContext, type BusinessTool } from "./runtime.js";
import { pixProfilesSchema, validPixProfileRequest, validPixProfileResult, type PixProfile, type PixProfilePort, type PixProfileRequest, type PixProfileResult } from "./pix-profiles.js";

export interface PiProfileSelection {
  ownerId: string; agentId: string; cutRef: string; modelRef: string;
  cutRevision: string; modelRevision: string; policyRevision: string; scopeDigest: string;
  taskId: string; generation: string; profile: PixProfile;
  modelKind: "empirical" | "aspirational" | "mandatory";
  modelProvenance: { sourceRef: string; derivation: string };
  artifactRefs: string[];
  coverage: { complete: boolean; sourceEventCount: number; exclusions: { eventId: string; reason: string }[];
    ordering: "source-sequence" | "selected-object-point-time"; evidenceRefs: string[] };
  model: Record<string, unknown>; proxyPaths?: string[][];
  sequential?: PixProfileRequest["sequential"]; objects?: PixProfileRequest["objects"];
  sourceRun?: { sessionId: string; runId: string };
}
/** Trusted host port. Recheck current access on EVERY call, including historical-result reads.
 * The authoritative source owns publication, revisions, grant revocation and CAS.
 * Do not manufacture source order or silently exclude unauthorized events in the model tool.
 */
export interface PiProfileSource {
  resolve(principal: Principal, refs: { cutRef: string; modelRef: string }, signal?: AbortSignal): Promise<PiProfileSelection>;
  list?(principal: Principal, signal?: AbortSignal): Promise<{ cutRef: string; modelRef: string }[]>;
}
export interface PiProfileAnalysisOptions {
  directory: string; agentId: string; source: PiProfileSource; port?: PixProfilePort;
  enginePin: { sourceCommit: string; sourceDigest: string };
  limits?: PixProfileRequest["limits"]; maxCallsPerRun?: number; maxArtifacts?: number;
}
export interface PiProfileAnalysisResult {
  schemaVersion: "pida.pi.profile-analysis/1"; profile: PixProfile;
  status: "computed" | "partial" | "unavailable";
  processJudgment: "pending" | "unknown" | "conforms" | "deviates";
  businessAcceptance: "UNKNOWN"; automaticCorrection: false; empiricalDeviationIsViolation: false;
  applicability: "CURRENT" | "STALE";
  transition: "recomputed" | "resumed";
  selectionDigest: string; selection: PiProfileSelection; request: PixProfileRequest;
  native?: PixProfileResult; issues: string[]; limits: string[]; durationMs: number;
  resultRef?: string; resultDigest?: string;
}
const hash = /^[a-f0-9]{64}$/;
const label = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 256 && v.every(label) && new Set(v).size === v.length;
const closedKeys = (v: object, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const fail = (code: string, status = 409): never => { throw new PidaError(code, status); };
const refSchema = Type.String({ minLength: 1, maxLength: 256 });
const selectSchema = Type.Object({ cutRef: refSchema, modelRef: refSchema,
  previousResultRef: Type.Optional(Type.String({ pattern: "^pi-profile-result:[a-f0-9]{64}$" })) }, { additionalProperties: false });

/** Read-only computation and immutable evidence. No source ledger, model adoption or memory writer. */
export class ProcessProfileAnalysis {
  private readonly root: string;
  private readonly active = new Set<string>();
  private readonly calls = new Map<string, number>();
  private readonly maxCalls: number;
  private readonly maxArtifacts: number;
  constructor(private readonly options: PiProfileAnalysisOptions) {
    this.root = resolve(options.directory); this.maxCalls = options.maxCallsPerRun ?? 2; this.maxArtifacts = options.maxArtifacts ?? 512;
    if (!label(options.agentId) || !/^[a-f0-9]{40}$/.test(options.enginePin.sourceCommit) || !hash.test(options.enginePin.sourceDigest)
      || !Number.isSafeInteger(this.maxCalls) || this.maxCalls < 1 || this.maxCalls > 8
      || !Number.isSafeInteger(this.maxArtifacts) || this.maxArtifacts < 1 || this.maxArtifacts > 4096) fail("PI_PROFILE_CONFIG_INVALID", 400);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (lstatSync(this.root).isSymbolicLink()) fail("PI_PROFILE_STORAGE_UNSAFE");
  }
  private permit(principal: Principal, permission: string) {
    if (!principal?.id || !principal.permissions.includes(permission)) fail("FORBIDDEN", 403);
  }
  private request(selected: PiProfileSelection): PixProfileRequest {
    return { schemaVersion: pixProfilesSchema, profile: selected.profile,
      generation: "pida:" + sha256(canonical([selected.cutRef, selected.generation, selected.modelRef, selected.modelRevision, selected.policyRevision, selected.scopeDigest,
        selected.taskId, selected.artifactRefs, selected.modelKind, selected.modelProvenance, selected.coverage.ordering, selected.coverage.complete, selected.coverage.exclusions])),
      model: selected.model, ...(selected.sequential ? { sequential: selected.sequential } : {}),
      ...(selected.objects ? { objects: selected.objects } : {}), ...(selected.proxyPaths ? { proxyPaths: selected.proxyPaths } : {}),
      ...(this.options.limits ? { limits: this.options.limits } : {}) };
  }
  private async selection(principal: Principal, refs: { cutRef: string; modelRef: string }, signal?: AbortSignal): Promise<PiProfileSelection> {
    if (!label(refs.cutRef) || !label(refs.modelRef)) fail("PI_PROFILE_REFERENCE_INVALID", 400);
    signal?.throwIfAborted();
    let selected: PiProfileSelection;
    try { selected = structuredClone(await this.options.source.resolve(principal, { cutRef: refs.cutRef, modelRef: refs.modelRef }, signal)); }
    catch (error) { signal?.throwIfAborted(); if (error instanceof PidaError) throw error; return fail("PI_PROFILE_SOURCE_UNAVAILABLE"); }
    signal?.throwIfAborted();
    if (!selected || selected.ownerId !== principal.id || selected.agentId !== this.options.agentId || selected.cutRef !== refs.cutRef || selected.modelRef !== refs.modelRef) fail("PI_PROFILE_SCOPE_MISMATCH", 403);
    if (!closedKeys(selected, ["ownerId", "agentId", "cutRef", "modelRef", "cutRevision", "modelRevision", "policyRevision", "scopeDigest", "taskId", "generation", "profile", "modelKind", "modelProvenance", "artifactRefs", "coverage", "model", "proxyPaths", "sequential", "objects", "sourceRun"])
      || Buffer.byteLength(canonical(selected)) > 2_000_000 || ![selected.cutRevision, selected.modelRevision, selected.policyRevision, selected.scopeDigest].every(v => typeof v === "string" && hash.test(v))
      || !label(selected.taskId) || !label(selected.generation) || !["empirical", "aspirational", "mandatory"].includes(selected.modelKind)
      || !selected.modelProvenance || !closedKeys(selected.modelProvenance, ["sourceRef", "derivation"]) || !label(selected.modelProvenance.sourceRef) || !label(selected.modelProvenance.derivation) || !names(selected.artifactRefs)
      || !selected.coverage || !closedKeys(selected.coverage, ["complete", "sourceEventCount", "exclusions", "ordering", "evidenceRefs"]) || typeof selected.coverage.complete !== "boolean" || !names(selected.coverage.evidenceRefs) || !selected.coverage.evidenceRefs.length
      || !Number.isSafeInteger(selected.coverage.sourceEventCount) || selected.coverage.sourceEventCount < 0 || selected.coverage.sourceEventCount > 10000
      || !Array.isArray(selected.coverage.exclusions) || selected.coverage.exclusions.length > 4096
      || !selected.coverage.exclusions.every(e => e && closedKeys(e, ["eventId", "reason"]) && label(e.eventId) && label(e.reason))
      || selected.sourceRun !== undefined && (!closedKeys(selected.sourceRun, ["sessionId", "runId"]) || !label(selected.sourceRun.sessionId) || !label(selected.sourceRun.runId))
      || !validPixProfileRequest(this.request(selected))) fail("PI_PROFILE_SOURCE_INVALID", 400);
    const events = selected.sequential?.events ?? selected.objects!.events;
    const excluded = selected.coverage.exclusions.map(e => e.eventId), ids = new Set(events.map(e => e.id));
    if (new Set(excluded).size !== excluded.length || excluded.some(id => ids.has(id))
      || selected.coverage.sourceEventCount !== events.length + excluded.length
      || selected.coverage.ordering !== (selected.profile === "sequential-prefix/1" ? "source-sequence" : "selected-object-point-time")) fail("PI_PROFILE_COVERAGE_INVALID", 400);
    return selected;
  }
  private path(id: string): string {
    if (!hash.test(id)) fail("PI_PROFILE_REFERENCE_INVALID", 400);
    const path = join(this.root, `result-${id}.json`);
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size > 16_000_000)) fail("PI_PROFILE_EVIDENCE_INVALID");
    return path;
  }
  private load(principal: Principal, ref: string): PiProfileAnalysisResult {
    if (typeof ref !== "string" || !/^pi-profile-result:[a-f0-9]{64}$/.test(ref)) fail("PI_PROFILE_REFERENCE_INVALID", 400);
    const id = ref.slice("pi-profile-result:".length), path = this.path(id);
    if (!existsSync(path)) fail("PI_PROFILE_RESULT_NOT_FOUND", 404);
    let stored: { owner: string; agent: string; digest: string; value: PiProfileAnalysisResult };
    try { stored = JSON.parse(readFileSync(path, "utf8")); } catch { return fail("PI_PROFILE_EVIDENCE_INVALID"); }
    if (stored.owner !== principal.id || stored.agent !== this.options.agentId) fail("PI_PROFILE_RESULT_NOT_FOUND", 404);
    if (stored.digest !== sha256(canonical(stored.value)) || id !== sha256(canonical([stored.owner, stored.agent, stored.digest]))) fail("PI_PROFILE_EVIDENCE_INVALID");
    return { ...stored.value, resultRef: ref, resultDigest: stored.digest };
  }
  async read(principal: Principal, ref: string, signal?: AbortSignal): Promise<PiProfileAnalysisResult> {
    this.permit(principal, "pi:read");
    const result = this.load(principal, ref);
    const current = await this.selection(principal, result.selection, signal);
    const unchanged = sha256(canonical(current)) === result.selectionDigest && (!result.native?.engine || this.sameEngine(result.native));
    return { ...result, applicability: unchanged ? "CURRENT" : "STALE", processJudgment: unchanged ? result.processJudgment : "unknown" };
  }
  private sameEngine(result: PixProfileResult | undefined) {
    return result?.engine?.sourceVerified === true && result.engine.sourceCommit === this.options.enginePin.sourceCommit && result.engine.sourceDigest === this.options.enginePin.sourceDigest;
  }
  async analyze(principal: Principal, refs: { cutRef: string; modelRef: string; previousResultRef?: string }, context?: ToolContext): Promise<PiProfileAnalysisResult> {
    this.permit(principal, "pi:analyze");
    if (!Value.Check(selectSchema, refs)) fail("PI_PROFILE_ARGUMENT_INVALID", 400);
    if (context && context.principal.id !== principal.id) fail("PI_PROFILE_SCOPE_MISMATCH", 403);
    if (this.active.has(principal.id)) fail("PI_PROFILE_CONCURRENT_CALL");
    const runKey = context ? canonical([principal.id, context.sessionId, context.runId]) : undefined;
    if (runKey) {
      if ((this.calls.get(runKey) ?? 0) >= this.maxCalls || this.calls.size >= 1024 && !this.calls.has(runKey)) fail("PI_PROFILE_CALL_BUDGET", 429);
      this.calls.set(runKey, (this.calls.get(runKey) ?? 0) + 1);
    }
    this.active.add(principal.id);
    try {
      const started = performance.now(), selected = await this.selection(principal, refs, context?.signal);
      if (context && selected.sourceRun?.sessionId === context.sessionId && selected.sourceRun.runId === context.runId) fail("PI_ANALYSIS_SELF_REFERENCE");
      const selectionDigest = sha256(canonical(selected)), request = this.request(selected);
      const result: PiProfileAnalysisResult = { schemaVersion: "pida.pi.profile-analysis/1", profile: selected.profile,
        status: "unavailable", processJudgment: "unknown", businessAcceptance: "UNKNOWN", automaticCorrection: false, empiricalDeviationIsViolation: false,
        applicability: "CURRENT", transition: "recomputed", selectionDigest, selection: selected, request, issues: [], durationMs: 0,
        limits: ["HOST_SELECTED_SCOPE", "REFERENCE_ONLY_NO_ADOPTION", "NO_BUSINESS_ACCEPTANCE", "NO_NORMALIZED_FITNESS", "NO_CAUSAL_IMPROVEMENT_CLAIM"] };
      if (refs.previousResultRef) {
        const previous = this.load(principal, refs.previousResultRef);
        if (previous.selection.cutRef !== refs.cutRef || previous.selection.modelRef !== refs.modelRef) fail("PI_CHECKPOINT_SCOPE_MISMATCH");
        const old = previous.request;
        if (selected.profile === "sequential-prefix/1" && old.profile === request.profile && old.generation === request.generation
          && canonical(old.model) === canonical(request.model) && canonical(old.proxyPaths) === canonical(request.proxyPaths)
          && canonical(old.limits) === canonical(request.limits) && this.sameEngine(previous.native!)) {
          const a = old.sequential!, b = request.sequential!;
          if (a.caseId !== b.caseId || canonical(a.events) !== canonical(b.events.slice(0, a.events.length))) fail("PI_CORRECTION_REQUIRES_NEW_GENERATION");
          if (a.closed && canonical(a) !== canonical(b)) fail("PI_SOURCE_ALREADY_CLOSED");
          if (!a.closed && previous.native?.checkpoint) {
            request.resume = { checkpoint: previous.native.checkpoint, offset: a.events.length }; result.transition = "resumed";
          }
        } else result.limits.push("CHECKPOINT_IDENTITY_CHANGED_RECOMPUTED");
      }
      if (!this.options.port) result.issues = ["PIX_PROFILE_NOT_CONFIGURED"];
      else {
        try {
          const native = await this.options.port.compute(structuredClone(request), context?.signal);
          if (!validPixProfileResult(native, request) || native.engine && !this.sameEngine(native)) fail("PIX_PROFILE_RESULT_INVALID");
          result.native = native; result.issues = native.issues.map(i => i.code);
          result.status = ["computed", "partial"].includes(native.status) ? native.status as "computed" | "partial" : "unavailable";
          result.limits.push(...native.limits);
          if (native.summary) {
            if (selected.profile === "sequential-prefix/1") result.processJudgment = native.summary.closed ? "unknown" : "pending";
            else if (native.status === "computed" && native.summary.outcome === "optimal" && native.summary.cost !== null)
              result.processJudgment = native.summary.cost === 0 ? "conforms" : "deviates";
          }
          if (!selected.coverage.complete || selected.coverage.exclusions.length) {
            result.processJudgment = "unknown"; if (result.status === "computed") result.status = "partial";
            result.limits.push("SOURCE_COVERAGE_INCOMPLETE_OR_EXCLUDED");
          }
        } catch (error) {
          context?.signal.throwIfAborted();
          result.issues = [error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "PIX_PROFILE_COMPUTATION_FAILED"];
          result.status = "unavailable"; result.processJudgment = "unknown";
        }
      }
      context?.signal.throwIfAborted();
      const current = await this.selection(principal, refs, context?.signal);
      if (sha256(canonical(current)) !== selectionDigest) fail("PI_STALE_CUT");
      result.durationMs = performance.now() - started; result.limits = [...new Set(result.limits)];
      const serialized = canonical(result);
      if (Buffer.byteLength(serialized) > 15_000_000) fail("PI_PROFILE_EVIDENCE_LIMIT", 413);
      const digest = sha256(serialized), id = sha256(canonical([principal.id, this.options.agentId, digest]));
      if (!existsSync(this.path(id))) {
        if (readdirSync(this.root).length >= this.maxArtifacts) fail("PI_PROFILE_ARTIFACT_CAPACITY");
        savePrivate(this.path(id), { owner: principal.id, agent: this.options.agentId, digest, value: result });
      }
      return { ...result, resultRef: `pi-profile-result:${id}`, resultDigest: digest };
    } finally { this.active.delete(principal.id); }
  }
  tools(): BusinessTool<any>[] {
    const summary = (r: PiProfileAnalysisResult) => ({ resultRef: r.resultRef, resultDigest: r.resultDigest, profile: r.profile, status: r.status,
      processJudgment: r.processJudgment, businessAcceptance: r.businessAcceptance, applicability: r.applicability, transition: r.transition,
      modelKind: r.selection.modelKind, cutRevision: r.selection.cutRevision, modelRevision: r.selection.modelRevision,
      coverage: r.selection.coverage, summary: r.native?.summary ?? null, issues: r.issues, limits: r.limits });
    return [
      { name: "pi_profile_list", description: "List host-authorized cut and model references for separately configured PIX profiles. No model registration, source publication or grants.",
        parameters: Type.Object({}, { additionalProperties: false }), permission: "pi:read", effect: "read",
        execute: async (_a, c) => {
          this.permit(c.principal, "pi:read"); c.signal.throwIfAborted();
          const refs = await this.options.source.list?.(c.principal, c.signal) ?? [];
          if (!Array.isArray(refs) || refs.length > 64 || refs.some(r => !r || !label(r.cutRef) || !label(r.modelRef))) fail("PI_PROFILE_SOURCE_INVALID");
          const items = [];
          for (const r of refs) { const s = await this.selection(c.principal, r, c.signal); items.push({ cutRef: s.cutRef, modelRef: s.modelRef, profile: s.profile, cutRevision: s.cutRevision, modelKind: s.modelKind }); }
          return { configured: !!this.options.port, items, source: "host-selected", sourcePublication: "host-only" };
        } },
      { name: "pi_profile_analyze", description: "Analyze an authorized source cut against its host-selected native model. Sequential online costs are approximate prefix bounds and remain partial; future completion is pending. Object analysis requires explicit completion. Results grant no authority and never adopt models or change memory.",
        parameters: selectSchema, permission: "pi:analyze", effect: "read", execute: async (a: any, c) => summary(await this.analyze(c.principal, a, c)) },
      { name: "pi_profile_result", description: "Read an owned profile result with fresh source/model access and applicability checks. Stale evidence is historical and cannot describe the current cut.",
        parameters: Type.Object({ resultRef: Type.String({ pattern: "^pi-profile-result:[a-f0-9]{64}$" }) }, { additionalProperties: false }), permission: "pi:read", effect: "read",
        execute: async (a: any, c) => summary(await this.read(c.principal, a.resultRef, c.signal)) },
    ];
  }
}
