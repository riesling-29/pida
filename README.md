# Pida-core

An embedded, reusable **Pi-based agent harness** for applications. Bring the package into a host backend, register business tools, and connect a web or app interface through the client SDK. The host does not implement the agent loop.

**MVP 0.1.0:** Pi `AgentSession`, agent loop, schema validation, tool dispatch, streaming, cancellation and in-memory `SessionManager` are reused. Pida adds authenticated HTTP access, session ownership, per-call business authorization, bounded execution and metadata traces. It does not invoke an external coding-agent CLI, OpenCode or Codex. Pi remains an exact-version upstream dependency, not a fork.

The lot-status tool is **replaceable synthetic sample data**, not a manufacturing-specific restriction. The default mock is deterministic and not an intelligent model.

## Quick start

Requires Node.js **22.19+** and npm. Tested here on Node 24.19.0.

```sh
npm ci --ignore-scripts
npm test
export PIDA_API_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
npm start
```

Open `http://127.0.0.1:8787`, enter the value of `PIDA_API_TOKEN` from your own shell, click **새 세션**, then run `LOT-001의 상태를 알려줘`. The server never logs the token. In PowerShell, set `$env:PIDA_API_TOKEN` to a freshly generated random value before `npm start`. Tokens must be at least 32 characters; length alone is not an entropy guarantee.

The example server listens on loopback only. Its token represents one demo user with `lots:read`. The browser holds this application token only in memory. It never receives the LLM provider key.

## Bring Pida into another application

The package has **not** been published to npm. Create and install a local package:

```sh
npm pack
# Run from your host application directory:
npm install /absolute/path/to/pida-core-0.1.0.tgz
```

Three entry points separate server code from browser code:

| Import | Environment | Responsibility |
| --- | --- | --- |
| `pida-core` | Node backend / desktop backend | Runtime, provider factories, business tool contract |
| `pida-core/http` | Node backend | Authenticated HTTP/SSE adapter |
| `pida-core/client` | Browser or Node with Fetch streams | Session, execution, streaming, cancellation and trace client |

### Embedded backend

```ts
import { PidaRuntime, mockProvider, lotStatusTool } from 'pida-core';

const pida = new PidaRuntime({ provider: mockProvider, tools: [lotStatusTool] });
// Derive this principal from your verified application identity, never request JSON.
const principal = { id: 'employee-123', permissions: ['lots:read'] };
const { sessionId } = await pida.createSession(principal);
const result = await pida.run(sessionId, principal, 'LOT-001 status', event => {
  if (event.type === 'text_delta') process.stdout.write(event.delta);
});
console.log(result.status);
await pida.close();
```

### Add HTTP access

```ts
import { createPidaServer } from 'pida-core/http';

const server = createPidaServer({
  runtime: pida,
  authenticate: verifyApplicationToken, // Your async (token) => Principal | undefined
  allowedOrigin: 'https://your-app.example.com',
});
server.listen(8787, '127.0.0.1');
```

Keep identity verification in the host. Put TLS, rate limits and any remote ingress at your deployment boundary. A browser on a phone or tablet can connect to that backend; this does **not** mean the Node runtime executes inside iOS/Android or a browser. React, Vue or another UI can consume the client; the example uses plain browser JavaScript.

### Web/app frontend

```ts
import { PidaClient } from 'pida-core/client';

const client = new PidaClient({
  baseUrl: 'https://your-pida-backend.example.com',
  token: () => applicationAccessToken,
});
const { sessionId } = await client.createSession();
for await (const event of client.stream(sessionId, 'LOT-001 status')) {
  // Render in your existing UI; no provider handling or agent loop needed.
  if (event.type === 'text_delta') appendText(event.delta);
  if (event.type === 'trace') appendTimeline(event.trace);
  if (event.type === 'result') showStatus(event.result.status);
}
// From a stop button while a run is active:
await client.cancel(sessionId);
```

`client.run()` collects a final result and optionally calls `onEvent`. `client.stream()` is an async iterator. Both accept an AbortSignal. Breaking the iterator closes the response stream; disconnection requests server-side cancellation. A stream missing its terminal result throws `STREAM_INTERRUPTED`, rather than reporting success.

## Connect a company LLM endpoint

For the example server:

