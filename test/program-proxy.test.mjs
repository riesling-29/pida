import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectProgramProxy, loadProgramProxy, validateProgramManifest } from "../dist/program-proxy.js";
import { PidaRuntime } from "../dist/runtime.js";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

const empty = { type: "object", properties: {}, additionalProperties: false };
async function fixture(t, source, changes = {}) {
  const parent = await mkdtemp(join(tmpdir(), "pida-program-")), root = join(parent, "repository"), registry = join(parent, "registry");
  await mkdir(root); await mkdir(registry); t.after(() => rm(parent, { recursive: true, force: true }));
  const manifestPath = join(registry, "program.json"), entrypoint = join(root, "entry.mjs");
  await writeFile(entrypoint, source);
  const manifest = { version: 1, id: "fixture", name: "Fixture", description: "A local fixture program", command: "$node", args: ["entry.mjs"], inputMode: "none", outputMode: "text", timeoutMs: 2000, effect: "write", inputSchema: empty, ...changes };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const inspection = inspectProgramProxy(root, manifestPath);
  const proxy = loadProgramProxy(root, manifestPath, { trustedHost: true, approval: inspection.approval });
  const context = { principal: { id: "alice", permissions: ["program:fixture"] }, sessionId: "session", runId: "run", signal: new AbortController().signal };
  return { parent, root, manifestPath, manifest, entrypoint, inspection, proxy, context, invoke: (args = {}, overrides = {}) => proxy.tool.execute(args, { ...context, ...overrides }) };
}

test("approved CLI receives validated JSON stdin and fixed literal arguments, without inherited provider secrets", async t => {
  const previous = process.env.PROGRAM_TEST_PROVIDER_SECRET;
  process.env.PROGRAM_TEST_PROVIDER_SECRET = "must-not-inherit";
  t.after(() => { if (previous === undefined) delete process.env.PROGRAM_TEST_PROVIDER_SECRET; else process.env.PROGRAM_TEST_PROVIDER_SECRET = previous; });
  const f = await fixture(t, "let raw='';for await(const c of process.stdin)raw+=c;console.log(JSON.stringify({input:JSON.parse(raw),arg:process.argv[2],secret:process.env.PROGRAM_TEST_PROVIDER_SECRET??null}));", {
    inputMode: "json-stdin", outputMode: "json", args: ["entry.mjs", "$(touch SHOULD_NOT_EXIST); literal"],
    inputSchema: { type: "object", properties: { message: { type: "string", maxLength: 200 } }, required: ["message"], additionalProperties: false },
  });
  const result = await f.invoke({ message: "hello\n$(not-a-command)" });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, { input: { message: "hello\n$(not-a-command)" }, arg: "$(touch SHOULD_NOT_EXIST); literal", secret: null });
  assert.equal(result.effectState, "applied");
  await assert.rejects(readFile(join(f.root, "SHOULD_NOT_EXIST")), /ENOENT/);
  assert.equal(f.proxy.tool.name, "program_fixture"); assert.equal(f.proxy.tool.permission, "program:fixture");
  await assert.rejects(f.invoke({ message: "denied" }, { principal: { id: "alice", permissions: [] } }), /FORBIDDEN/);
  assert.equal((await f.invoke({ command: "arbitrary" })).error, "PROGRAM_INPUT_INVALID");
});

test("manifest and entrypoint edits require a fresh host approval across calls and reconstructed proxies", async t => {
  const f = await fixture(t, "console.log('original');");
  assert.equal((await f.invoke()).output.trim(), "original");
  await writeFile(f.entrypoint, "console.log('changed');");
  assert.deepEqual(await f.invoke(), { ok: false, error: "PROGRAM_APPROVAL_MISMATCH", effectState: "not_applied" });
  assert.throws(() => loadProgramProxy(f.root, f.manifestPath, { trustedHost: true, approval: f.inspection.approval }), /PROGRAM_APPROVAL_MISMATCH/);
  const renewed = inspectProgramProxy(f.root, f.manifestPath);
  const next = loadProgramProxy(f.root, f.manifestPath, { trustedHost: true, approval: renewed.approval });
  assert.equal((await next.tool.execute({}, f.context)).output.trim(), "changed");
  await writeFile(f.manifestPath, JSON.stringify({ ...f.manifest, description: "New manifest" }));
  assert.equal((await next.tool.execute({}, f.context)).error, "PROGRAM_APPROVAL_MISMATCH");
  assert.throws(() => loadProgramProxy(f.root, f.manifestPath, { trustedHost: false, approval: renewed.approval }), /PROGRAM_HOST_TRUST_REQUIRED/);
});

test("exit failure and invalid JSON retain executed effects; large output is bounded and stopped", async t => {
  const failed = await fixture(t, "import{writeFileSync}from'node:fs';writeFileSync('changed.txt','yes');console.error('fixture error');process.exit(7);");
  const result = await failed.invoke();
  assert.equal(result.error, "PROGRAM_EXIT_FAILED"); assert.equal(result.exitCode, 7); assert.equal(result.effectState, "applied");
  assert.equal(await readFile(join(failed.root, "changed.txt"), "utf8"), "yes");
  const invalid = await fixture(t, "console.log('not JSON');", { outputMode: "json" });
  assert.deepEqual(Object.fromEntries(Object.entries(await invalid.invoke()).filter(([k]) => ["error", "effectState"].includes(k))), { effectState: "applied", error: "PROGRAM_OUTPUT_INVALID" });
  const excessive = await fixture(t, "process.stdout.write('x'.repeat(400000));setInterval(()=>{},1000);");
  const limited = await excessive.invoke(); assert.equal(limited.error, "PROGRAM_OUTPUT_LIMIT"); assert.equal(limited.effectState, "unknown");
  assert.ok(JSON.stringify(limited).length <= 26_000);
});

