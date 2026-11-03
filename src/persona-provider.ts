import { agentMemoryRevision, type AgentMemoryStore } from "./agent-memory.js";
import { canonical, sha256 } from "./private-state.js";
import { PidaError, type Principal } from "./runtime.js";
import { validContextDescriptor, type RunContextSnapshot } from "./run-context.js";

/** Consumer port owned by Pida; external PersonaSubstrate compatibility is not asserted. */
export interface PersonaRequest {
  principal: Principal; agentId: string; sessionId: string; runId: string; taskId: string; signal: AbortSignal;
}
export interface PersonaAnalysisRecord {
  kind: "reflection" | "awareness";
  modelKind: "empirical" | "aspirational" | "mandatory";
  modelRef: string; modelDigest: string;
  resultRef: string; resultDigest: string;
  snapshotDigest: string;
  evidenceRefs: string[];
  /** Interpretation remains an agent report; never promoted to identity or policy. */
  interpretation?: string;
}
export interface PersonaAnalysisRequest extends PersonaRequest {
  expectedRevision: string; idempotencyKey: string; record: PersonaAnalysisRecord;
}
export interface PersonaAppendReceipt {
  status: "appended" | "duplicate"; recordId: string; revision: number; contextRevision: string;
}
export interface PersonaProvider {
  readonly id: string;
  readonly agentId: string;
  readonly authority: "pida-local" | "external";
  resolveContext(request: PersonaRequest): RunContextSnapshot | Promise<RunContextSnapshot>;
  appendAnalysis?(request: PersonaAnalysisRequest): PersonaAppendReceipt | Promise<PersonaAppendReceipt>;
}
const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const label = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);
function assertRef(ref: unknown): asserts ref is string {
  if (typeof ref !== "string" || ref.length > 512 || !/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(ref)
    || /^(bearer|authorization|password|secret|analysis-key|analysis-payload):/i.test(ref)) throw new PidaError("INVALID_PERSONA_ANALYSIS_REFERENCE", 400);
  if (/^https?:/i.test(ref)) {
    let url: URL; try { url = new URL(ref); } catch { throw new PidaError("INVALID_PERSONA_ANALYSIS_REFERENCE", 400); }
    if (url.username || url.password || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key))) throw new PidaError("INVALID_PERSONA_ANALYSIS_REFERENCE", 400);
  }
}
export function validatePersonaSnapshot(snapshot: unknown, provider: PersonaProvider): asserts snapshot is RunContextSnapshot {
  const value = snapshot as RunContextSnapshot;
  if (!value || typeof value !== "object" || Object.keys(value).some(k => !["text", "descriptor"].includes(k))
    || typeof value.text !== "string" || !value.text.trim() || value.text.length > 16000 || Buffer.byteLength(value.text) > 65536
    || !validContextDescriptor(value.descriptor) || !value.descriptor.personaBinding
    || value.descriptor.personaBinding.providerId !== provider.id || value.descriptor.personaBinding.agentId !== provider.agentId
    || value.descriptor.personaBinding.authority !== provider.authority || value.descriptor.personaBinding.contextDigest !== sha256(value.text)
    || JSON.stringify(value.descriptor).length > 7600) throw new PidaError("PERSONA_CONTEXT_INVALID", 500);
}
/** Reuses one existing canonical memory store. No mirror registry or dual-write path. */
export function createLocalPersonaProvider(memory: AgentMemoryStore, options: {
  principalId: string; workspaceId: string; personaId?: string; role?: string; maxChars?: number;
}): PersonaProvider {
  const id = "pida.agent-memory/1", agentId = memory.agentId;
  const personaId = options.personaId ?? "pida-local:" + sha256(canonical({ principalId: options.principalId, workspaceId: options.workspaceId, agentId }));
  const role = options.role ?? "agent";
  if (!label(options.principalId) || !label(options.workspaceId) || !label(personaId) || !label(role)) throw new PidaError("INVALID_PERSONA_PROVIDER_CONFIG", 400);
  const scopeId = sha256(canonical({ principalId: options.principalId, workspaceId: options.workspaceId, agentId }));
  const authorize = (request: PersonaRequest, write = false) => {
    request.signal.throwIfAborted();
    if (request.principal.id !== options.principalId || request.agentId !== agentId) throw new PidaError("PERSONA_SCOPE_DENIED", 403);
    if (write && !request.principal.permissions.includes("agent:memory:write")) throw new PidaError("FORBIDDEN", 403);
  };
  const provider: PersonaProvider = {
    id, agentId, authority: "pida-local",
    resolveContext(request) {
      authorize(request);
      const view = memory.view(), selected = memory.contextForRun(options.maxChars ?? 12000, view);
      const snapshot: RunContextSnapshot = { text: selected.text, descriptor: { ...selected.descriptor, personaBinding: {
        schemaVersion: 1, providerId: id, personaId, authority: "pida-local", agentId, role, scopeId,
        contextRevision: agentMemoryRevision(view), contextDigest: sha256(selected.text), rendererVersion: selected.descriptor.rendererVersion,
        omitted: selected.descriptor.truncated,
      } } };
      validatePersonaSnapshot(snapshot, provider);
      return snapshot;
    },
    appendAnalysis(request) {
      authorize(request, true);
      const record = request.record;
      if (!record || Object.keys(record).some(k => !["kind", "modelKind", "modelRef", "modelDigest", "resultRef", "resultDigest", "snapshotDigest", "evidenceRefs", "interpretation"].includes(k))
        || !["reflection", "awareness"].includes(record.kind) || !["empirical", "aspirational", "mandatory"].includes(record.modelKind)
        || !hex(record.modelDigest) || !hex(record.resultDigest) || !hex(record.snapshotDigest)
        || !Array.isArray(record.evidenceRefs) || record.evidenceRefs.length > 20 || new Set(record.evidenceRefs).size !== record.evidenceRefs.length
        || (record.interpretation !== undefined && (typeof record.interpretation !== "string" || record.interpretation.length > 2000))) throw new PidaError("INVALID_PERSONA_ANALYSIS_REFERENCE", 400);
      for (const ref of [record.modelRef, record.resultRef, ...record.evidenceRefs]) assertRef(ref);
      const text = JSON.stringify({ type: "behavior-analysis-reference", ...record, interpretationStatus: "agent-report", activatesIdentity: false, activatesPolicy: false });
      const appended = memory.appendAnalysisReference({ expectedRevision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey, payloadDigest: sha256(canonical({ agentId, scopeId, expectedRevision: request.expectedRevision, record })), text,
        sourceRefs: [...new Set([record.modelRef, record.resultRef, ...record.evidenceRefs])] });
      return { status: appended.status, recordId: appended.experience.id, revision: appended.experience.revision, contextRevision: appended.contextRevision };
    },
  };
  return provider;
}
