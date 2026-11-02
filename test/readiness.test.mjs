import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { PidaClient } from "../dist/client.js";
import { unlockStore } from "../dist/storage.js";
const owner = { id: "owner", permissions: ["mutate", "pida:recover", ...workbenchPermissions] };
const tool = (name, args = {}) => answer(call(name, args), { stopReason: "toolUse" });
function provider(responses) { const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(responses); return () => ({ provider: f.provider, modelId: f.getModel().id }); }
async function dir(t) { const d = await mkdtemp(join(tmpdir(), "pida-ready-")); t.after(() => rm(d, { recursive: true, force: true })); return d; }
async function runtime(t, responses, options = {}) { const r = new PidaRuntime({ provider: provider(responses), ...options }); t.after(() => r.close()); return { r, id: (await r.createSession(owner)).sessionId }; }
const mutation = execute => ({ name: "mutate", permission: "mutate", description: "test change", parameters: Type.Object({}), execute });

test("output continuation cannot replay an applied non-idempotent change", async t => {
  let applied = 0;
  const { r, id } = await runtime(t, [tool("mutate"), answer("partial", { stopReason: "length" }), tool("mutate"), answer("done")], { tools: [mutation(async () => { applied++; return { ok: true }; })] });
  const result = await r.run(id, owner, "change once");
  assert.equal(applied, 1); assert.equal(result.code, "TOOL_REPLAY_BLOCKED");
  assert.ok(r.exportRun(id, result.runId, owner).events.some(e => e.activity === "output_retry"));
});

test("explicitly idempotent host tools receive a stable retry key", async t => {
  const keys = [];
  const { r, id } = await runtime(t, [tool("mutate"), tool("mutate"), answer("done")], { tools: [{ ...mutation(async (_args, context) => { keys.push(context.idempotencyKey); return {}; }), effect: "idempotent" }] });
  assert.equal((await r.run(id, owner, "repeat safely")).status, "completed");
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.match(keys[0], /^[a-f0-9]{64}$/);
});

test("missing effect storage fails before a changing tool executes", async t => {
  const state = await dir(t); let changes = 0;
  const { r, id } = await runtime(t, [tool("mutate")], { storageDir: state, tools: [mutation(async () => { changes++; return {}; })] });
  writeFileSync(join(state, "effects"), "not a directory");
  const result = await r.run(id, owner, "write");
  assert.equal(changes, 0); assert.equal(result.code, "EFFECT_PERSISTENCE_FAILED");
});

test("a process crash after a side effect leaves an unresolved receipt; restart never replays it", async t => {
  const state = await dir(t);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/crash-runner.mjs", import.meta.url)), state], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const id = (await readFile(join(state, "session-id"), "utf8")).trim();
  assert.equal(await readFile(join(state, "external-effect"), "utf8"), "applied-once");
  unlockStore(state);
  let repeated = 0;
  const r = new PidaRuntime({ storageDir: state, provider: provider([tool("mutate"), answer("inspected")]), tools: [mutation(async () => { repeated++; return {}; })] });
  t.after(() => r.close());
  assert.equal(r.listSessions(owner)[0].lastStatus, "interrupted");
  const result = await r.run(id, owner, "continue");
  assert.equal(result.code, "EFFECT_STATE_UNKNOWN"); assert.equal(repeated, 0);
  assert.equal(result.recovery.autoRetry, false);
  const pending = r.getRecovery(id, owner).pendingEffects;
  assert.equal(pending.length, 1); assert.ok(!("operationKey" in pending[0]));
  await assert.rejects(r.compactSession(id, owner, true), /EFFECT_STATE_UNKNOWN/);
  assert.throws(() => r.reconcileEffect(id, { ...owner, permissions: [] }, pending[0].id, "applied"), /FORBIDDEN/);
  r.reconcileEffect(id, owner, pending[0].id, "applied");
  assert.equal(r.getRecovery(id, owner).pendingEffects.length, 0);
  assert.equal((await r.run(id, owner, "report only")).status, "completed");
  const bundles = r.listRuns(id, owner).map(runId => r.exportRun(id, runId, owner));
  assert.ok(bundles.some(b => b.manifest?.reported_status === "interrupted" && !b.complete));
});

test("observation IDs survive export/restart; bounded UI traces do not truncate the journal", async t => {
  const state = await dir(t);
  const { r, id } = await runtime(t, [answer("SECRET_ANSWER")], { storageDir: state, maxTraceEvents: 1, observationSink: { async write() { throw new Error("SECRET_SINK_ERROR"); } } });
  const result = await r.run(id, owner, "SECRET_PROMPT", undefined, undefined, { taskId: "task-independent" });
  await new Promise(resolve => setImmediate(resolve));
  const bundle = r.exportRun(id, result.runId, owner);
  assert.equal(result.status, "completed"); assert.equal(bundle.complete, true);
  assert.ok(bundle.known_limits.includes("EXTERNAL_SINK_DELIVERY_FAILED"));
  assert.ok(bundle.events.length > r.getTrace(id, owner).length);
  assert.ok(bundle.events.every(e => e.task_id === "task-independent" && e.task_id !== e.run_id));
  assert.ok(!JSON.stringify(bundle).includes("SECRET_"));
  assert.equal(bundle.manifest.verification_status, "UNKNOWN");
  await r.close();
  const resumed = new PidaRuntime({ storageDir: state, provider: () => { throw new Error("provider must not initialize for export"); } });
  t.after(() => resumed.close());
  assert.deepEqual(resumed.exportRun(id, result.runId, owner).events, bundle.events);
  assert.throws(() => resumed.exportRun(id, result.runId, { ...owner, id: "other" }), /SESSION_NOT_FOUND/);
});

