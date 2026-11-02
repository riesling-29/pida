import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CommandManager } from "../dist/commands.js";
import { createProjectTools } from "../dist/project-tools.js";
import { PidaRuntime } from "../dist/runtime.js";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

const principal = { id: "alice", permissions: ["project:read", "project:write", "project:execute", "pida:recover"] };
const session = "session";
const pause = ms => new Promise(r => setTimeout(r, ms));
const quote = value => process.platform === "win32" ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
const nodeCommand = file => (process.platform === "win32" ? "& " : "") + quote(process.execPath) + " " + quote(file);
const start = (manager, command, rest = {}) => manager.start(principal, { sessionId: session, runId: "run", command, ...rest });
async function eventually(fn, max = 3000) { const until = Date.now() + max; while (!await fn()) { if (Date.now() > until) throw new Error("condition timed out"); await pause(20); } }
async function fixture(t, options = {}) {
  const parent = await mkdtemp(join(tmpdir(), "pida-commands-")), root = join(parent, "project"), stateDirectory = join(parent, "state");
  await mkdir(root);
  const manager = new CommandManager({ root, stateDirectory, defaultDeadlineMs: 5000, maxDeadlineMs: 10000, ...options });
  t.after(async () => { await manager.close(); await rm(parent, { recursive: true, force: true }); });
  return { parent, root, stateDirectory, manager };
}
function running(pid) {
  try { process.kill(pid, 0); if (process.platform === "linux") return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); return true; } catch { return false; }
}

test("real long command has separate wait/deadline, non-consuming cursors, and request replay protection", async t => {
  const f = await fixture(t), entry = join(f.root, "long.mjs");
  await writeFile(entry, "import{appendFileSync}from'node:fs';appendFileSync('starts.txt','1');console.log('FIRST');setTimeout(()=>console.log('FINAL 가😀'),700);");
  const before = Date.now(), job = start(f.manager, nodeCommand(entry), { requestId: "request-1" });
  assert.ok(Date.now() - before < 500); assert.equal(job.status, "running");
  const early = await f.manager.wait(principal, session, job.id, 20);
  assert.equal(early.waitExpired, true); assert.equal(early.command.status, "running");
  await eventually(() => f.manager.read(principal, session, job.id).output.text.includes("FIRST"));
  const a = f.manager.read(principal, session, job.id), b = f.manager.read(principal, session, job.id);
  assert.equal(a.output.text, b.output.text); assert.equal(a.output.nextOffset, b.output.nextOffset);
  const controller = new AbortController(), cancelledWait = f.manager.wait(principal, session, job.id, 5000, controller.signal); controller.abort();
  await assert.rejects(cancelledWait, /COMMAND_WAIT_CANCELLED/);
  assert.equal(f.manager.read(principal, session, job.id).command.status, "running");
  assert.equal(start(f.manager, nodeCommand(entry), { requestId: "request-1" }).id, job.id);
  assert.throws(() => start(f.manager, "different", { requestId: "request-1" }), /COMMAND_REQUEST_CONFLICT/);
  const final = await f.manager.wait(principal, session, job.id, 5000);
  assert.equal(final.command.status, "completed"); assert.equal(final.command.exitCode, 0); assert.equal(final.command.directExited, true); assert.equal(final.command.rangeExited, "unknown");
  assert.equal(await readFile(join(f.root, "starts.txt"), "utf8"), "1");
  assert.match(f.manager.read(principal, session, job.id).output.text, /FINAL 가😀/);
  await f.manager.close();
  const restored = new CommandManager({ root: f.root, stateDirectory: f.stateDirectory }); t.after(() => restored.close());
  assert.equal(restored.read(principal, session, job.id).command.status, "completed");
});

test("permission/owner and unsupported PTY/sandbox checks happen before spawning", async t => {
  const f = await fixture(t), entry = join(f.root, "canary.mjs");
  await writeFile(entry, "import{writeFileSync}from'node:fs';writeFileSync('spawned','yes');setTimeout(()=>{},100);");
  const args = { sessionId: session, runId: "run", command: nodeCommand(entry) };
  assert.throws(() => f.manager.start({ id: "alice", permissions: ["project:read"] }, args), /FORBIDDEN/);
  assert.throws(() => start(f.manager, args.command, { pty: true }), /COMMAND_PTY_UNSUPPORTED/);
  assert.throws(() => start(f.manager, args.command, { sandbox: "workspace-write" }), /COMMAND_SANDBOX_UNSUPPORTED/);
  assert.equal(existsSync(join(f.root, "spawned")), false); assert.equal(f.manager.capabilities().pty, false); assert.deepEqual(f.manager.capabilities().sandboxModes, ["none"]);
  const job = start(f.manager, args.command);
  assert.throws(() => f.manager.read({ id: "alice", permissions: ["project:execute"] }, session, job.id), /FORBIDDEN/);
  assert.throws(() => f.manager.read({ ...principal, id: "bob" }, session, job.id), /COMMAND_NOT_FOUND/);
  assert.throws(() => f.manager.read(principal, "other", job.id), /COMMAND_NOT_FOUND/);
  assert.throws(() => f.manager.cancel({ id: "alice", permissions: ["project:read"] }, session, job.id), /FORBIDDEN/);
  await f.manager.wait(principal, session, job.id, 5000);
});

