import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createPixProcessPort } from "../dist/pix-port.js";

// Transport-only fixture: this Python script does not import or calculate with PIX.
const probe = spawnSync(process.env.PIDA_TEST_PYTHON || "python3", ["-I", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
const python = probe.status === 0 ? probe.stdout.trim() : undefined;
const skip = python ? false : "Python interpreter unavailable; subprocess contract fixture NOT_RUN";
const pin = { expectedSourceCommit: "a".repeat(40), expectedSourceDigest: "b".repeat(64) };
const request = id => ({ schemaVersion: "pida.pix.worker.v1", operation: "reflect", traces: [{ caseId: id, events: [{ eventId: "one", activity: "read" }] }] });
const script = `import sys, json, os, time, signal
args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
req = json.load(sys.stdin)
mode = req.get('traces',[{'caseId':'capabilities'}])[0]['caseId']
out = {'schemaVersion':'pida.pix.worker.v1','operation':req['operation'],'status':'computed','engine':{'repository':'Chanta-Research-Group/PIX','sourceCommit':args['--source-commit'],'sourceDigest':args['--source-digest'],'packageVersion':'0.5.0','pythonVersion':'3.12','sourceVerified':True},'issues':[],'nativeResults':[],'limits':[]}
if req['operation'] == 'reflect': out.update({'sampleCount':1,'model':{'activities':['read'],'edges':[],'starts':['read'],'ends':['read'],'acceptsEmpty':False},'variants':[{'variantId':'v1','caseIds':[mode],'activities':['read'],'frequency':1,'cumulativeCaseCount':1}]})
if mode == 'pins': out['engine']['sourceDigest'] = 'c'*64
if mode == 'extra': out['unexpected'] = True
if mode == 'operation': out['operation'] = 'awareness'
if mode == 'population': out['variants'][0]['caseIds'] = ['different-case']
if mode == 'frequency': out['variants'][0]['frequency'] = 2
if mode == 'missing_model': del out['model']
if mode == 'unavailable':
 out['status'] = 'unavailable'; del out['engine']; out['issues'] = [{'code':'pix_missing','message':'Fixture missing engine'}]
if mode == 'environment':
 out['issues'] = [{'code':'fixture_environment','message':json.dumps({'secret':os.environ.get('PIDA_PIX_TEST_SECRET'),'pythonpath':os.environ.get('PYTHONPATH'),'isolatedCwd':os.getcwd()!=args['--source'],'isolatedPython':sys.flags.isolated})}]
if mode == 'failure': sys.stderr.write('private-failure-secret'); sys.exit(9)
if mode == 'badjson': sys.stdout.write('{} trailing'); sys.exit(0)
if mode == 'utf8': sys.stdout.buffer.write(b'\\xff'); sys.exit(0)
if mode == 'overflow': sys.stdout.write('X'*10000); sys.stdout.flush(); time.sleep(10)
if mode == 'stderr': sys.stderr.write('private-stderr-secret'*1000); sys.stderr.flush(); time.sleep(10)
if mode == 'hang':
 open(os.path.join(args['--source'],'pid'), 'w').write(str(os.getpid()))
 signal.signal(signal.SIGTERM, signal.SIG_IGN)
 time.sleep(20)
print(json.dumps(out))
`;
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pida-pix-port-test-"));
  const workerPath = join(directory, "worker.py");
  await writeFile(workerPath, script);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { pythonExecutable: python, workerPath, sourceDirectory: directory, ...pin, ...overrides };
  return { directory, workerPath, config, port: createPixProcessPort(config) };
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("PIX process contract uses fixed args, isolated Python and cwd, without provider environment", { skip }, async t => {
  const oldSecret = process.env.PIDA_PIX_TEST_SECRET, oldPath = process.env.PYTHONPATH;
  process.env.PIDA_PIX_TEST_SECRET = "never-pass"; process.env.PYTHONPATH = "/untrusted/module";
  t.after(() => { if (oldSecret === undefined) delete process.env.PIDA_PIX_TEST_SECRET; else process.env.PIDA_PIX_TEST_SECRET = oldSecret; if (oldPath === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = oldPath; });
  const f = await fixture(t), result = await f.port.compute(request("environment"));
  assert.equal(result.status, "computed"); assert.equal(result.engine.sourceDigest, pin.expectedSourceDigest);
  assert.deepEqual(JSON.parse(result.issues[0].message), { secret: null, pythonpath: null, isolatedCwd: true, isolatedPython: 1 });
  const unavailable = await f.port.compute(request("unavailable"));
  assert.equal(unavailable.status, "unavailable"); assert.equal(unavailable.engine, undefined);
});

test("PIX rejects stale worker pins, mismatched source, unsupported input and malformed results", { skip }, async t => {
  const f = await fixture(t);
  await assert.rejects(f.port.compute(request("pins")), /PIX_SOURCE_PIN_MISMATCH/);
  for (const mode of ["extra", "operation", "badjson", "utf8", "population", "frequency", "missing_model"]) await assert.rejects(f.port.compute(request(mode)), /PIX_OUTPUT_INVALID/);
  await assert.rejects(f.port.compute({ ...request("ordinary"), principal: "invented-owner" }), /PIX_INPUT_INVALID/);
  await assert.rejects(f.port.compute({ ...request("ordinary"), limits: { maxStates: 100001 } }), /PIX_INPUT_INVALID/);
  await assert.rejects(f.port.compute({ ...request("ordinary"), traces: [{ caseId: "one", events: [{ eventId: "duplicate", activity: "read" }, { eventId: "duplicate", activity: "edit" }] }] }), /PIX_INPUT_INVALID/);
  await writeFile(f.workerPath, script + "\n# changed after activation\n");
  await assert.rejects(f.port.compute(request("ordinary")), /PIX_WORKER_PIN_MISMATCH/);
});

test("PIX validates responses against dispatched bytes even if the caller mutates its request", { skip }, async t => {
  const f = await fixture(t), original = request("ordinary");
  const pending = f.port.compute(original);
  original.traces[0].caseId = "changed-after-dispatch";
  const result = await pending;
  assert.deepEqual(result.variants[0].caseIds, ["ordinary"]);
});

test("PIX output and stderr bounds stop the worker and expose only safe failure metadata", { skip }, async t => {
  const f = await fixture(t, { maxOutputBytes: 1024, maxStderrBytes: 64, timeoutMs: 3000 });
  await assert.rejects(f.port.compute(request("overflow")), e => e.code === "PIX_OUTPUT_LIMIT" && e.details.stdoutBytes > 1024);
  await assert.rejects(f.port.compute(request("stderr")), e => e.code === "PIX_STDERR_LIMIT" && !JSON.stringify(e).includes("private-stderr-secret"));
  await assert.rejects(f.port.compute(request("failure")), e => e.code === "PIX_WORKER_FAILED" && e.details.exitCode === 9 && e.details.stderrBytes > 0 && !JSON.stringify(e).includes("private-failure-secret"));
  const small = createPixProcessPort({ ...f.config, maxInputBytes: 256 });
  await assert.rejects(small.compute(request("a".repeat(256))), /PIX_INPUT_LIMIT/);
});

test("PIX cancellation and deadline wait for actual direct-child exit; pre-cancel does not launch", { skip }, async t => {
  const f = await fixture(t, { timeoutMs: 200 });
  await assert.rejects(f.port.compute(request("hang")), /PIX_TIMEOUT/);
  let pid = Number(await readFile(join(f.directory, "pid"), "utf8"));
  assert.equal(alive(pid), false);
  const long = createPixProcessPort({ ...f.config, timeoutMs: 5000 });
  const controller = new AbortController();
  const pending = long.compute(request("hang"), controller.signal);
  // Wait for a new real child to prove cancellation acts after process admission.
  const until = Date.now() + 2000;
  while (Date.now() < until) { await new Promise(resolve => setTimeout(resolve, 10)); const next = Number(await readFile(join(f.directory, "pid"), "utf8")); if (next !== pid) { pid = next; break; } }
  assert.equal(alive(pid), true); controller.abort();
  await assert.rejects(pending, /PIX_CANCELLED/); assert.equal(alive(pid), false);
  const already = new AbortController(); already.abort();
  await assert.rejects(long.compute(request("hang"), already.signal), /PIX_CANCELLED/);
  assert.equal(Number(await readFile(join(f.directory, "pid"), "utf8")), pid);
});
