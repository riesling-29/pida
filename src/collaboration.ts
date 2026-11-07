import { canonical, sha256, isId } from "./private-state.js";
import type { Principal } from "./runtime.js";

/** Contract-bound external delivery. No permission or principal is supplied by the sender. */
export interface CollaborationRecipient {
  organization_id: string; host_id: string; org_session_id: string; agent_id: string;
}
export interface CollaborationEnvelope {
  schema_version: "pida.collaboration.envelope/1";
  producer_id: string; request_id: string; payload_digest: string;
  room_id: string; room_revision: number; contract_id: string; contract_revision: number;
  sender_binding_id: string; recipient: CollaborationRecipient; input: string;
  /** Correlation only: creates a fresh task, never resumes an existing waiting attempt. */
  reply_to_job_id?: string;
}
export interface CollaborationReceipt {
  schema_version: "pida.collaboration.receipt/1";
  receipt_id: string; producer_id: string; request_id: string; payload_digest: string;
  recipient: CollaborationRecipient; received_at: string; job_id: string;
  phase: "job_enqueued"; durable: true; durability_scope: "local-process-restart";
}
export interface CollaborationPolicy {
  hostId: string;
  /** Validate CURRENT sender binding, recipient mapping, room/contract revisions and grants.
   * Rejection/absence fails closed. This is not Persona input authorization. */
  authorize(input: { principal: Principal; envelope: CollaborationEnvelope; phase: "receive" | "read" | "dispatch"; signal: AbortSignal }): boolean | Promise<boolean>;
}
export interface CollaborationRecord { owner: string; envelope: CollaborationEnvelope; receipt: CollaborationReceipt }
export const collaborationId = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && !/[\r\n]/.test(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const nativeId = (value: unknown): value is string => isId(value) && value.length === 36;
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(k => keys.includes(k));
/** Fixed ASCII keys; lexicographically sorted recursively; JSON scalar escaping; UTF-8 SHA256.
 * Only the closed validated envelope domain (safe positive integers, Unicode scalar strings) is supported. */
export function collaborationDigest(envelope: Omit<CollaborationEnvelope, "payload_digest"> | CollaborationEnvelope): string {
  const { payload_digest: _, ...body } = envelope as CollaborationEnvelope;
  return sha256(canonical(body));
}
export function validCollaborationEnvelope(value: unknown): value is CollaborationEnvelope {
  if (!closed(value, ["schema_version", "producer_id", "request_id", "payload_digest", "room_id", "room_revision", "contract_id", "contract_revision", "sender_binding_id", "recipient", "input", "reply_to_job_id"])) return false;
  const r = value.recipient;
  return value.schema_version === "pida.collaboration.envelope/1"
    && [value.producer_id, value.request_id, value.room_id, value.contract_id, value.sender_binding_id].every(collaborationId)
    && [value.room_revision, value.contract_revision].every(n => Number.isSafeInteger(n) && (n as number) > 0)
    && closed(r, ["organization_id", "host_id", "org_session_id", "agent_id"])
    && collaborationId(r.organization_id) && collaborationId(r.host_id) && nativeId(r.org_session_id) && nativeId(r.agent_id)
    && typeof value.input === "string" && !!value.input.trim() && value.input.length <= 12000 && !/[\uD800-\uDFFF]/u.test(value.input)
    && (value.reply_to_job_id === undefined || nativeId(value.reply_to_job_id))
    && typeof value.payload_digest === "string" && /^[a-f0-9]{64}$/.test(value.payload_digest)
    && value.payload_digest === collaborationDigest(value as unknown as CollaborationEnvelope);
}
export function collaborationKey(owner: string, e: CollaborationEnvelope): string {
  return canonical([owner, e.producer_id, e.request_id, e.recipient.organization_id]);
}
