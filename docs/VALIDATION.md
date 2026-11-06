# ChatGPT provider authentication — 2026-10-28 KST

Patch baseline: remote `bb2a8c1e6fec82d4d6465dd5dc3a2872e25aaa12`. Package 0.6.1 and dependency/lockfile versions unchanged. Linux, Node 24.22.1, npm 11.9.0, Pi 1.2.0. Implementation/usage/contract references: [CHATGPT-AUTH.md](CHATGPT-AUTH.md).

| Executed command | Result |
| --- | --- |
| `npm test` | **105 passed, 0 failed, 0 skipped**. Six new auth tests use actual Pi OAuth/Responses/session/tool paths with synthetic upstream responses. |
| `npm run build` / `npm run check` | PASS; strict types/declarations |
| `node --test --test-timeout=20000 test/chatgpt-auth.test.mjs` | Six pass; rerun for the final serialized-write guard and refresh-error redaction. |
| `node scripts/chatgpt-browser-check.mjs` | PASS; real Chromium and Pi callback with intercepted OpenAI endpoints. Auth-mode selection, login across reload, account model list/apply, cancel preserving the connection, local disconnect without fallback, no token in browser storage, mobile width; no page errors. |
| `node scripts/browser-check.mjs` | PASS; prior login/chat/restart/provider-settings regression flow. |
| `node scripts/studio-browser-check.mjs` | PASS; prior file/UI/diff/evidence/restore/cancel flow. |
| Frontend/runner `node --check`; `git diff --check` | PASS |

Browser commands use `PIDA_BROWSER_EXECUTABLE=/tmp/pida-chromium/chromium`; Korean visual QA uses temporary Noto Sans KR fonts. Chromium 153, Playwright 1.64.1. No fonts/browser packages were added as dependencies. Desktop auth-settings screenshot inspected.

Integration review found Pi's current Responses adapter emits flat function tools while the documented ChatGPT route requires namespaced tools. A public payload-hook adaptation now supplies that format without copying the transport or tool loop; the protocol fixture validates it and dispatches an actual Pida business tool. Login commitment checks runtime-idle state immediately before the credential write. Token-endpoint refresh error bodies are replaced with a safe code before Pi can persist them. The test workspace was kept within the package for Node self-package resolution.

**NOT_RUN:** real OpenAI OAuth/consent, account eligibility, live inference/usage limits, Windows callback and ACLs, company/remote hosting, remote CI. No real credentials, paid calls, merge or release. The passing fixture/browser tests do not establish live-account acceptance.

# Web work surface — 2026-10-28 KST

Implementation: [UI-STUDIO.md](UI-STUDIO.md), [WORKBENCH.md](WORKBENCH.md). Direction and remaining Web/TUI trial: [INTERFACE-DIRECTION.md](INTERFACE-DIRECTION.md). Baseline: remote `fix/runtime-stabilization-00-02` at `5ac2d5220b040619c1e9ce2faa5f6f6e8b73cdbc`. Linux, Node 24.22.1, npm 11.9.0, installed Pi 1.2.0; package remains 0.6.1. No dependency/lockfile changes.

| Executed command | Actual result and boundary |
| --- | --- |
| `npm run build` / `npm run check` | PASS; strict types/declarations |
| `npm test` | **99 passed, 0 failed, 0 skipped**; actual Pi/tools/storage/HTTP with synthetic model decisions |
| `node --test test/studio-review.test.mjs` | PASS, 4 tests; exact diff, reversible restore, stale-write preservation, owner/permission checks, active-run and unresolved-effect rejection, explicit large-diff truncation. Rerun after adding the uncertain-effect HTTP check. |
| `PIDA_BROWSER_EXECUTABLE=/tmp/pida-chromium/chromium node scripts/studio-browser-check.mjs` | PASS; file work without a UI template, real tool-driven edits and QuickJS test, actual browser UI check, safe source/diff presentation, revision-matching evidence, reload/login, guarded restore, cancel after a saved edit, later-file invalidation, different-client run attribution, arrow keys, Korean IME composition guard, mobile width and logout. No page errors. |
| `PIDA_BROWSER_EXECUTABLE=/tmp/pida-chromium/chromium node scripts/browser-check.mjs` | PASS; existing workspace login/chat/trace, refresh, process restart/resume, cancellation, deletion, logout and provider-settings paths. Provider settings use local protocol fixtures, not real inference. |
| `node --check examples/web/studio.js` / `node --check scripts/studio-browser-check.mjs` / `git diff --check` | PASS |

