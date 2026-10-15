# Pida-core

An embedded, reusable **Pi-based agent harness** for applications. Bring the package into a host backend, register business tools, and connect a web or app interface through the client SDK. The host does not implement the agent loop.

**Workspace MVP 0.2.0:** Pi `AgentSession`, agent loop, schema validation, tool dispatch, streaming, cancellation and `SessionManager` are reused. Standalone workspaces now persist Pi sessions, while embedded runtimes remain in-memory unless a storage directory is supplied. Pida adds authenticated HTTP access, session ownership, per-call business authorization, bounded execution and metadata traces. It does not invoke an external coding-agent CLI, OpenCode or Codex. Pi remains an exact-version upstream dependency, not a fork.

The lot-status tool is **replaceable synthetic sample data**, not a manufacturing-specific restriction. The default mock is deterministic and not an intelligent model.

## Quick start — usable workspace

Requires Node.js **22.19+** and npm. From a checkout of this feature branch:

```sh
npm ci --ignore-scripts
npm run pida -- init ./my-agent
npm start -- ./my-agent --open
```

`init` builds the CLI through the npm script, creates a configuration, generates a private random application token, and adds a sample tool. `start` serves the bundled web UI and API at `http://127.0.0.1:8787`. `--open` launches a browser with local authentication; no manual token generation is required. If opening a browser is unavailable, open the URL manually and run `npm run pida -- token ./my-agent` to obtain the login token. This command intentionally displays the secret; do not paste its output into logs or chat.

Click **새 대화**, ask `LOT-001의 상태를 알려줘`, and inspect the result and timeline. Stop with Ctrl+C; run the same start command later and select the saved conversation. Refreshing the browser requires authentication again; tokens are held only in that tab's memory. A login fragment from `--open` is removed immediately after page load.

Default mock mode needs no company credentials. It is a deterministic demonstration of the sample tool, **not a general-purpose model**. To connect your own model:

```sh
npm run pida -- configure ./my-agent
# Put the provider key into my-agent/.env (or inject it through the environment).
npm run pida -- doctor ./my-agent
npm start -- ./my-agent --open
```

The wizard asks for protocol, endpoint, exact model ID and model limits. It never asks you to paste an API key into command-line arguments. `doctor` checks configuration and paths without importing tool code or contacting the model; a successful doctor check does not verify gateway compatibility.

The workspace server is a local, single-user profile. It listens on loopback and uses a generated token. For another app or remote multi-user deployment, embed the SDK and supply your application's authentication.

See [the complete workspace guide](docs/WORKSPACE.md) for tool folders, provider examples, persistence, Windows commands and packaging.

## Bring Pida into another application

The package has **not** been published to npm. Create and install a local package:

```sh
npm pack
# Run from your host application directory:
npm install /absolute/path/to/pida-core-0.2.0.tgz
```

Entry points separate standalone configuration, server code and browser code:

| Import | Environment | Responsibility |
| --- | --- | --- |
| `pida-core` | Node backend / desktop backend | Runtime, provider factories, business tool contract |
| `pida-core/http` | Node backend | Authenticated HTTP/SSE adapter |
| `pida-core/client` | Browser or Node with Fetch streams | Session listing/resume, execution, streaming, cancellation and trace client |
| `pida-core/workspace` | Node backend | Load a configured workspace, approved tool modules and local HTTP service |

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

For the standalone workspace, use `pida configure` and `.env` as described above. The original environment-only example is retained as `npm run demo`:

```sh
export PIDA_PROVIDER=endpoint
export PIDA_API=openai-completions
export PIDA_BASE_URL=https://your-company-gateway.example.com/v1
export PIDA_MODEL=your-deployment-name
export PIDA_LLM_API_KEY=... # Inject through your secret manager / environment
export PIDA_CONTEXT_WINDOW=32000
export PIDA_MAX_TOKENS=2048
npm run demo
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

Workspace tool modules can be enabled with `pida tools enable FILE.mjs ./my-agent`; their required permission must also be granted in configuration, and the server restarted. Only enabled modules are imported. No tools are enabled unless registered. Built-in shell/filesystem tools, project extensions, skills, prompt templates, context files and MCP discovery are disabled in this profile. Pi's trusted tool/plugin code is not an OS sandbox. See [security boundaries](docs/SECURITY.md).

## API

All `/v1/*` routes require `Authorization: Bearer <application-token>`. POST bodies require JSON. Unknown fields are rejected.

| Method | Path | Request / response |
| --- | --- | --- |
| GET | `/v1/info` | Safe configured model label, persistence mode, tools and permission availability |
| GET | `/v1/sessions` | Current user’s saved and active sessions (title, dates, status) |
| POST | `/v1/sessions` | `{}` → `{ sessionId }` |
| GET | `/v1/sessions/:id` | Safe user/assistant text history, active tools, state |
| POST | `/v1/sessions/:id/runs` | `{ prompt }` → SSE `trace`, `text_delta`, final `result` |
| POST | `/v1/sessions/:id/cancel` | `{}` → waits for cooperative cancellation |
| GET | `/v1/sessions/:id/trace` | `{ events }`, bounded metadata ring |
| DELETE | `/v1/sessions/:id` | Cancels, disposes, deletes; 204 |
| GET | `/health` | Public liveness only |

Final run status: `completed`, `failed`, `cancelled`, `limited`. `completed` means the execution finished without a detected runtime/tool error, **not** that a business objective was independently verified. Busy sessions return 409; foreign/nonexistent sessions 404; unauthenticated 401. Errors before SSE starts use HTTP errors; execution errors use the terminal result. One run at a time per session; different sessions may run concurrently.

## Scope and validation

Defaults: 100 sessions, 100 runs per session, 8 turns per run, 16 tool calls per run, 60-second cooperative deadline, 1,000 trace records per session, 16,000 prompt characters, 32 KiB HTTP bodies and tool text results. Limits are configurable through the SDK. Finished sessions are not automatically evicted; delete them when done. Direct SDK calls default to in-memory sessions. Set `storageDir` for persistence; standalone workspaces enable it by default. `listSessions` returns owned saved sessions, `resumeSession` loads a Pi transcript, and HTTP reads/runs restore saved sessions automatically. `close()` preserves disk sessions; `deleteSession()` removes them. One process owns each storage directory. See the workspace guide for crash recovery and storage limitations.

`npm test` runs contract and integration tests with real Pi packages, faux providers, a local OpenAI-compatible streaming stub, HTTP and the client SDK. No company credentials or paid provider calls are needed. [Validation](docs/VALIDATION.md) records exactly what was tested and what remains open.

See [architecture](docs/ARCHITECTURE.md), [upstream verification](docs/UPSTREAM.md), [security](docs/SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md). Pida source currently has no redistribution license grant (`UNLICENSED`); Pi retains its MIT license. Publishing to npm is a separate owner decision.
