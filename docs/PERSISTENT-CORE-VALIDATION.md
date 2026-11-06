# 0.8.0 implementation and validation — 2026-11-02

## Baseline and scope

- Local baseline: `fix/runtime-stabilization`, `529d992` (package 0.7.0).
- Remote baseline: `fix/runtime-stabilization-00-02`, `6a8ad59bab4b12ccae9076a629b9950ac5037fd7`, draft PR #1.
- Result package: **0.8.0**. Pi SDK and seven Pi package pins remain **1.2.0**.
- Environment: Linux, Node **v24.22.1**, npm **11.9.0**. Supported package minimum remains Node 22.19.
- Scope: PC-01–PC-08 in [the plan](PERSISTENT-CORE-PATCH-PLAN.md), plus the user's in-turn PC-09 program discovery/proxy request. No public release/deployment, main merge, Schumpeter implementation or external Memory Substrate implementation.

## What is connected and what was tested

| Capability | Actual connection | Evidence / limit |
| --- | --- | --- |
| Generic core | Exported supervisor, memory, resources, proxy and connector modules; optional HTTP integration | TypeScript build and embedding fixtures; Pi owns the model/tool loop |
| Persistent agents | Registry → durable queue → independent Pi session/workbench → owner-checked API/SDK → live UI | Three-agent execution, session restart, idempotent submit, permissions, artifacts and reconnect through actual HTTP |
| Queue/recovery | Concurrency bound, shared-workspace gate, pause/cancel, interrupted state and explicit reconciliation | Actual child process SIGKILL/restart; old work is not automatically replayed |
| Three memory tiers | Persona versions, sourced experience/corrections, information-state lineage/CAS/branch/merge → bounded per-run context and tools | Reload/CAS/conflicts, ownership, large valid records, subsequent turn continuity; job completion does not manufacture an information state |
| Resources/steering | Project-root AGENTS.md, explicitly selected skills, named reader, Pi steer/follow-up and expected-run guard | Actual Pi SDK synthetic model loop; cancellation removes old live input; no ambient extensions |
| Project view | Scoped list/read, protected paths, sanitized staged/working-tree Git view → Studio | Actual files/Git/HTTP and hostile Git configuration canaries; browser rendering not established |
| Private connector | Host module/config → Pi ProviderFactory → workspace and model settings boundary | Real Pi synthetic protocol fixture; private options/env absent from API; host-managed mutation blocked; no company gateway request |
| Program proxies | Read-only scan → deterministic manifest → CLI pin/grant → BusinessTool → Pi call → actual process → effect/observation record | Actual Node JSON stdin/output and npm script, denied grants, source mutation, literal argv, timeouts/cancel, bounded output, no inherited provider credential |
| UI | Persistent-agent tab, job activity/partial text, persona/experience/state forms, recovery, per-agent files, project catalog/diff | Syntax, DOM handler fixture and actual underlying HTTP contracts passed; Chromium unavailable |

Model decisions in these tests are **mock/scripted faux responses**, including tests using the actual Pi runtime. File, HTTP, process, Git, session and queue operations are real. This is not a live-model quality benchmark, company authentication validation or a claim of full Codex/OpenClaw parity.

## Commands and results

| Command | Actual result |
| --- | --- |
| `npm test` | **184 passed, 0 failed, 0 skipped**, approximately 20.3 seconds; all current test files included |
| `npm run build` / `npm run check` | Passed |
| `node --test test/agent-tools.test.mjs` after final job-link correction | **3/3 passed** |
| `PIDA_CHECK_API_ONLY=1 node scripts/studio-browser-check.mjs` | Passed: actual ProjectView files/diff/protected paths, unavailable-agent behavior, program catalog/draft/source conflict; explicitly no browser |
| `node scripts/agents-ui-handler-check.mjs` | Passed handler assertions for registration, durable request ID, memory CAS/relationship preservation/correction target, steer, explicit recovery and reset; DOM mock |
| `node --check examples/web/{app,studio,agents}.js` (each file separately) | Passed |
| `git diff --check` | Passed |
| `npm ci --dry-run --ignore-scripts --offline` | Passed using existing `npm-shrinkwrap.json`; actual dependencies were not reinstalled |
| `node scripts/studio-browser-check.mjs` | **Blocked** at Playwright launch: Chromium headless executable is not installed. No browser behavior or screenshots claimed |

The full suite preceded the final two-line job URL correction; the affected agent-tools suite and build were rerun afterward. The added portable UI handler script was also executed. No unnecessary second whole-suite review was performed.

## Review findings and corrections

One integrated PC-01–08 review found four concrete problems:

1. **P1, shared recovery gate:** main-runtime unknown effects did not block another agent writing the same project. The shared lease now checks main persisted recovery records as well as agent recovery. Host inspection is exposed through the recovery HTTP/SDK/CLI path.
2. **P2, provider freshness:** existing cached agents retained old model/credentials after global changes. Active agent execution now blocks provider replacement. A host generation plus configuration key reopens idle agent runtimes with the same saved session, including same-target credential rotation.
3. **P2, large memory writes:** a successful large write could exceed the runtime's tool-response limit and be misreported as failure. Mutation tools now return compact receipts; recall is bounded, paginated and explicit about omitted fields. Full records remain in storage/API.
4. **P2, relationship loss:** the UI's simple state editor discarded relationship fields. It now retains the CAS-base relationships and displays them. Experience correction UI also supplies the explicit target record.

Those findings were selectively rechecked. The later PC-09 addition received its own targeted integration review; no blocker was found. A wrong agent-job URL noticed during route integration was corrected and the affected test rerun. Test fixtures also verify empty recovery for interruption before a Pi session exists, without pretending a session was created.

## Remaining limits for home testing

- **Live models and Windows:** no real ChatGPT/LM Studio/LightLLM/company endpoint run or Windows-machine execution occurred in this environment. Test the actual configured provider with tool calls, not only a short text probe.
- **Browser:** launch the prepared browser fixture where Chromium is installed. The existing isolated `ui_check` remains opt-in; a working HTTP route is not browser verification.
- **Process lifetime:** Pida must run for work to execute. This batch is not an OS service installer or messaging/scheduling agent.
- **Host execution:** shell/programs are trusted host processes, not OS sandboxes. Proxy pins do not cover every dependency/data file, and cancellation does not guarantee descendant-process cleanup or rollback.
- **Memory:** stored source references are provenance claims, not independently validated facts. A crash exactly during a memory write can leave `memory.lock` requiring separate operator recovery; unknown locks are not removed automatically.
- **Agent configuration:** the embedded factory supports host-selected runtime variants. Per-agent model/tool/project preset selection in the bundled UI remains future work. Program/tool changes require restart; model changes through supported settings propagate on the next idle agent runtime opening.
- **Coding surfaces:** project diffs are bounded live views, not rollback checkpoints or artifact-bound verification. Interactive PTY/native sandbox execution, MCP lifecycle, messaging channels, scheduler, TUI and automatic upstream integration remain follow-on requirements.

See [persistent agents](PERSISTENT-AGENTS.md), [program proxies](PROGRAM-PROXIES.md), and [private provider connectors](PRIVATE-CONNECTORS.md) for operational commands and exact boundaries. Observation/ResultManifest metadata remains available for each agent job; model completion does not set independent verification to VERIFIED.