Browser environment: Playwright 1.64.1 and temporary Chromium 153 from `@sparticuz/chromium@153.0.0`. Desktop 1440 × 1000 and mobile-width 390 × 844 screenshots inspected; temporary Noto Sans KR fonts used for Korean layout inspection, not shipped with Pida. Browser startup initially failed in the new acceptance fixture because its origin allowlist was missing; corrected the fixture. The keyboard check found a tab-navigation defect when focus differed from the selected view; movement now follows the focused tab. Review also prevents a newer run in the same session from inheriting an older comparison, clears stale event displays and clears source content on logout.

**NOT_RUN / not implemented:** actual LM Studio/company-provider reasoning quality, five-scenario real-model E2E, native Windows/browser/mobile-device acceptance, screen-reader acceptance, remote CI, repository npm/shell/React execution, OMP adoption and Web-versus-upstream-TUI comparison. No claims of coding-quality parity or cognitive improvement. No merge, release or deployment.

Earlier validation records below describe their historical revisions.

# Runtime stabilization through PATCH-08 — 2026-10-25

Implementation details and acceptance boundaries: [EXECUTION-READINESS.md](EXECUTION-READINESS.md). Environment: Linux, Node 24.22.1, npm 11.9.0, Pi packages 1.2.0. Package/version and lockfiles remain unchanged at 0.6.1.

| Executed command | Actual result |
| --- | --- |
| `npm run check` / `npm run build` | PASS; strict types and declarations |
| `npm test` | **95 passed, 0 failed, 0 skipped**; model decisions synthetic |
| `node scripts/integration-fixtures.mjs` | 11 captured/derived producer fixtures; 3 draft JSON schemas |
| `node --test test/integration-contract.test.mjs` | PASS; positive/negative contract expectations, stale/fabricated verification and broken references |
| `node scripts/ui-readiness-check.mjs` | PASS with actual Chromium; two Pi-driven UI edits, counter/reset, three existing navigation views, revision-bound evidence; scripted model |
| `node scripts/ui-check-check.mjs` | PASS with actual Chromium; service renderer, click/script errors, denied external fetch |
| `node scripts/browser-check.mjs` | PASS with actual backend/Chromium; login, chat/tool trace, refresh, restart/resume, selection, mobile overflow, cancellation, deletion, logout and provider settings against local protocol fixtures |
| New runner JavaScript syntax / `real-model-e2e.mjs --help` | PASS; mock refusal tested without importing user modules |

The browser commands used `PIDA_BROWSER_EXECUTABLE=/tmp/pida-chromium/chromium`, a temporary Chromium 153 binary from `@sparticuz/chromium@153.0.0`; optional Playwright 1.64.1 was already installed. No browser dependency was added to the package. A script label saying "live provider apply" refers to switching to its local protocol stub, not real inference.

New regressions cover separate-process exit after an actual test side effect, durable uncertain receipts, blocked duplicate changes, host idempotency keys, journal failure without run cancellation, stable event IDs across restart, ownership, budget stop before effect, UI match diagnostics and stale test evidence. Integration review also corrected retention of pre-change artifact versions, phantom archive listings after unknown-run reads and unsafe raw key-parse errors.

**NOT_RUN:** real-model five-scenario E2E, native Windows execution/ACLs, remote CI, company environment, and Schumpeter receiver ingestion. No live model credentials or user LM Studio connection were used. Actual-model tooling is ready, but its live paths are not accepted by these synthetic/browser results. No merge, release or deployment was performed.

