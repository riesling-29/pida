import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createServer } from "node:http";
import { initWorkspace, readConfig, createWorkspace, workspaceEnvironment } from "../dist/workspace.js";
import { ProviderSettings } from "../dist/provider-settings.js";
import { AgentSupervisor } from "../dist/agent-supervisor.js";
import { PidaRuntime, mockProvider } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { PidaClient } from "../dist/client.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
async function waitFor(read, accept) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Expected state was not observed within five seconds");
}
const terminal = job => !["queued", "running"].includes(job.status);
async function stopServer(server) {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

test("global provider changes wait for agents, refresh existing/new agents, and rotate same-target keys", async t => {
  const directory = await mkdtemp(join(repository, ".pida-test-review-model-"));
  let app, releaseFirst;
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    requests.push({ authorization: request.headers.authorization, body: JSON.parse(raw) });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: "review", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant", content: "OK" });
    if (requests.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
    send({}, "stop"); response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { releaseFirst?.(); await app?.close(); await stopServer(server); await rm(directory, { recursive: true, force: true }); });
  initWorkspace(directory);
  const config = readConfig(directory), baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  config.provider = { kind: "endpoint", api: "openai-completions", baseUrl, modelId: "fixture", apiKeyEnv: "PIDA_REVIEW_KEY", contextWindow: 8192, maxTokens: 1024, allowInsecureHttp: true };
  config.tools.enabled = [];
  await writeFile(join(directory, "pida.config.json"), JSON.stringify(config));
  await writeFile(join(directory, ".env"), await readFile(join(directory, ".env"), "utf8") + "\nPIDA_REVIEW_KEY=synthetic-old-key\n");
  app = await createWorkspace(directory);
  const principal = { id: "local-user", permissions: config.permissions };
  const agent = app.agents.register(principal, { name: "existing agent" });
  const first = app.agents.enqueue(agent.id, principal, { input: "first request", requestId: "initial" });
  await waitFor(() => releaseFirst, Boolean);
  const before = await app.agents.getRuntime(agent.id, principal);
  const settings = new ProviderSettings(directory, app.runtime);
  await assert.rejects(settings.apply({ kind: "mock" }), error => error.code === "PROVIDER_BUSY");
  assert.equal(readConfig(directory).provider.kind, "endpoint");
  releaseFirst();
  assert.equal((await waitFor(() => app.agents.getJob(first.id, principal), terminal)).status, "completed");
  const sessionId = app.agents.get(agent.id, principal).sessionId;
  assert.equal(requests[0].authorization, "Bearer synthetic-old-key");
  await settings.apply({ kind: "endpoint", api: "openai-completions", baseUrl, modelId: "fixture", apiKey: "synthetic-new-key", contextWindow: 8192, maxTokens: 1024, allowInsecureHttp: true });
  const rotated = await app.agents.getRuntime(agent.id, principal);
  assert.notEqual(rotated, before, "same-target credential changes must replace a stale provider binding");
  const next = app.agents.enqueue(agent.id, principal, { input: "continue after key rotation", requestId: "rotated" });
  assert.equal((await waitFor(() => app.agents.getJob(next.id, principal), terminal)).status, "completed");
  assert.equal(app.agents.get(agent.id, principal).sessionId, sessionId);
  assert.equal(requests.at(-1).authorization, "Bearer synthetic-new-key");
  await settings.apply({ kind: "mock" });
  const changed = await app.agents.getRuntime(agent.id, principal);
  const freshAgent = app.agents.register(principal, { name: "new agent" });
  const fresh = await app.agents.getRuntime(freshAgent.id, principal);
  for (const runtime of [app.runtime, changed, fresh]) assert.equal(runtime.getInfo(principal).provider.mode, "mock");
  assert.equal(app.agents.get(agent.id, principal).sessionId, sessionId);
  await settings.close();
});

test("unreconciled main effects block shared-project agent execution after restart and permit it after host reconciliation", async t => {
  const directory = await mkdtemp(join(repository, ".pida-review-effect-"));
  let app;
  t.after(async () => { if (app) { await stopServer(app.server); await app.close(); } await rm(directory, { recursive: true, force: true }); });
  initWorkspace(directory); await mkdir(join(directory, "connectors"));
  await writeFile(join(directory, "connectors", "fixture.mjs"), `import {fauxProvider,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai/providers/faux";
export const manifest={apiVersion:1,id:"effect-fixture",displayName:"Synthetic effect fixture"};
export default () => { const fake=fauxProvider({provider:"effect-fixture",tokensPerSecond:500}); fake.setResponses([
  context => {const user=context.messages.findLast(message=>message.role==="user");const text=typeof user.content==="string"?user.content:user.content.map(part=>part.text??"").join("");return text==="main-failure"?fauxAssistantMessage(fauxToolCall("uncertain_change",{}),{stopReason:"toolUse"}):fauxAssistantMessage("Agent proceeded");},
  fauxAssistantMessage("Main stopped after uncertain effect")]);return {provider:fake.provider,modelId:fake.getModel().id};};`);
  await writeFile(join(directory, "tools", "uncertain.mjs"), `import {Type} from "typebox"; export default {name:"uncertain_change",description:"Synthetic uncertain effect",permission:"review:write",effect:"write",parameters:Type.Object({}),execute:async()=>{throw new Error("simulated lost acknowledgement");}};`);
  const config = readConfig(directory);
  config.providerConnector = { module: "connectors/fixture.mjs" };
  config.project = { enabled: true, root: directory, trustedHost: false };
  config.tools.enabled = ["uncertain.mjs"]; config.permissions.push("review:write");
  await writeFile(join(directory, "pida.config.json"), JSON.stringify(config));
  const principal = { id: "local-user", permissions: [...config.permissions, "pida:recover"] };
  app = await createWorkspace(directory);
  const { sessionId } = await app.runtime.createSession(principal);
  const main = await app.runtime.run(sessionId, principal, "main-failure");
  assert.ok(main.recovery);
  const agent = app.agents.register(principal, { name: "shared project writer" });
  await app.close();
  app = await createWorkspace(directory);
  const job = app.agents.enqueue(agent.id, principal, { input: "after main failure", requestId: "blocked" });
  const blocked = await waitFor(() => app.agents.getJob(job.id, principal), terminal);
  assert.equal(blocked.status, "failed"); assert.equal(blocked.code, "EFFECT_STATE_UNKNOWN"); assert.equal(blocked.runId, undefined);
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  const url = `http://127.0.0.1:${app.server.address().port}`, token = workspaceEnvironment(directory).PIDA_API_TOKEN;
  const client = new PidaClient({ baseUrl: url, token: () => token });
  const recovery = app.runtime.getRecovery(sessionId, principal);
  assert.equal(recovery.pendingEffects.length, 1);
  const response = await fetch(`${url}/v1/sessions/${sessionId}/recovery`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ effects: recovery.pendingEffects.map(effect => ({ id: effect.id, state: "not_applied" })), inspected: true }) });
  assert.equal(response.status, 200, await response.text());
  assert.equal(app.runtime.getRecovery(sessionId, principal).pendingEffects.length, 0);
  const resumed = await client.enqueueAgentJob(agent.id, { input: "after reconciliation", requestId: "allowed" });
  const done = await waitFor(() => app.agents.getJob(resumed.id, principal), terminal);
  assert.equal(done.status, "completed"); assert.equal(done.result.text, "Agent proceeded");
});

