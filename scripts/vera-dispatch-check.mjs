// Public new-profile producer + actual Pi; synthetic data/scripted model. Never imports app state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { createVeraDispatchPersonaProvider, veraDispatchCapabilities } from '../dist/vera-dispatch-provider.js';
import { validateObservationBundle } from '../dist/integration-contract.js';
const root = fileURLToPath(new URL('../', import.meta.url)), args = {};
for (let i = 2; i < process.argv.length; i += 2) { assert.ok(['--source', '--output', '--python'].includes(process.argv[i]) && process.argv[i + 1]); args[process.argv[i].slice(2)] = resolve(process.argv[i + 1]); }
assert.ok(args.source && args.output && args.python, 'Require --source, --output, --python absolute paths');
await mkdir(args.output, { recursive: true }); assert.deepEqual(await readdir(args.output), [], 'Output directory must be empty');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const lock = JSON.parse(await readFile(join(root, 'fixtures/vera-dispatch/producer-source-lock.json'), 'utf8'));
async function verifySource() { for (const [path, expected] of Object.entries(lock.files)) assert.equal(hash(await readFile(join(args.source, path))), expected, 'Producer source pin: ' + path); }
await verifySource();
const localPaths = ['src/vera-dispatch-provider.ts', 'src/vera-persona-provider.ts', 'src/runtime.ts', 'dist/vera-dispatch-provider.js', 'dist/vera-persona-provider.js', 'dist/runtime.js', 'scripts/vera-dispatch-check.mjs'];
const localHashes = async () => Object.fromEntries(await Promise.all(localPaths.map(async p => [p, hash(await readFile(join(root, p)))])));
const before = await localHashes(), results = [], files = [];
async function save(name, value) { const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(join(args.output, name), bytes); files.push({ path: name, sha256: hash(bytes) }); }
function probe() {
  const child = spawn(args.python, ['-I', '-B', join(args.source, 'scripts/dispatch_probe.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, stderr = '', exited = false; const pending = new Map();
  const closed = new Promise(resolve => child.on('close', (code) => { exited = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Probe exit ' + code + ': ' + stderr)); } pending.clear(); resolve(code); }));
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  child.on('error', error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); });
  createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line), p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(r.error)) : p.resolve(r.value); });
  return { call(value) { return new Promise((resolve, reject) => { if (exited) return reject(Error('Probe closed')); const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error('Probe timeout')); child.kill(); }, 10000); pending.set(key, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id: key, ...value }) + '\n'); }); }, async close() { child.stdin.end(); const timer = setTimeout(() => child.kill(), 3000); try { assert.equal(await closed, 0); } finally { clearTimeout(timer); } } };
}
const principal = { id: 'owner', permissions: ['fixture:read'] };
for (const scenario of ['normal', 'reference-renderer', 'revoke', 'expire', 'revise_identity', 'append_memory', 'advance_state']) {
  const external = probe(), inputChecks = [];
  const provider = createVeraDispatchPersonaProvider({ protocol: 'vera-dispatch/0.1.0', requiredCapabilities: [...veraDispatchCapabilities],
    agentId: 'main', principalId: 'owner', providerPrincipal: 'principal:fixture', personaId: 'persona:synthetic-vera', hostId: 'host:one', projectId: 'alpha', organizationSessionId: 'session:fixture', agentInstanceId: 'instance:main', role: 'main',
    memoryScope: ['organization:fixture', 'personal:fixture', 'project:alpha', 'project:beta'], now: () => 1000,
    port: { describe: () => external.call({ action: 'describe' }), resolve: r => external.call({ action: 'resolve', request: { runId: r.runId, taskId: r.taskId, renderer: scenario === 'reference-renderer' ? 'vera-reference-text/1' : 'vera-json/1' } }),
      authorizeInput: async r => { inputChecks.push({ requestId: r.requestId, inputDigest: r.inputDigest }); return external.call({ action: 'authorize', request: { protocol: r.protocol, requestId: r.requestId, inputDigest: r.inputDigest, runId: r.runId, taskId: r.taskId, hostId: 'host:one', binding: r.binding, context: r.context } }); } } });
  const negative = !['normal', 'reference-renderer'].includes(scenario), f = fauxProvider({ tokensPerSecond: 100000 });
  f.setResponses([answer(call('inspect', {}), { stopReason: 'toolUse' }), answer('Synthetic inspection complete.')]);
  const runtime = new PidaRuntime({ personaProvider: provider, provider: () => ({ provider: f.provider, modelId: f.getModel().id }), autoCompaction: false,
    tools: [{ name: 'inspect', description: 'Synthetic fixture inspection', parameters: Type.Object({}), permission: 'fixture:read', effect: 'read', execute: async () => { if (negative) await external.call({ action: scenario }); return { inspected: true }; } }] });
  try {
    const { sessionId } = await runtime.createSession(principal), result = await runtime.run(sessionId, principal, 'Inspect the synthetic reference and continue.');
    const bundle = runtime.exportRun(sessionId, result.runId, principal), included = bundle.events.filter(e => e.activity === 'context_input_included');
    assert.equal(validateObservationBundle(bundle).valid, true);
    assert.equal(f.state.callCount, negative ? 1 : 2); assert.equal(included.length, f.state.callCount);
    assert.ok(included.every((e, i) => e.payload.input_digest === inputChecks[i].inputDigest && JSON.parse(e.payload.descriptor).personaBinding.providerId === provider.id));
    assert.equal(negative ? result.code : result.status, negative ? 'PERSONA_INPUT_NOT_AUTHORIZED' : 'completed');
    results.push({ scenario, status: 'PASS', resultStatus: result.status, code: result.code ?? null, modelCalls: f.state.callCount, inputReceipts: included.length, authorizationRequests: inputChecks.length });
    await save(scenario + '-bundle.json', bundle);
  } finally { await runtime.close(); await external.close(); }
}
await verifySource(); assert.deepEqual(await localHashes(), before);
await save('result.json', { protocol: 'vera-dispatch/0.1.0', producerSourceDigest: lock.source_digest, consumerFiles: before, scenarios: results, files: [...files], limitations: ['synthetic local data and scripted Pi model', 'public local producer methods; not a remote transport acceptance', 'linear-state subset; no graph, behavior models, canonical provider receipt writeback or task acceptance', 'historical continuity source remains unavailable; old lock unchanged'] });
console.log(JSON.stringify({ scenarios: results.length, status: 'PASS', output: args.output }));