# Runtime stabilization PATCH-00–02 — 2026-10-25

See [RUNTIME-STABILIZATION.md](RUNTIME-STABILIZATION.md) for the exact upstream baseline, environment, reproduced failures, implementation/validation matrix, results and remaining real-model gates. Earlier entries below are historical results, not new validation claims.

# Terminal-style UI refresh — 2026-10-18

The existing 57 automated contract/integration tests pass after the UI changes. Browser QA uses the real local Pida backend with a synthetic model, not static mock screens. Verified in cloud Chromium: session restoration, HTML file preview, inspector tab switching and arrow-key navigation, Alt+N session creation, Ctrl+Enter submission through the Pi loop (LOT-002 tool response), six execution events in the timeline, native provider catalog selection in the settings modal and Escape dismissal. No real LLM key was entered or charged. Backend/API/provider capabilities are unchanged.

The optional `scripts/browser-check.mjs` selectors were adapted for the modal and translated timeline; that full optional script was not rerun. Mobile breakpoints are implemented, but a separate mobile-device browser acceptance run has not been performed for this refresh. Package-manager dependencies and lockfiles are unchanged.

# 0.5 workbench validation — 2026-10-17

Result: **57/57 automated tests passed** on Node 24 using `npm test`.

- Actual Pi loop with scripted provider responses: writes a deliberately incorrect aggregation, observes an assertion failure, repairs with upstream Pi edit, retests, produces an HTML dashboard and saves a Pi SKILL.md bundle. A new runtime discovers and retests the saved bundle, reuses it with new input, and produces a different result despite the current working script being broken.
- QuickJS WASM: no exposed process/require/fetch/WebSocket; failed staged writes discarded; path/output/file bounds, CPU loop, memory pressure, cancellation and unsupported Promise result tested.
- Files/history/security: independent permissions, principal separation, traversal/symlink/hardlink rejection, oversized files, exact Git restore including trailing whitespace and removal of later files, empty/failed/write-attempting tests rejected for skill save.
- HTTP/client: authenticated workbench listing/upload/read, principal separation and permission rejection. HTML is returned as JSON, with preview markup using an empty iframe sandbox.
- **npm 11.9.0, pnpm 12.11.2, bun 1.4.3** each installed the 0.5.0 tarball in a separate clean consumer project. Each exercised manager CLI init, installed Node server, sample tool, provider/settings/UI, file upload/read, and the packaged QuickJS worker/WASM. All passed. The full 57-test suite was run with npm; a full 0.5 source-test matrix under pnpm/bun was not run.
- Cloud browser: installed tarball served in the test computer; restored scripted demonstration conversation, 4 files and 1 saved skill displayed. Selecting artifacts/dashboard.html rendered a static dashboard with total 540 and monthly values 120/180/240. This is evidence of the actual generated file and UI preview, not real-model reasoning. Desktop Chromium was inspected; new workbench mobile layout and all download/upload UI interactions were not separately browser-tested.
- `scripts/workbench-demo.mjs` reproduces the deterministic demonstration into a new local workspace, with explicit synthetic-model labeling in both the conversation and generated HTML.

No paid or real LLM credentials were used. Real-provider autonomous tool selection, business correctness, arbitrary app building, shell/Python/npm execution, dynamic React previews and production isolation remain unverified or unsupported. Test-created skills only establish their own assertions. The generic embedded runtime still has no tools by default; new standalone workspaces explicitly enable the bounded workbench profile. Git remains an external host prerequisite.

Previous release records below are historical; they do not imply a repeated full browser or source package-manager matrix for 0.5.

# 0.4 provider selection validation — 2026-10-17

Result: **52/52 automated tests passed** on Node 24 with `npm test`. A clean npm consumer installed the 0.4 tarball successfully. In the cloud browser, the named provider selector, Anthropic model selection, missing-key rejection and switch to the separate Gemini model list were verified. No real API key was entered.

