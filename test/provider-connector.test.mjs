import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { PidaRuntime, lotStatusTool } from "../dist/index.js";
import { loadProviderConnector } from "../dist/provider-connector.js";
import { initWorkspace, readConfig, createWorkspace, workspaceEnvironment } from "../dist/workspace.js";
import { PidaClient } from "../dist/client.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
const manifest = `export const manifest = { apiVersion: 1, id: "private-test", displayName: "Private synthetic connector" };`;
const valid = `import { mockProvider } from "pida-core";
${manifest}
export default async function createProvider(context) {
  if (!Object.isFrozen(context) || !Object.isFrozen(context.env) || !Object.isFrozen(context.options)) throw new Error("mutable host context");
  return mockProvider();
}`;
async function fixture(t, source = valid) {
  const dir = await mkdtemp(join(repository, ".pida-test-private-"));
  await mkdir(join(dir, "connectors"));
  await writeFile(join(dir, "connectors", "local.mjs"), source);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function code(expected) {
  return error => {
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes("synthetic-private-secret"), false);
    return true;
  };
}

test("host connector runs standalone through the real Pi tool loop and creates independent session bindings", async t => {
  const dir = await fixture(t);
  const loaded = await loadProviderConnector(dir, { module: "connectors/local.mjs", options: { nonSecretMode: "test" } }, { PRIVATE_TOKEN: "synthetic-private-secret" });
  assert.deepEqual(loaded.manifest, { apiVersion: 1, id: "private-test", displayName: "Private synthetic connector" });
  const first = await loaded.provider(), second = await loaded.provider();
  assert.notEqual(first.provider, second.provider);
  const runtime = new PidaRuntime({ provider: loaded.provider, tools: [lotStatusTool] });
  t.after(() => runtime.close());
  const principal = { id: "private-user", permissions: ["lots:read"] };
  const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "LOT-001");
  assert.equal(result.status, "completed");
  assert.match(result.text, /LOT-001/);
  assert.equal(JSON.stringify(runtime.getTrace(sessionId, principal)).includes("synthetic-private-secret"), false);
});

test("connector options are copied and frozen and credentials are host-only context", async t => {
  const dir = await fixture(t, `import { mockProvider } from "pida-core";
${manifest}
export default ({ options, env, workspaceDir }) => {
  if (options.nested.value !== "original" || !Object.isFrozen(options.nested) || env.PRIVATE_TOKEN !== "synthetic-private-secret" || !workspaceDir) throw new Error("synthetic-private-secret");
  return mockProvider();
}`);
  const options = { nested: { value: "original" } };
  const env = { PRIVATE_TOKEN: "synthetic-private-secret" };
  const loaded = await loadProviderConnector(dir, { module: "connectors/local.mjs", options }, env);
  options.nested.value = "changed";
  env.PRIVATE_TOKEN = "changed";
  await loaded.provider();
  assert.equal(JSON.stringify(loaded).includes("synthetic-private-secret"), false);
});

test("entry-point selection rejects remote imports, escapes, platform paths and symlinks", async t => {
  const dir = await fixture(t);
  for (const module of ["https://example.test/provider.mjs", "file:///tmp/provider.mjs", "../provider.mjs", "connectors/../local.mjs", "connectors//local.mjs", "connectors/local.mjs?other", "connectors/local.js", "connectors\\local.mjs", "D:/private/provider.mjs", "/tmp/provider.mjs"]) {
    await assert.rejects(loadProviderConnector(dir, { module }), code("PROVIDER_CONNECTOR_PATH_INVALID"));
  }
  await symlink(join(dir, "connectors", "local.mjs"), join(dir, "connectors", "linked.mjs"));
  await assert.rejects(loadProviderConnector(dir, { module: "connectors/linked.mjs" }), code("PROVIDER_CONNECTOR_PATH_INVALID"));
  await mkdir(join(dir, "private"));
  await writeFile(join(dir, "private", "outside.mjs"), valid);
  await symlink(join(dir, "private"), join(dir, "connectors", "linked-dir"), "dir");
  await assert.rejects(loadProviderConnector(dir, { module: "connectors/linked-dir/outside.mjs" }), code("PROVIDER_CONNECTOR_PATH_INVALID"));
});

test("changing the entry module after activation cannot silently change the next session", async t => {
  const dir = await fixture(t);
  const loaded = await loadProviderConnector(dir, { module: "connectors/local.mjs" });
  await loaded.provider();
  await writeFile(join(dir, "connectors", "local.mjs"), `${valid}\n// Host update requires restart.`);
  await assert.rejects(loaded.provider(), code("PROVIDER_CONNECTOR_CHANGED"));
  const reloaded = await loadProviderConnector(dir, { module: "connectors/local.mjs" });
  await reloaded.provider();
});

test("invalid config and module contracts fail closed with stable redacted errors", async t => {
  const dir = await fixture(t);
  const circular = {}; circular.self = circular;
  for (const config of [
    { module: "connectors/local.mjs", remote: true },
    { module: "connectors/local.mjs", options: circular },
    { module: "connectors/local.mjs", options: { value: () => "secret" } },
    { module: "connectors/local.mjs", options: { long: "x".repeat(70_000) } },
  ]) await assert.rejects(loadProviderConnector(dir, config), code("PROVIDER_CONNECTOR_CONFIG_INVALID"));
  const cases = [
    [`throw new Error("synthetic-private-secret");`, "PROVIDER_CONNECTOR_LOAD_FAILED"],
    [`export const manifest={apiVersion:2,id:"test",displayName:"Test"}; export default () => {};`, "PROVIDER_CONNECTOR_VERSION_UNSUPPORTED"],
    [`export const manifest={apiVersion:1,id:"test",displayName:"Test",secret:"synthetic-private-secret"}; export default () => {};`, "PROVIDER_CONNECTOR_MANIFEST_INVALID"],
    [`${manifest} export default {};`, "PROVIDER_CONNECTOR_FACTORY_INVALID"],
  ];
  for (let i = 0; i < cases.length; i++) {
    await writeFile(join(dir, "connectors", `invalid-${i}.mjs`), cases[i][0]);
    await assert.rejects(loadProviderConnector(dir, { module: `connectors/invalid-${i}.mjs` }), code(cases[i][1]));
  }
});

