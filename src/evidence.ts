import { randomUUID } from "node:crypto";
import { canonical, sha256 } from "./private-state.js";
import { manifestSchema, type ArtifactSnapshot, type ToolEvidence, type VerificationResult, type ResultManifest } from "./execution-contract.js";
export function artifactSnapshot(files: Record<string, string>): ArtifactSnapshot {
  const artifacts = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, content]) => {
    const hash = sha256(content);
    return { id: sha256(canonical({ path, hash })), path, sha256: hash, bytes: Buffer.byteLength(content) };
  });
  return { digest: sha256(canonical(artifacts)), artifacts };
}
export function toolEvidence(before: Record<string, string>, after: Record<string, string>, verification?: Omit<VerificationResult, "id" | "occurred_at" | "artifact_refs" | "artifact_snapshot_digest" | "actor" | "independence">): ToolEvidence {
  const previous = artifactSnapshot(before), current = artifactSnapshot(after);
  return {
    snapshot: current,
    changed: current.artifacts.filter(a => !previous.artifacts.some(b => a.id === b.id)),
    removed: previous.artifacts.filter(a => !current.artifacts.some(b => a.path === b.path)).map(a => a.id),
    previousArtifacts: previous.artifacts,
    ...(verification ? { verification: {
      ...verification, id: randomUUID(), occurred_at: new Date().toISOString(), artifact_refs: previous.artifacts.map(a => a.id),
      artifact_snapshot_digest: previous.digest, actor: "host-tool", independence: "agent-supplied-check",
    } } : {}),
  };
}
export function resultManifest(input: {
  taskId: string; runId: string; sessionId: string; agentId: string; status: ResultManifest["reported_status"];
  code?: string; version: string; snapshot?: ArtifactSnapshot; artifacts?: import("./execution-contract.js").ArtifactRef[]; inspectedAtEnd?: boolean; verification: VerificationResult[]; limits?: string[];
}): ResultManifest {
  return {
    schema_version: manifestSchema, task_id: input.taskId, run_id: input.runId, session_id: input.sessionId, agent_id: input.agentId,
    reported_status: input.status, reported_by: "runtime", verification_status: "UNKNOWN",
    artifact_refs: input.artifacts ?? input.snapshot?.artifacts ?? [], current_artifact_refs: input.snapshot?.artifacts.map(a => a.id) ?? [], evidence_refs: input.verification.map(v => v.id),
    verification_results: input.verification.map(v => ({ ...v, current_at_run_end: !!input.inspectedAtEnd && !!input.snapshot && v.artifact_snapshot_digest === input.snapshot.digest })),
    runtime_version: input.version,
    known_limits: ["NO_INDEPENDENT_TASK_ACCEPTANCE", "AGENT_SUPPLIED_CHECKS_ARE_SCOPED", ...(!input.inspectedAtEnd ? ["FINAL_ARTIFACT_STATE_UNCONFIRMED"] : []), ...(input.limits ?? [])],
    ...(input.code ? { code: input.code } : {}),
  };
}