test("managed commands exclude provider credentials and preserve large UTF-8 output for later reads", async t => {
  const f = await fixture(t), entry = join(f.root, "output.mjs"), old = process.env.PIDA_PROVIDER_SECRET;
  process.env.PIDA_PROVIDER_SECRET = "must-not-inherit";
  t.after(() => { if (old === undefined) delete process.env.PIDA_PROVIDER_SECRET; else process.env.PIDA_PROVIDER_SECRET = old; });
  await writeFile(entry, "console.log(process.env.PIDA_PROVIDER_SECRET??'NO_SECRET');process.stdout.write('가😀'.repeat(30000)+'FINAL');");
  const job = start(f.manager, nodeCommand(entry));
  assert.equal((await f.manager.wait(principal, session, job.id, 5000)).command.status, "completed");
  let offset = 0, output = "";
  while (true) { const r = f.manager.read(principal, session, job.id, { offset, maxBytes: 16384 }); assert.equal(r.output.lossy, false); assert.ok(!r.output.text.includes("�")); output += r.output.text; if (r.output.eof) break; assert.ok(r.output.nextOffset > offset); offset = r.output.nextOffset; }
  assert.equal(output, "NO_SECRET\n" + "가😀".repeat(30000) + "FINAL");
});

test("live UTF-8 reads wait for a complete code point and shutdown waits for the actual driver", async t => {
  const f = await fixture(t), entry = join(f.root, "utf8-live.mjs");
  await writeFile(entry, "import{writeFileSync}from'node:fs';writeFileSync('live.pid',String(process.pid));process.stdout.write(Buffer.from([0xf0]));setTimeout(()=>process.stdout.write(Buffer.from([0x9f,0x98,0x80])),200);setInterval(()=>{},1000);");
  const job = start(f.manager, nodeCommand(entry));
  await eventually(() => f.manager.read(principal, session, job.id).command.totalBytes === 1);
  const partial = f.manager.read(principal, session, job.id);
  assert.equal(partial.output.text, ""); assert.equal(partial.output.nextOffset, 0);
  await eventually(() => f.manager.read(principal, session, job.id).command.totalBytes === 4);
  assert.equal(f.manager.read(principal, session, job.id).output.text, "😀");
  const pid = Number(await readFile(join(f.root, "live.pid"), "utf8"));
  await Promise.all([f.manager.close(), f.manager.close()]);
  assert.equal(f.manager.read(principal, session, job.id).command.status, "cancelled"); await eventually(() => !running(pid));
});

test("cancel requests settle only after Pi driver exit and stop ordinary descendants on POSIX", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t), entry = join(f.root, "parent.mjs");
  await writeFile(entry, "import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));console.log('READY');setInterval(()=>{},1000);");
  const job = start(f.manager, nodeCommand(entry));
  await eventually(() => existsSync(join(f.root, "pids.json")));
  const pids = JSON.parse(await readFile(join(f.root, "pids.json"), "utf8"));
  t.after(() => { for (const pid of pids) try { process.kill(pid, "SIGKILL"); } catch {} });
  const requested = f.manager.cancel(principal, session, job.id);
  assert.equal(requested.disposition, "requested"); assert.equal(requested.command.status, "stopping");
  const final = await f.manager.wait(principal, session, job.id, 5000);
  assert.equal(final.command.status, "cancelled"); assert.equal(final.command.directExited, true); assert.equal(final.command.rangeExited, "unknown"); assert.equal(final.command.requiresRecovery, true);
  await eventually(() => pids.every(pid => !running(pid)));
  assert.equal(f.manager.cancel(principal, session, job.id).disposition, "already_finished");
});

test("execution deadline cancels a real command and uncertain state requires host reconciliation", async t => {
  const f = await fixture(t), entry = join(f.root, "timeout.mjs");
  await writeFile(entry, "import{writeFileSync}from'node:fs';writeFileSync('pid',String(process.pid));setInterval(()=>{},1000);");
  const job = start(f.manager, nodeCommand(entry), { deadlineMs: 400 });
  const result = await f.manager.wait(principal, session, job.id, 5000);
  assert.equal(result.command.status, "timed_out"); assert.equal(result.command.error, "COMMAND_DEADLINE");
  const pid = Number(await readFile(join(f.root, "pid"), "utf8")); await eventually(() => !running(pid));
  assert.throws(() => start(f.manager, "echo next"), /COMMAND_RECOVERY_REQUIRED/);
  assert.throws(() => f.manager.acknowledgeRecovery({ ...principal, permissions: ["project:execute"] }, session, job.id), /FORBIDDEN/);
  assert.equal(f.manager.acknowledgeRecovery(principal, session, job.id).requiresRecovery, false);
  const next = start(f.manager, "echo next"); assert.equal((await f.manager.wait(principal, session, next.id, 5000)).command.status, "completed");
});