test("factory failures, duplicate models and malformed Pi bindings are rejected without exception details", async t => {
  const cases = [
    [`throw new Error("synthetic-private-secret");`, "PROVIDER_CONNECTOR_CREATE_FAILED"],
    [`return () => mockProvider();`, "PROVIDER_CONNECTOR_BINDING_INVALID"],
    [`const binding=mockProvider(); binding.modelId="missing"; return binding;`, "PROVIDER_CONNECTOR_BINDING_INVALID"],
    [`const binding=mockProvider(); const models=binding.provider.getModels(); binding.provider={...binding.provider,getModels:()=>[...models,...models]}; return binding;`, "PROVIDER_CONNECTOR_BINDING_INVALID"],
    [`const binding=mockProvider(); binding.credentials={}; return binding;`, "PROVIDER_CONNECTOR_BINDING_INVALID"],
    [`const binding=mockProvider(); binding.provider={...binding.provider,getModels:()=>{throw new Error("synthetic-private-secret")}}; return binding;`, "PROVIDER_CONNECTOR_BINDING_INVALID"],
  ];
  for (const [body, expected] of cases) {
    const dir = await fixture(t, `import { mockProvider } from "pida-core"; ${manifest} export default async () => { ${body} };`);
    const loaded = await loadProviderConnector(dir, { module: "connectors/local.mjs" });
    await assert.rejects(loaded.provider(), code(expected));
  }
});

test("workspace connector stays host-managed over HTTP and project writes cannot replace its code or activation", async t => {
  const dir = await mkdtemp(join(repository, ".pida-test-private-workspace-"));
  let app;
  t.after(async () => {
    if (app) {
      app.server.closeAllConnections();
      if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
      await app.close();
    }
    await rm(dir, { recursive: true, force: true });
  });
  initWorkspace(dir);
  await mkdir(join(dir, "connectors"));
  const source = `import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
${manifest}
export default () => {
  const fake = fauxProvider({ provider: "private-write-test", tokensPerSecond: 500 });
  fake.setResponses([
    context => {
      const user = [...context.messages].reverse().find(message => message.role === "user");
      const input = typeof user.content === "string" ? user.content : user.content.filter(part => part.type === "text").map(part => part.text).join("");
      return fauxAssistantMessage(fauxToolCall("project_write", { path: input.includes("config") ? "pida.config.json" : "connectors/local.mjs", content: "must never be written" }), { stopReason: "toolUse" });
    },
    fauxAssistantMessage("Synthetic protected-write attempt completed."),
  ]);
  return { provider: fake.provider, modelId: fake.getModel().id };
};`;
  await writeFile(join(dir, "connectors", "local.mjs"), source);
  const config = readConfig(dir);
  config.provider = { kind: "endpoint", api: "openai-completions", baseUrl: "https://unused.invalid/v1", modelId: "unused", apiKeyEnv: "UNUSED_PRIVATE_CONNECTOR_KEY", contextWindow: 8192, maxTokens: 1024 };
  config.providerConnector = { module: "connectors/local.mjs", options: { privateMarker: "synthetic-private-option" } };
  config.project = { enabled: true, root: dir, trustedHost: false };
  config.permissions.push("project:read", "project:write");
  config.tools.enabled = [];
  const serialized = JSON.stringify(config);
  await writeFile(join(dir, "pida.config.json"), serialized);
  const environment = await readFile(join(dir, ".env"), "utf8");
  await writeFile(join(dir, ".env"), environment + "\nPRIVATE_CONNECTOR_TEST_TOKEN=synthetic-private-secret\n");
  app = await createWorkspace(dir);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const client = new PidaClient({ baseUrl: `http://127.0.0.1:${app.server.address().port}`, token: () => workspaceEnvironment(dir).PIDA_API_TOKEN });
  const settings = await client.getProviderSettings();
  assert.deepEqual(settings.connector, { apiVersion: 1, id: "private-test", displayName: "Private synthetic connector", managed: true });
  const visible = JSON.stringify(settings);
  for (const hidden of ["synthetic-private-secret", "synthetic-private-option", "PRIVATE_CONNECTOR_TEST_TOKEN", "connectors/local.mjs"]) assert.equal(visible.includes(hidden), false);
  for (const operation of [() => client.configureProvider({ kind: "mock" }), () => client.testProvider({ kind: "mock" }), () => client.listProviderModels({ kind: "mock" }), () => client.startChatGPTLogin()]) {
    await assert.rejects(operation(), error => error.code === "PROVIDER_HOST_MANAGED" && error.status === 409);
  }
  const principal = { id: "local-user", permissions: config.permissions };
  for (const request of ["replace connector", "replace config"]) {
    const { sessionId } = await app.runtime.createSession(principal);
    await app.runtime.run(sessionId, principal, request);
    const trace = JSON.stringify(app.runtime.getTrace(sessionId, principal));
    assert.match(trace, /PROJECT_PATH_DENIED/);
    assert.equal(trace.includes("synthetic-private-secret"), false);
  }
  assert.equal(await readFile(join(dir, "connectors", "local.mjs"), "utf8"), source);
  assert.equal(await readFile(join(dir, "pida.config.json"), "utf8"), serialized);
});
