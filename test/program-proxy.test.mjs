import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectProgramProxy, loadProgramProxy, validateProgramManifest } from "../dist/program-proxy.js";
import { ProgramOutputStore } from "../dist/program-output.js";
import { createProgramRegistry } from "../dist/program-registry.js";
import { PidaRuntime } from "../dist/runtime.js";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

const empty = { type: "object", properties: {}, additionalProperties: false };

test("JSON envelope preview clipping reports unretained control-byte output as lossy", async t => {
  const f = await fixture(t, "process.stdout.write(Buffer.alloc(6000,0));");
  const result = await f.invoke();
  assert.equal(result.ok, true); assert.equal(result.truncated, true); assert.equal(result.lossy, true);
  assert.equal(result.outputDetails.stdout.totalBytes, 6000);
  assert.equal(result.outputDetails.stdout.truncated, true); assert.equal(result.outputDetails.stdout.lossy, true);
  assert.equal(result.outputDetails.stdout.storageError, "PROGRAM_OUTPUT_PREVIEW_LIMIT");
  assert.equal(result.artifact_refs, undefined);
});
async function fixture(t, source, changes = {}, outputLimits) {
  const parent = await mkdtemp(join(tmpdir(), "pida-program-")), root = join(parent, "repository"), registry = join(parent, "registry");
  await mkdir(root); await mkdir(registry); t.after(() => rm(parent, { recursive: true, force: true }));
  const manifestPath = join(registry, "program.json"), entrypoint = join(root, "entry.mjs");
  await writeFile(entrypoint, source);
  const manifest = { version: 1, id: "fixture", name: "Fixture", description: "A local fixture program", command: "$node", args: ["entry.mjs"], inputMode: "none", outputMode: "text", timeoutMs: 2000, effect: "write", inputSchema: empty, ...changes };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const inspection = inspectProgramProxy(root, manifestPath);
  const outputDirectory = join(parent, "private-output"), outputStore = new ProgramOutputStore(outputDirectory, outputLimits);
  const proxy = loadProgramProxy(root, manifestPath, { trustedHost: true, approval: inspection.approval, outputStore });
  const context = { principal: { id: "alice", permissions: ["program:fixture"] }, sessionId: "session", runId: "run", signal: new AbortController().signal };
  return { parent, root, manifestPath, manifest, entrypoint, inspection, proxy, context, outputDirectory, invoke: (args = {}, overrides = {}) => proxy.tool.execute(args, { ...context, ...overrides }) };
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

test("exit failure and invalid JSON retain executed effects; JSON output has an explicit limit", async t => {
  const failed = await fixture(t, "import{writeFileSync}from'node:fs';writeFileSync('changed.txt','yes');console.error('fixture error');process.exit(7);");
  const result = await failed.invoke();
  assert.equal(result.error, "PROGRAM_EXIT_FAILED"); assert.equal(result.exitCode, 7); assert.equal(result.effectState, "applied");
  assert.equal(await readFile(join(failed.root, "changed.txt"), "utf8"), "yes");
  const invalid = await fixture(t, "console.log('not JSON');", { outputMode: "json" });
  assert.deepEqual(Object.fromEntries(Object.entries(await invalid.invoke()).filter(([k]) => ["error", "effectState"].includes(k))), { effectState: "applied", error: "PROGRAM_OUTPUT_INVALID" });
  const excessive = await fixture(t, "process.stdout.write('x'.repeat(400000));setInterval(()=>{},1000);", { outputMode: "json" });
  const limited = await excessive.invoke(); assert.equal(limited.error, "PROGRAM_OUTPUT_LIMIT"); assert.equal(limited.effectState, "unknown");
  assert.ok(JSON.stringify(limited).length <= 26_000);
});

test("verbose text program completes and exposes complete owner-scoped output through the workspace reader", async t => {
  const f = await fixture(t, "import{writeFileSync}from'node:fs';process.stdout.write('HEAD 설비\\n'+'가😀'.repeat(40000)+'\\nFINAL_SUCCESS\\n');console.error('stderr:'+ 'z'.repeat(9000)+'LAST_ERROR');writeFileSync('completed.txt','yes');");
  const registry = await createProgramRegistry(f.parent, [{ id: "fixture", enabled: true, root: f.root, manifest: f.manifestPath, approval: f.inspection.approval }], { outputDirectory: f.outputDirectory });
  const tool = registry.tools.find(t => t.name === "program_fixture"), reader = registry.tools.find(t => t.name === "program_fixture_output");
  assert.ok(tool && reader);
  const result = await tool.execute({}, f.context);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.exitCode, 0); assert.equal(result.effectState, "applied");
  assert.equal(await readFile(join(f.root, "completed.txt"), "utf8"), "yes");
  assert.equal(result.truncated, true); assert.equal(result.lossy, false); assert.equal(result.artifact_refs.length, 2);
  assert.match(result.output, /HEAD 설비/); assert.match(result.output, /FINAL_SUCCESS/); assert.match(result.stderr, /LAST_ERROR/);
  assert.ok(!result.output.includes("�")); assert.ok(JSON.stringify(result).length <= 26000);
  const artifact = result.artifact_refs.find(r => r.stream === "stdout");
  assert.equal(artifact.readTool, reader.name); assert.match(artifact.sha256, /^[a-f0-9]{64}$/); assert.ok(artifact.bytes > 131072);
  let text = "", offset = 0;
  while (true) {
    const page = await reader.execute({ artifactId: artifact.id, offset, maxBytes: 16384 }, f.context);
    assert.equal(page.ok, true, JSON.stringify(page)); assert.equal(page.lossy, false); assert.ok(!page.text.includes("�"));
    text += page.text; if (page.eof) break; assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  }
  assert.equal(text, 'HEAD 설비\n'+'가😀'.repeat(40000)+'\nFINAL_SUCCESS\n');
  assert.equal((await reader.execute({ artifactId: artifact.id }, { ...f.context, sessionId: "other" })).error, "PROGRAM_OUTPUT_NOT_FOUND");
  assert.equal((await reader.execute({ artifactId: artifact.id }, { ...f.context, principal: { id: "bob", permissions: ["program:fixture"] } })).error, "PROGRAM_OUTPUT_NOT_FOUND");
  await assert.rejects(reader.execute({ artifactId: artifact.id }, { ...f.context, principal: { id: "alice", permissions: [] } }), /FORBIDDEN/);
  assert.equal((await reader.execute({ artifactId: "../../secret" }, f.context)).error, "PROGRAM_OUTPUT_ARGUMENT_INVALID");
  if (process.platform !== "win32") { assert.equal((await stat(f.outputDirectory)).mode & 0o777, 0o700); }
  const reconstructed = loadProgramProxy(f.root, f.manifestPath, { trustedHost: true, approval: f.inspection.approval, outputStore: new ProgramOutputStore(f.outputDirectory) });
  assert.equal((await reconstructed.outputTool.execute({ artifactId: artifact.id }, f.context)).ok, true);
  const meta = JSON.parse(await readFile(join(f.outputDirectory, artifact.id + ".json"), "utf8"));
  await writeFile(join(f.outputDirectory, meta.file), "tampered");
  assert.equal((await reader.execute({ artifactId: artifact.id }, f.context)).error, "PROGRAM_OUTPUT_CHANGED");
  await writeFile(f.entrypoint, "console.log('changed source');");
  assert.equal((await reader.execute({ artifactId: artifact.id }, f.context)).error, "PROGRAM_APPROVAL_MISMATCH");
});

