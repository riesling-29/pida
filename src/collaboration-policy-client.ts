import { randomUUID } from "node:crypto";
import { canonical } from "./private-state.js";
import { collaborationId, validCollaborationEnvelope, type CollaborationPolicy, type CollaborationEnvelope, type CollaborationRecipient } from "./collaboration.js";
import { PidaError } from "./runtime.js";

export interface CollaborationAuthorizationRequest {
  schema_version: "schumpeter.pida.authorization.request/1"; request_id: string;
  phase: "receive" | "read" | "dispatch"; principal_id: string; host_id: string; envelope: CollaborationEnvelope;
}
export interface CollaborationAuthorizationResponse {
  schema_version: "schumpeter.pida.authorization.response/1"; request_id: string; authorized: boolean;
  phase: "receive" | "read" | "dispatch";
  principal_id: string; host_id: string; payload_digest: string; room_revision: number; contract_revision: number; recipient: CollaborationRecipient;
}
export interface CollaborationPolicyClientOptions { hostId: string; authorizationUrl: string; token(): string; timeoutMs?: number }
/** Fixed literal loopback endpoint from trusted host config; never a URL from envelope/model data. */
export function createCollaborationPolicyClient(options: CollaborationPolicyClientOptions): CollaborationPolicy {
  let url: URL;
  try { url = new URL(options.authorizationUrl); } catch { throw new PidaError("COLLABORATION_POLICY_CONFIG_INVALID", 400); }
  const timeout = options.timeoutMs ?? 2000;
  if (!collaborationId(options.hostId) || typeof options.token !== "function" || !Number.isSafeInteger(timeout) || timeout < 50 || timeout > 4000
    || !["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/v1/pida-authorization") throw new PidaError("COLLABORATION_POLICY_CONFIG_INVALID", 400);
  const endpoint = url.href, hostId = options.hostId, token = options.token;
  return { hostId, async authorize({ principal, envelope, phase, signal }) {
    if (!validCollaborationEnvelope(envelope) || envelope.recipient.host_id !== hostId || !["receive", "read", "dispatch"].includes(phase)) return false;
    const request: CollaborationAuthorizationRequest = { schema_version: "schumpeter.pida.authorization.request/1", request_id: randomUUID(), phase,
      principal_id: principal.id, host_id: hostId, envelope: structuredClone(envelope) };
    const stop = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    try {
      stop.throwIfAborted(); const credential = token();
      if (typeof credential !== "string" || credential.length < 32 || credential.length > 4096 || /[\r\n]/.test(credential)) return false;
      const response = await fetch(endpoint, { method: "POST", redirect: "error", cache: "no-store", signal: stop,
        headers: { authorization: "Bearer " + credential, "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(request) });
      if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" || !response.body) return false;
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8192) { await reader.cancel(); return false; } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CollaborationAuthorizationResponse;
      return !stop.aborted && !!value && typeof value === "object" && Object.keys(value).length === 10
        && value.schema_version === "schumpeter.pida.authorization.response/1" && value.request_id === request.request_id && value.authorized === true
        && value.phase === phase
        && value.principal_id === request.principal_id && value.host_id === hostId && value.payload_digest === envelope.payload_digest
        && value.room_revision === envelope.room_revision && value.contract_revision === envelope.contract_revision && canonical(value.recipient) === canonical(envelope.recipient);
    } catch { return false; }
  } };
}
