# Runtime stabilization through PATCH-08

Date: 2026-10-25. Implementation is available for review; real-model acceptance and the external Schumpeter contract remain open. This is not a release or production-readiness certification.

## Baseline and delivery

- Target repository/branch: `riesling-29/pida`, `feat/pida-workspace`, original HEAD `7d480d0d3d0da5153f089d2993ebcaba54934962`.
- PATCH-00–02: commit `58451b0e9f32312a0c54147786233d62d284872a`; details in [RUNTIME-STABILIZATION.md](RUNTIME-STABILIZATION.md).
- Delivery branch: `fix/runtime-stabilization-00-02` (historical name retained); [draft PR #1](https://github.com/riesling-29/pida/pull/1) now includes PATCH-03–08. Obtain the final implementation HEAD from that PR; local reconstructed snapshot hashes are not upstream commit hashes.
- Package remains `pida-core@0.6.1`. Node requirement remains `>=22.19.0`; tested here on Linux, Node `v24.22.1`, npm `11.9.0`, Pi AI/coding-agent/agent-core `1.2.0`. No dependency or lockfile changes.

| Patch | Implemented and connected | Validation / remaining limit |
| --- | --- | --- |
| 00 | Baseline inventory; opt-in actual-model runners | Original 69 tests; no reachable user LM Studio in this environment |
| 01 | Explicit workspace identity and config diagnostics | Cwd propagation, restored session and nested-config regression; native Windows not run |
| 02 | Classified tool failures, recovery keys, cancellation/persistence outcome precedence | Actual Pi loop with synthetic model; failure/repair/retest and interruption races |
| 03 | Separate durable effect receipts; replay guard; shared time/turn/tool/observed-usage budgets | Applied mutation executes once across output continuation; unknown effect blocks further writes; idempotent host key |
| 04 | Interrupted run identity, restore observations and controlled effect reconciliation | Real child-process exit after a side effect; restart blocks replay; corrupted session metadata fails closed |
| 05 | UI match diagnostics; revision-bound browser result; host artifact snapshots | Actual Chromium counter/reset/navigation after two Pi-driven edits; stale verification rejected |
| 06 | Metadata journal, optional sink, JSON/JSONL export, ownership | Stable IDs after restart; ring buffer independence; disk/sink failures; HTTP/client exports |
| 07 | ResultManifest with versioned artifacts and scoped evidence | Completion never implies VERIFIED; changed files invalidate current verification; unknowns explicit |
| 08 | Native draft schemas, strict validator and positive/negative fixtures | Local producer validation only; Schumpeter ObservationEnvelope v0.1 not confirmed |

## Retry and recovery policy

Pi still owns model streaming, the agent loop, sessions and compaction. There is no copied runtime engine. The host adds execution-boundary guards.

| Condition | Behavior |
| --- | --- |
| Provider connection/response failure | Stop with a sanitized failure code. No automatic provider request replay. Caller may retry after inspecting state. |
| Output limit | At most `maxOutputRetries` continuations, default 1, sharing the original deadline/turn/tool/usage budgets. Incomplete calls never execute. Pending effects prevent continuation; applied identical non-idempotent calls cannot repeat within the run. |
| Declared tool failure | Pi may repair within the same bounded run. Only a matching host recovery key can supersede an earlier declared failure. |
| Unclassified tool exception | Failed run; a started effect becomes unknown. No automatic mutation retry. |
| Timeout / cancellation | First interruption wins. Cancellation is cooperative; completed side effects are not rolled back. |
| Process exit during mutation | Receipt remains started/unknown. Restart marks the session interrupted and blocks writes, including writes with different arguments, until trusted reconciliation. |
| Corrupt session metadata | Startup fails with `SESSION_METADATA_INVALID`. Preserve a backup and repair externally; no silent quarantine, reset or format migration. |
| Failed compaction / oversized handoff | Preserve source session, report failure, do not replay tools. Handoff is blocked while effects are unresolved. |
| Observation/sink failure | Continue agent execution; export reports incomplete/delivery limits. Effect-ledger persistence failures instead prevent mutations. |

Tools may declare `effect: "read"`, `"write"` or `"idempotent"`. Undeclared tools are conservatively treated as writes. `effectResult` is a trusted host callback, not a model-provided flag. An idempotent tool receives `context.idempotencyKey`; its implementation must actually honor that key. The runtime does not turn arbitrary external APIs into idempotent services.

Receipts store tool/run/call IDs, timestamps, state and an HMAC of canonical arguments. They do not store arguments or results. Identity is session/run/tool/argument scoped: this prevents a particular replay within one run, not semantically equivalent changes across tasks or sessions. Legitimate identical non-idempotent operations in one run are conservatively rejected. Pending receipts survive restart; deleting a session deletes its receipts and must not be used as an uncertainty-recovery shortcut.

The trusted embedding host can inspect and reconcile, after checking the affected files/system independently:

```js
const recovery = runtime.getRecovery(sessionId, principal);
// Inspect the real effect before deciding. principal must also have pida:recover.
runtime.reconcileEffect(sessionId, principal, effectId, "applied");
// Use "not_applied" only with evidence that the effect did not occur.
```

Reconciliation is not exposed to the model or as an HTTP mutation endpoint. There is no organization retry scheduler, multi-agent recovery loop or automatic rollback.

`maxTotalTokens` limits cumulative usage reported by observed assistant responses. SDK `maxCostUsd` requires the host assertion `pricingVerified: true`; otherwise construction fails with `COST_BUDGET_UNAVAILABLE`. Unknown usage fails closed when a budget requires it. These are post-response continuation guards, not hard billing caps: an in-flight response may exceed the limit, and Pi-internal compaction/auxiliary requests are not fully exported or charged to this counter. Manifests explicitly include `PI_INTERNAL_REQUEST_USAGE_NOT_EXPORTED`; unverified pricing yields `COST_UNKNOWN`, not zero cost. A cost-budgeted runtime rejects provider switching until reconstructed with appropriate pricing.

## Observation interface

Native producer schema identifiers are `pida.observation/0.1-draft`, `pida.bundle/0.1-draft` and `pida.result/0.1-draft`. They are deliberately not named Schumpeter ObservationEnvelope v0.1. See [fixture contract notes](../fixtures/schumpeter-readiness/README.md).

The archive records run/turn start, observable model request/response metadata, tool start/end/failure, output retry, interruption, compaction/restore/handoff, artifact changes, scoped verification and final outcome. Request IDs identify host-observed requests, not provider-issued IDs. Unseen internal requests are not invented. `occurred_at` is capture time; interrupted-run detection is timestamped at restore, with `ORIGINAL_END_TIME_UNKNOWN` rather than a fabricated crash time. Restore/compaction are separate operation bundles; a run interrupted before its terminal event remains incomplete even when a recovery manifest exists.

Persistent identity and journals live under `<stateDir>/observations/`. IDs are generated once at capture and retained across exports. Sequence numbers are per operation/run. `payload_digest` is SHA-256 over the canonical JSON payload (sorted object keys, preserved array order, UTF-8), not a signature or whole-envelope authenticity proof. Stable source/event IDs allow duplicate detection. The JSONL file is independent of the UI trace ring.

Default retention per run is 4,000 events, with a 16 MiB cap. Limit/disk loss is visible through `complete: false` and `known_limits`; partial evidence must not be treated as a complete audit. Optional `ObservationSink.write(event)` is a separate asynchronous interface, with at most 64 pending deliveries; it never calls the UI/SSE consumer. Delivery failure/pending diagnostics are process-local, best effort, with no durable delivery queue or acknowledgement protocol. Local bundle completeness is separate from successful external delivery.

Exports omit raw prompts, responses, tool input/output, endpoint URLs and credentials. Artifact paths, tool names, hashes, model labels, timing and identifiers are still potentially sensitive metadata. Pi transcripts remain sensitive and are not part of this export. The archive is not encrypted, signed or an immutable audit log. A deployment needs its own retention policy; deleting a session removes its archive. Keep exports private until the receiving system's authorization/data policy is established.

## API, client and CLI

All HTTP routes use existing authentication and session-owner checks. Reading archived observations does not initialize the model provider.

| Method / path | Result |
| --- | --- |
| `GET /v1/sessions/:id/runs` | Archived run/operation IDs |
| `GET /v1/sessions/:id/runs/:runId/export` | JSON bundle with completeness and optional manifest |
| Same path with `?format=jsonl` | Event lines; `X-Pida-Complete` header |
| `GET /v1/sessions/:id/runs/:runId/manifest` | ResultManifest, or 404 when absent |
| `GET /v1/sessions/:id/recovery` | Pending effect metadata; no HMAC key/arguments |

`PidaClient` exposes `listRuns`, `exportRun`, `exportRunJsonl`, `getManifest`, and `getRecovery`. Run/stream options accept an optional host `taskId` (maximum 128 allowed characters); generated task IDs are distinct from run IDs. There is no inferred mapping from task/run to a Schumpeter mission/attempt.

With the selected workspace server running:

```powershell
cd D:\pida
npm start -- .\my-agent --open
# In a second terminal, substitute actual IDs:
node dist/cli.js runs SESSION_ID .\my-agent
node dist/cli.js export SESSION_ID RUN_ID .\my-agent
node dist/cli.js export SESSION_ID RUN_ID .\my-agent --jsonl
```

CLI JSONL exits with code 2 for incomplete exports and explains on stderr. JSON bundles include their own completeness flag. The generic SDK supplies the same information without a running HTTP server.

## Result and verification semantics

`reported_status` is the runtime outcome, not a model's claim. `verification_status` is always `UNKNOWN` in this draft: there is no independent task-level acceptance authority. Individual host-executed QuickJS assertions/browser steps may be `PASSED`, `FAILED` or `UNAVAILABLE`, with `independence: "agent-supplied-check"`. A passed weak test is still a weak test.

Artifacts contain workspace-relative paths, byte counts and content SHA-256. IDs include both path and content hash. The manifest retains observed historical versions, and `current_artifact_refs` identifies the last inspected snapshot. Evidence records a definition digest (test path/source or browser steps/viewport), exact snapshot digest and artifact references. Only a final host inspection of the same snapshot sets `current_at_run_end: true`; a test followed by modification is stale. Without final inspection, `FINAL_ARTIFACT_STATE_UNCONFIRMED` is explicit. This is point-in-time inspection under the workbench lock, not a global filesystem transaction or protection against later host changes.

The built-in workspace wires `inspectArtifacts`. Embedded hosts must provide their own trusted inspection callback for final-state confirmation. The bounded workbench captures its text-file area; saved skill directories, arbitrary external API effects and other host artifacts are not exhaustively captured. Custom tools may provide their own trusted `evidence` callback. Missing evidence is not reconstructed from model text.

## Validation and open acceptance gates

See [VALIDATION.md](VALIDATION.md) for executed commands and results. Automated tests use actual Pi/tools/storage/HTTP with scripted model decisions; browser checks use actual Chromium. The full opt-in real-model runner is separate:

```powershell
cd D:\pida
npm run build
node scripts/real-model-e2e.mjs .\my-agent
```

It reads the selected real provider configuration, refuses mock mode, does not import user tool modules, and runs in a disposable workspace. It makes multiple actual model calls and may incur charges. It checks: natural-language tool/file effect and response; code repair with fixed host acceptance tests; two UI edits and actual browser interactions; long history/manual Pi compaction and recall; and recall after starting a new process. Chromium must be available through Playwright or `PIDA_BROWSER_EXECUTABLE`. Missing browser is `NOT_RUN`, not a pass; all five cases must pass for the suite gate. Output is JSON assertions/metadata bundles; temporary files/transcripts are removed. Scripts are source-checkout tooling, not packaged CLI commands.

**Not executed here:** the five actual-model cases, native Windows filesystem/ACL/launch behavior, company network/auth deployment, remote GitHub Actions and Schumpeter Hub ingestion. Protocol stubs do not establish Qwen/LM Studio quality. The supplied Schumpeter repository currently contains architecture/audit documents but no confirmed ObservationEnvelope v0.1 schema; schema reconciliation and receiver-side acceptance require that contract. The readiness fixtures make this work concrete without requiring a Hub server or SDK.

No Pi upgrade, public release, merge, deployment, PIX/OCEL engine, Mission Orchestration, PersonaSubstrate or OpenClaw runtime replacement is included.
