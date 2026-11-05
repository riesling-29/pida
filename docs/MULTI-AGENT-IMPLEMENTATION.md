# Multi-agent work surface implementation

2026-11-05 KST. Scope: Pida only. Baseline 0.8.11 local `70d8194`,
remote draft PR #1 `2d942c5cc99111f24eceef3a894dfb863b8cfe71`.

The user authorized implementing the existing multi-agent tabs/split prototype
for actual home use. Reuse the supervisor, owned job APIs, client, Web agent
administration and upstream Pi terminal components. No substitute runtime.

| Version | Patch scope | Acceptance |
| --- | --- | --- |
| 0.8.12 | Shared bounded layout/panel state, owner-scoped runtime overview, independent drafts and shared job observation | Two agents and two views of one agent remain distinct; stale reads cannot change another panel; layout cannot authorize actions; restored layout does not execute anything |
| 0.8.13 | Web agent workbench: tabs, nested horizontal/vertical splits, ratios, focus, close, restore, job submission/control, existing admin entry | Actual browser + HTTP flow with two agents, resize, drafts, reconnect and precise cancellation |
| 0.8.14 | Pi TUI agent workbench using the same layout/controller, keyboard and mouse controls, layout persistence; integrated verification | Real terminal + host flow; Web/TUI observe same jobs; close/detach leaves jobs intact; restart reads interrupted state without replay |

At most 8 tabs / 4 panels per tab. Ratios are bounded; narrow screens focus a
single panel without discarding the tree. A panel binds a real agent and either
a pinned job or explicitly follows its current/latest job. Different view types
may inspect the same run. Only layout identifiers and preferences are persisted;
drafts, credentials, prompts and tool outputs are not part of layout storage.

UI close differs from cancel. New requests use stable idempotency keys until
their delivery is resolved. Unknown delivery is retained and never automatically
replayed. Queue pause affects subsequent jobs. Reconciliation remains an explicit
inspection of actual effects through the existing host contract.

Existing shared-project single-writer gates remain enforced. This delivery does
not add parallel writes to one checkout, automatic worktree provisioning,
external terminal subprocess embedding or structured file/line target binding.

Plans, implementation, automated component tests, actual browser/PTY integration
and Windows/live-model checks will be reported separately. Version commits go to
the existing draft PR; no merge, release or deployment.

## 0.8.12 checkpoint

Implemented shared validated layout/controller and owner-filtered overview.
The overview and scheduler share admission gates and status queries do not
create sessions. HTTP tests cover two independent drafts/jobs, exact queued
cancellation, close/reconnect without replay, and lost enqueue acknowledgements
with read-only delivery reconciliation. `npm run build` passed;
`node --test --test-timeout=20000 test/agent-workspace.test.mjs test/agent-supervisor.test.mjs`
passed 9/9 on Node 24.22.1/Linux (mock model; real Pi/HTTP).
Web and TUI surfaces are the following version slices, not claimed complete here.

## 0.8.13 checkpoint

Web **멀티 에이전트** now uses the shared controller: eight tabs, four nested
panels, pointer/keyboard separator resize, focus/zoom, cross-tab panel swap,
agent registration/source selection, job selection/control and scoped local
layout restoration. Existing agent memory/recovery administration is retained.
Colors now follow the approved near-black green palette.

Build and 17 targeted controller/Web handler tests passed. The new DOM adapter
test executes actual fleet handlers, preserves textarea identity/drafts across
polls/tabs, and checks the submission destination. It is not a browser test.
`node scripts/multi-agent-browser-check.mjs fixtures/workspace/0.8.13` was
**blocked before testing**: Chromium process singleton socket creation returned
EPERM in this executor. A separate cloud browser could not reach the local
fixture server (connection refused). No browser pass or screenshot is claimed.
The script is provided for a host with Chromium (`PIDA_BROWSER_EXECUTABLE`).

## 0.8.14 checkpoint

Actual Pi TUI and CLI default now use the shared multi-agent controller. F-key
menus and mouse focus/tabs, retained per-pane editors, nested cell-sized layouts,
keyboard ratios, zoom, registration/source selection, private atomic layout
saving and detach/reconnect are connected. `--main`/`--session`/`--new` retain
the previous single-session view. No new runtime or dependency was introduced.

Integrated review was performed once. It corrected Pi integer growth weight
handling, Pi's submit-buffer clear ordering, editor mouse focus, nonfocused
cursors and raw private profile fields in status polling. Relevant controller,
Web handler, supervisor and TUI checks were rerun. Full suite: 372/372, 0 skipped
on Linux/Node 24.22.1, including actual pinned PIX tests. The standalone multi
PTY check passed 18 assertions with actual Pi/HTTP/CLI and deterministic mock
decisions. Browser/Windows/live-provider limitations remain explicit.
See [delivery and home guide](MULTI-AGENT-0.8.14.md).
