import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "typebox";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions } from "../dist/index.js";
import { initWorkspace, readConfig, createWorkspace, checkWorkspace } from "../dist/workspace.js";

const owner = { id: "owner", permissions: [...workbenchPermissions, "sample"] };
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
function scripted(responses) {
  const f = fauxProvider({ tokensPerSecond: 100000 });
  f.setResponses(responses);
  return () => ({ provider: f.provider, modelId: f.getModel().id });
}
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "pida workspace "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test("missing/invalid config has actionable diagnostics without exposing file contents", async t => {
  const dir = await directory(t);
  const result = spawnSync(process.execPath, [cli, "start", dir], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CONFIG_NOT_FOUND/);
  assert.ok(result.stderr.includes(join(dir, "pida.config.json")));
  assert.match(result.stderr, /npm start --/);
  await writeFile(join(dir, "pida.config.json"), '{"secret":"do-not-echo",');
  assert.throws(() => readConfig(dir), error => {
    assert.match(error.message, /CONFIG_INVALID_JSON/);
    assert.ok(!error.message.includes("do-not-echo"));
    return true;
  });
});

test("selected workspace reaches Pi prompt and transcript, including restored legacy cwd", async t => {
  const dir = await directory(t);
  initWorkspace(dir);
  const config = readConfig(dir);
  config.tools.enabled = [];
  await writeFile(join(dir, "pida.config.json"), JSON.stringify(config));
  assert.equal(checkWorkspace(dir).workspaceDir, dir);
  const seen = [];
  const capture = context => { seen.push(JSON.stringify(context)); return answer("done"); };
  const provider = scripted([capture, capture]);
  let app = await createWorkspace(relative(process.cwd(), dir));
  t.after(() => app.runtime.close());
  app.runtime.configureProvider(provider);
  const { sessionId } = await app.runtime.createSession(owner);
  assert.equal((await app.runtime.run(sessionId, owner, "hello")).status, "completed");
  assert.ok(seen[0].includes(dir));
  await app.runtime.close();
  const sessions = join(dir, ".pida", "sessions");
  const path = join(sessions, (await readdir(sessions)).find(p => p.endsWith(".jsonl")));
  const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
  const header = JSON.parse(lines[0]);
  assert.equal(header.cwd, dir);
  // Existing transcripts remain untouched; current host workspace controls the prompt.
  lines[0] = JSON.stringify({ ...header, cwd: join(dir, "legacy-wrong-directory") });
  await writeFile(path, lines.join("\n") + "\n");
  app = await createWorkspace(dir);
  app.runtime.configureProvider(provider);
  await app.runtime.resumeSession(sessionId, owner);
  await app.runtime.run(sessionId, owner, "continue");
  assert.ok(seen[1].includes(dir));
  assert.ok(!seen[1].includes("legacy-wrong-directory"));
  assert.equal(app.runtime.getSession(sessionId, owner).sessionId, sessionId);
});

