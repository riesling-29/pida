# Contract-bound collaboration delivery v1

Implementation unit authorized 2026-11-07. This supersedes the intake-only restriction in [owner readiness](development/PIDA-OWNER-READINESS-2026-11-07.md); its source observations and historical limits remain evidence.

## Owner agreement

Pida and Schumpeter owners agreed this bounded contract on 2026-11-07 through Codex collaboration. The agreed fields and semantics are implemented in [collaboration.ts](../src/collaboration.ts). Schumpeter will implement its own adapter against the shared fixture. PIX received the carrier mapping and explicitly distinguishes synthetic send evidence from actual Pida receive evidence. No other repository was edited by the Pida owner.

This slice handles a contract-bound external message becoming a fresh native task. Room-only chat and resuming an existing waiting parent are outside v1. `reply_to_job_id` is correlation, not a command to resume that job. Pida's native `OrgSession` remains a goal-bound execution; the persistent external organization identity is a separate field.

## Wire and canonical digest

The closed envelope schema is `pida.collaboration.envelope/1`:

- `producer_id`, `request_id`, `sender_binding_id` are opaque bounded ASCII identifiers.
- `room_id`, `room_revision`, `contract_id`, `contract_revision` identify the current externally authorized collaboration. Revisions are positive safe integers.
- `recipient` is exactly `{organization_id, host_id, org_session_id, agent_id}`. Native session/agent IDs are UUID-shaped; the external organization/host are explicit opaque identifiers.
- `input` is nonblank text, at most 12,000 UTF-16 code units, without unpaired surrogates.
- Optional `reply_to_job_id` refers to an owned, same-agent/same-org native job that has not failed, been cancelled/interrupted or entered recovery.
- `payload_digest` is lower-case SHA256 of the entire envelope except this field.

Digest algorithm for this closed domain: recursively sort fixed ASCII object keys lexicographically, use compact JSON scalar escaping with Unicode scalar string values retained, encode UTF-8, then SHA256. No whitespace is inserted. Arrays are not part of this envelope; floats, unknown keys and unsupported values are rejected by validation. For the validated domain Python's `json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False)` is equivalent. Pida exports `collaborationDigest` and `validCollaborationEnvelope`; digest calculation alone is not validation or authorization.

[Shared golden envelope](../fixtures/collaboration/envelope-v1.json) includes Korean, emoji, newline and quotes. File SHA256: `ee7386c009799ac52b976b26c99b45b4fceae4dc78338581045da8c71aebfdfe`; expected payload digest: `b3e9a68120885e6a91cec1062c718899a0cd2e22f5d6c8d46e222df30cfd0edd`.

## Authority and endpoints

The principal comes from host authentication, never the body. Both `pida:agents` and `pida:collaborate` permissions are required. `AgentSupervisorOptions.collaboration` is opt-in and contains a host ID and an `authorize` callback. Without it, delivery is disabled.

The host callback receives a detached principal/envelope, phase (`receive`, `read`, `dispatch`) and bounded abort signal. It must check current sender binding, external organization -> host/native session/agent mapping, current room/contract revisions and grants. Only literal `true` allows the operation; rejection, timeout or absence fails closed. Pida additionally checks native ownership, membership, active session/deadline and late reply state. These local checks run after asynchronous receive authorization; dispatch checks run immediately before the native runtime starts. Cancellation still follows existing cooperative runtime semantics. Policy changes do not themselves preempt an already running job; the host can use normal cancellation. Persona authorization remains a separate per-model-dispatch runtime check.

HTTP/SDK:

- `POST /v1/collaboration/messages` / `PidaClient.receiveCollaboration(envelope)` returns HTTP 202 and a receipt.
- `GET /v1/collaboration/receipts/{receipt_id}` / `getCollaborationReceipt(id)` requires current read authority.

The current standalone workspace CLI does not enable a default permissive collaboration policy. Embedded hosts must configure it; the Schumpeter adapter must provide an authoritative mapping instead of inferring identity from names. This is an explicit deployment integration requirement.

## Durable boundary and receipt meaning

Deduplication scope is authenticated owner + producer ID + request ID + recipient organization ID. A duplicate with the same payload returns the same immutable receipt; a different payload conflicts. Changing native mapping while reusing that scoped request ID also conflicts. A different recipient organization is a separate delivery, subject to authorization.

Supervisor state **version 3** stores envelope, receipt, exact native job and organization task in the same `supervisor.json`. Receive validates before mutation, persists all four through existing temporary-file fsync + atomic replacement, then schedules and acknowledges. There is no cross-file receive/job gap. v1/v2 state migrates without inventing historical collaboration evidence; old binaries reject v3, so downgrade requires restoring a compatible backup. Single-writer locking remains active.

Receipt schema `pida.collaboration.receipt/1` includes `receipt_id`, `producer_id`, `request_id`, `payload_digest`, `recipient`, `received_at`, `job_id`, `phase: job_enqueued`, `durable: true`, `durability_scope: local-process-restart`. It proves the local persisted mapping. It does **not** prove model input inclusion, response, local check acceptance, enterprise acceptance, transport authentication beyond host policy, or power-loss/directory-fsync durability. Do not render it as a later phase.

After cancellation or completion, an authorized exact duplicate returns historical receipt only and does not re-enqueue. New deliveries to an inactive native session fail. Interrupted running jobs follow existing no-blind-replay recovery; receipt history is not permission to retry their effects.

PIX carrier identity is the producer/request/recipient-organization tuple, with authenticated principal scope retained separately. `receipt_id` names receive evidence and `job_id` names exact execution mapping. Receipt timestamps do not establish send/response causality or a total cross-producer sequence. No new fabricated send or model-use trace is emitted by this slice.

## Validation and remaining scope

[Collaboration tests](../test/collaboration.test.mjs) exercise concurrent duplicate receives, changed-payload conflict, current authority, absent policy, native mapping/foreign owner rejection, cancellation races/late replies, persisted corruption, v2 migration and real HTTP+SDK. [Crash subprocess](../test/fixtures/collaboration-crash.mjs) exits immediately before replacement, immediately after replacement and after successful receive without cleanup; reopen verifies all-or-nothing job mapping and exact receipt reuse. Scripted Pi runs then verify one root job plus one mapped job. No real external model response is claimed.

Initial focused run: nine collaboration and thirteen existing organization tests passed on Windows/Node24.18.0. Full-suite result and later Persona integration evidence are recorded in [implementation validation](development/PIDA-COLLABORATION-VALIDATION-20261107.md). Full two-org question/re-question/answer/resume, live authority service, actual provider acceptance and Linux desktop acceptance remain separate gates.

Withdraw the durability claim if a committed receive can lose its mapping or a same-scoped retry creates another native job after a process restart. Withdraw authorization coverage if a rejected/stale/cancelled delivery can dispatch in the tested pre-dispatch window. Recheck after changes to these source files, policy semantics or persisted state format; this document is not acceptance for future revisions.
