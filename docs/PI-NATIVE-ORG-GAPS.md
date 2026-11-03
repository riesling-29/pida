# PI-native organization execution: reuse and remaining gaps

Date: 2026-11-03 KST. Scope: pida only. This is a source assessment and a next-slice design, not an implemented organization controller or a live integration result.

Assessment baseline: local `fix/runtime-stabilization` at `0b454cb` (package 0.8.3), corresponding delivered PR #1 head `e08edcfc98b0ca7e3450714865eaae294b1c1c3f`. The local worktree was clean when this assessment began. The accompanying first implementation slice addresses producer validation, Persona consumption and direct PIX analysis; it does not implement the organization design below.

The controlling requirements are `INT-PD-*` in the supplied 2026-11-03 integrated report. They are not equivalent to older `PD-*` identifiers. In particular, the new mouse-capable TUI direction supersedes the earlier Web-first hypothesis in `INTERFACE-DIRECTION.md`; no TUI implementation is established by that decision.

## Existing implementation and requirement status

| Requirement | Existing implementation to reuse | Current gap / status |
| --- | --- | --- |
| INT-PD-01: autonomous organization | `AgentSupervisor` owns profiles, durable jobs, execution admission and current-principal resolution. Each job invokes the existing `PidaRuntime.run` and Pi session. | **Partial foundation.** There is no authoritative OrgSession goal, criterion set, task/attempt distinction, organization budget or local acceptance state. A profile/job list is not an OrgSession. |
| INT-PD-03: durable delegation, join, continuation | `enqueue` deduplicates `(agentId, requestId)` and rejects changed input/parent under the same key. `parentJobId` and depth persist. Shared workspace scheduling and crash reconciliation already exist. | **Partial delegation; join/continuation unimplemented.** Required/optional child membership, immutable assignment revision, failure branches, deadlines and parent wakeup are absent. |
| INT-PD-04: execution-connected inbox | Agent tools can enqueue work and read bounded results. Existing job requests survive restart. | **Unimplemented conversation protocol.** No thread/mailbox/outbox, delivered/input-included/replied receipt, or clarification round trip. Delegation forbids ancestor cycles; that rule must not be reused as the conversation graph. |
| INT-PD-11: local verification, repair and acceptance | Workbench checks produce host-collected, definition- and artifact-digest-bound evidence. `resultManifest` records whether evidence matches the final inspected snapshot. The agent can repair and invoke checks again. | **Partial evidence; independent task acceptance unimplemented.** Manifest `verification_status` remains `UNKNOWN`; checks explicitly have `independence: agent-supplied-check`. Project shell exit zero is not acceptance, and host-project artifacts are not included in workbench snapshots. |

These are source-level findings. Existing tests cover actual Pi with scripted decisions, local filesystem/process behavior and protocol fixtures. They are not evidence that the proposed organization paths ran or that a real model completed them.

## Exact reuse points and invariants

| Source | Existing behavior to preserve | Consequence for the next slice |
| --- | --- | --- |
| `src/agent-supervisor.ts`: `State`, `persist`, constructor | Profiles and jobs share one private atomic file replacement; previously running jobs become interrupted and their profiles pause for reconciliation. | Put related join state and continuation intent in the same durable record. Do not claim a transaction across separate JSON files or power-loss durability beyond `savePrivate`. Reject unknown future formats and validate migration explicitly. |
| `AgentSupervisor.enqueue` | Same request key and same content return the existing job; different content conflicts. An owned parent sets delegation depth. | Derive a stable continuation request key from join ID and revision. Persist its input digest and result references. Retry after an uncertain response must find the existing continuation. |
| `AgentSupervisor.pump`, `execute`, `active` | One active job per agent and workspace key; `maxConcurrent` bounds admitted jobs. Current permissions are resolved at start. Active state clears only after `execute` settles. | A waiting task must not keep a running Pi call alive while polling children. Queue a later attempt after the parent run settles; reacquire current authority at admission. |
| `src/runtime.ts`: `run`, `acquireRunLease`, pending tools | Runtime release is delayed until abort-ignoring callbacks settle. Effects may remain unknown even when a model run ends. | Do not release a real writer lease merely by marking an organization task `waiting`. Do not admit a continuation over unsettled callbacks, unknown effects or managed-command ownership. |
| `src/workspace.ts`: shared lease and command guards | Main and agent runtimes share the project gate; unreconciled agent state blocks the matching workspace. | Organization scheduling must use this gate, including main-runtime contention, rather than a second independent mutex. Unrelated workspaces may still proceed. |
| `src/agent-tools.ts`: `agent_delegate` | Queues immediately; tool descriptions warn that a child sharing the workspace runs only after the parent job ends. Ancestry comes from the current owned run, not model arguments. | Keep immediate queue admission separate from acceptance/completion. A new join tool may declare intent, but cannot claim the child started or finished. |
| `src/effects.ts` | Pending or unknown effects block further unsafe effects. Reconciliation is explicit and host-owned. | A child status or join timeout is not evidence that its external effect did not occur. Do not automatically rerun interrupted children. |
| `src/evidence.ts`, `src/workbench.ts` | Snapshot hashes describe exact content; check definitions and artifact snapshots are recorded. `current_at_run_end` compares against a final host inspection. | Reuse snapshot identity, but keep integrity, scoped tests and independent acceptance separate. New output invalidates applicability of old acceptance without erasing historical evidence. |

