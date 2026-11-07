# Organization root admission /1

Status: implementation contract agreed by Pida and Schumpeter adapter owners on 2026-11-07, after explicit parent authorization. Not implemented or accepted at this document's first revision. Existing collaboration envelope /1, delivery /1 and native `createOrganization` semantics remain separate.

## Purpose and alternatives

Pida organizations are goal-bound sessions. A persistent Schumpeter organization must not be represented by keeping a native coordinator paused forever. Existing operator-owned `createOrganization` already runs its first root task once; it remains the no-extension alternative when a durable external collaboration receipt is not required. This unit adds atomic external admission when the first task must carry current collaboration authority and a durable exact root-job receipt. It does not create a root goal and then enqueue the same incoming work again.

Schumpeter preallocates a fresh native OrgSession UUID and records it as an authoritative **reservation**, together with an existing native root agent and complete admission definition. Reserved identity is not evidence that a Pida session exists or execution occurred. The reservation explicitly permits the exact first root dispatch while current grants remain valid. Promotion to an observed binding follows receipt verification and is reconciliation only; it is not a prerequisite that could race the admission ACK. An observed binding without the same retained reservation/admission provenance cannot authorize this API.

## Closed admission request

`POST /v1/collaboration/organization-admissions` accepts:

```text
{
  schema_version: "pida.organization.admission/1",
  reservation_id,
  envelope: <unchanged pida.collaboration.envelope/1>,
  definition: {
    goal, root_agent_id, participants, criterion_ids, criteria_digest,
    environment_revision, max_repair_attempts, timeout_ms
  },
  definition_digest,
  admission_digest
}
```

All fields are required except the envelope's existing optional reply correlation. `goal` equals `envelope.input`; `root_agent_id` equals `envelope.recipient.agent_id`. Every participant is an owned existing native agent, unique, and the root is included. `recipient.org_session_id` is the proposed fresh native session UUID. Budgets match the existing native limits: 0–3 repairs, timeout 1,000–86,400,000 ms; there are no implicit defaults. Arrays retain their supplied order in digests; retries must use the same definition.

`definition_digest` is SHA256 over the canonical definition. `admission_digest` is SHA256 over the whole closed outer object with only `admission_digest` omitted, including the nested envelope and `definition_digest`. Canonicalization uses the existing collaboration rules: recursively sorted ASCII keys, compact JSON scalar escaping, UTF-8 bytes, safe integers and Unicode scalar strings. These digests bind participants, goal, budgets and host acceptance definitions, not merely message text. A shared Pida helper and non-ASCII golden request will be published with implementation before consumer integration.

Authenticated `GET /v1/collaboration/organization-admission-capabilities` reports schema `pida.organization.admission.capabilities/1`, enabled configuration, host/schema IDs, supervisor state version 4 and `acceptance:{criterion_ids,criteria_digest,environment_revision,criteria}`. IDs are the ASCII-sorted list of **all** host criteria, descriptors and digest are supplied by the host. This first bounded profile requires exactly that complete list and the current host-computed digest/environment revision. The client must not guess Node environment strings or reproduce locale-dependent criterion ordering. Empty criteria are allowed but yield UNKNOWN native acceptance, not PASS. Capability readback is not a grant.

## Current authority wire /2

The fixed policy endpoint remains `/v1/pida-authorization`, but the host invokes a separate `authorizeAdmission` method. Existing policy wire /1 is unchanged.

Request has exactly six fields:

```text
{schema_version:"schumpeter.pida.authorization.request/2", request_id:<fresh nonce>,
 phase:"admit"|"read"|"dispatch", principal_id, host_id, admission:<full closed request>}
```

Response has exactly fourteen fields:

```text
{schema_version:"schumpeter.pida.authorization.response/2", request_id, phase, authorized,
 principal_id, host_id, admission_digest, definition_digest, payload_digest, reservation_id,
 room_revision, contract_revision, recipient, reservation_state:"reserved"|"observed"|null}
```

Success requires literal `authorized:true`, exact nonce/phase/identity/recipient/digest/revision echoes and reservation state `reserved` or `observed`. Denial may use null when no reservation exists; Pida never treats denial as execution permission. Endpoint configuration, credential separation, timeout/abort, redirect rejection and response bounds retain /1 guarantees. Schumpeter authenticates the host, maps the principal independently, checks sender/current room and contract authority, then checks the exact persisted reservation and all admission fields. An arbitrary existing native mapping or echoed request values are insufficient. Revocation is checked again immediately before actual native dispatch, including derived native attempts; no receipt or reserved state substitutes for it.

## Durable boundary and receipt

After current authorization, Pida checks collisions, current host criteria and capacity, then commits one native OrgSession, one root OrgTask/OrgAttempt/job, and one admission record/receipt in the same bounded durable supervisor write. Nothing is scheduled before that commit. Existing state versions migrate with an empty admission collection; old collaboration receipts remain intact. A source mismatch or native ID collision must not adopt an existing session, even if its owner matches.

Receipt schema `pida.organization.admission.receipt/1` contains `receipt_id`, `producer_id`, `request_id`, `payload_digest`, `definition_digest`, `admission_digest`, `reservation_id`, `recipient`, `received_at`, `job_id`, `root_task_id`, `root_attempt_id`, `phase:"organization_root_enqueued"`, `durable:true`, `durability_scope:"local-process-restart"`. The proposed native session ID is already exact in `recipient.org_session_id`. Readback and idempotent retries recheck current authority and return the same immutable receipt; they do not create another session/job or re-execute a completed/interrupted task. Receipt readback uses a separate admission-receipt route. Deduplication retains authenticated owner + producer + request + persistent recipient organization scope and checks the complete admission digest; reservation reuse and native session ID reuse also conflict. Altered definition/payload under the same scope returns 409.

Lost ACK or a Schumpeter crash before promotion is reconciled by replaying the exact admission. Pida returns its existing receipt; Schumpeter verifies all native IDs/digests before marking the reservation observed. The same reservation remains the source of current dispatch authorization throughout. New independent work for the persistent organization uses a new reserved native goal session.

Optional `reply_to_job_id` is correlation only, never `parentJobId` or waiting-parent resume. For this profile it may reference an owned same-recipient-agent prior job that is the latest native task attempt, non-cancelled and without recovery uncertainty; accepted states are queued, running or completed. The new reservation authorizes only the new work. Cross-agent/foreign or stale/cancelled references are rejected. Schumpeter can retain external message correlation separately and omit this field when these native constraints do not fit.

## Verification and falsification

Required checks include actual first-root execution once; single durable root mapping before ACK; restart/lost ACK returning the same org/job/receipt; changed definition and all ID collisions; capacity failure with no partial publication; revoked reservation before execution; observed binding lacking reservation provenance; promotion crash reconciliation; current authority on root descendants; old state migration; and existing native create/delivery regression. Scripted Pi, real provider execution, independent review and final desktop acceptance must remain separately recorded.

Withdraw this contract if reservation grants can authorize a different definition, if promotion timing alone causes first-work failure, if root work duplicates, if IDs are inferred rather than verified, or if replays silently create effects. Validity is limited to this version and subsequent exact implemented source evidence. No cross-process atomic transaction, durable canonical Persona memory, cross-producer total event ordering, cost estimate or final desktop acceptance is claimed here.