test("observation outage and retention limits are explicit without cancelling execution", async t => {
  for (const mode of ["disk", "limit"]) await t.test(mode, async t => {
    const state = await dir(t);
    const { r, id } = await runtime(t, [answer("done")], { storageDir: state, maxObservationEvents: mode === "limit" ? 1 : 4000 });
    if (mode === "disk") { rmSync(join(state, "observations"), { recursive: true }); writeFileSync(join(state, "observations"), "unavailable"); }
    const result = await r.run(id, owner, "hello");
    assert.equal(result.status, "completed");
    const bundle = r.exportRun(id, result.runId, owner);
    assert.equal(bundle.complete, false); assert.ok(bundle.known_limits.includes("OBSERVATION_INCOMPLETE"));
  });
});

test("verification binds the actual test and artifact snapshot; later edits make it stale", async t => {
  const bench = new PidaWorkbench(await dir(t));
  await bench.write(owner, "test.js", 'assert(pida.readText("value.txt") === "before");');
  await bench.write(owner, "value.txt", "before");
  const { r, id } = await runtime(t, [tool("workspace_test", { path: "test.js" }), tool("workspace_write", { path: "value.txt", content: "after" }), answer("verified everything")], { tools: bench.tools() });
  const result = await r.run(id, owner, "test then change");
  assert.equal(result.status, "completed");
  const manifest = r.exportRun(id, result.runId, owner).manifest;
  assert.equal(manifest.verification_status, "UNKNOWN");
  const verification = manifest.verification_results[0];
  assert.equal(verification.status, "PASSED"); assert.equal(verification.current_at_run_end, false);
  assert.match(verification.definition_digest, /^[a-f0-9]{64}$/);
  assert.equal(verification.independence, "agent-supplied-check");
  assert.ok(manifest.artifact_refs.some(a => a.path === "value.txt"));
  assert.ok(manifest.evidence_refs.includes(verification.id));
});

test("token budgets stop before effects; unverifiable cost budgets are rejected", async t => {
  let executed = false;
  const { r, id } = await runtime(t, [tool("mutate")], { maxTotalTokens: 1, tools: [mutation(async () => { executed = true; return {}; })] });
  assert.equal((await r.run(id, owner, "work")).code, "TOKEN_BUDGET"); assert.equal(executed, false);
  assert.throws(() => new PidaRuntime({ provider: provider([]), maxCostUsd: 1 }), /COST_BUDGET_UNAVAILABLE/);
});

test("owned HTTP/SDK exports include JSONL and manifest without initializing a provider", async t => {
  const { r, id } = await runtime(t, [answer("done")]);
  const token = "a".repeat(32), other = "b".repeat(32);
  const server = createPidaServer({ runtime: r, authenticate: staticTokenAuth([{ token, principal: owner }, { token: other, principal: { ...owner, id: "other" } }]) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new PidaClient({ baseUrl, token: () => token });
  const result = await client.run(id, "hello", { taskId: "external-task" });
  const bundle = await client.exportRun(id, result.runId), jsonl = await client.exportRunJsonl(id, result.runId);
  assert.equal(jsonl.complete, true); assert.deepEqual(jsonl.jsonl.trim().split("\n").map(JSON.parse), bundle.events);
  assert.equal((await client.getManifest(id, result.runId)).task_id, "external-task");
  assert.ok((await client.listRuns(id)).runs.includes(result.runId));
  await assert.rejects(new PidaClient({ baseUrl, token: () => other }).exportRun(id, result.runId), /SESSION_NOT_FOUND/);
});

test("UI patch errors identify missing/ambiguous matches without modifying the document", async t => {
  const bench = new PidaWorkbench(await dir(t));
  const initial = await bench.uiTemplate(owner, "sidebar", "");
  const invoke = args => bench.tools().find(t => t.name === "ui_patch").execute(args, { principal: owner, sessionId: "test", runId: "test", signal: new AbortController().signal });
  const result = await invoke({ expectedRevision: initial.revision, edits: [{ oldText: "not-in-document", newText: "x" }] });
  assert.deepEqual(result.details, { editIndex: 0, matchCount: 0, revision: initial.revision });
  assert.equal((await bench.uiState(owner)).revision, initial.revision);
});
