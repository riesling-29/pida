# Pida workspace — install, configure, extend, reuse

Pida 0.2 provides a local agent workspace around the same embedded Pi runtime. It includes a CLI, approved tool directory, saved conversations and a web UI. Node.js 22.19+ is required. npm registry publication has not been performed.

## Start from the repository

Check out the feature branch containing 0.2, then:

```sh
npm ci --ignore-scripts
npm run pida -- init ./my-agent
npm start -- ./my-agent --open
```

These commands work with npm in PowerShell as well as a Unix shell. The npm `pida` script builds the TypeScript source before invoking the CLI. `npm start` uses that build. No LLM key is needed for the mock demonstration.

In the UI, select **새 대화**, enter `LOT-001의 상태를 알려줘`, and send. The result is synthetic. Ctrl+C stops the server; restarting and opening the UI restores the saved conversation list. Clicking a conversation reopens its Pi history.

`--open` asks the OS browser to open a local authenticated URL. If no browser launcher exists, the server remains available and reports a manual login fallback:

```sh
npm run pida -- token ./my-agent
```

Open `http://127.0.0.1:8787` and enter that application token. This is not your model API key. `token` explicitly displays a secret; avoid logging or sharing the output. Refresh requires signing in again because the web UI does not persist the token.

## Install into another project

Create a package from the source checkout:

```sh
npm pack
```

From the receiving application's directory:

```sh
npm install /absolute/path/to/pida-core-0.2.0.tgz
npx pida init
npx pida start --open
```

After this installation, use `npx pida` in the commands below instead of `npm run pida --`. If installed globally from the tarball, the `pida` command is directly available. Do not run an unqualified registry install expecting this unpublished package to exist.

You can also embed the runtime via `pida-core`, the HTTP adapter via `pida-core/http`, or the frontend client via `pida-core/client`. To reuse a whole configured workspace in a Node host:

```ts
import { createWorkspace } from 'pida-core/workspace';
const { server, runtime, config } = await createWorkspace('./my-agent');
server.listen(config.port, '127.0.0.1');
// During host shutdown: stop accepting connections, await runtime.close(), close remaining connections.
```

This factory uses the local single-user token profile. A multi-user application should construct `PidaRuntime` and `createPidaServer` with its verified identity callback.

## Workspace files

```text
my-agent/
  pida.config.json       Non-secret model, tool and permission configuration
  .env                   Private application/provider/tool credentials
  tools/
    lot-status.mjs       Replaceable sample
    README.md            Tool module contract
  .pida/
    runtime.lock         One active process for this workspace
    index/               Session ownership, title, counters and metadata traces
    sessions/            Canonical Pi JSONL conversations
```

Initialization refuses to overwrite existing workspace files. The config requires `version`, `port`, `stateDir`, `systemPrompt`, `provider`, `tools`, and `permissions`; unknown fields are rejected. Paths are workspace-relative subdirectories. If you change `stateDir`, add the new path to `.gitignore`. State contains sensitive conversation data, not only traces.

## Connect a model once

```sh
npm run pida -- configure ./my-agent
npm run pida -- doctor ./my-agent
```

The interactive wizard selects mock or endpoint mode, protocol, base URL, exact model ID, context window, output limit, and the name of a credential variable. Add the variable's value to the private `.env` or the launching shell. Shell values override `.env`. Restart to apply configuration changes.

Example provider section (replace model names/limits with your actual endpoint values):

```json
{
  "kind": "endpoint",
  "api": "openai-completions",
  "baseUrl": "http://localhost:1234/v1",
  "modelId": "your-loaded-model-id",
  "apiKeyEnv": "PIDA_LLM_API_KEY",
  "contextWindow": 32000,
  "maxTokens": 2048,
  "allowInsecureHttp": true
}
```

This is an illustrative local OpenAI-compatible configuration, not a verified LM Studio integration. For an endpoint with no authentication, set `PIDA_LLM_API_KEY` to a non-secret placeholder if that endpoint permits it. For a company HTTPS gateway use its actual URL and credentials, with `allowInsecureHttp` false/omitted. Available protocols are `openai-completions`, `openai-responses`, and `anthropic-messages`; only Chat Completions has a local protocol-stub integration test here.