test("an interrupted job before session creation can expose empty recovery without creating a Pi session", async t => {
  const directory = await mkdtemp(join(repository, ".pida-test-review-empty-recovery-"));
  const principal = { id: "review-owner", permissions: ["pida:agents", "pida:recover"] };
  let supervisor, server;
  const runtime = new PidaRuntime({ provider: mockProvider });
  const options = { directory, createRuntime: () => { throw new Error("Recovery must not create a nonexistent session"); }, resolvePrincipal: () => principal };
  t.after(async () => { if (server) await stopServer(server); await supervisor?.close(); await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  supervisor = await AgentSupervisor.open(options);
  const agent = supervisor.register(principal, { name: "interrupted startup" });
  const job = supervisor.enqueue(agent.id, principal, { input: "not yet started", requestId: "startup" });
  await supervisor.close();
  const path = join(directory, "supervisor.json"), state = JSON.parse(await readFile(path, "utf8"));
  state.jobs[0].status = "running"; // Durable boundary immediately before Pi session creation.
  await writeFile(path, JSON.stringify(state));
  supervisor = await AgentSupervisor.open(options);
  const token = "synthetic-review-token-no-company-secret";
  server = createPidaServer({ runtime, agents: supervisor, authenticate: staticTokenAuth([{ token, principal }]) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new PidaClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: () => token });
  assert.equal(supervisor.getJob(job.id, principal).status, "interrupted");
  assert.deepEqual(await client.getAgentJobRecovery(agent.id, job.id), { sessionId: null, autoReplay: false, pendingEffects: [] });
  await client.reconcileAgent(agent.id, { inspected: true, effects: [] });
  assert.equal(supervisor.get(agent.id, principal).needsReconciliation, false);
  assert.equal(supervisor.get(agent.id, principal).sessionId, undefined);
});