The previous 0.3 evidence below remains historical. The 0.4 change adds eight Pi native provider catalogs and separate API-key storage. New automated tests validate all eight factories, model ownership, scoped auth, keyless catalog discovery, rejection of native endpoint overrides, failed-probe retention, provider-specific key isolation and credential-safe metadata. Real Pi OpenAI Responses, Anthropic Messages, Google Gemini and DeepSeek adapters consume synthetic intercepted protocol streams through settings apply, conversation execution and persistence/reopen. These tests never call paid services.

Live cloud-provider credentials, subscription OAuth, IAM/ADC, Azure deployments and real Ollama/LM Studio inference are not verified. OpenRouter, Groq, xAI and Mistral have factory/catalog/auth contract checks, not protocol-response integration checks in this release.

# Validation record — Pida-core 0.3.0

Updated: 2026-10-15 UTC. Environment: Linux, Node.js 24.19.0, npm 11.9.0, TypeScript 7.0.2, official Pi packages 1.2.0.

## Confirmed

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| TypeScript strict build and declarations | PASS | `npm run build`, `npm run check` |
| Automated contract/integration suite | PASS — 44 tests | `npm test`; actual installed Pi SDK, no copied loop |
| Runtime loop and tools | PASS | Faux model asks for tool; Pi dispatches, validates, persists result and calls model again |
| Authorization and owner isolation | PASS | Missing scopes, additional policy denial, foreign session read/run/trace/cancel/delete, concurrent independent sessions |
| Restricted profile | PASS | Only explicit business tools active; model request for built-in bash fails |
| Failure handling | PASS | Invalid arguments, raw provider/business errors, failed tool outcome; stable codes, no sensitive exception text |
| Streaming | PASS | Real Pi text deltas through HTTP SSE and standalone client |
| Cancellation | PASS | Active cooperative tool, cooperative provider, explicit HTTP cancel, external signal, cancel before prompt start, subsequent session reuse |
| Limits | PASS | Busy-session rejection, turn/tool/deadline/session/history/trace limits, session creation race |
| Company protocol path | PASS against local Chat Completions stub only | Actual Pi OpenAI protocol implementation sends tool definitions, reads SSE tool calls, submits tool results, continues history and reads rotated key |
| Client protocol parser | PASS | Split UTF-8 and frame boundaries; truncated stream produces an error |
| HTTP boundary | PASS | Auth, origin allowlist, JSON/unknown-field validation, body limit, CSP and demo asset delivery |
| Consumer installation | PASS | `npm pack` then separate clean installs using all three managers; installed CLI initializes and starts a workspace, imports the sample module, runs a tool through HTTP and serves packaged UI assets. Restart persistence is covered by integration/browser tests. |
| Browser TypeScript dependency boundary | PASS | Consumer compiles `pida-core/client` with `types: []`, DOM/ES2022 libs and no Node ambient types |
| Example JavaScript syntax | PASS | `node --check examples/web/app.js` |
| Directory tool loading | PASS | Disabled modules never imported; traversal/symlinks/invalid exports rejected; approved user module executes through Pi and permission denial remains enforced |
| Persistent conversations | PASS | Real Pi JSONL restore; ownership, history, trace ordering and run budgets survive restart; empty sessions retain identity |
| Crash behavior and local lock | PASS | Separate process killed during a tool call; stale lock explicitly cleared; interrupted state restored without automatic tool replay; live owner unlock refused |
| Browser interaction | PASS | Playwright 1.62.1 + headless Chromium 153.0.8010.0: authenticated launch, Korean request, trace, refresh/login, restart/resume, selection, cancellation, deletion and logout; no page errors |
| Responsive layout | PASS for checked viewports | Desktop 1365 × 1000 and mobile-width 390 × 844; screenshots inspected with Korean fonts; no horizontal overflow at mobile width |
| Browser provider administration | PASS against a local protocol stub | Model discovery, keyless headers, private-key save/restart, same-target key reuse, destination-change denial, redirect rejection, failed-probe retention and live provider switching with preserved history |
| Provider admin isolation | PASS | Explicit `pida:configure` permission required; changes during a running tool are refused |
| npm / pnpm / bun consumer installation | PASS | npm 11.9.0, pnpm 12.11.2, bun 1.4.3: clean tarball install, manager exec/run init, installed Node CLI start, tool run, UI and settings endpoints |
| Source package-manager scripts | PASS | 44 tests under each manager's dependency installation; build/test tasks contain no nested npm invocation |
| Interactive advanced setup | Previously verified in Linux PTY | Earlier terminal wizard retained behind `configure --terminal` |
| CLI setup and reuse | PASS | `setup --no-open` starts a workspace; a separate `configure --no-open` process finds and reuses its authenticated server without opening a second store |
| Workspace diagnostics | PASS | Key-presence and configuration checks, no key output, no tool imports or model requests |


