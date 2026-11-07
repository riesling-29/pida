import { canonical, sha256, isId } from "./private-state.js";
import { collaborationId, validCollaborationEnvelope, type CollaborationEnvelope, type CollaborationRecipient } from "./collaboration.js";

export interface OrganizationAdmissionDefinition {
  goal: string; root_agent_id: string; participants: string[]; criterion_ids: string[];
  criteria_digest: string; environment_revision: string; max_repair_attempts: number; timeout_ms: number;
}
export interface OrganizationAdmission {
  schema_version: "pida.organization.admission/1"; reservation_id: string; envelope: CollaborationEnvelope;
  definition: OrganizationAdmissionDefinition; definition_digest: string; admission_digest: string;
}
export interface OrganizationAdmissionReceipt {
  schema_version: "pida.organization.admission.receipt/1"; receipt_id: string; producer_id: string; request_id: string;
  payload_digest: string; definition_digest: string; admission_digest: string; reservation_id: string;
  recipient: CollaborationRecipient; received_at: string; job_id: string; root_task_id: string; root_attempt_id: string;
  phase: "organization_root_enqueued"; durable: true; durability_scope: "local-process-restart";
}
export interface OrganizationAdmissionRecord { owner: string; admission: OrganizationAdmission; receipt: OrganizationAdmissionReceipt }
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k));
const nativeId = (value: unknown): value is string => isId(value) && value.length === 36;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
export const organizationDefinitionDigest = (definition: OrganizationAdmissionDefinition): string => sha256(canonical(definition));
export function organizationAdmissionDigest(admission: Omit<OrganizationAdmission, "admission_digest"> | OrganizationAdmission): string {
  const { admission_digest: _, ...body } = admission as OrganizationAdmission; return sha256(canonical(body));
}
export function validOrganizationAdmission(value: unknown): value is OrganizationAdmission {
  if (!closed(value, ["schema_version", "reservation_id", "envelope", "definition", "definition_digest", "admission_digest"])
    || value.schema_version !== "pida.organization.admission/1" || !collaborationId(value.reservation_id) || !validCollaborationEnvelope(value.envelope)) return false;
  const d = value.definition, e = value.envelope;
  if (!closed(d, ["goal", "root_agent_id", "participants", "criterion_ids", "criteria_digest", "environment_revision", "max_repair_attempts", "timeout_ms"])
    || d.goal !== e.input || d.root_agent_id !== e.recipient.agent_id
    || !Array.isArray(d.participants) || !d.participants.length || d.participants.length > 32 || !d.participants.every(nativeId)
    || new Set(d.participants).size !== d.participants.length || !d.participants.includes(d.root_agent_id)
    || !Array.isArray(d.criterion_ids) || d.criterion_ids.length > 32 || new Set(d.criterion_ids).size !== d.criterion_ids.length
    || !d.criterion_ids.every(id => typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id) && !/[\r\n]/.test(id))
    || !digest(d.criteria_digest) || typeof d.environment_revision !== "string" || !d.environment_revision.length || d.environment_revision.length > 256 || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(d.environment_revision)
    || !Number.isSafeInteger(d.max_repair_attempts) || (d.max_repair_attempts as number) < 0 || (d.max_repair_attempts as number) > 3
    || !Number.isSafeInteger(d.timeout_ms) || (d.timeout_ms as number) < 1000 || (d.timeout_ms as number) > 86400000) return false;
  return digest(value.definition_digest) && value.definition_digest === organizationDefinitionDigest(d as unknown as OrganizationAdmissionDefinition)
    && digest(value.admission_digest) && value.admission_digest === organizationAdmissionDigest(value as unknown as OrganizationAdmission);
}
