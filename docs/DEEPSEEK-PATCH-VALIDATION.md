# DeepSeek-derived 0.8.x implementation and validation

Baseline: branch `fix/runtime-stabilization`, commit `1638064a7fe8ca23332c5670363fe40ef6eae678`, Pida 0.8.0. Validation host: Linux x64, Node 24.22.1, Pi 1.2.0. Baseline `npm test`: 184 passed. The source analysis and optional follow-up candidates are recorded separately in [DEEPSEEK-HARNESS-REVIEW.md](DEEPSEEK-HARNESS-REVIEW.md).

## 0.8.1 — visible execution, provider capabilities, retained output

- Main workspace and Studio accept instructions during execution through existing Pi steering/follow-up APIs. Input receipts explicitly remain `durable:false`; acceptance is not completion. Late responses cannot overwrite newer drafts or runs.
- Workspace, Studio and agent jobs expose explicitly opened, owner-authorized tool details. Actual retained commands, outputs and exit codes come from Pi tool results. Raw details are excluded from observation bundles. Compacted-away history is not fabricated. Trace pages expose sequence gaps and an optional cursor.
- Native and endpoint settings support explicit reasoning, input modalities, thinking-level maps and thinking levels. Native UI choices follow Pi's model catalog; target changes do not inherit endpoint capabilities. Host private connectors remain host-managed.
- Model attempts record real IDs/generations, timings, local HMAC fingerprints and available token/cache/reasoning usage. Missing usage is `null`; normalization is distinguished from raw observation. No claim is made that this changes gateway KV-cache behavior.
- Text program output over 128 KiB no longer kills the process. Pida directly vendors the MIT-licensed DeepSeek `OutputCollector` from pinned commit `ce7073d51254c26cd63b22a60835b8f948deb447`; origin and local type-only adaptations are recorded in `THIRD_PARTY_NOTICES.md`. Private bounded spill files can be read through a same-owner/session/program tool. JSON output retains its strict limit. Retention failures are reported as lossy rather than successful preservation.

Validation:

- `npm test`: **213/213 passed**, no skips (24.5 s), before the focused native-thinking UI review fix.
- `node scripts/agents-ui-handler-check.mjs`: passed, DOM fixture.
- `PIDA_CHECK_API_ONLY=1 node scripts/studio-browser-check.mjs`: passed, real HTTP/project-view/discovery paths; browser intentionally not run.
- Actual Pi + local SSE fixtures exercise provider reasoning/tool history and Responses → Chat → Responses isolation. Actual Node/npm processes generate roughly 280 KiB of Korean/emoji output and read retained bytes back. These are not real-model tests.
- One integrated review found three defects: unsupported native `off` selection, lost stderr/output-artifact labels in details, and unreported control-byte preview loss. All were corrected. `npm run build` and `node --test test/run-details.test.mjs test/program-proxy.test.mjs test/web-run-ui.test.mjs`: **19/19 passed** after the fixes; app syntax and diff checks passed.

Limits: no live model, real browser engine, Windows process containment, or company-gateway execution in this environment. Native PTY/sandbox, external runners, schedules and channel adapters are not included in this release. Existing Pi loop/session ownership and explicit permission/effect boundaries remain in force.

## 0.8.2 — recovery, lifecycle, presets and MCP

- Reuses Pi AgentSession retry events/settings, with SDK transport retry still disabled. Default retry count is 2; host configuration supports 0–5 and bounded backoff. Unknown effects block continuation. Whole-run deadlines, stalled-provider streams, cancellation and retry exhaustion remain distinct outcomes.
- A committed compaction must reduce the estimated context before overflow recovery proceeds. A failed or ineffective compaction does not silently retry forever.
- Memory text and its persona/state/experience revisions are projected from one snapshot. The descriptor and local keyed digest survive session restart. Handoff records source session/run and artifact snapshot when available, with `filesRestored:false`. Future session/memory formats are rejected without rewriting the source.
- One composition builder serves main and persistent agents. Named `coding`, `personal`, `headless` presets supply defaults without permissions. Scoped host extension factories have activation cleanup and shared close promises. Configuration/source changes expose `restartRequired` rather than mixing new capabilities into an old runtime.
- Directly depends on installed `@earendil-works/pi-mcp@1.2.0`. Real stdio and Streamable HTTP discovery, calls, cancellation, bounded reconnect, generation/schema fencing, source policy and error classification use Pi's client. Dispatched tools are never automatically replayed by reconnect.
- `GET /v1/composition` and the bundled settings panel show actual tools, permissions, sources, revisions and MCP health. The HTTP DTO excludes command lines, endpoints, environment, schemas and server instructions.

Validation: `npm test` **245/245 passed**, no skips, after updating the combined DOM fixture to load the new composition module. `npm ls --depth=0` confirms pinned direct dependencies. Real local HTTP fault servers, child MCP servers, Pi faux loops and filesystem restarts were exercised; these are not live-model or real-browser acceptance tests.

Integrated review identified two lifecycle defects: pending agent activation was not signalled during shutdown, and cancelled/timed-out HTTP MCP requests remained alive in the upstream transport. Both were corrected: shutdown aborts pending factory activation before awaiting cleanup; MCP retires and closes the affected transport generation before bounded reconnect. `npm run build` passed; MCP/recovery regressions **18/18** and lifecycle/supervisor/composition regressions **20/20** passed after the fixes. No tool replay was introduced.
