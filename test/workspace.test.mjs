import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  initWorkspace,
  readConfig,
  checkWorkspace,
  listToolFiles,
  setToolEnabled,
  loadWorkspaceTools,
  createWorkspace,
  workspaceEnvironment,
} from "../dist/workspace.js";
import { PidaClient } from "../dist/client.js";
const root = fileURLToPath(new URL("../", import.meta.url));
async function fixture(t) {
  const dir = await mkdtemp(join(root, ".pida-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  initWorkspace(dir);
  return dir;
}
test("CLI setup starts the workspace and configure reuses its running server", async (t) => {
  const dir = await fixture(t);
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const config = readConfig(dir);
  config.port = listener.address().port;
  await new Promise((ok) => listener.close(ok));
  await writeFile(join(dir, "pida.config.json"), JSON.stringify(config));
  const cli = join(root, "dist", "cli.js");
  const server = spawn(process.execPath, [cli, "setup", dir, "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, "exit");
      server.kill("SIGTERM");
      await stopped;
    }
  });
  let startup = "";
  await new Promise((ok, fail) => {
    server.stdout.on("data", (chunk) => {
      startup += chunk;
      if (startup.includes("Pida ready:")) ok();
    });
    server.once("error", fail);
    server.once("exit", () => fail(new Error("Setup exited before readiness")));
  });
  const configure = spawn(
    process.execPath,
    [cli, "configure", dir, "--no-open"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let result = "";
  configure.stdout.on("data", (chunk) => (result += chunk));
  configure.stderr.on("data", (chunk) => (result += chunk));
  assert.equal((await once(configure, "exit"))[0], 0, result);
  assert.match(result, /Pida settings:/);
  assert.ok(!startup.includes(workspaceEnvironment(dir).PIDA_API_TOKEN));
  assert.ok(!result.includes(workspaceEnvironment(dir).PIDA_API_TOKEN));
});
test("initialization creates a usable workspace, unique private credentials and never overwrites existing files", async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  assert.notEqual(
    workspaceEnvironment(a).PIDA_API_TOKEN,
    workspaceEnvironment(b).PIDA_API_TOKEN,
  );
  assert.equal(checkWorkspace(a).ok, true);
  assert.throws(() => initWorkspace(a), /already exist/);
  const env = await readFile(join(a, ".env"), "utf8");
  assert.match(env, /PIDA_API_TOKEN=[a-f0-9]{64}/);
  assert.deepEqual(listToolFiles(a), [
    { file: "lot-status.mjs", enabled: true },
  ]);
  assert.equal((await loadWorkspaceTools(a))[0].name, "get_lot_status");
});
test("only explicitly approved tool files are imported; enabling grants no permission", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, "tools", "disabled.mjs"),
    'throw new Error("SHOULD_NOT_IMPORT");',
  );
  assert.equal(listToolFiles(dir).length, 2);
  assert.equal(checkWorkspace(dir).ok, true);
  assert.equal((await loadWorkspaceTools(dir)).length, 1);
  setToolEnabled(dir, "disabled.mjs", true);
  assert.deepEqual(readConfig(dir).permissions, ["lots:read", "workbench:read", "workbench:write", "workbench:execute", "workbench:history", "skills:write"]);
  await assert.rejects(loadWorkspaceTools(dir), /SHOULD_NOT_IMPORT/);
  setToolEnabled(dir, "disabled.mjs", false);
  assert.equal((await loadWorkspaceTools(dir)).length, 1);
});
test("tool paths reject traversal, symlinks and invalid exports; config rejects unknown fields", async (t) => {
  const dir = await fixture(t);
  assert.throws(() => setToolEnabled(dir, "../oops.mjs", true), /plain/);
  await symlink(
    join(dir, "tools", "lot-status.mjs"),
    join(dir, "tools", "alias.mjs"),
  );
  assert.throws(() => setToolEnabled(dir, "alias.mjs", true), /symlinks/);
  await writeFile(join(dir, "tools", "invalid.mjs"), "export default {};");
  setToolEnabled(dir, "invalid.mjs", true);
  await assert.rejects(loadWorkspaceTools(dir), /BusinessTool/);
  const config = readConfig(dir);
  config.secret = "do-not-accept";
  await writeFile(join(dir, "pida.config.json"), JSON.stringify(config));
  assert.throws(() => readConfig(dir), /Invalid/);
});
test("workspace HTTP client lists and resumes persisted sessions without extra application code", async (t) => {
  const dir = await fixture(t);
  let app;
  const start = async () => {
    app = await createWorkspace(dir);
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    return new PidaClient({
      baseUrl: `http://127.0.0.1:${app.server.address().port}`,
      token: () => workspaceEnvironment(dir).PIDA_API_TOKEN,
    });
  };
  const stop = async () => {
    app.server.closeAllConnections();
    await new Promise((ok) => app.server.close(ok));
    await app.runtime.close();
  };
  let client = await start();
  t.after(async () => {
    if (app.server.listening) await stop();
  });
  const info = await client.getInfo();
  assert.equal(info.persistence, true);
  assert.equal(info.provider.mode, "mock");
  assert.ok(info.tools[0].permitted);
  assert.ok(
    !JSON.stringify(info).includes(workspaceEnvironment(dir).PIDA_API_TOKEN),
  );
  const { sessionId } = await client.createSession();
  assert.equal((await client.run(sessionId, "LOT-002")).status, "completed");
  await stop();
  client = await start();
  assert.equal((await client.listSessions()).sessions[0].sessionId, sessionId);
  assert.ok(
    (await client.getSession(sessionId)).messages.some((m) =>
      m.text.includes("processing"),
    ),
  );
  await client.deleteSession(sessionId);
  assert.deepEqual((await client.listSessions()).sessions, []);
});
test("doctor catches missing provider credentials without printing keys or importing modules", async (t) => {
  const dir = await fixture(t),
    config = readConfig(dir);
  config.provider = {
    kind: "endpoint",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    modelId: "test",
    apiKeyEnv: "PIDA_TEST_MISSING_KEY",
    contextWindow: 8192,
    maxTokens: 1024,
  };
  await writeFile(join(dir, "pida.config.json"), JSON.stringify(config));
  const report = checkWorkspace(dir);
  assert.equal(report.ok, false);
  assert.match(report.problems[0], /PIDA_TEST_MISSING_KEY/);
  const app = await createWorkspace(dir);
  assert.equal(
    app.runtime.getInfo({ id: "local-user", permissions: [] }).provider.mode,
    "endpoint",
  );
  await assert.rejects(
    app.runtime.createSession({ id: "local-user", permissions: [] }),
    /PIDA_TEST_MISSING_KEY/,
  );
  await app.runtime.close();
});
test("CLI help and doctor are executable and output no credentials", async (t) => {
  const dir = await fixture(t);
  const cli = join(root, "dist", "cli.js");
  const help = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /pida init/);
  const doctor = spawnSync(process.execPath, [cli, "doctor", dir], {
    encoding: "utf8",
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.ok(!doctor.stdout.includes(workspaceEnvironment(dir).PIDA_API_TOKEN));
});
test("a user module executes through Pi after approval and still requires its own permission", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, "tools", "ticket.mjs"),
    `
    export default { name: 'get_ticket', description: 'Read a test ticket', permission: 'tickets:read',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      async execute({ id }, { principal }) { return { id, owner: principal.id, status: 'open' }; }
    };
  `,
  );
  setToolEnabled(dir, "ticket.mjs", true);
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import(
    "@earendil-works/pi-ai/providers/faux"
  );
  const { PidaRuntime } = await import("../dist/index.js");
  const r = new PidaRuntime({
    tools: await loadWorkspaceTools(dir),
    provider: () => {
      const f = fauxProvider();
      f.setResponses([
        fauxAssistantMessage(fauxToolCall("get_ticket", { id: "T-1" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      return { provider: f.provider, modelId: f.getModel().id };
    },
  });
  t.after(() => r.close());
  const allowed = { id: "operator", permissions: ["tickets:read"] };
  const first = await r.createSession(allowed);
  assert.equal(
    (await r.run(first.sessionId, allowed, "ticket")).status,
    "completed",
  );
  assert.ok(
    r
      .getTrace(first.sessionId, allowed)
      .some((e) => e.type === "tool_completed" && e.toolName === "get_ticket"),
  );
  const denied = { id: "operator", permissions: [] },
    second = await r.createSession(denied);
  assert.equal(
    (await r.run(second.sessionId, denied, "ticket")).code,
    "TOOL_FORBIDDEN",
  );
});
