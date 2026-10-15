import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PidaRuntime, mockProvider, lotStatusTool } from "../dist/index.js";
import { unlockStore } from "../dist/storage.js";
const alice = { id: "alice", permissions: ["lots:read"] },
  bob = { id: "bob", permissions: ["lots:read"] };
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pida-storage-"));
  const runtimes = [];
  const open = () => {
    const r = new PidaRuntime({
      provider: mockProvider,
      tools: [lotStatusTool],
      storageDir: dir,
      ...options,
    });
    runtimes.push(r);
    return r;
  };
  t.after(async () => {
    for (const r of runtimes) await r.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, open };
}
test("Pi session files reopen with history, ownership, trace sequence and run budget preserved", async (t) => {
  const { dir, open } = await fixture(t, { maxRunsPerSession: 2 });
  let r = open();
  const { sessionId: id } = await r.createSession(alice);
  await r.run(id, alice, "LOT-001");
  const before = r.getSession(id, alice).messages,
    sequence = r.getTrace(id, alice).at(-1).sequence;
  assert.equal((await readdir(join(dir, "sessions"))).length, 1);
  await r.close();
  r = open();
  assert.equal(r.listSessions(alice)[0].sessionId, id);
  assert.equal(r.listSessions(alice)[0].lastStatus, "completed");
  assert.deepEqual(r.listSessions(bob), []);
  await assert.rejects(r.resumeSession(id, bob), /SESSION_NOT_FOUND/);
  await r.resumeSession(id, alice);
  assert.deepEqual(r.getSession(id, alice).messages, before);
  assert.equal((await r.run(id, alice, "LOT-002")).status, "completed");
  assert.equal(
    r.getSession(id, alice).messages.filter((m) => m.role === "user").length,
    2,
  );
  assert.ok(r.getTrace(id, alice).at(-1).sequence > sequence);
  await r.close();
  r = open();
  await assert.rejects(r.run(id, alice, "third"), /SESSION_RUN_LIMIT/);
  await r.deleteSession(id, alice);
  await r.close();
  r = open();
  assert.deepEqual(r.listSessions(alice), []);
  assert.deepEqual(await readdir(join(dir, "sessions")), []);
});
test("empty sessions survive restart; limits include saved sessions; resume is deduplicated", async (t) => {
  const { open } = await fixture(t, { maxSessions: 1 });
  let r = open();
  const { sessionId: id } = await r.createSession(alice);
  await r.close();
  r = open();
  await assert.rejects(r.createSession(alice), /SESSION_LIMIT/);
  const resumed = await Promise.all([
    r.resumeSession(id, alice),
    r.resumeSession(id, alice),
  ]);
  assert.ok(resumed.every((x) => x.sessionId === id));
  assert.equal((await r.run(id, alice, "LOT-001")).status, "completed");
});
test("disk lock rejects a second runtime and live unlock; closing releases it", async (t) => {
  const { dir, open } = await fixture(t);
  const r = open();
  assert.throws(open, /locked/);
  assert.throws(() => unlockStore(dir), /still running/);
  await r.close();
  const next = open();
  await next.close();
});
test("restored sessions use current permissions and registered tools, not saved grants", async (t) => {
  const { dir, open } = await fixture(t);
  const r = open();
  const { sessionId: id } = await r.createSession(alice);
  await r.run(id, alice, "LOT-001");
  await r.close();
  const restored = new PidaRuntime({
    provider: mockProvider,
    storageDir: dir,
    tools: [],
  });
  t.after(() => restored.close());
  await restored.resumeSession(id, alice);
  assert.deepEqual(restored.getSession(id, alice).tools, []);
  assert.equal((await restored.run(id, alice, "LOT-002")).status, "failed");
});
test("unloaded sessions can be deleted without initializing a provider; corrupt metadata fails closed", async (t) => {
  const { dir, open } = await fixture(t);
  let r = open();
  const { sessionId: id } = await r.createSession(alice);
  await r.close();
  r = new PidaRuntime({
    provider: () => {
      throw new Error("must not initialize");
    },
    storageDir: dir,
  });
  await assert.rejects(r.deleteSession(id, bob), /SESSION_NOT_FOUND/);
  await r.deleteSession(id, alice);
  await r.close();
  await writeFile(join(dir, "index", "bad.json"), '{"version":42}');
  assert.throws(open, /Invalid saved session/);
  assert.ok(!(await readdir(dir)).includes("runtime.lock"));
});
test("abrupt process termination records interrupted execution and never retries a tool on restore", async (t) => {
  const { dir, open } = await fixture(t);
  const marker = join(dir, "executions.txt");
  const code = `
    import { PidaRuntime, mockProvider, lotStatusTool } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
    import { appendFileSync } from 'node:fs';
    const r = new PidaRuntime({ provider: mockProvider, storageDir: ${JSON.stringify(dir)}, tools: [{ ...lotStatusTool, execute: async () => {
      appendFileSync(${JSON.stringify(marker)}, 'executed\\n'); console.log('TOOL'); await new Promise(() => {});
    }}] });
    const p = ${JSON.stringify(alice)}; const { sessionId } = await r.createSession(p); console.log(sessionId); void r.run(sessionId, p, 'LOT-001');
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGKILL"));
  let output = "",
    stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  await new Promise((ok, fail) => {
    child.stdout.on("data", (c) => {
      output += c;
      if (output.includes("TOOL")) ok();
    });
    child.on("error", fail);
    child.on("exit", () => fail(new Error(stderr || "child exited early")));
  });
  const id = output.split("\n")[0];
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  unlockStore(dir);
  const r = open();
  assert.equal(r.listSessions(alice)[0].lastStatus, "interrupted");
  await r.resumeSession(id, alice);
  assert.equal(await readFile(marker, "utf8"), "executed\n");
  assert.equal(r.getSession(id, alice).runs, 1);
  assert.equal((await r.run(id, alice, "LOT-002")).status, "completed");
  assert.equal(await readFile(marker, "utf8"), "executed\n");
});
