import { canonical, sha256 } from "./private-state.js";
import { artifactSnapshot } from "./evidence.js";
import type { Principal } from "./runtime.js";
import type { AgentProfile } from "./agent-supervisor.js";

/** Closed host checks; neither a tool result nor model prose can supply a receipt. */
export interface LocalCriterion { id: string; kind: "file-contains" | "json-equals"; path: string; expected: string; required: boolean }
export interface LocalAcceptanceOptions {
  criteria: readonly LocalCriterion[];
  capture(profile: AgentProfile, principal: Principal): Promise<Record<string, string>>;
  environmentRevision?: string;
}
export interface LocalReceipt {
  id: string; taskId: string; attemptId: string; jobId: string; owner: string; agentId: string;
  artifactSnapshotDigest?: string; criteriaDigest: string; environmentRevision: string;
  status: "PASS" | "FAIL" | "UNKNOWN"; occurredAt: string;
  checks: { id: string; required: boolean; status: "PASS" | "FAIL" | "UNKNOWN" }[];
  issuer: "pida-host"; scope: "workbench-exact-revision";
}
export interface OrgSession {
  id: string; owner: string; requestId: string; definitionDigest: string; goal: string;
  participants: string[]; rootTaskId: string; criterionIds: string[]; criteriaDigest: string; environmentRevision: string;
  maxRepairAttempts: number; deadlineAt: number; createdAt: string;
  status: "active" | "accepted" | "failed" | "unknown" | "cancelled" | "expired";
}
export interface OrgTask {
  id: string; orgId: string; agentId: string; assignmentRevision: 1; inputDigest: string;
  attempts: string[]; status: "queued" | "waiting" | "completed" | "accepted" | "failed" | "unknown" | "cancelled";
  receipts: LocalReceipt[];
}
export interface OrgAttempt { id: string; taskId: string; jobId: string; kind: "initial" | "continuation" | "repair"; number: number }
export interface BatchJoin {
  id: string; orgId: string; taskId: string; parentJobId: string; requestId: string; payloadDigest: string;
  revision: number; required: string[]; optional: string[]; deadlineAt: number; failurePolicy: "block";
  status: "waiting" | "ready" | "blocked" | "cancelled" | "expired"; code?: string;
  continuationJobId?: string;
  results?: { assignmentJobId: string; attemptId: string; jobId: string; inputDigest: string; resultDigest: string; status: string; runId?: string }[];
}
export interface OrganizationState { sessions: OrgSession[]; tasks: OrgTask[]; attempts: OrgAttempt[]; joins: BatchJoin[] }
export const emptyOrganizations = (): OrganizationState => ({ sessions: [], tasks: [], attempts: [], joins: [] });
export const localEnvironment = "pida-local-checks/1:node-" + process.versions.node;
export function validCriteria(criteria: readonly LocalCriterion[]): boolean {
  return Array.isArray(criteria) && criteria.length <= 32 && new Set(criteria.map(c => c?.id)).size === criteria.length && criteria.every(c => c && Object.keys(c).every(k => ["id", "kind", "path", "expected", "required"].includes(k))
    && typeof c.id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(c.id) && ["file-contains", "json-equals"].includes(c.kind)
    && typeof c.path === "string" && /^[A-Za-z0-9_-][A-Za-z0-9_./ -]{0,239}$/.test(c.path) && c.path.split("/").every((p: string) => p && !p.startsWith("."))
    && typeof c.expected === "string" && c.expected.length > 0 && c.expected.length <= 16000 && typeof c.required === "boolean"
    && (c.kind !== "json-equals" || (() => { try { JSON.parse(c.expected); return true; } catch { return false; } })()));
}
export function criterionDigest(criteria: readonly LocalCriterion[]) { return sha256(canonical([...criteria].sort((a, b) => a.id.localeCompare(b.id)))); }
/** Only the host-captured bounded bytes are evaluated. No tools, shell, network or model execution. */
export function evaluateLocal(files: Record<string, string>, criteria: readonly LocalCriterion[]) {
  const entries = Object.entries(files);
  if (entries.length > 64 || entries.some(([p, v]) => !p || typeof v !== "string" || Buffer.byteLength(v) > 131072) || entries.reduce((n, [, v]) => n + Buffer.byteLength(v), 0) > 2097152) throw Error("ACCEPTANCE_SUBJECT_INVALID");
  const snapshot = artifactSnapshot(files);
  const checks = criteria.map(c => {
    let passed = false;
    if (Object.hasOwn(files, c.path)) {
      if (c.kind === "file-contains") passed = files[c.path]!.includes(c.expected);
      else { try { passed = canonical(JSON.parse(files[c.path]!)) === canonical(JSON.parse(c.expected)); } catch { /* failed JSON check */ } }
    }
    return { id: c.id, required: c.required, status: passed ? "PASS" as const : "FAIL" as const };
  });
  const required = checks.filter(c => c.required);
  return { artifactSnapshotDigest: snapshot.digest, checks, status: !required.length ? "UNKNOWN" as const : required.every(c => c.status === "PASS") ? "PASS" as const : "FAIL" as const };
}
export function boundedAgentResult(value: string, limit = 6000) {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{10,})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*)["']?[^\s,"';}]+["']?/gi, "$1[REDACTED]").slice(0, limit);
}
