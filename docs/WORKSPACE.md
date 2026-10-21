# Pida workspace — install, configure, extend, reuse

Pida 0.6 provides a local agent workspace around the same embedded Pi runtime. It includes a CLI, approved tool directory, saved conversations and a web UI. Git and Node.js 22.19+ are required for the default workbench. npm registry publication has not been performed.

## Start from the repository

Check out the feature branch containing 0.5, then:

```sh
npm ci --ignore-scripts
npm run pida -- setup ./my-agent
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
npm install /absolute/path/to/pida-core-0.6.1.tgz
npx pida setup
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
    provider-key.json    Optional private, endpoint-bound provider key
```

Initialization refuses to overwrite existing workspace files. The config requires `version`, `port`, `stateDir`, `systemPrompt`, `provider`, `tools`, and `permissions`; unknown fields are rejected. Paths are workspace-relative subdirectories. If you change `stateDir`, add the new path to `.gitignore`. State contains sensitive conversation data, not only traces.

## Connect a model once — browser setup

`pida setup` initializes the workspace, starts its server and opens model settings. `pida configure` opens settings on the existing server or starts it if needed. Append the workspace directory when not using the current directory.

Select a named cloud provider, enter its API key (or use the matching server environment variable), select a model, then choose **연결 확인 후 적용**. URLs, protocols and model limits come from Pi for native providers. LM Studio, Ollama and custom company endpoints use a separate URL-based form. Configuration changes take effect without a restart. Existing sessions are unloaded safely and reopen through Pi using the new provider. A running request blocks a provider change; it is not silently cancelled.

The LM Studio preset uses `http://localhost:1234/v1`, OpenAI Chat Completions format and no authentication. It is a convenience preset, not evidence that a real LM Studio instance was tested here. HTTP requires an explicit opt-in; company HTTPS URLs remain the default for remote endpoints. An exact `/chat/completions`, `/responses` or `/messages` suffix is normalized to its base URL. URLs containing credentials, query strings or fragments are rejected.

Model discovery calls the draft endpoint's `/models`. If a gateway does not implement it, type the exact model ID. Discovery uses a 10-second timeout, a bounded response and no redirects. It does not send conversation history. The apply action uses Pi itself to request a short response without tools; only after success does it persist and apply configuration. Tool-call compatibility requires a separate real tool request. Failed tests preserve the old configuration.

Advanced options expose the protocol, context window and output-token limit. Their initial 8192/1024 values are conservative configuration defaults, not a claim about the model's actual limits. Anthropic Messages and OpenAI Responses remain available; this milestone's protocol stub exercises Chat Completions only.

For custom endpoints, keys entered in the web form are saved in `<stateDir>/provider-key.json`, bound to the exact normalized URL and API protocol. A blank key field reuses a configured credential only for that same URL and protocol. Changing the destination requires entering its key again; previous environment/saved keys are not forwarded to a new endpoint automatically. Keyless mode sends no Authorization or x-api-key header. A matching UI-saved key takes precedence over the configured environment variable; remove the local key file to return to environment-managed credentials.

The original terminal wizard is still available as `pida configure --terminal`. In that advanced mode, put credentials in `.env` or the shell yourself. `pida doctor` remains a static check; it imports no tools and makes no model call. A server with missing model credentials can still start, so the UI can fix the connection before creating a model session.

### Named providers

Native configuration uses Pi's actual provider factory and full model metadata:

```json
{
  "kind": "native",
  "providerId": "anthropic",
  "modelId": "<select an ID from nativeProviderCatalog()>",
  "apiKeyEnv": "ANTHROPIC_API_KEY"
}
```

This is the `provider` field of `pida.config.json`; choose a real catalog model ID. No key belongs in this JSON. `pida configure --terminal` also lists providers and numbered models.

