# Pida 0.8.7 terminal/Web validation

2026-11-03 KST. [Plan](TUI-PATCH-PLAN.md), [design and usage](TUI.md).

Baseline: local `daf43e55f800d42e23551c7bea47fac59723bb46`, branch
`fix/runtime-stabilization`; delivered draft PR1 parent
`81acddac69c9acacb7fb82a0e450c46691b14ddf`, branch
`fix/runtime-stabilization-00-02`. Worktree was clean. Only Pida changed.
Package is 0.8.7. Pi remains 1.2.0; the already installed/pinned Pi TUI package
is now an explicit direct dependency, without a new package version or fork.

## Completion gates

| Gate | Status |
| --- | --- |
| Design / plan | Complete for the main-session terminal client, using the existing TempleOS-inspired interface principles |
| Implementation | Complete: terminal composition, CLI attach, shared live snapshots, Web peer observation and guarded cancellation |
| Automated suite | 353 passed, 0 failed/cancelled/skipped; TypeScript build included |
| Actual Pi/HTTP cross-client integration | Passed with synthetic model decisions; shared execution, detach/reattach without replay, explicit cancellation and foreign-owner denial |
| Actual terminal integration | 10 Linux PTY checks passed with the packaged CLI, Pi editor/renderer, separate Pida host and deterministic mock model |
| Web behavior | Actual DOM handlers exercised with controlled fixtures; idle observation, partial/final projection, unsent draft preservation and exact-session launch checked |
| Live LLM / company connector | NOT_RUN |
| Windows Terminal / native Korean IME | NOT_RUN; Unicode cells and Korean paste were exercised, not real Windows input composition |
| Actual browser rendering | NOT_RUN; Chromium executable is absent; no browser pass is inferred from DOM tests |

## Actual behavior and boundaries

The host remains the execution and persistence owner. TUI is a client of the
existing HTTP/session/trace APIs; no AgentSession, token store, execution loop,
workspace lock or standalone tool executor is duplicated in the terminal.
Pi TUI supplies alternate-screen rendering, layout, scroll views, editor, paste,
input, cursor handling and session selector components.

The new owned session field contains up to 32,768 UTF-16 code units of the
currently streaming public assistant text. It is ephemeral and replaced by the
completed message. Reasoning/tool-argument blocks are not projected. No raw text
is added to the metadata observation export. Both interfaces poll the same
session and can observe work started by the other; ordinary run initiation
retains the existing detached SSE route.

Cancellation optionally accepts `expectedRunId`. Existing callers remain
compatible; the new TUI and bundled Web controls use the observed identity.
An old cancellation receives RUN_CHANGED rather than stopping another run.
Normal requests cannot bypass existing same-session/workspace write admission.
Connection failures never replay a prompt. Terminal close aborts its HTTP
observations and restores terminal modes while the separate server continues.
Stopping that server still stops its runtime; this patch adds no daemonization.

Terminal display sanitizes control sequences before rendering model/file/tool
content, disables automatic clipboard copying and external link opening, and
bounds displayed messages/panels. Server-side history is unaffected. `/tools`,
`/read` and `/diff` remain explicitly requested owned views; the frontend does
not read project files directly. Slash completion is command-only.

## Commands and results

Environment: Linux x64; Node 24.22.1, npm 11.9.0, Python 3.12.14, Pi 1.2.0.

| Command | Actual result |
| --- | --- |
| `npm test` | PASS, 353/353, 27.971949 s, including final build |
| `python scripts/tui-terminal-check.py --output .pida-test-tui-pty-final/report.json` | PASS, 10 checks |
| `node --check examples/web/app.js` and `node --check examples/web/studio.js` | PASS |
| `npm ls @earendil-works/pi-tui --depth=0` | Direct 1.2.0 pin resolved |
| `npm pack --dry-run --ignore-scripts --json` | PASS; CLI and compiled terminal/controller modules included; temporary private workspaces excluded |
| `git diff --check` | PASS |

The PTY probe creates a disposable source-checkout workspace, starts a separate
host process, opens the actual CLI in a 112×32 terminal, pastes Korean text,
sends a real request through Pi's mock-provider/tool loop, resizes to 64×24,
opens help/session selection, detaches, checks canonical input/echo restoration,
and launches another terminal process on the same saved session. The host stays
alive, the run count stays one, and no application token appears in output.
Its first fixture attempt used a directory outside the source package and could
not resolve the generated sample tool's package self-import; the probe was
corrected to use a disposable directory under the checkout. It does not alter
an installed user's workspace or weaken runtime module checks.

[PTY report](../fixtures/tui/pty-report.json) records source hashes.
[Suite summary](../fixtures/tui/test-summary.json) records the actual command,
counts, duration and transcript digest. The complete suite includes the new
cross-client, bounded text/reasoning exclusion, stale cancellation, failed
selection, late snapshot, real renderer/editor, Web peer-poll and launch tests.
Mock model decisions, DOM fixtures and actual components are explicitly
separated; these are not live-model or human usability results.

One integrated self-review was performed. It tightened session-selection
fencing, bounded conversation rendering, exact-session Web launch, guarded Web
cancellation, terminal-construction cleanup and cancellation of pending client
requests on detach. No independent review is claimed. Final full-suite and PTY
results above follow these corrections.

## Remaining scope

The terminal operates main-workspace sessions. Full persistent-agent/job/memory
administration, visual application preview and provider login remain available
through Web. `/web` opens the exact selected session and requests the workspace
tab. This patch does not add a native PTY executor for agent shell commands,
an OS sandbox, terminal service previews, independent task acceptance or full
OpenCode/Codex feature parity.

The user requested the older `pitano: 따라잡기` discussion. Search recovered the
prior Pida interpretation and constraints, but not that original project
conversation. The design therefore relies on the user-provided thread summary
and existing interface document; it does not claim to have inspected an
unretrieved original or to have proven a cognitive effect.

Delivered as a version-specific commit on the existing draft PR. No merge,
release, deployment, tag, external message or other application change.
