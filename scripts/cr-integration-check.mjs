#!/usr/bin/env node
// Actual external source + actual Pi, synthetic data/model. Does not edit other apps.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { createVeraPersonaProvider } from '../dist/vera-persona-provider.js';
import { validateObservationBundle } from '../dist/integration-contract.js';
import { sha256, canonical } from '../dist/private-state.js';

const root = fileURLToPath(new URL('../', import.meta.url)), args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--persona', '--schumpeter', '--output', '--python'].includes(process.argv[i]) && process.argv[i + 1], 'Expected source/output path pairs');
  args[process.argv[i].slice(2)] = resolve(process.argv[i + 1]);
}
assert.ok(args.persona && args.schumpeter && args.output, 'Required --persona SOURCE --schumpeter SOURCE --output EMPTY_DIR');
const python = args.python ?? execFileSync('python3', ['-I', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
await mkdir(args.output, { recursive: true }); assert.deepEqual(await readdir(args.output), []);
const sourcePaths = ['src/runtime.ts', 'src/persona-provider.ts', 'src/vera-persona-provider.ts', 'src/vera-contract.ts', 'src/run-context.ts', 'src/integration-contract.ts', 'src/execution-contract.ts', 'src/observation.ts', 'scripts/cr-integration-check.mjs', 'scripts/cr-consumer-probe.py', 'package.json'];
const paths = [...sourcePaths, ...sourcePaths.filter(p => p.startsWith('src/')).map(p => p.replace('src/', 'dist/').replace(/\.ts$/, '.js'))];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async p => [p, sha256(await readFile(join(root, p), 'utf8'))])));
const before = await hashes(), checks = [], files = [], processes = new Set();
const check = (name, condition) => { assert.ok(condition, name); checks.push({ name, status: 'PASS' }); };
async function save(name, value) {
  const text = JSON.stringify(value, null, 2) + '\n'; await writeFile(join(args.output, name), text);
  files.push({ path: name, sha256: sha256(text), bytes: Buffer.byteLength(text) });
}
function probe(mode) {
  const child = spawn(python, ['-I', '-B', join(root, 'scripts/cr-consumer-probe.py'), mode, args[mode], join(root, 'fixtures/cr-integration/consumer-lock.json')], { cwd: args.output, stdio: ['pipe', 'pipe', 'pipe'] });
  processes.add(child); let sequence = 0, stderr = '', closed = false; const pending = new Map();
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
  const rejectAll = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.on('error', rejectAll); child.on('close', code => { closed = true; processes.delete(child); rejectAll(new Error(`Probe exited ${code}: ${stderr}`)); });
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      if (line.length > 262144) throw new Error('Probe response too large');
      const r = JSON.parse(line), p = pending.get(r.id); if (!p) return;
      clearTimeout(p.timer); pending.delete(r.id); r.error ? p.reject(new Error(r.error)) : p.resolve(r.value);
    } catch (e) { rejectAll(e); child.kill(); }
  });
  return { call(value) { return new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Probe closed')); return; }
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Probe timeout')); child.kill(); }, 10000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, ...value }) + '\n');
  }); }, close() { child.stdin.end(); } };
}
const owner = { id: 'owner', permissions: ['fixture:read'] }, scope = ['organization:fixture', 'personal:fixture', 'project:alpha', 'project:beta'];
let firstBundle;
try {
  for (const scenario of ['normal', 'worker', 'subagent', 'verifier', 'revoke', 'withdraw', 'expire']) {
    const external = probe('persona'), requests = [], selections = [];
    const personaId = ['worker', 'subagent', 'verifier'].includes(scenario) ? 'persona:' + scenario : 'persona:synthetic-vera';
    const provider = createVeraPersonaProvider({ agentId: scenario, principalId: 'owner', providerPrincipal: 'principal:fixture', personaId,
      hostId: 'host:one', projectId: 'alpha', organizationSessionId: 'session:fixture', agentInstanceId: 'instance:main', role: scenario, memoryScope: scope, now: () => 1000,
      port: { async resolve(r) {
        const value = await external.call({ action: 'resolve', persona: personaId, request: { runId: r.runId, taskId: r.taskId } });
        selections.push(value); return value;
      }, async authorizeInput(r) {
        requests.push({ requestId: r.requestId, inputDigest: r.inputDigest, contextDigest: r.context.digest });
        return external.call({ action: 'authorize', request: { requestId: r.requestId, inputDigest: r.inputDigest,
          runId: r.runId, taskId: r.taskId, binding: r.binding, context: r.context } });
      } } });
    const f = fauxProvider({ tokensPerSecond: 100000 });
    const negative = ['revoke', 'withdraw', 'expire'].includes(scenario);
    f.setResponses([answer(call('inspect', {}), { stopReason: 'toolUse' }), context => {
      assert.match(JSON.stringify(context), /Synthetic/); return answer('Synthetic run complete.');
    }]);
    const p = new PidaRuntime({ personaProvider: provider, provider: () => ({ provider: f.provider, modelId: f.getModel().id }), autoCompaction: false,
      tools: [{ name: 'inspect', description: 'Synthetic inspection', permission: 'fixture:read', effect: 'read', parameters: Type.Object({}),
        async execute() { if (negative) await external.call({ action: scenario }); return { inspected: true }; } }] });
    try {
      const { sessionId } = await p.createSession(owner), result = await p.run(sessionId, owner, 'Inspect the synthetic reference and continue.');
      const bundle = p.exportRun(sessionId, result.runId, owner), validation = validateObservationBundle(bundle);
      check(scenario + ': valid actual producer export', validation.valid);
      check(scenario + ': exact provider dispatch count', f.state.callCount === (negative ? 1 : 2));
      check(scenario + ': correct outcome', negative ? result.code === 'PERSONA_INPUT_NOT_AUTHORIZED' : result.status === 'completed');
      const receipts = bundle.events.filter(e => e.activity === 'context_input_included');
      check(scenario + ': host receipt bound to actual converted input', receipts.every((e, i) => e.payload.input_digest === requests[i].inputDigest && e.payload.authorization === 'current-provider-check') && receipts.length === f.state.callCount);
      check(scenario + ': no fabricated provider use receipt', (await external.call({ action: 'status' })).provider_use_receipts === 0);
      await save(scenario + '-bundle.json', bundle);
      if (scenario === 'normal') { firstBundle = bundle; await save('normal-source-context.json', selections[0]); await save('normal-input-bindings.json', requests); }
    } finally { await p.close(); external.close(); }
  }
  const consumer = probe('schumpeter');
  const current = await consumer.call({ bundle: join(args.output, 'normal-bundle.json') });
  const control = await consumer.call({ bundle: join(root, 'fixtures/schumpeter-readiness/claim-without-evidence.json') });
  check('Schumpeter pinned source accepts its supported old contract control', control.accepted);
  check('Schumpeter current producer incompatibility is explicit and unchanged', !current.accepted && current.error === 'PIDA_FORBIDDEN_PAYLOAD_FIELD');
  await save('schumpeter-consumer-result.json', { current, control, status: 'BLOCKED_CONSUMER_CONTRACT', producerBytesAltered: false });
  consumer.close();
  assert.deepEqual(await hashes(), before, 'Source and executed build unchanged during checks');
  const report = { profile: 'actual-Pi-and-local-Persona-source; scripted-model; actual-Schumpeter-import-attempt', version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
    status: 'PASS', executed_at_utc: new Date().toISOString(), checks, files, sourceAndBuildHashes: before, sourceDigest: sha256(canonical(before)),
    consumerLock: JSON.parse(await readFile(join(root, 'fixtures/cr-integration/consumer-lock.json'), 'utf8')),
    personaIntegration: 'PASS_LOCAL_PINNED_SOURCE', schumpeterIntegration: 'BLOCKED_CONSUMER_CONTRACT',
    limitations: ['synthetic data and scripted model decisions', 'Persona validation shim uses pinned private local methods, not a public remote API', 'no canonical data, credentials or other-app source changes', 'no automatic writeback of Pida receipts to Persona', 'no live network/LLM, Windows, independent task acceptance or improvement claim'] };
  await writeFile(join(args.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ checks: checks.length, status: report.status, persona: report.personaIntegration, schumpeter: report.schumpeterIntegration }));
} finally { for (const child of processes) child.kill(); }