test("timeout and cancellation kill the actual child and report uncertain effects", async t => {
  const source = "import{writeFileSync}from'node:fs';writeFileSync('pid.txt',String(process.pid));setInterval(()=>{},1000);";
  const timeout = await fixture(t, source, { timeoutMs: 500 });
  const timed = await timeout.invoke(); assert.equal(timed.error, "PROGRAM_TIMEOUT"); assert.equal(timed.effectState, "unknown");
  const timeoutPid = Number(await readFile(join(timeout.root, "pid.txt"), "utf8"));
  assert.throws(() => process.kill(timeoutPid, 0), error => error.code === "ESRCH");
  const cancelled = await fixture(t, source);
  const controller = new AbortController(), running = cancelled.invoke({}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 400);
  const stopped = await running; assert.equal(stopped.error, "PROGRAM_CANCELLED"); assert.equal(stopped.effectState, "unknown");
  const cancelPid = Number(await readFile(join(cancelled.root, "pid.txt"), "utf8"));
  assert.throws(() => process.kill(cancelPid, 0), error => error.code === "ESRCH");
  const already = new AbortController(); already.abort();
  assert.equal((await cancelled.invoke({}, { signal: already.signal })).effectState, "not_applied");
});

test("manifest schema/path boundaries reject dynamic executables, unsupported validators and symlink scripts", async t => {
  const f = await fixture(t, "console.log('safe');");
  for (const change of [{ command: "node" }, { id: "invalid-id" }, { arbitraryCommand: true }, { args: ["x".repeat(2001)] }, { timeoutMs: 300001 }]) {
    assert.throws(() => validateProgramManifest({ ...f.manifest, ...change }), /PROGRAM_MANIFEST_INVALID/);
  }
  assert.throws(() => validateProgramManifest({ ...f.manifest, inputSchema: { ...empty, $ref: "file:///private" } }), /PROGRAM_SCHEMA_INVALID/);
  await writeFile(f.manifestPath, JSON.stringify({ ...f.manifest, args: ["../outside.mjs"] }));
  assert.throws(() => inspectProgramProxy(f.root, f.manifestPath), /PROGRAM_PATH_DENIED/);
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await rm(f.entrypoint); await writeFile(join(f.parent, "outside.mjs"), "console.log('outside')");
  await symlink(join(f.parent, "outside.mjs"), f.entrypoint);
  assert.throws(() => inspectProgramProxy(f.root, f.manifestPath), /PROGRAM_PATH_DENIED/);
});

test("npm proxy executes an installed npm runner with a pinned package script without installing dependencies", async t => {
  const f = await fixture(t, "console.log('unused');");
  await writeFile(join(f.root, "package.json"), JSON.stringify({ name: "program-fixture", version: "1.0.0", scripts: { inspect: "node -e \"console.log('ACTUAL_NPM_PROXY')\"" } }));
  await writeFile(f.manifestPath, JSON.stringify({ ...f.manifest, command: "$npm", args: ["--prefix", ".", "run", "inspect"] }));
  const inspection = inspectProgramProxy(f.root, f.manifestPath);
  assert.match(inspection.approval.runnerDigest, /^[a-f0-9]{64}$/); assert.match(inspection.approval.entrypointDigest, /^[a-f0-9]{64}$/);
  const proxy = loadProgramProxy(f.root, f.manifestPath, { trustedHost: true, approval: inspection.approval });
  const result = await proxy.tool.execute({}, f.context); assert.equal(result.ok, true, JSON.stringify(result)); assert.match(result.output, /ACTUAL_NPM_PROXY/);
  await writeFile(join(f.root, "package.json"), JSON.stringify({ scripts: { inspect: "other command" } }));
  assert.equal((await proxy.tool.execute({}, f.context)).error, "PROGRAM_APPROVAL_MISMATCH");
});

test("actual Pi tool loop invokes the approved program with its declared input schema", async t => {
  const f = await fixture(t, "let s='';for await(const c of process.stdin)s+=c;console.log(JSON.stringify({doubled:JSON.parse(s).value*2}));", {
    inputMode: "json-stdin", outputMode: "json", effect: "read",
    inputSchema: { type: "object", properties: { value: { type: "integer", minimum: 0, maximum: 100 } }, required: ["value"], additionalProperties: false },
  });
  let programOutput;
  const runtime = new PidaRuntime({ tools: [f.proxy.tool], provider: () => {
    const model = fauxProvider(); model.setResponses([
      fauxAssistantMessage(fauxToolCall("program_fixture", { value: 21 }), { stopReason: "toolUse" }),
      context => { programOutput = context.messages.findLast(m => m.role === "toolResult"); return fauxAssistantMessage("Actual program returned 42."); },
    ]); return { provider: model.provider, modelId: model.getModel().id };
  } });
  t.after(() => runtime.close());
  const principal = f.context.principal, { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "Double 21 with the approved program");
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.match(JSON.stringify(programOutput), /doubled.*42/);
  assert.ok(runtime.getTrace(sessionId, principal).some(event => event.type === "tool_completed" && event.toolName === "program_fixture"));
});
