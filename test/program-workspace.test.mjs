import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { createWorkspace, initWorkspace, readConfig, workspaceEnvironment } from "../dist/workspace.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "pida-program-workspace-")), repository = join(directory, "repository"), workspace = join(directory, "agent");
  await mkdir(repository); initWorkspace(workspace);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = readConfig(workspace); config.tools.enabled = []; config.workbench = { enabled: false }; config.agents = { enabled: false };
  config.project = { enabled: true, root: repository, trustedHost: false };
  config.permissions = ["project:read", "project:write"];
  await writeFile(join(workspace, "pida.config.json"), JSON.stringify(config));
  const source = "import{appendFileSync}from'node:fs';let text='';for await(const part of process.stdin)text+=part;const input=text?JSON.parse(text):{};appendFileSync('executions.jsonl',JSON.stringify(input)+'\\n');console.log(JSON.stringify({message:input.message??null,arg:process.argv[2]??null,providerSecret:process.env.PIDA_PROGRAM_WORKSPACE_SECRET??null}));";
  const entrypoint = join(repository, "entry.mjs"); await writeFile(entrypoint, source);
  await writeFile(join(repository, "package.json"), JSON.stringify({ name: "existing-fixture-program", version: "1.0.0", bin: { fixture: "entry.mjs" }, scripts: { inspect: "node entry.mjs" } }));
  const cli = (...args) => execFileSync(process.execPath, ["dist/cli.js", "programs", ...args], { cwd: process.cwd(), encoding: "utf8" });
  const executions = join(repository, "executions.jsonl");
  return { directory, repository, workspace, entrypoint, source, cli, executions };
}
async function enable(f) {
  const catalog = JSON.parse(f.cli("scan", f.repository));
  const candidate = catalog.candidates.find(item => item.kind === "node-bin"); assert.ok(candidate);
  f.cli("draft", f.repository, candidate.id, f.workspace);
  const manifestPath = join(f.workspace, "programs", candidate.id + ".json"), drafted = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = { ...drafted, inputMode: "json-stdin", outputMode: "json", args: ["entry.mjs", "$(not-a-shell-command); literal"], timeoutMs: 2000,
    inputSchema: { type: "object", properties: { message: { type: "string", maxLength: 300 } }, required: ["message"], additionalProperties: false } };
  await writeFile(manifestPath, JSON.stringify(manifest));
  f.cli("enable", f.repository, manifestPath, f.workspace);
  return { candidate, manifest, manifestPath };
}
function scripted(toolName, args, inspect) {
  return () => {
    const f = fauxProvider({ tokensPerSecond: 100000 });
    f.setResponses([answer(call(toolName, args), { stopReason: "toolUse" }), context => {
      const result = context.messages.filter(message => message.role === "toolResult").at(-1);
      if (inspect) inspect(JSON.parse(result.content.filter(block => block.type === "text").map(block => block.text).join("")));
      return answer("Program result inspected.");
    }]);
    return { provider: f.provider, modelId: f.getModel().id };
  };
}
const principal = f => ({ id: "local-user", permissions: readConfig(f.workspace).permissions });
async function receipts(f, sessionId) {
  return JSON.parse(await readFile(join(f.workspace, readConfig(f.workspace).stateDir, "effects", sessionId + ".json"), "utf8"));
}

test("CLI discovery and draft inspect metadata only; enable pins contract and permissions without execution", async t => {
  const f = await fixture(t), catalog = JSON.parse(f.cli("scan", f.repository));
  assert.ok(catalog.candidates.some(item => item.kind === "npm-script"));
  const candidate = catalog.candidates.find(item => item.kind === "node-bin"); assert.equal(candidate.status, "ready");
  assert.equal(existsSync(f.executions), false);
  f.cli("draft", f.repository, candidate.id, f.workspace);
  const manifestPath = join(f.workspace, "programs", candidate.id + ".json"), draft = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(draft.command, "$node"); assert.deepEqual(draft.args, ["entry.mjs"]); assert.equal(draft.inputMode, "none");
  assert.equal(readConfig(f.workspace).programs, undefined); assert.equal(existsSync(f.executions), false);
  f.cli("enable", f.repository, manifestPath, f.workspace);
  const configured = readConfig(f.workspace), registration = configured.programs[0];
  assert.equal(registration.id, candidate.id); assert.equal(registration.enabled, true);
  for (const key of ["manifestDigest", "commandDigest", "entrypointDigest"]) assert.match(registration.approval[key], /^[a-f0-9]{64}$/);
  assert.ok(configured.permissions.includes(`program:${candidate.id}`)); assert.equal(existsSync(f.executions), false);
  let app = await createWorkspace(f.workspace); assert.ok(app.runtime.getInfo(principal(f)).tools.some(tool => tool.name === `program_${candidate.id}` && tool.permitted));
  await app.close(); assert.equal(existsSync(f.executions), false);
  f.cli("disable", candidate.id, f.workspace);
  assert.equal(readConfig(f.workspace).programs[0].enabled, false); assert.ok(!readConfig(f.workspace).permissions.includes(`program:${candidate.id}`));
  app = await createWorkspace(f.workspace); assert.ok(!app.runtime.getInfo(principal(f)).tools.some(tool => tool.name === `program_${candidate.id}`)); await app.close();
  assert.equal(existsSync(f.executions), false);
});

