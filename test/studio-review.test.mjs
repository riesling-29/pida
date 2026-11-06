import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { PidaWorkbench, PidaRuntime, workbenchPermissions } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { PidaClient } from "../dist/client.js";
const owner = { id: "owner", permissions: workbenchPermissions };
async function bench(t) { const dir = await mkdtemp(join(tmpdir(), "pida-review-")); t.after(() => rm(dir, { recursive: true, force: true })); return new PidaWorkbench(dir); }

test("review captures exact changed files; stale restore preserves newer work and valid restore is reversible", async t => {
  const b = await bench(t);
  await b.write(owner, "space file.js", "const original = 1;\n\n");
  const before = await b.captureCheckpoint(owner);
  await b.write(owner, "space file.js", "const original = 2;\n");
  await b.write(owner, "created.txt", "new\n");
  const after = await b.captureCheckpoint(owner), diff = await b.changes(owner, before.checkpoint, after.checkpoint);
  assert.deepEqual(diff.files, ["created.txt", "space file.js"]);
  assert.match(diff.diff, /\+const original = 2/); assert.equal(diff.truncated, false);
  await b.write(owner, "newer.txt", "do not lose me");
  await assert.rejects(b.restoreCheckpoint(owner, before.checkpoint, after.revision), /WORKSPACE_REVISION_CONFLICT/);
  assert.equal((await b.read(owner, "newer.txt")).content, "do not lose me");
  const current = await b.captureCheckpoint(owner);
  const restored = await b.restoreCheckpoint(owner, before.checkpoint, current.revision);
  assert.equal((await b.read(owner, "space file.js")).content, "const original = 1;\n\n");
  await assert.rejects(b.read(owner, "created.txt"), /FILE_NOT_FOUND/);
  assert.equal(restored.revision, before.revision);
  await b.restoreCheckpoint(owner, restored.before, restored.revision);
  assert.equal((await b.read(owner, "newer.txt")).content, "do not lose me");
});

test("review and restore enforce permissions and principal history boundaries", async t => {
  const b = await bench(t); await b.write(owner, "private.txt", "private");
  const c = await b.captureCheckpoint(owner), read = { ...owner, permissions: ["workbench:read"] };
  assert.equal((await b.status(read)).canCheckpoint, false);
  await assert.rejects(b.captureCheckpoint(read), /FORBIDDEN/);
  await assert.rejects(b.changes(read, c.checkpoint, c.checkpoint), /FORBIDDEN/);
  await assert.rejects(b.restoreCheckpoint(read, c.checkpoint, c.revision), /FORBIDDEN/);
  await assert.rejects(b.changes({ ...owner, id: "other" }, c.checkpoint, c.checkpoint));
  await assert.rejects(b.changes(owner, "HEAD; arbitrary", c.checkpoint), /INVALID_CHECKPOINT/);
});

test("HTTP/client restore requires authentication and blocks active execution and uncertain effects", async t => {
  const b = await bench(t); await b.write(owner, "file.txt", "original");
  const f = fauxProvider(); let release;
  f.setResponses([async () => { await new Promise(resolve => { release = resolve; }); return answer("done"); }]);
  const runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: [{
    name: "uncertain", permission: "workbench:write", description: "write then lose the result", parameters: Type.Object({}),
    async execute() { await b.write(owner, "uncertain.txt", "partially applied"); throw new Error("connection lost after mutation"); },
  }] }); t.after(() => runtime.close());
  const token = "t".repeat(32), readToken = "r".repeat(32);
  const server = createPidaServer({ runtime, workbench: b, authenticate: staticTokenAuth([{ token, principal: owner }, { token: readToken, principal: { ...owner, permissions: ["workbench:read"] } }]) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`, c = new PidaClient({ baseUrl, token: () => token });
  assert.equal((await fetch(baseUrl + "/v1/workbench/changes")).status, 401);
  const before = await c.captureCheckpoint(); await c.writeWorkspaceFile("file.txt", "changed"); const after = await c.captureCheckpoint();
  assert.deepEqual((await c.getChanges(before.checkpoint, after.checkpoint)).files, ["file.txt"]);
  await assert.rejects(new PidaClient({ baseUrl, token: () => readToken }).restoreCheckpoint(before.checkpoint, after.revision), /FORBIDDEN/);
  const { sessionId } = await runtime.createSession(owner), running = runtime.run(sessionId, owner, "wait");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  try { await assert.rejects(c.restoreCheckpoint(before.checkpoint, after.revision), /SESSION_BUSY/); }
  finally { release(); await running; }
  await c.restoreCheckpoint(before.checkpoint, after.revision);
  assert.equal((await c.readWorkspaceFile("file.txt")).content, "original");
  f.setResponses([answer(call("uncertain", {}), { stopReason: "toolUse" }), answer("cannot confirm")]);
  await runtime.run(sessionId, owner, "make a change");
  assert.equal(runtime.getRecovery(sessionId, owner).pendingEffects.length, 1);
  const current = await c.captureCheckpoint();
  await assert.rejects(c.restoreCheckpoint(before.checkpoint, current.revision), /EFFECT_STATE_UNKNOWN/);
  assert.equal((await c.readWorkspaceFile("uncertain.txt")).content, "partially applied");
});

test("large reviews are explicitly truncated while preserving the changed-file list", async t => {
  const b = await bench(t), before = await b.captureCheckpoint(owner);
  await b.write(owner, "large.txt", "a".repeat(100000));
  const first = await b.captureCheckpoint(owner);
  await b.write(owner, "large.txt", "b".repeat(100000));
  const after = await b.captureCheckpoint(owner), result = await b.changes(owner, first.checkpoint, after.checkpoint);
  assert.equal(result.truncated, true); assert.equal(result.diff.length, 131072); assert.deepEqual(result.files, ["large.txt"]);
  assert.ok((await b.changes(owner, before.checkpoint, after.checkpoint)).diff.includes("new file mode"));
});