test("memory-only SDK sessions use explicit workspace without changing process cwd", async t => {
  const dir = await directory(t), original = process.cwd();
  let observed;
  const runtime = new PidaRuntime({ workspaceDir: dir, provider: scripted([context => { observed = JSON.stringify(context); return answer("done"); }]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  await runtime.run(sessionId, owner, "hello");
  assert.ok(observed.includes(dir));
  assert.equal(process.cwd(), original);
});

test("unresolved workbench failure is not hidden by a successful read or model completion claim", async t => {
  const workbench = new PidaWorkbench(await directory(t));
  const initial = await workbench.uiTemplate(owner, "sidebar", "");
  let modelSawFailure;
  const runtime = new PidaRuntime({ tools: workbench.tools(), provider: scripted([
    tool("ui_patch", { expectedRevision: initial.revision, edits: [{ oldText: "no-such-marker", newText: "change" }] }),
    context => {
      modelSawFailure = context.messages.filter(m => m.role === "toolResult").at(-1).isError;
      return tool("ui_read", {});
    },
    answer("Everything is complete."),
  ]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, "change UI");
  assert.equal(result.status, "failed");
  assert.equal(result.code, "UI_EDIT_MATCH_REQUIRED");
  assert.equal(modelSawFailure, true);
  assert.equal((await workbench.uiState(owner)).revision, initial.revision);
  const events = runtime.getTrace(sessionId, owner);
  assert.ok(events.some(e => e.type === "tool_failed" && e.toolName === "ui_patch"));
  assert.ok(events.some(e => e.type === "tool_completed" && e.toolName === "ui_read"));
  assert.equal(events.at(-1).status, result.status);
});

test("a successful UI repair may complete while retaining the earlier failure trace", async t => {
  const workbench = new PidaWorkbench(await directory(t));
  const initial = await workbench.uiTemplate(owner, "sidebar", "");
  const runtime = new PidaRuntime({ tools: workbench.tools(), provider: scripted([
    tool("ui_patch", { expectedRevision: initial.revision, edits: [{ oldText: "no-such-marker", newText: "change" }] }),
    tool("ui_patch", { expectedRevision: initial.revision, edits: [{ oldText: "</main>", newText: "<p>repaired-marker</p></main>" }] }),
    answer("Applied the corrected edit."),
  ]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  assert.equal((await runtime.run(sessionId, owner, "change UI")).status, "completed");
  assert.match((await workbench.uiState(owner)).html, /repaired-marker/);
  assert.deepEqual(runtime.getTrace(sessionId, owner).filter(e => e.type.startsWith("tool_")).map(e => e.type), ["tool_started", "tool_failed", "tool_started", "tool_completed"]);
});

test("unclassified business data containing ok:false remains ordinary data", async t => {
  const runtime = new PidaRuntime({
    tools: [{ name: "sample", description: "data", permission: "sample", parameters: Type.Object({}), async execute() { return { ok: false, label: "business-data" }; } }],
    provider: scripted([tool("sample", {}), answer("Returned the data.")]),
  });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  assert.equal((await runtime.run(sessionId, owner, "read")).status, "completed");
});

test("first interruption wins when cancellation and deadline race during provider teardown", async t => {
  for (const first of ["cancel", "timeout"]) await t.test(first, async t => {
    const started = deferred(), aborted = deferred(), release = deferred();
    const runtime = new PidaRuntime({ maxRunMs: 100, provider: scripted([async (_context, options) => {
      started.resolve();
      if (options.signal.aborted) aborted.resolve();
      else options.signal.addEventListener("abort", aborted.resolve, { once: true });
      await release.promise;
      return answer("", { stopReason: "aborted" });
    }]) });
    t.after(() => { release.resolve(); return runtime.close(); });
    const { sessionId } = await runtime.createSession(owner);
    const running = runtime.run(sessionId, owner, "wait");
    await started.promise;
    let cancelling;
    if (first === "cancel") cancelling = runtime.cancel(sessionId, owner);
    await aborted.promise;
    if (first === "cancel") await delay(150);
    else cancelling = runtime.cancel(sessionId, owner);
    release.resolve();
    const result = await running;
    await cancelling;
    assert.equal(result.code, first === "cancel" ? "CANCELLED" : "RUN_TIMEOUT");
    assert.equal(runtime.getSession(sessionId, owner).lastStatus, result.status);
    assert.equal(runtime.getTrace(sessionId, owner).at(-1).code, result.code);
  });
});

test("a final consumer callback failure cannot cancel a newer run", async t => {
  const runtime = new PidaRuntime({ provider: scripted([answer("first"), answer("second")]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  let next;
  const result = await runtime.run(sessionId, owner, "first", event => {
    if (event.type === "result") {
      next = runtime.run(sessionId, owner, "next");
      throw new Error("consumer disconnected after completion");
    }
  });
  assert.equal(result.status, "completed");
  assert.equal((await next).status, "completed");
  assert.equal(runtime.getSession(sessionId, owner).running, false);
});

test("final storage failure preserves cancellation and reports the secondary error", async t => {
  const dir = await directory(t);
  const runtime = new PidaRuntime({ storageDir: dir, provider: scripted([answer("must not run")]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  const controller = new AbortController();
  const result = await runtime.run(sessionId, owner, "cancel", event => {
    if (event.type === "trace" && event.trace.type === "run_started") {
      rmSync(join(dir, "index"), { recursive: true });
      controller.abort();
    }
  }, controller.signal);
  assert.equal(result.status, "cancelled");
  assert.equal(result.code, "CANCELLED");
  assert.equal(result.persistenceError, "PERSISTENCE_FAILED");
  const final = runtime.getTrace(sessionId, owner).at(-1);
  assert.equal(final.status, result.status);
  assert.equal(final.persistenceError, result.persistenceError);
});

test("uppercase guest error text is not promoted to metadata-only trace codes", async t => {
  const workbench = new PidaWorkbench(await directory(t));
  await workbench.write(owner, "broken.js", 'throw new Error("PRIVATE_EXECUTION_DETAIL");');
  const runtime = new PidaRuntime({ tools: workbench.tools(), provider: scripted([
    tool("workspace_run", { path: "broken.js" }), answer("Failed to execute."),
  ]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, "run");
  assert.equal(result.status, "failed");
  assert.equal(result.code, "WORKSPACE_OPERATION_FAILED");
  assert.ok(!JSON.stringify(runtime.getTrace(sessionId, owner)).includes("PRIVATE_EXECUTION_DETAIL"));
});

test("live-model smoke refuses mock configuration without importing user tools", async t => {
  const dir = await directory(t);
  initWorkspace(dir);
  await writeFile(join(dir, "tools", "lot-status.mjs"), 'throw new Error("MUST_NOT_IMPORT");');
  for (const name of ["real-model-smoke.mjs", "real-model-e2e.mjs"]) {
  const script = fileURLToPath(new URL("../scripts/" + name, import.meta.url));
  const result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "NOT_RUN");
  assert.equal(report.error, "REAL_PROVIDER_REQUIRED");
  assert.deepEqual(report.cases, []);
  assert.ok(!result.stderr.includes("MUST_NOT_IMPORT"));
  }
});