test("actual host crash restores an interrupted handle without replaying its orphan command", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t); await f.manager.close();
  const entry = join(f.root, "orphan.mjs"), host = join(f.parent, "host.mjs"), handoff = join(f.parent, "handoff.json");
  await writeFile(entry, "import{appendFileSync,writeFileSync}from'node:fs';appendFileSync('starts','1');writeFileSync('orphan.pid',String(process.pid));setInterval(()=>{},1000);");
  const module = pathToFileURL(resolve("dist/commands.js")).href;
  const command = "exec " + nodeCommand(entry);
  await writeFile(host, `import {CommandManager} from ${JSON.stringify(module)};import {existsSync,writeFileSync} from 'node:fs';const m=new CommandManager(${JSON.stringify({ root: f.root, stateDirectory: f.stateDirectory, defaultDeadlineMs: 10000 })});const j=m.start(${JSON.stringify(principal)},${JSON.stringify({ sessionId: session, runId: "run", command })});const timer=setInterval(()=>{if(existsSync(${JSON.stringify(join(f.root, "orphan.pid"))})){writeFileSync(${JSON.stringify(handoff)},JSON.stringify(j));clearInterval(timer)}},10);`);
  const child = spawn(process.execPath, [host], { stdio: "ignore" });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  await eventually(() => existsSync(handoff));
  const job = JSON.parse(await readFile(handoff, "utf8")), pid = Number(await readFile(join(f.root, "orphan.pid"), "utf8"));
  t.after(() => { try { process.kill(-pid, "SIGKILL"); } catch {} });
  const exited = new Promise(r => child.once("exit", r)); child.kill("SIGKILL"); await exited;
  const restored = new CommandManager({ root: f.root, stateDirectory: f.stateDirectory }); t.after(() => restored.close());
  const view = restored.read(principal, session, job.id).command;
  assert.equal(view.status, "interrupted"); assert.equal(view.error, "COMMAND_PROCESS_LOST"); assert.equal(view.directExited, "unknown"); assert.equal(view.rangeExited, "unknown");
  t.diagnostic(`After host SIGKILL the command process is ${running(pid) ? "still running" : "already stopped by the environment"}; restored ownership remains unknown in either case.`);
  assert.equal(await readFile(join(f.root, "starts"), "utf8"), "1");
  assert.throws(() => start(restored, command), /COMMAND_RECOVERY_REQUIRED/);
  try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } await eventually(() => !running(pid));
});

test("project command tools run through Pi and prevent project writes while a command owns execution", async t => {
  const f = await fixture(t); await f.manager.close();
  const project = createProjectTools({ enabled: true, root: f.root, trustedHost: true, timeoutSeconds: 5 }, { commandStateDirectory: join(f.parent, "tool-state") });
  t.after(() => project.commands.close());
  const entry = join(f.root, "tool.mjs"); await writeFile(entry, "console.log('TOOL_STARTED');setTimeout(()=>console.log('TOOL_DONE'),300);");
  let commandId, observed;
  const runtime = new PidaRuntime({ tools: project.tools, provider: () => {
    const model = fauxProvider(); model.setResponses([
      fauxAssistantMessage(fauxToolCall("project_command_start", { command: nodeCommand(entry) }), { stopReason: "toolUse" }),
      context => { const value = JSON.parse(context.messages.findLast(m => m.role === "toolResult").content.find(c => c.type === "text").text); commandId = value.command.id; return fauxAssistantMessage(fauxToolCall("project_command_wait", { id: commandId, waitTimeoutMs: 5000 }), { stopReason: "toolUse" }); },
      () => fauxAssistantMessage(fauxToolCall("project_command_read", { id: commandId }), { stopReason: "toolUse" }),
      context => { observed = JSON.parse(context.messages.findLast(m => m.role === "toolResult").content.find(c => c.type === "text").text); return fauxAssistantMessage("The command completed and output was read."); },
    ]); return { provider: model.provider, modelId: model.getModel().id };
  } });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "Run the project command and wait for its outcome.");
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(observed.command.status, "completed"); assert.match(observed.output.text, /TOOL_DONE/);
  const live = project.commands.start(principal, { sessionId, runId: "second", command: nodeCommand(entry) });
  const context = { principal, sessionId, runId: "write", signal: new AbortController().signal };
  const write = await project.tools.find(t => t.name === "project_write").execute({ path: "blocked.txt", content: "bad" }, context);
  assert.equal(write.error, "PROJECT_COMMAND_ACTIVE"); assert.equal(existsSync(join(f.root, "blocked.txt")), false);
  assert.equal(write.effectState, "not_applied");
  const shell = await project.tools.find(t => t.name === "project_shell").execute({ command: "echo blocked" }, context);
  assert.equal(shell.error, "PROJECT_COMMAND_ACTIVE");
  assert.equal(shell.effectState, "not_applied");
  await project.commands.wait(principal, sessionId, live.id, 5000);
});
