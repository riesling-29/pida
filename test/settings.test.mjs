import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initWorkspace,
  createWorkspace,
  workspaceEnvironment,
  readConfig,
} from "../dist/workspace.js";
import { ProviderSettings } from "../dist/provider-settings.js";
import { PidaRuntime, mockProvider, lotStatusTool } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
const owner = { id: "local-user", permissions: ["lots:read"] };
async function fixture(t) {
  const dir = await mkdtemp(
    fileURLToPath(new URL("../.pida-test-settings-", import.meta.url)),
  );
  initWorkspace(dir);
  const calls = [];
  const endpoint = createServer(async (req, res) => {
    calls.push({ path: req.url, auth: req.headers.authorization });
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: [{ id: "local-model" }, { id: "local-model" }],
        }),
      );
      return;
    }
    if (req.url === "/bad/models") {
      res.writeHead(302, { Location: "/v1/models" });
      res.end();
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    if (body.model === "fail") {
      res.writeHead(401);
      res.end("private upstream error synthetic-key");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish] of [
      [{ role: "assistant", content: "OK" }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  let app = await createWorkspace(dir);
  const settings = new ProviderSettings(dir, app.runtime);
  t.after(async () => {
    await app.runtime.close();
    endpoint.closeAllConnections();
    await new Promise((ok) => endpoint.close(ok));
    await rm(dir, { recursive: true, force: true });
  });
  const draft = {
    kind: "endpoint",
    baseUrl: `http://127.0.0.1:${endpoint.address().port}/v1`,
    modelId: "local-model",
    authMode: "none",
    allowInsecureHttp: true,
  };
  return {
    dir,
    app,
    settings,
    draft,
    calls,
    reopen: async () => {
      await app.runtime.close();
      app = await createWorkspace(dir);
      return app;
    },
  };
}
test("keyless local discovery, live apply and session resume use Pi without auth headers or restart", async (t) => {
  const { app, settings, draft, calls } = await fixture(t);
  const { sessionId } = await app.runtime.createSession(owner);
  await app.runtime.run(sessionId, owner, "LOT-001");
  assert.deepEqual((await settings.models(draft)).models, ["local-model"]);
  assert.equal(
    (
      await settings.apply({
        ...draft,
        baseUrl: draft.baseUrl + "/chat/completions",
      })
    ).applied,
    true,
  );
  assert.equal(
    (await app.runtime.run(sessionId, owner, "continue")).text,
    "OK",
  );
  assert.equal(
    app.runtime
      .getSession(sessionId, owner)
      .messages.filter((m) => m.role === "user").length,
    2,
  );
  assert.ok(calls.every((c) => c.auth === undefined));
  assert.equal(app.runtime.getInfo(owner).provider.model, "local-model");
});
test("new keys save privately, remain absent from API metadata and work after restart", async (t) => {
  const { dir, app, settings, draft, calls, reopen } = await fixture(t);
  const data = { ...draft, authMode: "api-key", apiKey: "synthetic-key-new" };
  const response = await settings.apply(data);
  assert.ok(!JSON.stringify(response).includes("synthetic-key-new"));
  assert.equal(settings.get().keyConfigured, true);
  assert.ok(!JSON.stringify(settings.get()).includes("synthetic-key-new"));
  assert.ok(
    !(await readFile(join(dir, "pida.config.json"), "utf8")).includes(
      "synthetic-key-new",
    ),
  );
  assert.ok(
    (await readFile(join(dir, ".pida", "provider-key.json"), "utf8")).includes(
      "synthetic-key-new",
    ),
  );
  await settings.models({ ...data, apiKey: "" });
  assert.equal(calls.at(-1).auth, "Bearer synthetic-key-new");
  const restored = await reopen();
  const { sessionId } = await restored.runtime.createSession(owner);
  assert.equal(
    (await restored.runtime.run(sessionId, owner, "hello")).status,
    "completed",
  );
  assert.equal(calls.at(-1).auth, "Bearer synthetic-key-new");
});
test("failed probes retain prior configuration, changed destinations never receive a saved key, redirects are rejected", async (t) => {
  const { dir, settings, draft, calls } = await fixture(t);
  await settings.apply({
    ...draft,
    authMode: "api-key",
    apiKey: "synthetic-key",
  });
  const previous = await readFile(join(dir, "pida.config.json"), "utf8");
  await assert.rejects(
    settings.apply({ ...draft, modelId: "fail", authMode: "api-key" }),
    /PROVIDER_TEST_FAILED/,
  );
  assert.equal(await readFile(join(dir, "pida.config.json"), "utf8"), previous);
  const count = calls.length;
  await assert.rejects(
    settings.models({
      ...draft,
      baseUrl: draft.baseUrl.replace("/v1", "/other"),
      authMode: "api-key",
    }),
    /PROVIDER_KEY_REQUIRED/,
  );
  assert.equal(calls.length, count);
  await assert.rejects(
    settings.models({
      ...draft,
      baseUrl: draft.baseUrl.replace("/v1", "/bad"),
    }),
    /MODEL_LIST_UNAVAILABLE/,
  );
  assert.equal(calls.length, count + 1);
  await assert.rejects(
    settings.apply({ ...draft, baseUrl: draft.baseUrl + "?secret=x" }),
    /INVALID_PROVIDER_URL/,
  );
  await assert.rejects(
    settings.apply({ ...draft, unknown: true }),
    /UNKNOWN_FIELD/,
  );
});
test("provider admin routes require an explicit independent permission", async (t) => {
  const { dir, app } = await fixture(t);
  const settings = new ProviderSettings(dir, app.runtime);
  const token = "t".repeat(40),
    server = createPidaServer({
      runtime: app.runtime,
      providerSettings: settings,
      authenticate: staticTokenAuth([{ token, principal: owner }]),
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/v1/provider`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 403);
});
test("applying providers during a tool run is rejected without changing state", async (t) => {
  const { dir } = await fixture(t);
  let entered;
  const started = new Promise((ok) => (entered = ok));
  const runtime = new PidaRuntime({
    provider: mockProvider,
    tools: [
      {
        ...lotStatusTool,
        execute: async (_, { signal }) => {
          entered();
          await new Promise((ok, fail) =>
            signal.addEventListener("abort", () => fail(new Error("stop")), {
              once: true,
            }),
          );
        },
      },
    ],
  });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  const running = runtime.run(sessionId, owner, "LOT-001");
  await started;
  const settings = new ProviderSettings(dir, runtime);
  await assert.rejects(settings.apply({ kind: "mock" }), /PROVIDER_BUSY/);
  await runtime.cancel(sessionId, owner);
  await running;
});
