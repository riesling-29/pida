# Validation record — Pida-core 0.2.0

Updated: 2026-10-15 KST. Environment: Linux, Node.js 24.19.0, npm 11.9.0, TypeScript 7.0.2, official Pi packages 1.2.0.

## Confirmed

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| TypeScript strict build and declarations | PASS | `npm run build`, `npm run check` |
| Automated contract/integration suite | PASS — 38 tests | `npm test`; actual installed Pi SDK, no copied loop |
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
| Consumer installation | PASS | `npm pack` then clean `/tmp/pida-consumer-v02` install; installed `pida` executable initializes and starts a workspace, imports its sample module, runs a tool via HTTP/client, survives SIGTERM/restart and serves packaged UI assets |
| Browser TypeScript dependency boundary | PASS | Consumer compiles `pida-core/client` with `types: []`, DOM/ES2022 libs and no Node ambient types |
| Example JavaScript syntax | PASS | `node --check examples/web/app.js` |
| Directory tool loading | PASS | Disabled modules never imported; traversal/symlinks/invalid exports rejected; approved user module executes through Pi and permission denial remains enforced |
| Persistent conversations | PASS | Real Pi JSONL restore; ownership, history, trace ordering and run budgets survive restart; empty sessions retain identity |
| Crash behavior and local lock | PASS | Separate process killed during a tool call; stale lock explicitly cleared; interrupted state restored without automatic tool replay; live owner unlock refused |
| Browser interaction | PASS | Playwright 1.62.1 + headless Chromium 153.0.8010.0: authenticated launch, Korean request, trace, refresh/login, restart/resume, selection, cancellation, deletion and logout; no page errors |
| Responsive layout | PASS for checked viewports | Desktop 1365 × 1000 and mobile-width 390 × 844; screenshots inspected with Korean fonts; no horizontal overflow at mobile width |
| Interactive provider setup | PASS in Linux PTY | Endpoint wizard saved protocol, URL, model ID, limits and credential variable name without receiving a secret |
| Workspace diagnostics | PASS | Key-presence and configuration checks, no key output, no tool imports or model requests |


Mock responses are produced by Pi's built-in faux provider. Only the LLM is simulated; runtime, session management, tool execution, authorization and HTTP paths are real. No company credentials or paid API calls were used. Protocol-stub success is not a claim about a real company's gateway.

The package uses `npm-shrinkwrap.json` so the tested dependency resolution also accompanies the installable tarball. The tarball was installed outside the repository, rather than testing only a workspace import.

## Not verified / limitations

- Browser interaction is verified in headless Linux Chromium only. Native Windows/macOS browser launching, mobile Safari, Android browser behavior, screen-reader operation and exhaustive accessibility/IME testing are not verified. Playwright’s direct browser download failed; the successful check used Chromium from the temporary `@sparticuz/chromium@153.0.0` test installation. Browser packages and test fonts are not runtime dependencies or shipped assets.
- Real company/cloud/local LLM endpoints: **not verified**. OpenAI Responses and Anthropic adapter construction compiles but their protocol paths have not been exercised here.
- Native Android/iOS/Electron packaging: not implemented or tested. Mobile/browser clients require access to the Node backend; frontend portability is not an on-device model/runtime claim.
- Local restart persistence is verified. Power-loss durability, metadata/transcript transactional consistency, corrupted-file repair, multi-process/multi-tenant deployment, worker isolation, federation, TLS termination, rate limiting and durable audit guarantees remain out of scope.
- Cancellation is cooperative; no forced termination of hostile or non-cooperative host code.
- No measured production throughput, latency SLO, real model cost, task-quality improvement or business objective verification. Those values are unknown.
- CI workflow is supplied for Node 22.19 and 24. Local results above do not assert remote GitHub Actions success.
- Package is installable as a tarball but has not been published to npm. Source licensing for redistribution is deliberately left to the repository owner (`UNLICENSED`).

## Commit-readiness review

The MVP meets the tested embedded-runtime/API/tool/client contracts. Pi remains an upstream dependency; no external agent executable, fork, replacement loop, duplicate transcript store or undisclosed credential is introduced. Architecture, installation, provider configuration, API usage, extension boundaries, provenance and limitations are documented.

Re-run tests on any Pi package or transport/auth change. Reassess storage guarantees and the architecture before remote multi-user deployment. Revoke readiness if a forbidden tool executes, an owner check fails, an interrupted stream reports success, or consumer applications need to reconstruct the agent loop.
