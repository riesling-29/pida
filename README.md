# Pida-core

An embedded, reusable **Pi-based agent harness** for applications. Bring the package into a host backend, register business tools, and connect a web or app interface through the client SDK. The host does not implement the agent loop.

**Workspace MVP 0.4.0:** Pi `AgentSession`, agent loop, schema validation, tool dispatch, streaming, cancellation and `SessionManager` are reused. Standalone workspaces now persist Pi sessions, while embedded runtimes remain in-memory unless a storage directory is supplied. Pida adds authenticated HTTP access, session ownership, per-call business authorization, bounded execution and metadata traces. It does not invoke an external coding-agent CLI, OpenCode or Codex. Pi remains an exact-version upstream dependency, not a fork.

The lot-status tool is **replaceable synthetic sample data**, not a manufacturing-specific restriction. The default mock is deterministic and not an intelligent model.

## Quick start — choose npm, pnpm or bun

Requires **Node.js 22.19+**, including when installing with bun. This release supports all three package managers; the production runtime stays on Node.

From a checkout of this feature branch, choose one row:

| Manager | Install | Initialize, configure and open UI |
| --- | --- | --- |
| npm | `npm ci --ignore-scripts` | `npm run pida -- setup ./my-agent` |
| pnpm | `pnpm install --frozen-lockfile --ignore-scripts` | `pnpm run pida setup ./my-agent` |
| bun | `bun install --frozen-lockfile --ignore-scripts` | `bun run pida setup ./my-agent` |

`setup` creates the workspace if needed, generates its private login token, starts the server and opens **model settings** in the browser. If its server is already running, it opens that server's settings. The same npm/pnpm/bun `run pida` prefix can invoke every CLI command.

In the browser:

1. Choose **OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Groq, xAI, or Mistral**.
2. Enter its API key (or use the provider's environment variable already set on the server).
3. Select a model from that provider's bundled Pi catalog. The native Pi adapter owns its API, endpoint, model limits and compatibility metadata.
4. Click **연결 확인 후 적용**. A short, no-tool test response must succeed before settings are saved and applied. Existing conversations can resume without restarting. The test may incur a small charge and does not establish tool-call compatibility.

**LM Studio**, **Ollama**, and **사내 API · 다른 서버** remain separate choices. Local presets supply the URL and keyless mode; custom connections expose protocol and token limits under advanced settings. Their model-list button queries the chosen server. Native service catalogs come from pinned Pi 1.2.0, not a live account entitlement check; newer models require a Pi update or a custom connection.

Native API keys are stored separately per provider, server-side, with private file permissions; switching back can reuse that provider's key. Keys are never returned by the settings API. **Subscription OAuth login (ChatGPT, Claude, Copilot, etc.) and AWS/Azure/Vertex credential flows are not implemented in this setup UI.** They are not interchangeable with API keys.

You can also select **데모만 사용** and try `LOT-001의 상태를 알려줘` without LLM credentials. The mock is deterministic and cannot choose arbitrary custom tools.

After initial setup, start again with `npm start -- ./my-agent --open`, `pnpm start ./my-agent --open`, or `bun run start ./my-agent --open`. Conversations survive restart. `pida configure` opens model settings again; the earlier terminal wizard remains under `configure --terminal`.

If browser launching is unavailable, open `http://127.0.0.1:8787` manually and obtain the application token with `pida token` using your package-manager prefix and workspace directory. This command intentionally prints a secret. Browser refresh requires signing in again because tokens are not persisted in browser storage.

The bundled server is a local single-user profile. Embed the SDK with your own identity callback for a remote multi-user application. See [the workspace guide](docs/WORKSPACE.md).

## Bring Pida into another application

The package has **not** been published to npm. Create and install a local package:

```sh
npm pack
# Run from your host application directory:
npm install /absolute/path/to/pida-core-0.4.0.tgz
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

The model limits above are examples: set verified values for your actual deployment. `PIDA_API` accepts `openai-completions`, `openai-responses` or `anthropic-messages`; these delegate to Pi's protocol implementations. Chat Completions has been exercised against a local protocol stub; native OpenAI Responses, Anthropic Messages and Google Gemini adapters have also been tested with intercepted synthetic protocol streams. Actual company/cloud/local endpoints still require endpoint-specific acceptance tests. A compatible label is not evidence of tool-call/streaming compatibility.

For the legacy environment-only demo, explicitly set `PIDA_ALLOW_HTTP=true` for HTTP. The web setup includes a corresponding HTTP checkbox and an explicit keyless option. Credentials resolve from `PIDA_LLM_API_KEY` on each request. Base URLs must not include credentials, query strings or fragments. URLs and provider selection are host configuration; session/run requests cannot override them. The optional settings API requires explicit admin permission. For custom endpoints pricing is unknown: required Pi cost fields use zero placeholders, and Pida does not expose them as measured cost.

Other Pi providers, authentication methods or custom protocols can be supplied through `RuntimeOptions.provider`, a factory returning `{ provider: PiProvider, modelId }` for each session. The factory is trusted host code. Its provider must cooperate with cancellation. The workspace settings can switch the workspace-wide provider while idle; embedded hosts can use `configureProvider`. Per-conversation model selection is not exposed.

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
| GET | `/v1/provider` | Local admin only: safe provider configuration and key-presence flag |
| POST | `/v1/provider/models` | Local admin only: discover model IDs using a draft connection |
| POST | `/v1/provider/test` | Local admin only: request a short model response without saving |
| POST | `/v1/provider` | Local admin only: test, save and apply a draft connection |
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
