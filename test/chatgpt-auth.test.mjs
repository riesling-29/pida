import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { initWorkspace, createWorkspace, readConfig, checkWorkspace } from "../dist/workspace.js";
import { ProviderSettings } from "../dist/provider-settings.js";
import { ChatGPTCredentialStore } from "../dist/chatgpt-auth.js";
import { nativeProvider } from "../dist/provider-catalog.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { PidaClient } from "../dist/client.js";
import { protocolFixture, modelId, callbackURL, waitForLogin } from "./fixtures/chatgpt-protocol.mjs";
const owner = { id: "local-user", permissions: ["lots:read", "pida:configure"] };
const draft = { kind: "native", providerId: "openai", modelId, authMode: "chatgpt" };
async function fixture(t) {
  const dir = await mkdtemp(fileURLToPath(new URL("../.pida-test-chatgpt-", import.meta.url))); initWorkspace(dir);
  const app = await createWorkspace(dir), settings = new ProviderSettings(dir, app.runtime), protocol = protocolFixture();
  t.mock.method(globalThis, "fetch", protocol.fetch);
  t.after(async () => { await settings.close(); await app.runtime.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, app, settings, protocol, store: new ChatGPTCredentialStore(dir, ".pida") };
}
async function login(f, manual = false) {
  const start = f.settings.startChatGPT(owner.id), ready = await waitForLogin(f.settings, start.id, owner.id, v => !!v.authUrl || v.status !== "pending");
  const auth = new URL(ready.authUrl); assert.equal(auth.searchParams.get("agent_name_hint"), "pida-core");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  if (manual) f.settings.inputChatGPT(start.id, owner.id, callbackURL(ready).href);
  else assert.equal((await fetch(callbackURL(ready))).status, 200);
  return { ready, result: await waitForLogin(f.settings, start.id, owner.id) };
}

test("upstream ChatGPT PKCE login, scoped account catalog, real Pi tool cycle and restart; no API-key fallback", async t => {
  const f = await fixture(t), { result } = await login(f);
  assert.equal(result.status, "connected"); assert.ok(!result.authUrl);
  assert.equal(f.protocol.tokens[0].client_id, "fixture-client"); assert.ok(f.protocol.tokens[0].code_verifier.length >= 43);
  assert.deepEqual((await f.settings.models(draft)).models, [modelId]);
  assert.equal(readConfig(f.dir).provider.kind, "mock", "login alone never switches provider");
  await f.settings.apply(draft); assert.equal(readConfig(f.dir).provider.authMode, "chatgpt");
  assert.equal(f.settings.get().keyConfigured, false); assert.equal(f.settings.get().chatgpt.connected, true);
  assert.ok(!JSON.stringify(f.settings.get()).includes("oauth-fixture"));
  assert.ok(!(await readFile(join(f.dir, "pida.config.json"), "utf8")).includes("oauth-fixture"));
  if (process.platform !== "win32") assert.equal((await stat(join(f.store.directory, "credential.json"))).mode & 0o777, 0o600);
  assert.equal(checkWorkspace(f.dir).ok, true);
  const { sessionId } = await f.app.runtime.createSession(owner); f.protocol.useTool = true;
  const run = await f.app.runtime.run(sessionId, owner, "Check LOT-002");
  assert.equal(run.status, "completed"); assert.ok(f.app.runtime.getTrace(sessionId, owner).some(e => e.type === "tool_completed" && e.toolName === "get_lot_status"));
  assert.ok(f.protocol.requests.at(-1).input.some(i => i.type === "function_call_output"));
  assert.ok(!JSON.stringify(f.app.runtime.getTrace(sessionId, owner)).includes("oauth-fixture"));
  const host = f.store.deviceId(); await f.app.runtime.close();
  const restored = await createWorkspace(f.dir);
  try { assert.equal((await restored.runtime.run(sessionId, owner, "continue")).status, "completed"); assert.equal(new ChatGPTCredentialStore(f.dir, ".pida").deviceId(), host); }
  finally { await restored.runtime.close(); }
  await f.store.delete("openai");
  const binding = nativeProvider({ ...draft, apiKeyEnv: "OPENAI_API_KEY" }, { OPENAI_API_KEY: "sk-never-use" }, undefined, f.store)();
  const models = createModels({ credentials: binding.credentials }); models.setProvider(binding.provider);
  assert.equal(await models.getAuth("openai"), undefined);
});

test("cancel, incorrect callback state and denied grant preserve previous credentials; manual callback succeeds", async t => {
  const f = await fixture(t); await login(f, true);
  const old = await readFile(join(f.store.directory, "credential.json"), "utf8"), host = f.store.deviceId();
  const start = f.settings.startChatGPT(owner.id), ready = await waitForLogin(f.settings, start.id, owner.id, s => !!s.authUrl);
  const bad = callbackURL(ready); bad.searchParams.set("state", "wrong-state"); assert.equal((await fetch(bad)).status, 400);
  assert.equal(f.settings.getChatGPTLogin(start.id, owner.id).status, "pending");
  assert.throws(() => f.settings.getChatGPTLogin(start.id, "other"), /NOT_FOUND/);
  assert.throws(() => f.settings.startChatGPT(owner.id), /SETUP_BUSY/);
  assert.equal((await f.settings.cancelChatGPT(start.id, owner.id)).status, "cancelled");
  assert.equal(await readFile(join(f.store.directory, "credential.json"), "utf8"), old);
  f.protocol.grant = false;
  const denied = await login(f); assert.equal(denied.result.code, "CHATGPT_PLAN_NOT_AUTHORIZED");
  assert.equal(await readFile(join(f.store.directory, "credential.json"), "utf8"), old);
  assert.equal(f.store.deviceId(), host); assert.equal(readConfig(f.dir).provider.kind, "mock");
});

test("Pi serializes rotated refresh tokens across sessions and preserves the last credential on refresh failure", async t => {
  const f = await fixture(t); await login(f);
  const credential = await f.store.read("openai");
  await f.store.modify("openai", async () => ({ ...credential, expires: 1 }));
  const binding = () => nativeProvider({ ...draft, apiKeyEnv: "OPENAI_API_KEY" }, {}, undefined, new ChatGPTCredentialStore(f.dir, ".pida"))();
  function models() { const b = binding(), m = createModels({ credentials: b.credentials }); m.setProvider(b.provider); return m; }
  const [a, b] = await Promise.all([models().getAuth("openai"), models().getAuth("openai")]);
  assert.equal(a.auth.apiKey, b.auth.apiKey); assert.equal(f.protocol.tokens.filter(t => t.grant_type === "refresh_token").length, 1);
  await f.store.modify("openai", async c => ({ ...c, expires: 1 })); const before = await f.store.read("openai");
  f.protocol.refreshFails = true; await assert.rejects(models().getAuth("openai"), e => e.message.includes("CHATGPT_REFRESH_FAILED") && !e.message.includes("fixture secret details"));
  assert.deepEqual(await f.store.read("openai"), before);
  await f.settings.logoutChatGPT(); assert.equal(f.store.status().connected, false);
  assert.equal(f.store.deviceId().length, 36);
});

test("HTTP login is configuration-authorized, owner-bound and returns no credentials; failed apply retains config", async t => {
  const f = await fixture(t), token = "a".repeat(32), other = "b".repeat(32), read = "r".repeat(32);
  const server = createPidaServer({ runtime: f.app.runtime, providerSettings: f.settings, authenticate: staticTokenAuth([
    { token, principal: owner }, { token: other, principal: { ...owner, id: "other" } }, { token: read, principal: { ...owner, permissions: [] } },
  ]) }); server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`, client = new PidaClient({ baseUrl, token: () => token });
  assert.equal((await fetch(baseUrl + "/v1/provider/chatgpt/login", { method: "POST" })).status, 401);
  await assert.rejects(new PidaClient({ baseUrl, token: () => read }).startChatGPTLogin(), /FORBIDDEN/);
  const started = await client.startChatGPTLogin();
  await assert.rejects(new PidaClient({ baseUrl, token: () => other }).getChatGPTLogin(started.id), /NOT_FOUND/);
  await waitForLogin(f.settings, started.id, owner.id, s => !!s.authUrl); await client.cancelChatGPTLogin(started.id);
  await login(f); f.protocol.responseFails = true;
  const before = await readFile(join(f.dir, "pida.config.json"), "utf8"); await assert.rejects(client.configureProvider(draft), /PROVIDER_TEST_FAILED/);
  assert.equal(await readFile(join(f.dir, "pida.config.json"), "utf8"), before);
  assert.ok(!JSON.stringify(await client.getProviderSettings()).includes("oauth-fixture"));
  await client.disconnectChatGPT(); assert.equal((await client.getProviderSettings()).chatgpt.connected, false);
});

test("credential files reject corruption and links without exposing content", async t => {
  const f = await fixture(t); await login(f);
  const path = join(f.store.directory, "credential.json");
  await writeFile(path, '{"secret":"should-not-appear"');
  await assert.rejects(f.store.read("openai"), e => e.code === "CHATGPT_STORAGE_FAILED" && !e.message.includes("should-not-appear"));
  await f.settings.logoutChatGPT();
  const outside = join(f.dir, "other.txt"); await writeFile(outside, "outside"); await symlink(outside, path);
  await assert.rejects(f.store.read("openai"), /CHATGPT_STORAGE_FAILED/);
  await assert.rejects(f.settings.logoutChatGPT(), /CHATGPT_STORAGE_FAILED/);
  assert.equal(await readFile(outside, "utf8"), "outside");
});


test("a run starting during login prevents account replacement; active execution also blocks logout", async t => {
  const f = await fixture(t); await login(f); const before = await f.store.read("openai");
  const model = fauxProvider(); let release;
  model.setResponses([async () => { await new Promise(resolve => { release = resolve; }); return fauxAssistantMessage("done"); }]);
  f.app.runtime.configureProvider(() => ({ provider: model.provider, modelId: model.getModel().id }));
  const started = f.settings.startChatGPT(owner.id), ready = await waitForLogin(f.settings, started.id, owner.id, s => !!s.authUrl);
  const { sessionId } = await f.app.runtime.createSession(owner), run = f.app.runtime.run(sessionId, owner, "wait");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  try {
    await fetch(callbackURL(ready));
    assert.equal((await waitForLogin(f.settings, started.id, owner.id)).code, "PROVIDER_BUSY");
    assert.deepEqual(await f.store.read("openai"), before);
    await assert.rejects(f.settings.logoutChatGPT(), /PROVIDER_BUSY/);
  } finally { release(); await run; }
  await f.settings.logoutChatGPT(); assert.equal(f.store.status().connected, false);
});