## Shortest independent next slice

Implement a bounded **batch join and exact-revision acceptance** before generalized agent conversation. The implementation should extend the supervisor around Pi rather than add another model/tool loop.

1. Add versioned organization/task/attempt/join records to the supervisor's own durable state. An organization owns a goal, a host-selected criterion set and participants. An assignment records input revision/digest, required or optional membership, deadline and explicit terminal-failure policy.
2. Bind a task to its existing queued job/attempt. Register join membership before observing completion; children that finish before registration are reconciled from durable job results. A parent ends its current run normally and the task enters waiting only when the actual runtime lease is free. No blocking wait tool is introduced.
3. At terminal settlement or startup reconciliation, evaluate the join from durable facts. Required failure, cancellation, interruption or unresolved effects must not produce a successful join. Optional failure remains visible. Persist the join decision and one continuation identity atomically with the corresponding queued job, or persist a deterministic intent and dispatch it through existing request-key deduplication.
4. Start the continuation through normal `pump` admission on the parent's existing session. Include bounded, referenced child results as untrusted data. Preserve source assignment/result revisions; child prose is not an instruction or verification receipt. An expired, cancelled or revised join cannot silently activate an older continuation.
5. Add host-owned acceptance records keyed by task/attempt, artifact snapshot digest, criterion-definition digest, verifier/environment revision and issuer scope. Host-selected deterministic verifier callbacks must inspect the exact pinned subject. A model cannot supply a successful receipt or rewrite required criteria. Results are `PASS`, `FAIL` or `UNKNOWN`; required unknown blocks only that task's acceptance.
6. A failed criterion may schedule a separately identified repair attempt within an explicit attempt/time budget. Repair creates a new artifact revision and requires re-verification. Automatic retries remain prohibited for unknown external effects. A full mandatory/optional criterion set must pass on the current exact revision before local acceptance is emitted.

The first supported artifact scope should be the existing bounded workbench. General project repositories require a defined capture and verifier execution boundary before claiming equivalent support. A verifier returning a digest is not sufficient: the host must control what bytes were passed to it, the criterion definition, and the recorded execution outcome.

## Races and focused acceptance tests

| Case | Required result |
| --- | --- |
| Two required children finish in reverse order | Same join decision and exactly one continuation identity; source result refs remain correct. |
| Duplicate terminal result or duplicate join registration | Same content is idempotent; changed content under the same key conflicts. |
| Restart after child completion, before continuation dispatch | Reconcile durable results and enqueue one continuation, without rerunning children. |
| Restart after continuation admission, before acknowledgement | Existing request key identifies the original attempt. Running work becomes interrupted and follows existing reconciliation rules. |
| `maxConcurrent = 1` and one shared project | Parent finishes, releases its actual lease, children run, then continuation runs. No busy polling or slot deadlock. |
| Parent callback ignores cancellation or command still runs | Waiting task status does not release workspace ownership. Other writers remain blocked until the actual guard permits them. |
| Required child fails; optional child fails | Required failure blocks success; optional failure is retained without pretending it passed. A configured repair branch is a new attempt. |
| Join cancelled/revised while last child finishes | Revision/CAS check prevents stale continuation. No unrelated task is cancelled. |
| Permission revoked before continuation starts | Current host principal resolution blocks the attempt; saved permissions are never replayed. |
| Artifact r6 passes, then r7 is produced | r6 receipt remains historical; r7 is `UNKNOWN` until its own required checks run. |
| Same bytes but changed criterion or verifier environment | Old acceptance is not reused under the new verification definition. |
| Model claims success, exit zero, forged/stale receipt | No task acceptance is created from these facts alone. |
| Required checker is unavailable | `UNKNOWN` for this task and criterion; unaffected work continues. |
| Acceptance result replay/conflict across restart | Same identity/content deduplicates; changed payload conflicts; no duplicate repair attempt. |
| Ownership or subject substitution | Another principal, task or artifact revision cannot reuse the receipt. |

## Subsequent slices, explicitly not delivered here

- **Conversation inbox (INT-PD-04):** a separate thread/message graph with durable outbox and inbox; distinguish received, input-included, task-accepted and replied receipts. Test A question → B clarification → A supplement → B answer → A original-task continuation, duplicate wakeups, TTL/budget and automated reply loops. Do not weaken task-cycle protection to make this pass.
- **TUI (INT-PD-12):** attach a reused mouse-capable terminal frontend to the existing host/HTTP/SDK. Attaching/replaying must not start a run; detach, pause, cancel and shutdown remain distinct. Real Windows IME/mouse/resize tests are outstanding. The Web service builder and preview remain supported.
- **External runner (INT-PD-13):** select one real CLI/ACP backend and preserve its native loop. Declare start/status/events/result/cancel capability and limitations. Existing program proxies and process handles are not this adapter.
- **Aggregate budgets (INT-PD-14):** existing per-run limits and scheduler concurrency do not constitute measured parent-plus-child billing limits. Preserve unknown usage and unsupported hard sandbox/cap status.
- **Procedure comparison and federation (INT-PD-15/16):** require versioned candidate/baseline/rollback and producer-consumer receipts. They must not change another application's canonical state or assume enterprise acceptance from local PASS.

No code outside pida was modified. No organization controller code or new organization test execution is claimed by this document.
