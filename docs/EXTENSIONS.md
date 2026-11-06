# Workspace composition and extension lifetime

`createWorkspace(directory)` still loads the approved files in `tools.enabled`. A legacy file that exports one `BusinessTool` is shared by the workspace. Enabling a file does not grant its tool permission. Module imports execute trusted host code; this is not a sandbox.

Optional `preset` values in `pida.config.json` supply defaults:

| Preset | Workbench default | Bundled Web UI | Persistent agents |
| --- | --- | --- | --- |
| `coding` | Enabled | Enabled | Enabled |
| `personal` | Disabled | Enabled | Enabled |
| `headless` | Disabled | Disabled; HTTP API remains available | Enabled |

Explicit `workbench`, `agents`, `codingPacks`, and project settings take precedence. Presets never add tool permissions, install programs, or enable shell access. An omitted preset preserves the preexisting workspace behavior, including the persistent agent workbench.

An approved module can instead export an extension factory:

```js
export default {
  id: "my-tool-service",
  scope: "agent", // or "workspace" for one shared instance
  revision: "1",
  async activate({ workspaceDir, agentId, signal, onDispose }) {
    // Register cleanup as resources are acquired, before later steps can fail.
    const service = await openService({ workspaceDir, agentId, signal });
    onDispose(() => service.close());
    return { tools: service.tools() };
  },
};
```

`agent` factories receive a separate activation for the main runtime (`agentId: "main"`) and each persistent agent runtime. A `workspace` activation is shared until the whole workspace closes. Each activation can also return `close()`; it is called before earlier `onDispose` callbacks. Do not register the same non-idempotent cleanup both ways. Factories must release resources they acquire before returning by registering `onDispose`; an import-time side effect is outside that contract.

Embedding hosts may supply these definitions through `createWorkspace(directory, { extensions })`. This is a code-level host API; model requests cannot register factories or change scopes. Host factories should provide a `revision` that changes with their code or configuration. Files approved through `tools.enabled` also receive a source digest. Imported dependencies are not fingerprinted.

Main and persistent-agent runtimes use the same composition builder. `workspace.getComposition()` returns active tool/source/scope/permission inventory, an active revision per runtime, the configured revision, and `restartRequired`. It omits prompt text, connector options, and credential values. Treat it as a host administration API.

`GET /v1/composition` and `PidaClient.getComposition()` expose a reduced view to callers with `pida:configure`. The HTTP boundary shows only the caller's agent instances, recomputes tool permissions for that caller, hashes extension revisions, and omits MCP schemas, instructions, descriptions, addresses and environment. Generic embedded servers opt in through `HttpOptions.getComposition`. The bundled Web settings panel uses this endpoint under **실제 적용 구성 · 도구 · MCP**; its refresh button only reads status.

Provider changes retain the existing idle-runtime replacement path. Other configuration or approved source changes require a workspace restart; new agent runtime creation fails with `WORKSPACE_RESTART_REQUIRED` until then. Existing activations retain their original configuration. There is no package installer or hot module replacement in this API.

An optional `mcp` configuration activates the managed MCP extension once for the workspace. Its connection status and schema-change restart requirement appear in `getComposition().mcp`. For example, a host can configure a local executable without granting any of its tools:

```json
{
  "mcp": {
    "servers": [{
      "id": "local",
      "transport": { "kind": "stdio", "command": "/absolute/path/to/server" },
      "tools": { "lookup": { "permission": "company:lookup", "effect": "read" } }
    }]
  }
}
```

Add `company:lookup` to the separate `permissions` list only when the host intends to authorize it. MCP stdio `envFrom` and HTTP `headersEnv` refer to environment variable names, not literal credentials. Tool schemas are fixed for each runtime; a reconnect that changes them requires a restart and cannot silently broaden its active wrappers.

Always await `workspace.close()`. Repeated calls share the same Promise. Shutdown drains runtimes before releasing their extensions; partial startup failures unwind acquired resources in reverse order. Cleanup continues after a failure and reports an `AggregateError`. When HTTP server shutdown triggers cleanup, `onCloseError(error)` can receive failures; awaiting `close()` still receives the same failure.
