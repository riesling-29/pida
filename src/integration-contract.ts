import { Type } from "typebox";
import { Value } from "typebox/value";
import { canonical, sha256 } from "./private-state.js";
import { observationSchema, manifestSchema, type ObservationBundle } from "./execution-contract.js";
import { validContextDescriptor } from "./run-context.js";
const object = (properties: Record<string, any>) => Type.Object(properties, { additionalProperties: false });
const str = Type.String({ maxLength: 512 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const refs = Type.Array(str, { maxItems: 10000 });
const nullable = (schema: any) => Type.Union([schema, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const nonnegative = Type.Number({ minimum: 0 });
const payload = object(Object.fromEntries(Object.entries({
  turn_id: str, turn_index: positive,
  model: str, api: str, request_id: nullable(str), stop_reason: str,
  attempt: nullable(positive), provider_generation: str, thinking_level: str,
  context_window: positive, model_max_tokens: positive,
  effective_config_digest: hash, system_digest: hash, tools_digest: hash, fingerprint_scope: str,
  usage_status: Type.Union(["normalized", "unknown", "invalid", "partial", "reported"].map(s => Type.Literal(s))),
  input_tokens: nullable(count), uncached_input_tokens: nullable(count), output_tokens: nullable(count),
  cache_read_tokens: nullable(count), cache_write_tokens: nullable(count), reasoning_tokens: nullable(count), tokens: nullable(count),
  cost_usd: nullable(nonnegative), first_output_ms: nullable(nonnegative), duration_ms: nullable(nonnegative),
  tool_call_id: str, parent_tool_call_id: str, tool_name: str,
  status: str, code: nullable(str), persistence_error: nullable(str), scope: str,
  handoff: Type.Boolean(), operation: str, compacted: Type.Boolean(), target_session_id: str,
  interrupted: Type.Boolean(), detected_on_restore: Type.Boolean(),
  // A loaded descriptor can contain 32 revision refs. Its JSON structure is checked below.
  descriptor: Type.String({ minLength: 2, maxLength: 8192 }),
  inclusion_scope: Type.Literal("pi-logical-context"),
  input_digest: hash, input_digest_scheme: Type.Literal("source-hmac-sha256"),
  authorization: Type.Union([Type.Literal("current-provider-check"), Type.Literal("snapshot-only")]),
  source: Type.Union([Type.Literal("provider"), Type.Literal("summarization")]), max_attempts: count, delay_ms: nonnegative,
  allowed: Type.Boolean(), success: Type.Boolean(),
}).map(([key, schema]) => [key, Type.Optional(schema)])));
export const observationJsonSchema = object({
  schema_version: Type.Literal(observationSchema), source_id: str, source_event_id: str, agent_id: str,
  session_id: str, task_id: str, run_id: str, activity: str, occurred_at: str,
  sequence_number: Type.Integer({ minimum: 1 }), capture_mode: Type.Literal("native-runtime"), payload_digest: hash,
  object_refs: refs, artifact_refs: refs, evidence_refs: refs, data_scope: Type.Literal("metadata-only"), payload,
});
const artifact = object({ id: hash, path: str, sha256: hash, bytes: Type.Integer({ minimum: 0 }) });
const verification = object({
  id: str, scope: Type.Union([Type.Literal("quickjs-assertions"), Type.Literal("isolated-browser")]),
  status: Type.Union([Type.Literal("PASSED"), Type.Literal("FAILED"), Type.Literal("UNAVAILABLE")]),
  definition_digest: hash, artifact_snapshot_digest: hash, artifact_refs: refs, occurred_at: str,
  assertions: Type.Optional(Type.Integer({ minimum: 0 })), actor: Type.Literal("host-tool"), independence: Type.Literal("agent-supplied-check"), current_at_run_end: Type.Boolean(),
});
export const manifestJsonSchema = object({
  schema_version: Type.Literal(manifestSchema), task_id: str, run_id: str, session_id: str, agent_id: str,
  reported_status: Type.Union(["completed", "failed", "cancelled", "limited", "interrupted"].map(s => Type.Literal(s))),
  reported_by: Type.Literal("runtime"), verification_status: Type.Literal("UNKNOWN"), artifact_refs: Type.Array(artifact), current_artifact_refs: refs,
  evidence_refs: refs, verification_results: Type.Array(verification), runtime_version: str, known_limits: refs, code: Type.Optional(str),
});
export const bundleJsonSchema = object({
  schema_version: Type.Literal("pida.bundle/0.1-draft"), session_id: str, run_id: str, complete: Type.Boolean(), known_limits: refs,
  events: Type.Array(observationJsonSchema, { maxItems: 10000 }), manifest: Type.Optional(manifestJsonSchema),
});
/** Local producer contract validation only; no claim of acceptance by Schumpeter/PIX. */
export function validateObservationBundle(input: unknown): { valid: boolean; issues: string[]; duplicateEventIds: string[] } {
  if (!Value.Check(bundleJsonSchema, input)) return { valid: false, issues: ["SCHEMA_INVALID"], duplicateEventIds: [] };
  const bundle = input as unknown as ObservationBundle, issues = new Set<string>(), duplicates: string[] = [];
  const seen = new Map<string, string>(); let sequence = 0, terminal: string | undefined;
  const requests = new Map<string, number | null | undefined>(), contextReceipts = new Set<string>();
  const requestEvents = new Map<string, string>();
  for (const event of bundle.events) if (event.activity === "model_request" && typeof event.payload.request_id === "string") {
    const identity = event.source_id + "/" + event.source_event_id;
    if (requestEvents.has(event.payload.request_id) && requestEvents.get(event.payload.request_id) !== identity) issues.add("MODEL_REQUEST_ID_CONFLICT");
    requestEvents.set(event.payload.request_id, identity);
    requests.set(event.payload.request_id, event.payload.attempt);
  }
  const first = bundle.events[0], precedingRequests = new Set<string>();
  let loadedDescriptor: string | undefined;
  for (const event of bundle.events) {
    const key = event.source_id + "/" + event.source_event_id, encoded = canonical(event);
    if (seen.has(key)) { if (seen.get(key) !== encoded) issues.add("EVENT_ID_CONFLICT"); else duplicates.push(event.source_event_id); continue; }
    seen.set(key, encoded);
    terminal = event.activity;
    if (event.session_id !== bundle.session_id || event.run_id !== bundle.run_id) issues.add("IDENTITY_MISMATCH");
    if (first && (event.task_id !== first.task_id || event.agent_id !== first.agent_id || event.source_id !== first.source_id)) issues.add("SOURCE_IDENTITY_MISMATCH");
    if (event.sequence_number !== ++sequence) issues.add("SEQUENCE_GAP");
    if (event.payload_digest !== sha256(canonical(event.payload))) issues.add("PAYLOAD_DIGEST_MISMATCH");
    if (!Number.isFinite(Date.parse(event.occurred_at))) issues.add("INVALID_TIMESTAMP");
    if (event.activity === "model_request" && typeof event.payload.request_id === "string") precedingRequests.add(event.payload.request_id);
    if (["context_snapshot_loaded", "context_input_included", "context_input_omitted", "context_summary_authorized"].includes(event.activity) || event.payload.descriptor !== undefined) {
      let descriptor: unknown;
      try { descriptor = JSON.parse(event.payload.descriptor ?? ""); } catch { /* invalid below */ }
      if (!["context_snapshot_loaded", "context_input_included", "context_input_omitted", "context_summary_authorized"].includes(event.activity) || !validContextDescriptor(descriptor, true)) issues.add("CONTEXT_DESCRIPTOR_INVALID");
      const external = (descriptor as any)?.personaBinding?.externalContext;
      if (external && (external.runId !== event.run_id || external.taskId !== event.task_id)) issues.add("CONTEXT_BINDING_MISMATCH");
      if (event.activity === "context_snapshot_loaded") loadedDescriptor = event.payload.descriptor;
    }
    if (event.activity === "context_summary_authorized" && (!event.payload.request_id || !event.payload.attempt || event.payload.source !== "summarization"
      || !event.payload.input_digest || event.payload.input_digest_scheme !== "source-hmac-sha256" || event.payload.authorization !== "current-provider-check"
      || event.payload.fingerprint_scope !== event.source_id || event.payload.descriptor !== loadedDescriptor)) issues.add("CONTEXT_SUMMARY_BINDING_INVALID");
    if (["context_input_included", "context_input_omitted"].includes(event.activity)) {
      const requestId = event.payload.request_id;
      const key = String(requestId);
      if (typeof requestId !== "string" || !requestId || typeof event.payload.attempt !== "number" ||
          event.payload.inclusion_scope !== "pi-logical-context" || !precedingRequests.has(requestId) ||
          requests.get(requestId) !== event.payload.attempt || contextReceipts.has(key)) issues.add("CONTEXT_RECEIPT_INVALID");
      if (event.payload.input_digest !== undefined || event.payload.input_digest_scheme !== undefined || event.payload.authorization !== undefined) {
        if (!event.payload.input_digest || event.payload.input_digest_scheme !== "source-hmac-sha256" || !event.payload.authorization
          || event.payload.fingerprint_scope !== event.source_id || event.payload.descriptor !== loadedDescriptor) issues.add("CONTEXT_INPUT_BINDING_INVALID");
      }
      contextReceipts.add(key);
    }
  }
  const manifest = bundle.manifest;
  if (manifest) {
    if (manifest.session_id !== bundle.session_id || manifest.run_id !== bundle.run_id) issues.add("MANIFEST_IDENTITY_MISMATCH");
    if (first && (manifest.task_id !== first.task_id || manifest.agent_id !== first.agent_id)) issues.add("MANIFEST_IDENTITY_MISMATCH");
    const artifacts = new Set(manifest.artifact_refs.map(a => a.id)), evidence = new Set(manifest.verification_results.map(v => v.id));
    if (artifacts.size !== manifest.artifact_refs.length || evidence.size !== manifest.verification_results.length) issues.add("DUPLICATE_MANIFEST_ID");
    for (const artifact of manifest.artifact_refs) if (artifact.id !== sha256(canonical({ path: artifact.path, hash: artifact.sha256 }))) issues.add("ARTIFACT_ID_MISMATCH");
    if (manifest.current_artifact_refs.some(id => !artifacts.has(id))) issues.add("ARTIFACT_REF_MISSING");
    if (manifest.evidence_refs.some(id => !evidence.has(id))) issues.add("EVIDENCE_REF_MISSING");
    const snapshotDigest = (ids: string[]) => sha256(canonical(ids.map(id => manifest.artifact_refs.find(a => a.id === id)).filter(a => a !== undefined).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
    for (const verification of manifest.verification_results) {
      if (verification.artifact_refs.some(id => !artifacts.has(id))) issues.add("VERIFICATION_ARTIFACT_MISSING");
      if (verification.artifact_snapshot_digest !== snapshotDigest(verification.artifact_refs)) issues.add("VERIFICATION_SNAPSHOT_MISMATCH");
      if (verification.current_at_run_end && (verification.artifact_snapshot_digest !== snapshotDigest(manifest.current_artifact_refs) || manifest.known_limits.includes("FINAL_ARTIFACT_STATE_UNCONFIRMED"))) issues.add("STALE_VERIFICATION_CLAIM");
      if (!Number.isFinite(Date.parse(verification.occurred_at))) issues.add("INVALID_TIMESTAMP");
    }
    for (const event of bundle.events) {
      if (event.artifact_refs.some(id => !artifacts.has(id))) issues.add("EVENT_ARTIFACT_MISSING");
      if (event.evidence_refs.some(id => !evidence.has(id))) issues.add("EVENT_EVIDENCE_MISSING");
    }
  }
  if (bundle.complete && (issues.has("SEQUENCE_GAP") || !["run_finished", "operation_finished"].includes(terminal ?? "") || (terminal === "run_finished" && !manifest))) issues.add("FALSE_COMPLETENESS");
  return { valid: issues.size === 0, issues: [...issues], duplicateEventIds: duplicates };
}