| Provider ID | Server environment variable |
| --- | --- |
| openai | OPENAI_API_KEY |
| anthropic | ANTHROPIC_API_KEY |
| google | GEMINI_API_KEY |
| openrouter | OPENROUTER_API_KEY |
| deepseek | DEEPSEEK_API_KEY |
| groq | GROQ_API_KEY |
| xai | XAI_API_KEY |
| mistral | MISTRAL_API_KEY |

Native keys use separate `<stateDir>/provider-key-<providerId>.json` files with mode 0600. A matching saved key takes precedence over the environment. Keys survive switching to another provider or mock mode, and are only reused by their provider. Remove the corresponding key file to revert to environment credentials. These files are not encrypted. One provider/model is active per workspace.

`GET /v1/provider` returns a secret-free `catalog` with names, key status and bundled model metadata. `POST /v1/provider/models` accepts `{ "kind": "native", "providerId": "google" }` without a key and returns catalog IDs; this is not account-specific discovery. Apply/test accepts `kind`, `providerId`, `modelId`, `apiKey` only for native providers, rejecting endpoint overrides. Unknown providers/models fail closed. Existing endpoint configurations remain supported unchanged.

The local Ollama preset is `http://localhost:11434/v1`, keyless Chat Completions. Neither local-server preset starts or installs a model server. `localhost` refers to the machine running Pida. Subscription OAuth, IAM/ADC and Azure deployment configuration are not part of this release's setup flow.

## Package-manager commands

After installing an already-built tarball into a receiving application:

| Manager | Install package | Set up / open settings |
| --- | --- | --- |
| npm | `npm install /path/pida-core-0.6.1.tgz` | `npx pida setup` |
| pnpm | `pnpm add --ignore-scripts /path/pida-core-0.6.1.tgz` | `pnpm exec pida setup` |
| bun | `bun add --ignore-scripts /path/pida-core-0.6.1.tgz` | `bun run pida setup` |

The tarball contains compiled code and requires no install/build lifecycle scripts. Using `--ignore-scripts` with npm is also supported. Pnpm 12 can otherwise ask about lifecycle scripts of optional upstream provider dependencies. The repository's pnpm configuration explicitly disables those unused scripts.

All three managers install and invoke the same `pida` executable. Node 22.19+ remains required; native Bun runtime support is not claimed. The source scripts themselves no longer invoke npm, so pnpm/bun users do not need npm for building or running the project. npm is used as the canonical tarball packer in CI only. The package is not published to the npm registry yet.

The source repository includes npm-shrinkwrap.json, pnpm-lock.yaml and bun.lock. Each captures its manager's tested graph; they are not necessarily byte-for-byte identical dependency graphs. When changing dependencies regenerate the affected locks and run the manager matrix. npm's shrinkwrap travels with the tarball; do not assume pnpm or bun will honor it in consumer projects.

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

## Work, verify, repair, reuse

New 0.5 workspaces include the bounded workbench. Existing configs remain unchanged until explicitly enabled. See [WORKBENCH.md](WORKBENCH.md) for migration, tool contracts, the execution API and security limits.

## Compact terminal-style web UI

The bundled web UI uses a charcoal/ivory palette with olive and terracotta accents, fixed-width labels, thin separators and three working areas: sessions on the left, conversation in the center, and a file/run/tool inspector on the right. Model settings open in a native modal dialog with focus handling and Escape dismissal. No extra frontend dependency or external font request is added.

- **Alt+N** creates a conversation; **Ctrl+Enter** (or **Cmd+Enter**) sends the request. Enter by itself remains a newline. IME composition is not submitted by the shortcut.
- The inspector tabs support Left/Right/Home/End keys. File selection shows source or the existing sandboxed static HTML preview; source is collapsed for HTML.
- Below 1120px the inspector opens from “작업 패널”; below 700px sessions also open from “대화 목록”. Close buttons and Escape dismiss these panels. Browser-specific shortcut conflicts can be avoided by using the corresponding buttons.
- Provider behavior, API contracts and execution capabilities are unchanged. The dark interface is a web UI, not a terminal emulator or shell.