```sh
export PIDA_PROVIDER=endpoint
export PIDA_API=openai-completions
export PIDA_BASE_URL=https://your-company-gateway.example.com/v1
export PIDA_MODEL=your-deployment-name
export PIDA_LLM_API_KEY=... # Inject through your secret manager / environment
export PIDA_CONTEXT_WINDOW=32000
export PIDA_MAX_TOKENS=2048
npm start
```

The model limits above are examples: set verified values for your actual deployment. `PIDA_API` accepts `openai-completions`, `openai-responses` or `anthropic-messages`; these delegate to Pi's protocol implementations. **Only Chat Completions has been exercised against a local protocol stub in this MVP.** Responses, Anthropic, actual company endpoints and local LLM servers require endpoint-specific acceptance tests. A compatible label is not evidence of tool-call/streaming compatibility.

For a local endpoint, explicitly set `PIDA_ALLOW_HTTP=true`. Credentials resolve from `PIDA_LLM_API_KEY` on each request. Base URLs must not include credentials, query strings or fragments. URLs and provider selection are host configuration, never HTTP request fields. Pricing is unknown: required Pi cost fields use zero placeholders, and Pida does not expose them as measured cost.

Other Pi providers, authentication methods or custom protocols can be supplied through `RuntimeOptions.provider`, a factory returning `{ provider: PiProvider, modelId }` for each session. The factory is trusted host code. Its provider must cooperate with cancellation. The MVP selects a provider/model at session creation; in-session model switching is not exposed.

## Register your tools

```ts
import { Type } from 'typebox';
import { defineBusinessTool } from 'pida-core';

const orderStatus = defineBusinessTool({
  name: 'get_order_status', description: 'Read an order visible to the current user',
  permission: 'orders:read',
  parameters: Type.Object({ orderId: Type.String() }, { additionalProperties: false }),
  async execute({ orderId }, { principal, signal }) {
    return orderService.readForUser(principal.id, orderId, { signal });
  },
});
```

Register it with `new PidaRuntime({ provider, tools: [orderStatus] })`. Pi validates arguments, then Pida checks the current run's host-supplied permission **at each invocation**. `authorize(request)` can additionally enforce row-level or resource-level rules. The business service must also enforce its own access control. Tool failures do not become successful runs just because the model continues or says it succeeded.

No tools are enabled unless registered. Built-in shell/filesystem tools, project extensions, skills, prompt templates, context files and MCP discovery are disabled in this profile. Pi's trusted tool/plugin code is not an OS sandbox. See [security boundaries](docs/SECURITY.md).

## API

All `/v1/*` routes require `Authorization: Bearer <application-token>`. POST bodies require JSON. Unknown fields are rejected.

| Method | Path | Request / response |
| --- | --- | --- |
| POST | `/v1/sessions` | `{}` → `{ sessionId }` |
| GET | `/v1/sessions/:id` | Safe user/assistant text history, active tools, state |
| POST | `/v1/sessions/:id/runs` | `{ prompt }` → SSE `trace`, `text_delta`, final `result` |
| POST | `/v1/sessions/:id/cancel` | `{}` → waits for cooperative cancellation |
| GET | `/v1/sessions/:id/trace` | `{ events }`, bounded metadata ring |
| DELETE | `/v1/sessions/:id` | Cancels, disposes, deletes; 204 |
| GET | `/health` | Public liveness only |

Final run status: `completed`, `failed`, `cancelled`, `limited`. `completed` means the execution finished without a detected runtime/tool error, **not** that a business objective was independently verified. Busy sessions return 409; foreign/nonexistent sessions 404; unauthenticated 401. Errors before SSE starts use HTTP errors; execution errors use the terminal result. One run at a time per session; different sessions may run concurrently.

## Scope and validation

Defaults: 100 sessions, 100 runs per session, 8 turns per run, 16 tool calls per run, 60-second cooperative deadline, 1,000 trace records per session, 16,000 prompt characters, 32 KiB HTTP bodies and tool text results. Limits are configurable through the SDK. Finished sessions are not automatically evicted; delete them when done. Session state and traces are in memory and disappear on restart.

`npm test` runs contract and integration tests with real Pi packages, faux providers, a local OpenAI-compatible streaming stub, HTTP and the client SDK. No company credentials or paid provider calls are needed. [Validation](docs/VALIDATION.md) records exactly what was tested and what remains open.

See [architecture](docs/ARCHITECTURE.md), [upstream verification](docs/UPSTREAM.md), [security](docs/SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md). Pida source currently has no redistribution license grant (`UNLICENSED`); Pi retains its MIT license. Publishing to npm is a separate owner decision.
