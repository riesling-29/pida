import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectTools } from "../dist/project-tools.js";
import { PidaRuntime } from "../dist/runtime.js";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
const permissions = ["project:read", "project:write", "project:execute"];
async function fixture(t, trustedHost = false, seconds = 3) {
  const parent = await mkdtemp(join(tmpdir(), "pida-project-")), root = join(parent, "repo"), privateRoot = join(root, "my-agent");
  await mkdir(privateRoot, { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  const { tools } = createProjectTools({ enabled: true, root, trustedHost, timeoutSeconds: seconds }, { protectedPaths: [privateRoot] });
  const invoke = (name, args, signal = new AbortController().signal, granted = permissions) => tools.find(tool => tool.name === name).execute(args, { principal: { id: "alice", permissions: granted }, sessionId: "session", runId: "run", signal });
  return { root, parent, privateRoot, tools, invoke };
}
function nodeCommand(file) {
  return process.platform === "win32" ? `& '${process.execPath.replaceAll("'", "''")}' '${file}'` : `'${process.execPath.replaceAll("'", "'\\''")}' '${file}'`;
}
test("project tools reuse Pi editing and keep workbench/private paths outside file access", async t => {
  const f = await fixture(t);
  assert.ok(!f.tools.some(tool => tool.name === "project_shell"));
  assert.equal((await f.invoke("project_write", { path: "src/add.js", content: "export const add = (a,b) => a-b;\n" })).ok, true);
  assert.equal((await f.invoke("project_edit", { path: "src/add.js", edits: [{ oldText: "a-b", newText: "a+b" }] })).ok, true);
  assert.match((await f.invoke("project_read", { path: "src/add.js" })).output, /a\+b/);
  assert.match((await f.invoke("project_find", { pattern: "**/*.js" })).output, /src\/add.js/);
  assert.match((await f.invoke("project_find", { pattern: "*.js" })).output, /src\/add.js/);
  assert.match((await f.invoke("project_find", { pattern: "src/*.js" })).output, /src\/add.js/);
  assert.doesNotMatch((await f.invoke("project_find", { pattern: "tests/*.js" })).output, /add.js/);
  await writeFile(join(f.root, ".env"), "TOKEN=private");
  await writeFile(join(f.privateRoot, "config.json"), "private");
  for (const path of ["../escape", ".env", ".env.local", ".git/config", "my-agent/config.json"]) {
    assert.equal((await f.invoke("project_read", { path })).error, "PROJECT_PATH_DENIED", path);
    assert.equal((await f.invoke("project_write", { path, content: "denied" })).error, "PROJECT_PATH_DENIED", path);
  }
  const listing = (await f.invoke("project_ls", {})).output;
  assert.doesNotMatch(listing, /my-agent|\.env/);
  await assert.rejects(f.invoke("project_write", { path: "denied.js", content: "x" }, undefined, ["project:read"]), /FORBIDDEN/);
  assert.equal((await readFile(join(f.root, "src/add.js"), "utf8")), "export const add = (a,b) => a+b;\n");
});
test("file boundaries reject symlinks, hardlinks and binary input", async t => {
  const f = await fixture(t);
  await writeFile(join(f.parent, "outside.txt"), "outside");
  await symlink(join(f.parent, "outside.txt"), join(f.root, "linked.txt"));
  await link(join(f.parent, "outside.txt"), join(f.root, "hard.txt"));
  for (const path of ["linked.txt", "hard.txt"]) {
    assert.equal((await f.invoke("project_read", { path })).error, "PROJECT_PATH_DENIED");
    assert.equal((await f.invoke("project_write", { path, content: "bad" })).error, "PROJECT_PATH_DENIED");
  }
  await writeFile(join(f.root, "data.bin"), Buffer.from([0, 1, 2]));
  assert.equal((await f.invoke("project_read", { path: "data.bin" })).error, "PROJECT_BINARY_UNSUPPORTED");
  assert.equal(await readFile(join(f.parent, "outside.txt"), "utf8"), "outside");
});
test("real project shell runs tests, reports nonzero exit and strips provider environment", async t => {
  const f = await fixture(t, true);
  const old = process.env.PIDA_PROJECT_TEST_SECRET;
  process.env.PIDA_PROJECT_TEST_SECRET = "must-not-be-inherited";
  t.after(() => { if (old === undefined) delete process.env.PIDA_PROJECT_TEST_SECRET; else process.env.PIDA_PROJECT_TEST_SECRET = old; });
  await writeFile(join(f.root, "check.mjs"), "import assert from 'node:assert/strict'; assert.equal(process.env.PIDA_PROJECT_TEST_SECRET,undefined); console.log('PASS actual node test');");
  const ok = await f.invoke("project_shell", { command: nodeCommand("check.mjs") });
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.exitCode, 0); assert.match(ok.output, /PASS actual/);
  await writeFile(join(f.root, "fail.mjs"), "import {writeFileSync} from 'node:fs';writeFileSync('changed.txt','changed');process.exit(7);");
  const failure = await f.invoke("project_shell", { command: nodeCommand("fail.mjs") });
  assert.equal(failure.ok, false); assert.equal(failure.exitCode, 7); assert.equal(failure.effectState, "applied");
  assert.equal(await readFile(join(f.root, "changed.txt"), "utf8"), "changed");
  await assert.rejects(f.invoke("project_shell", { command: nodeCommand("check.mjs") }, undefined, ["project:read"]), /FORBIDDEN/);
});
test("foreground shell timeout/cancellation are uncertain effects and output is bounded", async t => {
  const f = await fixture(t, true, 1);
  await writeFile(join(f.root, "hang.mjs"), "import {writeFileSync} from 'node:fs';writeFileSync('started.txt','yes');setTimeout(()=>writeFileSync('late.txt','bad'),2000);");
  const timeout = await f.invoke("project_shell", { command: nodeCommand("hang.mjs") });
  assert.equal(timeout.error, "PROJECT_TIMEOUT", JSON.stringify(timeout)); assert.equal(timeout.effectState, "unknown");
  const cancel = new AbortController();
  const running = f.invoke("project_shell", { command: nodeCommand("hang.mjs") }, cancel.signal);
  setTimeout(() => cancel.abort(), 100);
  const stopped = await running; assert.equal(stopped.error, "PROJECT_CANCELLED"); assert.equal(stopped.effectState, "unknown");
  await writeFile(join(f.root, "output.mjs"), "console.log('x'.repeat(100000));");
  const output = await f.invoke("project_shell", { command: nodeCommand("output.mjs") });
  assert.equal(output.ok, true); assert.equal(output.truncated, true); assert.ok(JSON.stringify(output).length <= 26000);
  assert.equal((await f.invoke("project_shell", { command: "ignored", timeout: 20 })).error, "PROJECT_ARGUMENT_INVALID");
});
test("grep uses installed ripgrep without exposing protected project content", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "ordinary.txt"), "public needle\n");
  await writeFile(join(f.root, ".env"), "private needle");
  await writeFile(join(f.privateRoot, "credential.txt"), "private needle");
  await mkdir(join(f.root, "src"));
  await mkdir(join(f.root, "other"));
  await writeFile(join(f.root, "src/add.ts"), "nested needle\n");
  await writeFile(join(f.root, "other/skip.ts"), "other needle\n");
  const r = await f.invoke("project_grep", { pattern: "needle", literal: true });
  if (r.error === "PROJECT_RG_UNAVAILABLE") { t.diagnostic("ripgrep unavailable: explicit dependency error confirmed"); return; }
  assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.output, /ordinary.txt:1:public needle/); assert.doesNotMatch(r.output, /private/);
  const basename = await f.invoke("project_grep", { pattern: "needle", glob: "*.ts", literal: true });
  assert.match(basename.output, /src[\\/]add.ts:1:nested needle/); assert.match(basename.output, /other[\\/]skip.ts:1:other needle/);
  assert.doesNotMatch(basename.output, /ordinary.txt/);
  const qualified = await f.invoke("project_grep", { pattern: "needle", glob: "src/*.ts", literal: true });
  assert.match(qualified.output, /src[\\/]add.ts:1:nested needle/); assert.doesNotMatch(qualified.output, /skip.ts|ordinary.txt/);
});
test("Pi loop can rerun the same failed test after an actual source edit, but not after a no-op write", async t => {
  const f = await fixture(t, true);
  await writeFile(join(f.root, "sum.mjs"), "export const sum = (a,b) => a-b;\n");
  await writeFile(join(f.root, "sum.test.mjs"), "import assert from 'node:assert/strict';import {sum} from './sum.mjs';assert.equal(sum(2,3),5);console.log('PASS sum');");
  const command = nodeCommand("sum.test.mjs");
  const call = (name, args) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
  const provider = responses => () => { const f = fauxProvider(); f.setResponses(responses); return { provider: f.provider, modelId: f.getModel().id }; };
  const principal = { id: "coder", permissions };
  const runtime = new PidaRuntime({ tools: f.tools, provider: provider([
    call("project_shell", { command }),
    call("project_edit", { path: "sum.mjs", edits: [{ oldText: "a-b", newText: "a+b" }] }),
    call("project_shell", { command }),
    fauxAssistantMessage("Fixed and tested."),
  ]) });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "Fix failing test and rerun it.");
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(runtime.getTrace(sessionId, principal).filter(e => e.toolName === "project_shell" && e.type === "tool_completed").length, 1);
  assert.match(await readFile(join(f.root, "sum.mjs"), "utf8"), /a\+b/);
  const repeated = new PidaRuntime({ tools: f.tools, provider: provider([
    call("project_shell", { command }),
    call("project_write", { path: "sum.mjs", content: "export const sum = (a,b) => a+b;\n" }),
    call("project_shell", { command }),
    fauxAssistantMessage("Repeated."),
  ]) });
  t.after(() => repeated.close());
  const run = await repeated.run((await repeated.createSession(principal)).sessionId, principal, "Do not replay unchanged commands.");
  assert.equal(run.status, "failed"); assert.equal(run.code, "TOOL_REPLAY_BLOCKED");
});
