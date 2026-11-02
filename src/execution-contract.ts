/** Pida-native draft contracts. These are not the unconfirmed Schumpeter v0.1 schema. */
export const observationSchema = "pida.observation/0.1-draft" as const;
export const manifestSchema = "pida.result/0.1-draft" as const;
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
  payload: Record<string, string | number | boolean | null>;
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