Mock responses are produced by Pi's built-in faux provider. Only the LLM is simulated; runtime, session management, tool execution, authorization and HTTP paths are real. No company credentials or paid API calls were used. Protocol-stub success is not a claim about a real company's gateway.

The package includes `npm-shrinkwrap.json` for npm consumers. Source pnpm and bun installations have separate tested lockfiles; their consumers must not assume they honor npm shrinkwrap. The tarball was installed outside the repository, rather than testing only a workspace import.

## Not verified / limitations

- Browser interaction is verified in headless Linux Chromium only. Native Windows/macOS browser launching, mobile Safari, Android browser behavior, screen-reader operation and exhaustive accessibility/IME testing are not verified. Playwright’s direct browser download failed; the successful check used Chromium from the temporary `@sparticuz/chromium@153.0.0` test installation. Browser packages and test fonts are not runtime dependencies or shipped assets.
- Real company/cloud/local LLM endpoints: **not verified**. OpenAI Responses and Anthropic adapter construction compiles but their protocol paths have not been exercised here.
- Native Android/iOS/Electron packaging: not implemented or tested. Mobile/browser clients require access to the Node backend; frontend portability is not an on-device model/runtime claim.
- Local restart persistence is verified. Power-loss durability, metadata/transcript transactional consistency, corrupted-file repair, multi-process/multi-tenant deployment, worker isolation, federation, TLS termination, rate limiting and durable audit guarantees remain out of scope.
- Cancellation is cooperative; no forced termination of hostile or non-cooperative host code.
- No measured production throughput, latency SLO, real model cost, task-quality improvement or business objective verification. Those values are unknown.
- CI workflow is supplied for Node 22.19 and 24. Local results above do not assert remote GitHub Actions success.
- Package is installable through npm/pnpm/bun as a tarball but has not been published to npm. Source licensing for redistribution is deliberately left to the repository owner (`UNLICENSED`).

## Commit-readiness review

The MVP meets the tested embedded-runtime/API/tool/client contracts. Pi remains an upstream dependency; no external agent executable, fork, replacement loop, duplicate transcript store or undisclosed credential is introduced. Architecture, installation, provider configuration, API usage, extension boundaries, provenance and limitations are documented.

Re-run tests on any Pi package or transport/auth change. Reassess storage guarantees and the architecture before remote multi-user deployment. Revoke readiness if a forbidden tool executes, an owner check fails, an interrupted stream reports success, or consumer applications need to reconstruct the agent loop.

The browser acceptance script also exercises the settings form against a local Chat Completions stub: model discovery/autoselection, keyless apply, live conversation on the new model, failure retention, masked-key submission and clearing, and mobile-width overflow. These are synthetic protocol tests, not tests against LM Studio or a real company gateway. Installation checks are reproducible with `scripts/install-check.mjs`; CI now includes the three-manager matrix.


## 0.6.1 recovery checks

`test/recovery.test.mjs` covers truncated calls not executing, one bounded retry, repeated truncation, context compaction without losing the latest response, ownership and handoff of recent requirements, empty answers, selected coding guides and preservation of history when summarization is truncated. Provider tests include a reasoning-model output-budget probe. Browser acceptance includes handoff controls; `scripts/ui-check-check.mjs` tests the optional isolated renderer. No live LM Studio or Qwen result is claimed by these synthetic tests.
