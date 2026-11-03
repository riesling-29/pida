import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { canonical, sha256 } from "./private-state.js";
import { PidaError } from "./runtime.js";
import { validatePersonaSnapshot, type PersonaProvider, type PersonaRequest, type PersonaInputRequest } from "./persona-provider.js";
import type { RunContextSnapshot } from "./run-context.js";
import { veraBindingJsonSchema, veraContextJsonSchema } from "./vera-contract.js";

/** Host-injected local/remote transport. No endpoint, credential or authority is selected by a model. */
export interface VeraPersonaPort {
  resolve(request: PersonaRequest): Promise<{ binding: unknown; context: unknown }>;
  /** Read-only, current authority check on EVERY dispatch, including retry/tool follow-up.
   * Return the exact request binding. Never enqueue work or mint a context-use receipt here. */
  authorizeInput(request: PersonaInputRequest & { binding: Readonly<Record<string, unknown>>; context: Readonly<Record<string, unknown>> }):
    Promise<{ authorized: true; requestId: string; bindingId: string; contextDigest: string; inputDigest: string }>;
}
export interface VeraPersonaOptions {
  agentId: string; principalId: string; providerPrincipal: string; personaId: string;
  hostId: string; projectId: string; organizationSessionId: string; agentInstanceId: string;
  role: string; memoryScope: string[]; port: VeraPersonaPort;
  /** Inject only for a synthetic clock profile. Production default is Unix wall time. */
  now?: () => number;
}
const fail = () => { throw new PidaError("VERA_CONTEXT_INVALID", 400); };
const extId = (x: unknown) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
/** Same PS-C14N-1 domain as the producer. Never coerce floats, undefined or invalid Unicode. */
function checkedJson(value: unknown, depth = 0): void {
  if (depth > 32) fail();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail(); return; }
  if (typeof value === "string") { if (/[\uD800-\uDFFF]/u.test(value)) fail(); return; }
  if (Array.isArray(value)) { value.forEach(v => checkedJson(v, depth + 1)); return; }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail();
  for (const [k, v] of Object.entries(value as object)) { if (!/^[\x00-\x7f]*$/.test(k)) fail(); checkedJson(v, depth + 1); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
/** Supports the observed Vera 0.2 closed wire contract; it does not create a Persona service. */
export function createVeraPersonaProvider(options: VeraPersonaOptions): PersonaProvider {
  const o = { ...options, memoryScope: [...options.memoryScope] };
  if (![o.agentId, o.principalId, o.providerPrincipal, o.personaId, o.hostId, o.projectId, o.organizationSessionId, o.agentInstanceId].every(extId)
    || typeof o.role !== "string" || !o.role || o.role.length > 200 || /[\x00-\x1f\x7f]/.test(o.role)
    || !o.memoryScope.length || o.memoryScope.length > 64 || new Set(o.memoryScope).size !== o.memoryScope.length
    || !o.memoryScope.every(s => /^(personal|project|organization):[A-Za-z0-9._-]{1,100}$/.test(s))
    || !o.memoryScope.includes("project:" + o.projectId) || typeof o.port?.resolve !== "function" || typeof o.port?.authorizeInput !== "function") throw new PidaError("VERA_PROVIDER_CONFIG_INVALID", 400);
  const clock = o.now ?? (() => Math.floor(Date.now() / 1000));
  // Weak snapshot keys hold no cross-run cache and need no new identity/state database.
  const selections = new WeakMap<RunContextSnapshot, { binding: any; context: any; request: { sessionId: string; runId: string; taskId: string } }>();
  const authorize = (r: PersonaRequest) => {
    r.signal.throwIfAborted();
    if (r.principal.id !== o.principalId || r.agentId !== o.agentId || ![r.sessionId, r.runId, r.taskId].every(extId)) throw new PidaError("PERSONA_SCOPE_DENIED", 403);
  };
  const live = (c: any) => { const now = clock(); if (!Number.isSafeInteger(now) || now < c.created_at || now >= c.valid_until) throw new PidaError("VERA_CONTEXT_EXPIRED", 403); };
  const provider: PersonaProvider = {
    id: "pida.vera-continuity/0.2", agentId: o.agentId, authority: "external",
    async resolveContext(request) {
      authorize(request);
      const raw = await o.port.resolve(request); authorize(request);
      checkedJson(raw);
      if (!raw || Object.keys(raw).some(k => !["binding", "context"].includes(k)) || Buffer.byteLength(canonical(raw)) > 262144) fail();
      const b: any = structuredClone(raw.binding), c: any = structuredClone(raw.context);
      if (!Value.Check(veraBindingJsonSchema as TSchema, b) || !Value.Check(veraContextJsonSchema as TSchema, c)) fail();
      if (b.principal !== o.providerPrincipal || b.persona_id !== o.personaId || b.host_id !== o.hostId || b.project_id !== o.projectId
        || b.organization_session_id !== o.organizationSessionId || b.agent_instance_id !== o.agentInstanceId
        || b.run_id !== request.runId || b.task_id !== request.taskId
        || canonical([...b.memory_scope].sort()) !== canonical([...o.memoryScope].sort())
        || c.binding_id !== b.binding_id || c.persona_id !== b.persona_id || c.scopes.some((s: string) => !o.memoryScope.includes(s))) fail();
      const { digest, ...body } = c;
      if (sha256(canonical(body)) !== digest || sha256(c.text) !== c.text_digest || c.text.length > 16000
        || Buffer.byteLength(c.text) !== c.budget.used || c.budget.used > c.budget.limit || c.budget.used > 65536
        || c.valid_until <= c.created_at || c.valid_until - c.created_at > 300 || c.omitted.working_state
        || c.truncated !== (c.omitted.memories > 0)) fail();
      live(c);
      // Check rendered identity/state linkage without interpreting its natural-language content.
      const prefix = "Vera continuity reference (vera-continuity/0.2.0)\n";
      let rendered: any;
      try { rendered = JSON.parse(c.renderer_version === "vera-json/1" ? c.text : c.text.startsWith(prefix) ? c.text.slice(prefix.length) : ""); } catch { fail(); }
      checkedJson(rendered);
      if (rendered.contract !== c.schema_version || rendered.identity?.persona_id !== c.persona_id || rendered.identity?.identity_revision !== c.identity_revision
        || (rendered.working_state?.state_id ?? null) !== c.state_ref) fail();
      const snapshot: RunContextSnapshot = { text: c.text, descriptor: { schemaVersion: 1, rendererVersion: c.renderer_version,
        personaRevision: c.identity_revision, informationState: null, experiences: [], truncated: c.truncated,
        personaBinding: { schemaVersion: 1, providerId: provider.id, personaId: c.persona_id, authority: "external", agentId: o.agentId,
          role: o.role, scopeId: sha256(canonical({ principal: o.principalId, host: o.hostId, project: o.projectId, scope: o.memoryScope.slice().sort() })),
          contextRevision: c.digest, contextDigest: c.text_digest, rendererVersion: c.renderer_version, omitted: c.truncated,
          externalContext: { contractVersion: c.schema_version, contextId: c.context_id, bindingId: b.binding_id, bindingDigest: sha256(canonical(b)),
            agentInstanceId: b.agent_instance_id, projectId: b.project_id, organizationSessionId: b.organization_session_id,
            taskId: b.task_id, attemptId: b.attempt_id, runId: b.run_id, hostId: b.host_id,
            memoryRevision: c.memory_revision, branch: c.branch, headRevision: c.head_revision, stateRef: c.state_ref,
            modelsDigest: sha256(canonical({ refs: c.model_refs, activations: c.model_activations })), analysesDigest: sha256(canonical(c.analysis_refs)),
            artifactsDigest: sha256(canonical(c.artifact_refs)), createdAt: c.created_at, validUntil: c.valid_until },
        } } };
      validatePersonaSnapshot(snapshot, provider);
      selections.set(snapshot, { binding: freeze(b), context: freeze(c), request: { sessionId: request.sessionId, runId: request.runId, taskId: request.taskId } });
      return freeze(snapshot);
    },
    async authorizeInput(request) {
      authorize(request);
      const selected = selections.get(request.snapshot);
      if (!selected || selected.request.runId !== request.runId || selected.request.taskId !== request.taskId || selected.request.sessionId !== request.sessionId) throw new PidaError("VERA_INPUT_BINDING_MISMATCH", 403);
      live(selected.context);
      const ack = await o.port.authorizeInput({ ...request, binding: selected.binding, context: selected.context });
      authorize(request); live(selected.context);
      if (!ack || Object.keys(ack).some(k => !["authorized", "requestId", "bindingId", "contextDigest", "inputDigest"].includes(k))
        || ack.authorized !== true || ack.requestId !== request.requestId || ack.bindingId !== selected.binding.binding_id
        || ack.contextDigest !== selected.context.digest || ack.inputDigest !== request.inputDigest) throw new PidaError("VERA_INPUT_ACK_MISMATCH", 403);
    },
  };
  return provider;
}