test("workspace Pi loop invokes approved JSON proxy, records observations/effects and denies an ungranted call", async t => {
  const f = await fixture(t), { manifest } = await enable(f);
  const previous = process.env.PIDA_PROGRAM_WORKSPACE_SECRET; process.env.PIDA_PROGRAM_WORKSPACE_SECRET = "provider-secret-canary";
  t.after(() => { if (previous === undefined) delete process.env.PIDA_PROGRAM_WORKSPACE_SECRET; else process.env.PIDA_PROGRAM_WORKSPACE_SECRET = previous; });
  const app = await createWorkspace(f.workspace); t.after(() => app.close());
  const name = `program_${manifest.id}`, who = principal(f);
  app.runtime.configureProvider(scripted(name, { message: "actual stdin $(literal)" }, result => {
    assert.equal(result.ok, true); assert.equal(result.exitCode, 0); assert.deepEqual(result.output, { message: "actual stdin $(literal)", arg: "$(not-a-shell-command); literal", providerSecret: null });
  }), { mode: "fixture", model: "real-pi-program-fixture" });
  const session = await app.runtime.createSession(who), result = await app.runtime.run(session.sessionId, who, "Run the approved program.");
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(JSON.parse((await readFile(f.executions, "utf8")).trim()), { message: "actual stdin $(literal)" });
  assert.equal((await receipts(f, session.sessionId))[0].state, "applied");
  const bundle = app.runtime.exportRun(session.sessionId, result.runId, who);
  assert.ok(bundle.events.some(event => event.activity === "tool_started" && event.payload.tool_name === name));
  assert.ok(bundle.events.some(event => event.activity === "tool_completed" && event.payload.tool_name === name));
  assert.equal(bundle.manifest.verification_status, "UNKNOWN");
  assert.doesNotMatch(JSON.stringify(bundle), /actual stdin|provider-secret-canary|not-a-shell-command/);
  const denied = { id: "local-user", permissions: ["project:read"] }, other = await app.runtime.createSession(denied);
  const forbidden = await app.runtime.run(other.sessionId, denied, "Attempt without permission.");
  assert.equal(forbidden.status, "failed"); assert.equal(forbidden.code, "TOOL_FORBIDDEN");
  assert.equal((await readFile(f.executions, "utf8")).trim().split("\n").length, 1);
});

test("source change fails closed before invocation and on workspace restart until host reapproval", async t => {
  const f = await fixture(t), { manifest } = await enable(f), app = await createWorkspace(f.workspace);
  t.after(() => app.close());
  const who = principal(f);
  app.runtime.configureProvider(scripted(`program_${manifest.id}`, { message: "must not run" }), { mode: "fixture", model: "real-pi-program-fixture" });
  await writeFile(f.entrypoint, f.source + "\n// source changed after host approval\n");
  const session = await app.runtime.createSession(who), result = await app.runtime.run(session.sessionId, who, "Run the now-stale registered program.");
  assert.equal(result.status, "failed"); assert.equal(result.code, "PROGRAM_APPROVAL_MISMATCH");
  assert.equal((await receipts(f, session.sessionId))[0].state, "not_applied"); assert.equal(existsSync(f.executions), false);
  await app.close();
  await assert.rejects(createWorkspace(f.workspace), /PROGRAM_APPROVAL_MISMATCH/);
  assert.equal(existsSync(f.executions), false);
});

test("HTTP program catalog and draft remain read-only and reject a stale candidate digest", async t => {
  const f = await fixture(t), app = await createWorkspace(f.workspace);
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await app.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`, token = workspaceEnvironment(f.workspace).PIDA_API_TOKEN;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const listed = await fetch(base + "/v1/programs", { headers }).then(response => response.json());
  const candidate = listed.catalog.candidates.find(item => item.kind === "node-bin"); assert.ok(candidate); assert.deepEqual(listed.enabled, []);
  const draft = await fetch(base + "/v1/programs/draft", { method: "POST", headers, body: JSON.stringify({ candidateId: candidate.id, sourceDigest: candidate.sourceDigest }) });
  assert.equal(draft.status, 200); assert.equal((await draft.json()).manifest.command, "$node");
  const packageFile = join(f.repository, "package.json"), pkg = JSON.parse(await readFile(packageFile, "utf8"));
  await writeFile(packageFile, JSON.stringify({ ...pkg, description: "changed metadata" }));
  const stale = await fetch(base + "/v1/programs/draft", { method: "POST", headers, body: JSON.stringify({ candidateId: candidate.id, sourceDigest: candidate.sourceDigest }) });
  assert.equal(stale.status, 409); assert.equal((await stale.json()).error, "PROGRAM_SOURCE_CHANGED");
  assert.equal(existsSync(f.executions), false); assert.equal(readConfig(f.workspace).programs, undefined); assert.equal(existsSync(join(f.workspace, "programs")), false);
});
