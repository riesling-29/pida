# Managed MCP

Pida uses `@earendil-works/pi-mcp` **1.2.0** for MCP initialization, JSON-RPC correlation, stdio / Streamable HTTP transport, cancellation and transport teardown. Pida supplies host configuration, bounded connection supervision and `BusinessTool` adapters. It does not implement another MCP protocol client or model loop.

## Host configuration

`ManagedMcpConfig` and `managedMcpConfigSchema` are exported from `src/mcp.ts`. The workspace composition uses the optional `mcp` configuration through `managedMcpExtension(config, options)`.

```json
{
  "mcp": {
    "servers": [
      {
        "id": "internal",
        "transport": {
          "kind": "streamable-http",
          "url": "https://tools.internal.example/mcp",
          "headersEnv": { "Authorization": "INTERNAL_MCP_AUTH" }
        },
        "tools": {
          "search": { "permission": "mcp:internal:search", "effect": "read" }
        },
        "connectTimeoutMs": 10000,
        "callTimeoutMs": 60000,
        "reconnect": { "maxAttempts": 3, "baseDelayMs": 250, "maxDelayMs": 10000 }
      }
    ]
  },
  "permissions": ["mcp:internal:search"]
}
```

`INTERNAL_MCP_AUTH` contains the complete header value, for example a bearer header. This is a reference to a host environment variable, not a literal credential. Existing workspace permissions must be retained when editing the example. Adding a server or a tool policy does **not** grant that permission to a principal.

A stdio transport instead uses:

```json
{
  "kind": "stdio",
  "command": "node",
  "args": ["./scripts/internal-mcp-server.mjs"],
  "envFrom": { "SERVICE_TOKEN": "INTERNAL_SERVICE_TOKEN" },
  "inheritEnv": []
}
```

Stdio starts in the host-selected workspace directory with an argument array, not an interpolated shell command. It receives only executable/Windows/temp environment essentials plus explicit `inheritEnv` names and `envFrom` references. It does not inherit the complete Pida environment or `HOME` by default. Command paths, arguments and environment grants are trusted host configuration; they are not accepted from model input. Do not put secrets into arguments.

HTTP URLs reject embedded credentials, query strings and fragments. Plain HTTP requires explicit `allowInsecureHttp:true`; redirects are refused, including credential-bearing redirects. MCP OAuth, sampling, elicitation and arbitrary server-request execution are not enabled by this adapter. Header credentials are resolved when a connection is created; restart/reactivation can apply updated host configuration.

## Lifecycle and tool contracts

`await activateMcp(config, {cwd, env, reservedToolNames, signal})` returns:

- `tools`: the current inventory as ordinary `BusinessTool` adapters;
- `inventory(principal?)`: connection status, generation, reconnect budget, restart requirement, raw-name/alias mapping, exact input/output schemas and host permissions/effects;
- `close()`: an idempotent shared promise that stops reconnects and awaits transport shutdown.

Initial activation awaits discovery and rolls back every server if a connection, schema or registration fails. Discovery has a total deadline, at most eight pages, 100 tools per server and bounded message/schema sizes. Runtime configuration is fixed for its lifetime; new/removed tools or changed schemas set `restartRequired`. Recreate the host runtime to adopt those tools. Existing wrappers can call a reconnected server only while their raw name and schema digest still match; stale wrappers fail before dispatch.

Aliases are `mcp_<server-id>_<normalized-raw-name>` with the runtime's 64-character limit. Normalization/truncation collisions and collisions with supplied reserved tool names fail explicitly. Mapping is not dependent on discovery order.

Reconnect is for a failed **connection**, never an automatic repeat of `tools/call`. The bounded reconnect counter does not reset after a short successful connection, so repeated start/crash cycles eventually reach `failed / MCP_RECONNECT_EXHAUSTED`. Intentional shutdown never reconnects. Tool-list-change notifications retire the old connection and discover a new generation; old transport teardown completes before connecting the replacement. Inventory-change reconnects consume the same bounded budget.

The default effect is `write`, regardless of the server's `readOnlyHint` or `idempotentHint`. The default permission is `mcp:<server-id>:<raw-tool-name>`. A trusted host can supply a more appropriate policy. Pida's ordinary tool input validation, principal permission checks, effect ledger, cancellation, observation and result classification remain in the execution path.

An unavailable/stale-schema/input-invalid call reports `not_applied`. A dispatched write with no confirmed result reports `unknown`, requiring inspection through the existing recovery flow. MCP `isError` is a failed tool result, not a successful business payload. Cancellation cannot undo an external effect. Timeout or cancellation retires and closes the entire connection generation: this aborts outstanding HTTP POSTs even if a server ignores MCP cancellation notifications. Other in-flight calls on that generation also lose their connection and retain unknown effects when applicable. Recovery consumes the bounded reconnect budget and never resubmits a tool call. A successful result too large for the model transport produces a bounded success receipt with `truncated:true`; it does not invent an uncertain effect after a confirmed response. Request smaller output from the server if the omitted content is needed.

Server instructions are **untrusted server data**. Inventory exposes only their presence, digest and size; they are never added to the system prompt. Tool descriptions and outputs are labelled as untrusted MCP data and cannot grant permissions. Diagnostic codes omit endpoint credentials, raw upstream exceptions and stderr. Tool output can itself contain sensitive business data and follows the same private transcript rules as other tools.

## Verification

```sh
npm run build
node --test --test-timeout=20000 test/mcp.test.mjs
```

The suite starts a real local child-process MCP server and a real local Streamable HTTP server using the installed Pi MCP client. It covers discovery, schema/name collisions, page/deadline limits, minimal environment, permission denial through the real Pi loop, cancellation notifications, write-then-crash effects, reconnect caps, schema generations, stale in-flight calls, shutdown and credential redirect refusal. The model in Pi-loop tests is deterministic/faux. These tests do not claim a real LLM or a company MCP server was exercised.
