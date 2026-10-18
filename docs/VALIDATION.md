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
