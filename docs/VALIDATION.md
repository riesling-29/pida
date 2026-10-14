# Validation record — Pida-core 0.1.0

Date: 2026-10-14 KST. Environment: Linux, Node.js 24.19.0, npm 11.9.0, TypeScript 7.0.2, official Pi packages 1.2.0.

## Confirmed

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| TypeScript strict build and declarations | PASS | `npm run build`, `npm run check` |
| Automated contract/integration suite | PASS — 25 tests | `npm test`; actual installed Pi SDK, no copied loop |
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
| Consumer installation | PASS | `npm pack` then clean `/tmp/pida-consumer` install; imports all three entry points, runs a tool via HTTP/client, serves packaged example assets |
| Browser TypeScript dependency boundary | PASS | Consumer compiles `pida-core/client` with `types: []`, DOM/ES2022 libs and no Node ambient types |
| Example JavaScript syntax | PASS | `node --check examples/web/app.js` |

Mock responses are produced by Pi's built-in faux provider. Only the LLM is simulated; runtime, session management, tool execution, authorization and HTTP paths are real. No company credentials or paid API calls were used. Protocol-stub success is not a claim about a real company's gateway.

The package uses `npm-shrinkwrap.json` so the tested dependency resolution also accompanies the installable tarball. The tarball was installed outside the repository, rather than testing only a workspace import.

## Not verified / limitations

- Browser visual layout and interactive browser automation: **not verified**. Playwright was available but its Chromium executable was absent; the attempted browser download returned an invalid/truncated archive. HTTP assets, client integration and JavaScript syntax were checked, not a rendered browser flow.
- Real company/cloud/local LLM endpoints: **not verified**. OpenAI Responses and Anthropic adapter construction compiles but their protocol paths have not been exercised here.
- Native Android/iOS/Electron packaging: not implemented or tested. Mobile/browser clients require access to the Node backend; frontend portability is not an on-device model/runtime claim.
- Restart persistence, multi-process/multi-tenant deployment, worker isolation, authentication federation, TLS termination, rate limiting and durable audit storage: out of scope.
- Cancellation is cooperative; no forced termination of hostile or non-cooperative host code.
- No measured production throughput, latency SLO, real model cost, task-quality improvement or business objective verification. Those values are unknown.
- CI workflow is supplied for Node 22.19 and 24. Local results above do not assert remote GitHub Actions success.
- Package is installable as a tarball but has not been published to npm. Source licensing for redistribution is deliberately left to the repository owner (`UNLICENSED`).

## Commit-readiness review

The MVP meets the tested embedded-runtime/API/tool/client contracts. Pi remains an upstream dependency; no external agent executable, fork, replacement loop, duplicate transcript store or undisclosed credential is introduced. Architecture, installation, provider configuration, API usage, extension boundaries, provenance and limitations are documented.

Re-run tests on any Pi package or transport/auth change. Reassess the architecture before persistent or remote multi-user deployment. Revoke readiness if a forbidden tool executes, an owner check fails, an interrupted stream reports success, or consumer applications need to reconstruct the agent loop.
