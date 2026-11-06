import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions, workbenchPrompt, mockProvider } from "../dist/index.js";
import { executeJavaScript } from "../dist/workbench.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { PidaClient } from "../dist/client.js";
const owner = { id: "alice", permissions: workbenchPermissions }, other = { id: "bob", permissions: workbenchPermissions };
const toolResponse = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
function provider(responses) { return () => { const f = fauxProvider(); f.setResponses(responses); return { provider: f.provider, modelId: f.getModel().id }; }; }
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pida-workbench-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workbench = new PidaWorkbench(dir);
  const invoke = (name, args = {}, principal = owner, signal = new AbortController().signal) => workbench.tools().find(t => t.name === name).execute(args, { principal, signal, sessionId: "test", runId: "test" });
  return { dir, workbench, invoke };
}
const buggy = 'globalThis.total = values => values.reduce((a,b) => a-b, 0);';
const testCode = 'eval(pida.readText("total.js")); assert(total([10,20,30]) === 60, "total must be 60"); console.log("3 inputs, total 60");';
const render = 'eval(pida.readText("total.js")); const values = pida.input?.values ?? [10,20,30]; pida.writeText("artifacts/dashboard.html", `<html><body><h1>Sales dashboard</h1><p>Total: ${total(values)}</p></body></html>\\n`); console.log("dashboard created");';
function lastTool(context) { return JSON.parse(context.messages.filter(m => m.role === "toolResult").at(-1).content.filter(c => c.type === "text").map(c => c.text).join("")); }
test("actual Pi loop writes, fails a test, repairs with Pi edit, retests, builds HTML and saves a Pi skill; restart reuses it", async t => {
  const { dir, workbench } = await fixture(t);
  let observedFailure = false, observedPass = false;
  const runtime = new PidaRuntime({
    tools: workbench.tools(), systemPrompt: workbenchPrompt, maxTurns: 20, maxToolCalls: 24,
    provider: provider([
      toolResponse("workspace_write", { path: "total.js", content: buggy }),
      toolResponse("workspace_write", { path: "total.test.js", content: testCode }),
      toolResponse("workspace_test", { path: "total.test.js" }),
      context => { const r = lastTool(context); assert.equal(r.ok, false); assert.match(r.error, /total must be 60/); observedFailure = true; return toolResponse("workspace_edit", { path: "total.js", edits: [{ oldText: "a-b", newText: "a+b" }] }); },
      toolResponse("workspace_test", { path: "total.test.js" }),
      context => { const r = lastTool(context); assert.equal(r.ok, true); assert.equal(r.assertions, 1); observedPass = true; return toolResponse("workspace_write", { path: "render.js", content: render }); },
      toolResponse("workspace_run", { path: "render.js" }),
      toolResponse("skill_save", { name: "sales-dashboard", description: "Build a sales dashboard", instructions: "Supply values as input.values. Verified by total.test.js.", scriptPath: "render.js", testPath: "total.test.js" }),
      context => { assert.equal(lastTool(context).ok, true); return answer("Built, tested and saved."); },
    ]),
  });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  assert.equal((await runtime.run(sessionId, owner, "Build and verify a dashboard; save the procedure.")).status, "completed");
  assert.ok(observedFailure && observedPass);
  assert.match((await workbench.read(owner, "artifacts/dashboard.html")).content, /Total: 60/);
  assert.deepEqual((await workbench.status(owner)).skills.map(s => s.name), ["sales-dashboard"]);
  assert.equal(runtime.getTrace(sessionId, owner).filter(e => e.type === "tool_completed").length, 7);
  assert.deepEqual(runtime.getTrace(sessionId, owner).filter(e => e.type === "tool_failed").map(e => [e.toolName, e.code]), [["workspace_test", "TEST_FAILED"]]);
  await runtime.close();
  const resumed = new PidaWorkbench(dir);
  await resumed.write(owner, "total.js", "throw new Error('current file is broken')");
  const second = new PidaRuntime({ tools: resumed.tools(), provider: provider([
    toolResponse("skill_list", {}),
    context => { assert.equal(lastTool(context).skills[0].name, "sales-dashboard"); return toolResponse("skill_run", { name: "sales-dashboard", input: { values: [7, 8] } }); },
    context => { assert.equal(lastTool(context).ok, true); return answer("Reused saved skill."); },
  ]) });
  t.after(() => second.close());
  assert.equal((await second.run((await second.createSession(owner)).sessionId, owner, "Reuse the dashboard with new values.")).status, "completed");
  assert.match((await resumed.read(owner, "artifacts/dashboard.html")).content, /Total: 15/);
});
test("QuickJS bridge excludes host APIs, discards failed writes and enforces resource/cancellation limits", async () => {
  const r = await executeJavaScript('assert(typeof process === "undefined"); assert(typeof require === "undefined"); assert(typeof fetch === "undefined"); assert(typeof WebSocket === "undefined"); console.log(pida.readText("data.txt"));', { "data.txt": "public" });
  assert.equal(r.ok, true); assert.equal(r.assertions, 4); assert.equal(r.output, "public");
  const failed = await executeJavaScript('pida.writeText("output.txt", "staged"); assert(false, "stop");', {});
  assert.equal(failed.ok, false); assert.deepEqual(failed.writes, {});
  for (const source of ['pida.readText("../secret")', 'pida.writeText(".env", "x")', 'pida.writeText("out.txt", "x".repeat(140000))', 'console.log("x".repeat(13000))', 'Promise.resolve(1)']) {
    assert.equal((await executeJavaScript(source, {})).ok, false, source);
  }
  assert.equal((await executeJavaScript('while(true) {}', {}, { timeoutMs: 30 })).ok, false);
  const memory = await executeJavaScript('const x=[]; while(true) x.push(new Array(100000).fill(1));', {}, { timeoutMs: 500 });
  assert.equal(memory.ok, false);
  const abort = new AbortController();
  const run = executeJavaScript('while(true) {}', {}, { signal: abort.signal, timeoutMs: 5000 });
  setTimeout(() => abort.abort(), 30);
  assert.equal((await run).error, "CANCELLED");
});
test("workspace permissions, principal isolation, traversal, links and total quotas are independently enforced", async t => {
  const { workbench, invoke, dir } = await fixture(t);
  await workbench.write(owner, "data.txt", "alice");
  assert.deepEqual((await workbench.status(other)).files, []);
  await assert.rejects(workbench.read(other, "data.txt"), /FILE_NOT_FOUND/);
  const noPermission = { id: owner.id, permissions: [] };
  await assert.rejects(workbench.write(noPermission, "a", "x"), /FORBIDDEN/);
  await assert.rejects(invoke("workspace_run", { path: "data.txt" }, { id: owner.id, permissions: ["workbench:execute"] }), /FORBIDDEN/);
  for (const path of ["../secret", "/etc/passwd", "x/../../a", ".env", "a/.git/config", "x\\y", "a\u0000b"])
    assert.equal((await invoke("workspace_read", { path })).ok, false, path);
  const root = join(dir, createHash("sha256").update(owner.id).digest("hex"), "files");
  await writeFile(join(dir, "outside"), "secret");
  await symlink(join(dir, "outside"), join(root, "alias"));
  assert.equal((await invoke("workspace_read", { path: "alias" })).ok, false);
  await rm(join(root, "alias"));
  await link(join(dir, "outside"), join(root, "linked"));
  assert.equal((await invoke("workspace_read", { path: "linked" })).ok, false);
  await rm(join(root, "linked"));
  await assert.rejects(workbench.write(owner, "large.txt", "x".repeat(131073)), /FILE_TOO_LARGE/);
  assert.equal(await readFile(join(dir, "outside"), "utf8"), "secret");
});
test("Git restore preserves exact contents and removes later files; failed or empty tests cannot save skills", async t => {
  const { workbench, invoke } = await fixture(t);
  const content = "alpha\n\n  \n";
  const { checkpoint } = await workbench.write(owner, "a.txt", content);
  await workbench.write(owner, "later.txt", "later");
  await workbench.write(owner, "a.txt", "changed");
  assert.equal((await invoke("workspace_restore", { checkpoint })).ok, true);
  assert.equal((await workbench.read(owner, "a.txt")).content, content);
  await assert.rejects(workbench.read(owner, "later.txt"), /FILE_NOT_FOUND/);
  for (const code of ['console.log("no test")', 'assert(false, "failed")', 'pida.writeText("oops", "x"); assert(true)']) {
    await workbench.write(owner, "test.js", code);
    const r = await invoke("skill_save", { name: "bad", description: "bad", instructions: "", scriptPath: "test.js", testPath: "test.js" });
    assert.equal(r.ok, false);
    assert.equal((await workbench.status(owner)).skills.length, 0);
  }
});
test("HTTP/SDK expose authenticated per-user files and status; generated HTML is returned as JSON only", async t => {
  const { workbench } = await fixture(t);
  const runtime = new PidaRuntime({ provider: mockProvider }); t.after(() => runtime.close());
  const token = "a".repeat(32), otherToken = "b".repeat(32), restrictedToken = "c".repeat(32);
  const server = createPidaServer({ runtime, workbench, serveDemo: true, authenticate: staticTokenAuth([{ token, principal: owner }, { token: otherToken, principal: other }, { token: restrictedToken, principal: { id: "alice", permissions: [] } }]) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise(ok => server.close(ok)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new PidaClient({ baseUrl, token: () => token });
  assert.equal((await fetch(baseUrl + "/v1/workbench")).status, 401);
  await client.writeWorkspaceFile("artifacts/page.html", "<script>parent.stolen=true</script><h1>Result</h1>");
  assert.equal((await client.getWorkbench()).files.length, 1);
  assert.match((await client.readWorkspaceFile("artifacts/page.html")).content, /parent.stolen/);
  assert.deepEqual((await new PidaClient({ baseUrl, token: () => otherToken }).getWorkbench()).files, []);
  await assert.rejects(new PidaClient({ baseUrl, token: () => restrictedToken }).readWorkspaceFile("artifacts/page.html"), /FORBIDDEN/);
  const response = await fetch(baseUrl + "/v1/workbench/file?path=artifacts/page.html", { headers: { Authorization: `Bearer ${token}` } });
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await fetch(baseUrl + "/artifacts/page.html")).status, 401);
  const ui = await (await fetch(baseUrl)).text();
  assert.match(ui, /sandbox=""/);
});