`doctor` checks config shape, key presence and approved module paths. It does not prove connectivity, tool-call support, model quality or import-time module correctness. Follow it with an actual request and tool execution against your chosen gateway.

## Add your own tool

Put an ESM JavaScript module in `tools/`. TypeScript should first be compiled to `.mjs` or ESM `.js`. This release does not automatically transpile arbitrary TypeScript or launch Python scripts.

```js
// tools/order-status.mjs
import { defineBusinessTool } from 'pida-core';
import { Type } from 'typebox';

export default defineBusinessTool({
  name: 'get_order_status',
  description: 'Read the status of an order visible to this user',
  permission: 'orders:read',
  parameters: Type.Object({ orderId: Type.String() }, { additionalProperties: false }),
  async execute({ orderId }, { principal, signal }) {
    // Replace this example with your existing service/function.
    // Enforce row-level access for principal.id and respect signal.
    signal.throwIfAborted();
    return { orderId, status: 'example', requestedBy: principal.id };
  },
});
```

For your own project, explicitly declare any imported dependencies such as `typebox` in its package manifest.

```sh
npm run pida -- tools ./my-agent
npm run pida -- tools enable order-status.mjs ./my-agent
```

Add `orders:read` to the config `permissions` list only for this authorized local user, then restart. Registration and permission grants are separate. The module can also wrap an existing API or library; business logic does not need to be rewritten. The model needs a useful description and accurate input schema to select it.

Each enabled file must default-export one BusinessTool. Only plain filenames ending `.mjs`/`.js` are accepted; traversal, tool symlinks and directories escaping the workspace are rejected. Files absent from `tools.enabled` are never imported. Listing and enabling validate selection without executing a module; startup checks exports and registers tools. Approved modules are trusted server code, not sandboxed uploads.

The mock provider deliberately calls `get_lot_status` only. It does not learn to choose new tools. Connect a model to exercise arbitrary tools; automated tests use scripted Pi providers to test custom registration and permission denial.

Disable a tool with `pida tools disable FILE` and restart. No hot reload is implemented.

## Persistence and recovery

Standalone workspaces save by default. Embedded runtimes opt in with `new PidaRuntime({ provider, tools, storageDir: './private-state' })`.

- `listSessions(principal)` lists only that user's sessions; it does not need to initialize a model.
- `await resumeSession(id, principal)` restores Pi history before SDK `getSession` / `getTrace`. HTTP reads and runs restore automatically, and SDK `run` does likewise.
- `close()` preserves saved conversations. `deleteSession()` removes the metadata and Pi file. An unloaded session can be deleted even without provider credentials.
- Restart applies current tools, provider configuration and permissions. Historical permission grants are never restored. Changing model protocols may require an endpoint-specific history compatibility test.
- A workspace accepts one process at a time. After an abrupt process termination, run `pida unlock`; it refuses to clear a lock whose recorded local process is live. PID reuse or unverifiable locks require manual inspection.
- An interrupted run is displayed as interrupted. It is not automatically replayed. A tool may already have changed an external system; verify before requesting that action again.
- The default session and run limits still apply to saved history; restart does not reset run budgets. Delete unneeded conversations or configure SDK limits for a host deployment.

This is local filesystem persistence, without encryption, cross-file transactions, guaranteed power-loss durability, multi-process coordination, SSE replay or exactly-once execution. Tool cancellation is cooperative. See SECURITY.md for the full boundary.

## Browser acceptance check

The optional `scripts/browser-check.mjs` drives the actual UI: login, tool request, reload, restart/resume, selection, mobile overflow, cancellation, deletion and logout. It is not part of the runtime package.

```sh
npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
npx playwright install chromium
npm run build
node scripts/browser-check.mjs
```

Alternatively set `PIDA_PLAYWRIGHT_MODULE` to an installed module path and `PIDA_BROWSER_EXECUTABLE` to an existing Chromium. The check uses a temporary workspace and cleans it up. Screenshots go to temporary paths unless `PIDA_DESKTOP_SCREENSHOT` / `PIDA_MOBILE_SCREENSHOT` override them. Linux headless hosts need fonts covering Korean for visual inspection.
