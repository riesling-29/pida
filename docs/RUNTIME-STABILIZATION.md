# Runtime stabilization: PATCH-00–02

Date: 2026-10-25. This is the first implementation batch of the Schumpeter readiness plan, not completion of PIDA-01 through PIDA-06 or a release certification.

## Baseline and environment

- Source: `feat/pida-workspace`, commit `7d480d0d3d0da5153f089d2993ebcaba54934962`.
- Package: `pida-core@0.6.1`; version and lockfiles remain unchanged in this batch.
- Required Node: `>=22.19.0`. Executed here: Linux, Node `v24.22.1`, npm `11.9.0`.
- Installed `@earendil-works/pi-ai`, `pi-coding-agent`, and `pi-agent-core`: `1.2.0`.
- Source was obtained through the GitHub connector because Git transport was unavailable. All 62 fetched text blobs matched upstream Git blob hashes. The unchanged documentation JPEG was not downloaded. The local snapshot commit is not the upstream commit; remote changes must use the upstream commit/tree as their parent/base.
- Baseline: `npm ci`, then `npm test`: **69 passed, 0 failed**. The model in these tests is scripted or a protocol stub. Pi, tools, QuickJS, persistence and HTTP are real code.

## Changes and reproduced defects

1. **Workspace identity.** `createWorkspace` passes its resolved root through the new optional `RuntimeOptions.workspaceDir` to Pi session creation and SDK configuration. Memory-only sessions use the same setting. Restoring an older transcript overrides its stale working directory for the current SDK session without rewriting historical headers or changing session IDs. The default is the host cwd captured at runtime construction; no `process.chdir` or additional file permissions are introduced.
2. **Configuration diagnostics.** Missing config reports `CONFIG_NOT_FOUND`, the attempted path and explicit workspace commands. Invalid JSON reports `CONFIG_INVALID_JSON` without echoing file contents. Doctor/start display the selected workspace. Existing positional directory arguments remain the interface; no automatic directory selection or config migration occurs.
3. **Tool outcomes.** The optional host `BusinessTool.classifyResult` distinguishes declared domain failures from ordinary business data. Workbench failures now reach Pi as `isError: true` and produce `tool_failed` traces. Raw guest/file error messages are not used as trace codes; workbench uses a fixed code allowlist and generic fallbacks.
4. **Recovery within a run.** Classified failures permit the existing Pi loop to attempt a repair within its existing time/turn/tool limits. Only an explicit host recovery key clears a pending failure. Workbench UI mutation success can supersede a failed UI mutation; retesting the same test path successfully can supersede its failed test. Reads and unrelated successes cannot clear these failures. Unresolved failures produce a failed final result even if the model claims completion. Unclassified exceptions and permission failures retain fail-closed behavior.
5. **Interruption races.** The first cancellation/deadline interruption wins while Pi settles. Both race orders were reproduced against the old code. Late consumer callback failures cannot request abort on a different active run.
6. **Secondary storage failure.** Failure to persist a final result no longer erases an existing cancellation/timeout/failure reason. `RunResult` and the final trace carry optional `persistenceError: "PERSISTENCE_FAILED"`. An otherwise completed run becomes failed. Both bundled chats display a secondary persistence error. Durable on-disk state may still be stale; this field is not a transactional-storage guarantee.

Recovery keys describe operation-level supersession, not proof that the user's intended task is correct. `completed` is not `VERIFIED`. There is no new automatic replay, provider retry policy, durable effect ledger or exactly-once guarantee in this batch. Other workbench failures without a recovery key remain conservatively unresolved until that run ends, even if the model performs other useful work.

## Current validation matrix

| Capability | Code/wiring | Automated validation in this environment | Actual LLM validation |
|---|---|---|---|
| Provider/local OpenAI-compatible connection | Existing | Scripted provider and HTTP protocol fixtures | Not run |
| Session create/save/restore | Existing; selected cwd corrected | Existing persistence tests plus current/legacy cwd regression | Not run |
| Tool execution/permissions | Existing; declared result failures connected | Actual Pi loop, permission rejection, failed test/repair/retest, failed UI edit/repair | Not run |
| Streaming/cancellation | Existing; interruption cause corrected | Stream tests, both cancellation/deadline race orders, final callback and storage failure | Not run |
| Compaction/handoff | Existing | Existing synthetic manual/automatic compaction and handoff tests | Not run |
| CLI/HTTP/client | Existing; additive fields and diagnostics | Existing contract tests and new CLI diagnostics | Not run |
| UI creation/modification | Existing; failure reporting corrected | Actual workbench mutations with scripted Pi calls | No live model or browser run in this batch |
| Observation Export/ResultManifest | Planned PATCH-06/07 | Not implemented in this batch | Not applicable |

The regression cases were first run against the unmodified build. They reproduced missing workspace propagation, opaque config errors, hidden domain failure reporting and both interruption race orders. The guard against ordinary `{ok:false}` business data and final consumer handling was also checked; those are not claimed as newly reproduced defects.

Validation commands (source checkout):

```sh
npm ci
npm run check
npm run build
npm test
node scripts/real-model-smoke.mjs --help
```

Final results for this batch: **82 automated tests passed, 0 failed** (Node's count includes nested race tests). Type check/build and bundled frontend JavaScript syntax checks passed. No real model requests were made. Native Windows execution, browser interaction, company networking, CI runs, crash durability and production readiness are not established by these results.

## Opt-in actual-model smoke

From a built source checkout with the real provider already configured:

```powershell
cd D:\pida
npm run build
node scripts/real-model-smoke.mjs .\my-agent
```

This is an explicit live-provider operation and may incur provider charges. It refuses a mock configuration. It reads the selected provider settings/credentials but does not import its tool modules, start its server or modify its files. A temporary workspace runs a synthetic read-only probe, closes/reopens the runtime and checks recall from the persisted session without a second probe call. It prints metadata and assertions, not raw model output, credentials, endpoint URLs or transcripts; temporary state is removed afterward.

The script is source-checkout tooling, not part of the published package interface. Its setup/refusal path is tested; the live path still requires a reachable actual provider. `PASS` covers only its two named smoke cases. It is not the five-scenario PIDA-02 acceptance gate, does not test a separate-process crash, and provides no independent model-quality or artifact-verification claim. Do not interpret this cloud environment's localhost as the user's LM Studio machine.

## Remaining gates and next batch

- PATCH-00 baseline inventory and smoke scaffolding are present; real-model defect reproduction is still pending.
- PATCH-01/02 changes and synthetic regressions are implemented. Windows and actual-provider validation remain open.
- PATCH-03: bounded retry policy and durable effect receipts; inspect real state before retrying an uncertain external change.
- PATCH-04: interrupted-session, damaged metadata and compaction state recovery. No session format migration was performed here.
- PATCH-05: revision/hash-bound UI and code verification; actual browser multi-edit acceptance.
- PATCH-06/07: observations and manifests with stable IDs, evidence references, privacy and ownership enforcement.
- PATCH-08: confirm the actual Schumpeter ObservationEnvelope contract and test fixtures; do not equate task/run with mission/attempt automatically.
- Release gate: retain `0.6.1` until the stabilization acceptance requirements justify `0.6.2`. No Pi upgrade, merge, release, deployment or Schumpeter repository modification is included.