test("disk cap and unavailable storage keep text commands running and never advertise incomplete artifacts", async t => {
  const f = await fixture(t, "process.stdout.write('BEGIN\\n'+'x'.repeat(300000)+'\\nFINISHED\\n');", {}, { maxSpillBytes: 16384 });
  const result = await f.invoke();
  assert.equal(result.ok, true); assert.equal(result.exitCode, 0); assert.equal(result.lossy, true);
  assert.equal(result.artifact_refs, undefined); assert.equal(result.outputDetails.stdout.storageError, "PROGRAM_OUTPUT_DISK_LIMIT");
  assert.match(result.output, /FINISHED/);
  assert.equal((await readdir(f.outputDirectory)).filter(n => n.endsWith(".log")).length, 0);
  const g = await fixture(t, "process.stdout.write('x'.repeat(20000)+'DONE');");
  await writeFile(g.outputDirectory, "not a directory");
  const unavailable = await g.invoke();
  assert.equal(unavailable.ok, true); assert.equal(unavailable.lossy, true); assert.equal(unavailable.artifact_refs, undefined);
  assert.equal(unavailable.outputDetails.stdout.storageError, "PROGRAM_OUTPUT_STORAGE_UNAVAILABLE"); assert.match(unavailable.output, /DONE/);
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

test("actual Pi loop follows a returned artifact reference through the registered output tool", async t => {
  const f = await fixture(t, "process.stdout.write('FIRST\\n'+'z'.repeat(150000)+'LAST\\n');", { effect: "read" });
  const registry = await createProgramRegistry(f.parent, [{ id: "fixture", enabled: true, root: f.root, manifest: f.manifestPath, approval: f.inspection.approval }], { outputDirectory: f.outputDirectory });
  let recovered;
  const runtime = new PidaRuntime({ tools: registry.tools, provider: () => {
    const model = fauxProvider(); model.setResponses([
      fauxAssistantMessage(fauxToolCall("program_fixture", {}), { stopReason: "toolUse" }),
      context => {
        const previous = context.messages.findLast(m => m.role === "toolResult");
        const result = JSON.parse(previous.content.find(c => c.type === "text").text);
        return fauxAssistantMessage(fauxToolCall(result.artifact_refs[0].readTool, { artifactId: result.artifact_refs[0].id, offset: 0, maxBytes: 32 }), { stopReason: "toolUse" });
      },
      context => { recovered = JSON.parse(context.messages.findLast(m => m.role === "toolResult").content.find(c => c.type === "text").text); return fauxAssistantMessage("The preserved output starts with FIRST."); },
    ]); return { provider: model.provider, modelId: model.getModel().id };
  } });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(f.context.principal);
  const result = await runtime.run(sessionId, f.context.principal, "Run the approved program and inspect its preserved output.");
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(recovered.ok, true); assert.match(recovered.text, /^FIRST/);
  assert.ok(runtime.getTrace(sessionId, f.context.principal).some(e => e.type === "tool_completed" && e.toolName === "program_fixture_output"));
});
