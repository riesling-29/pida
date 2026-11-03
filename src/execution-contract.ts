/** Pida-native draft contracts. These are not the unconfirmed Schumpeter v0.1 schema. */
export const observationSchema = "pida.observation/0.1-draft" as const;
export const manifestSchema = "pida.result/0.1-draft" as const;
/** Validator capability revision; existing persisted event/bundle identities are unchanged. */
export const observationContractRevision = "pida.export-validation/0.3" as const;
/** Closed metadata vocabulary. Descriptor is a bounded JSON-encoded LoadedRunContext,
 * validated structurally by the exporter contract, not arbitrary context text. */
export interface ObservationPayload {
  model?: string; api?: string; request_id?: string | null; stop_reason?: string;
  attempt?: number | null; provider_generation?: string; thinking_level?: string;
  context_window?: number; model_max_tokens?: number;
  effective_config_digest?: string; system_digest?: string; tools_digest?: string; fingerprint_scope?: string;
  usage_status?: "normalized" | "unknown" | "invalid" | "partial" | "reported";
  input_tokens?: number | null; uncached_input_tokens?: number | null; output_tokens?: number | null;
  cache_read_tokens?: number | null; cache_write_tokens?: number | null; reasoning_tokens?: number | null;
  tokens?: number | null; cost_usd?: number | null; first_output_ms?: number | null; duration_ms?: number | null;
  tool_call_id?: string; parent_tool_call_id?: string; tool_name?: string;
  status?: string; code?: string | null; persistence_error?: string | null; scope?: string;
  handoff?: boolean; operation?: string; compacted?: boolean; target_session_id?: string;
  interrupted?: boolean; detected_on_restore?: boolean; descriptor?: string;
  inclusion_scope?: "pi-logical-context";
  input_digest?: string; input_digest_scheme?: "source-hmac-sha256";
  authorization?: "current-provider-check" | "snapshot-only";
  source?: "provider" | "summarization"; max_attempts?: number; delay_ms?: number; allowed?: boolean; success?: boolean;
}
export interface ArtifactRef { id: string; path: string; sha256: string; bytes: number }
export interface ArtifactSnapshot { digest: string; artifacts: ArtifactRef[] }
export interface VerificationResult {
  id: string;
  scope: "quickjs-assertions" | "isolated-browser";
  status: "PASSED" | "FAILED" | "UNAVAILABLE";
  definition_digest: string;
  artifact_snapshot_digest: string;
  artifact_refs: string[];
  occurred_at: string;
  assertions?: number;
  actor: "host-tool";
  independence: "agent-supplied-check";
}
/** Host-produced metadata only; never extract this from arbitrary model/tool JSON. */
export interface ToolEvidence {
  snapshot: ArtifactSnapshot;
  changed: ArtifactRef[];
  removed: string[];
  verification?: VerificationResult;
  previousArtifacts?: ArtifactRef[];
}
export interface Observation {
  schema_version: typeof observationSchema;
  source_id: string;
  source_event_id: string;
  agent_id: string;
  session_id: string;
  task_id: string;
  run_id: string;
  activity: string;
  occurred_at: string;
  sequence_number: number;
  capture_mode: "native-runtime";
  payload_digest: string;
  object_refs: string[];
  artifact_refs: string[];
  evidence_refs: string[];
  data_scope: "metadata-only";
  payload: ObservationPayload;
}
export interface ResultManifest {
  schema_version: typeof manifestSchema;
  task_id: string;
  run_id: string;
  agent_id: string;
  session_id: string;
  reported_status: "completed" | "failed" | "cancelled" | "limited" | "interrupted";
  reported_by: "runtime";
  verification_status: "UNKNOWN";
  artifact_refs: ArtifactRef[];
  current_artifact_refs: string[];
  evidence_refs: string[];
  verification_results: (VerificationResult & { current_at_run_end: boolean })[];
  runtime_version: string;
  known_limits: string[];
  code?: string;
}
export interface ObservationBundle {
  schema_version: "pida.bundle/0.1-draft";
  session_id: string;
  run_id: string;
  complete: boolean;
  known_limits: string[];
  events: Observation[];
  manifest?: ResultManifest;
}
