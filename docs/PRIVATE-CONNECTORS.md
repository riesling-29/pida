# Private provider connectors

Pida can load a host-installed JavaScript connector that returns an ordinary Pi `ProviderBinding`. This lets a company keep its authentication, token refresh, gateway translation, SDK and certificates in private code. It does not assume that a bearer token or a custom header is sufficient, and it does not create another agent loop.

A connector is **trusted code running inside the Pida server process, not a sandbox**. Only an operator should install and enable it. Its module and dependencies have the same filesystem, network and credential access as Pida. Do not accept connector source, module paths or options from chat, model output, HTTP model settings or downloaded instructions. The operator activates it by editing the local workspace configuration and restarting Pida; there is no separate connector service or activation command.

## Contract v1

The workspace's host-owned `pida.config.json` selects exactly one connector. Add this field to the existing configuration, keeping the other required fields:

```json
{
  "providerConnector": {
    "module": "connectors/company.mjs",
    "options": { "profile": "development" }
  }
}
```

`options` contains non-secret JSON values only. Keep credentials in environment variables or a private credential store. Pida does not return these options through the model settings UI. The existing `provider` setting remains in the configuration, but an active connector takes precedence and does not silently fall back to that endpoint on errors. Ordinary model-setting mutations are rejected with `PROVIDER_HOST_MANAGED` while the connector is active. To disable it, stop Pida, remove `providerConnector` from the local configuration, and restart with the desired ordinary provider settings.

The module exports a versioned manifest and one default factory:

```js
export const manifest = {
  apiVersion: 1,
  id: "company-runtime",
  displayName: "Company private provider",
};

export default async function createProvider({ workspaceDir, env, options }) {
  // Private implementation owns authentication and request translation.
  // Return { provider: <Pi Provider>, modelId: <known chat model ID>,
  //          credentials?: <Pi CredentialStore> }.
}
```

Only `apiVersion`, `id` and `displayName` are accepted in the manifest. These are public display metadata, never credentials. `apiVersion` must be `1`. The factory returns a binding, not a second factory. Pida calls it once per session, including session restoration; it is not called before every request. Refresh expiring credentials through Pi's provider auth/credential-store mechanisms or your private SDK. The context's environment is a frozen startup snapshot, and options are copied and deeply frozen. Changing shell variables after startup requires restarting Pida; a credential store can support live rotation independently.

The binding must expose a Pi provider with `id`, `name`, `auth`, `getModels`, `stream` and `streamSimple`. Model IDs must be unique within that provider, the selected model must already be in the synchronous catalog, and its token limits must be valid. If supplied, `credentials` implements Pi's `read`, `list`, `modify` and `delete` methods. Match the Pi version pinned by the installed Pida package. The loader validates the boundary; it does not prove that your gateway implements a given wire protocol or that the model can call tools reliably.

## Local synthetic smoke example

Save this as `connectors/local-smoke.mjs` inside the selected workspace. The workspace must be able to resolve Pida's pinned `@earendil-works/pi-ai` package, for example when it is inside the Pida checkout. This example makes no network calls and uses no company credentials.

```js
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";

export const manifest = {
  apiVersion: 1,
  id: "local-smoke",
  displayName: "Local connector smoke (synthetic)",
};

export default async function createProvider() {
  const fake = fauxProvider({ provider: "private-smoke", tokensPerSecond: 500 });
  fake.setResponses([fauxAssistantMessage("Private connector smoke OK (synthetic).")]);
  return { provider: fake.provider, modelId: fake.getModel().id };
}
```

For SDK applications, loading is explicit and independent of the web server:

```js
import { loadProviderConnector, PidaRuntime } from "pida-core";

const loaded = await loadProviderConnector(workspaceDir, {
  module: "connectors/local-smoke.mjs",
}, process.env);
const runtime = new PidaRuntime({ provider: loaded.provider });
try {
  const principal = { id: "local-operator", permissions: [] };
  const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "Run the connector smoke check.");
  console.log(result.status, result.text);
} finally {
  await runtime.close();
}
```

This is a synthetic integration check, not an actual model/authentication test. Before company use, test the real credential lifecycle, model/tool request and response, streaming, cancellation, timeout and session restoration against your deployed gateway. Chat Completions, Responses and other APIs are separate protocols; exposing a similarly named URL is insufficient.

## Loading, updates and failures

- Entry modules must be relative `connectors/.../*.mjs` paths. URL imports as entry points, absolute paths, traversal, backslash paths, symlinks and non-files are rejected. Entry files are limited to 1 MiB; JSON options to 64 KiB and 12 nesting levels.
- The loader records the entry file hash and checks it before creating each session. Editing that file stops new sessions with `PROVIDER_CONNECTOR_CHANGED`; review the update and restart Pida. Already running sessions keep their provider.
- This check covers the entry point, not every dependency, and is not an OS isolation boundary. Keep the connector, its dependencies and activation configuration outside agent write permissions. Install dependencies and review updates as host maintenance.
- Import, factory and binding failures use fixed error codes without including the original exception, tokens or company endpoint details. The connector itself must also avoid writing secrets to logs, assistant output, tool content or provider metadata. Arbitrary private code can log or transmit information; Pida cannot make unsafe connector code confidential.
- A failed connector does not select a public provider automatically. Remove it from the local host configuration and restart before returning to ordinary model settings.

The public repository contains this contract, loader and synthetic tests. Keep real company connector implementations, configuration and credentials in the company's private distribution.
