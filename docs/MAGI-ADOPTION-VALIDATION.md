# MAGI adoption validation — 0.7.0

Date: 2026-10-30 UTC / 2026-10-31 KST. This records this implementation round, not historical browser runs or a real-model benchmark.

## Baseline and delivery

- Local baseline: branch `fix/runtime-stabilization`, HEAD `3bbdb23`.
- Remote baseline: `fix/runtime-stabilization-00-02`, HEAD `1d3345927f4a8d90c5a114356a470e0d8f2e7aaf`.
- Package: 0.6.1 → **0.7.0**. Pi AI/coding-agent/agent-core remain **1.2.0**. No dependency upgrade or new runtime engine.
- Environment: Linux, Node **24.22.1**, npm **11.9.0**. Working-directory tests use temporary files and synthetic credentials.
- Delivery: existing [draft PR #1](https://github.com/riesling-29/pida/pull/1); no merge, release, deployment or tag. The commit attached to this document records the final implementation tree.

## Implementation versus execution evidence

| Batch | Implemented | Executed evidence | Remaining acceptance |
| --- | --- | --- | --- |
| P01 activity | Bounded tool timeline, elapsed/last-event time, model-waiting state, trace replay and capability-selected project target | JavaScript syntax; server trace/state integration tests | Actual Chromium Studio reconnect/display fixture is prepared but blocked here |
| P02 detached observation | Additive `disconnectPolicy`, Studio opt-in, explicit cancel, timeout and repository single-writer gate | Real HTTP disconnect/requery; ownership, continued completion, legacy disconnect cancellation, explicit cancel, timeout, concurrent rejection | Server process must remain alive; no OS service or restart job scheduler |
| P03 browser checks | Click/fill/select/visible/count/viewport, partial failures, deadline/cancel, full definition hash | Schema/pre-abort/unavailable evidence tests | Real browser interactions, viewport, isolation and timeout fixture blocked here |
| P04 project coding | Pinned Pi file/edit/search and optional host shell; separate permissions and target | Actual temporary files and shell commands; failed Node test → source edit → same test passes through Pi loop; replay block after no-op write; boundaries, env stripping, timeout/cancel, CLI enable/disable | Model decisions are scripted; Windows PowerShell and actual-model task quality not tested |
| P05 company API | Host env header references; Pi compatibility overrides; shared discovery/inference auth and no redirect | Actual Pi adapter against local protocol fixture, streaming/tool dispatch, headers/rotation, request fields, target changes, secret redaction | Real company LightLLM/model/parser/network and KV cache not tested |
| P06 usability | `browser enable`, `project enable/disable`, use/configuration docs and capability/limit disclosures | CLI project configuration/load/doctor; terminal same-target setting preservation | Browser enable success path needs installed Chromium |

The runtime still reports task acceptance **UNKNOWN** when it has only agent-supplied checks. Project files and shell results do not acquire workbench snapshot/restore guarantees. Shell exit zero is evidence of that command, not independent proof of the task. Host shell is opt-in and **not an OS sandbox**.

## Commands and results

| Command | Actual result |
| --- | --- |
| `npm run build` | PASS: TypeScript and dist build |
| `npm test` | PASS: **124 tests, 0 failed, 0 skipped** before final review corrections |
| `node --test test/project-tools.test.mjs` after search correction | PASS: **6 tests**, including nested basename/directory-qualified glob assertions and actual shell repair/retest |
| `node --test test/project-workspace.test.mjs` after terminal correction | PASS: **3 tests**, including one newly added real terminal prompt/save regression (TTY capability flag emulated; no inference) |
| `npm run check` | PASS: final TypeScript no-emit check |
| `node --check examples/web/studio.js` and both changed browser scripts | PASS: syntax only |
| `git diff --check` | PASS |
| `node scripts/ui-check-check.mjs` | **BLOCKED, exit 2: BROWSER_UNAVAILABLE. No browser test passed.** |
| `node scripts/studio-browser-check.mjs` | NOT_RUN after missing-browser prerequisite was confirmed |

The final targeted checks cover both review corrections; the broad suite was not repeatedly rerun. There are 125 test cases in the final tree. All executed model paths above use mock/scripted responses or local protocol fixtures; no paid/account/company inference was invoked.

Chromium installation was attempted through the configured network path. The download returned an empty/non-ZIP payload and extraction failed. This round does not claim the newly extended browser scenarios pass based on earlier-version browser results. Install Chromium or set `PIDA_BROWSER_EXECUTABLE` on the user's machine, then run the two browser scripts.

## One integrated review

One read-only integrated review found two P2 issues and no confirmed P0/P1 blocker:

1. Terminal configuration rebuilt the endpoint and discarded custom headers/compatibility when changing only the model. Fixed: normalize URL, preserve same-protocol/same-target options including auth mode, discard on a new destination. Actual CLI save-path regression passes.
2. Repository `*.ts` glob matched only root files. Fixed: slash-free patterns match basenames for find and grep; directory-qualified patterns match relative paths. Nested-file/exclusion regressions pass.

The review covered runtime effect handling, shared-repository serialization, disconnect/cancellation boundaries, endpoint secret/redirect behavior, browser evidence binding and Studio state transitions. It does not substitute for the blocked browser or actual-model acceptance runs.

## First real-use checks

Follow [MAGI-ADOPTION-USAGE.md](MAGI-ADOPTION-USAGE.md). Test a small UI change while observing activity; refresh during execution and explicitly cancel another request. Enable browser checks and verify the missing inspection-alert panel through actual visibility/count/input operations. For project mode, choose a development repository and request a reproducible failing test, minimal repair and rerun. For company API, validate plain response, tool call, file edit, test and cancellation separately. Record Windows/LightLLM/KV-cache results as new evidence rather than assuming success from these fixtures.
