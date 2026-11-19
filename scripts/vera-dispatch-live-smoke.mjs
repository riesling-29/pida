// One real configured-provider request. No existing session/runtime is opened.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, readdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nativeProvider, validateNativeProvider } from '../dist/provider-catalog.js';
import { ChatGPTCredentialStore } from '../dist/chatgpt-auth.js';
import { PidaRuntime } from '../dist/runtime.js';
import { createVeraDispatchPersonaProvider, veraDispatchCapabilities } from '../dist/vera-dispatch-provider.js';
import { validateObservationBundle } from '../dist/integration-contract.js';
const args = {}, root = fileURLToPath(new URL('../', import.meta.url));
for (let i = 2; i < process.argv.length; i += 2) { assert.ok(['--workspace', '--source', '--python', '--output'].includes(process.argv[i]) && process.argv[i + 1]); args[process.argv[i].slice(2)] = resolve(process.argv[i + 1]); }
assert.ok(args.workspace && args.source && args.python && args.output);
await mkdir(args.output, { recursive: true }); assert.deepEqual(await readdir(args.output), []);
const hash = b => createHash('sha256').update(b).digest('hex');
const lock = JSON.parse(await readFile(join(root, 'fixtures/vera-dispatch/producer-source-lock.json'), 'utf8'));
for (const [file, expected] of Object.entries(lock.files)) assert.equal(hash(await readFile(join(args.source, file))), expected, 'Producer source mismatch: ' + file);
const config = JSON.parse(await readFile(join(args.workspace, 'pida.config.json'), 'utf8'));
assert.equal(config.provider.kind, 'native'); assert.equal(config.provider.authMode, 'chatgpt');
const selected = { ...config.provider, thinkingLevel: 'low' }; validateNativeProvider(selected);
const credentials = new ChatGPTCredentialStore(args.workspace, config.stateDir); assert.equal(credentials.status().connected, true, 'Configured credential store unavailable');
const workspace = await mkdtemp(join(tmpdir(), 'pida-persona-live-'));
// Keep disposable synthetic evidence for inspection; no recursive deletion of any user path.
const sourceFiles = Object.fromEntries(await Promise.all(['src/vera-dispatch-provider.ts', 'src/vera-persona-provider.ts', 'src/provider-catalog.ts', 'src/runtime.ts', 'scripts/vera-dispatch-live-smoke.mjs'].map(async p => [p, hash(await readFile(join(root, p)))])));
const summary = { startedAt: new Date().toISOString(), provider: selected.providerId, model: selected.modelId, authMode: 'chatgpt', thinkingLevel: 'low',
  protocol: 'vera-dispatch/0.1.0', producerSourceDigest: lock.source_digest, sourceFiles, syntheticWorkspace: workspace,
  limits: { runMs: 20000, turns: 1, providerRetries: 0, outputRetries: 0, streamedTextCharacters: 128, observedTokenGuard: 2048 },
  limitsScope: 'OAuth endpoint has no hard output-token/billing cap here; wall-time/stream cancellation is cooperative and token guard is post-response.', actualCostUsd: null };
await writeFile(join(args.output, 'start.json'), JSON.stringify(summary, null, 2) + '\n');
const child = spawn(args.python, ['-I', '-B', join(args.source, 'scripts/dispatch_probe.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
let sequence = 0, exitCode, closed = false; const pending = new Map();
const finish = new Promise(resolve => child.once('close', code => { closed = true; exitCode = code; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('PRODUCER_EXIT')); } pending.clear(); resolve(); }));
child.stderr.resume();
child.on('error', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('PRODUCER_START_FAILED')); } pending.clear(); });
createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line), p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(r.error)) : p.resolve(r.value); });
const invoke = value => new Promise((resolve, reject) => { if (closed) return reject(Error('PRODUCER_CLOSED')); const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('PRODUCER_TIMEOUT')); child.kill(); }, 5000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, ...value }) + '\n'); });
const checks = [];
const persona = createVeraDispatchPersonaProvider({ protocol: 'vera-dispatch/0.1.0', requiredCapabilities: [...veraDispatchCapabilities], agentId: 'main', principalId: 'smoke-owner', providerPrincipal: 'principal:fixture', personaId: 'persona:synthetic-vera', hostId: 'host:one', projectId: 'alpha', organizationSessionId: 'session:fixture', agentInstanceId: 'instance:main', role: 'bounded actual provider smoke', memoryScope: ['organization:fixture', 'personal:fixture', 'project:alpha', 'project:beta'], now: () => 1000,
  port: { describe: () => invoke({ action: 'describe' }), resolve: r => invoke({ action: 'resolve', request: { runId: r.runId, taskId: r.taskId } }), authorizeInput: async r => {
    const ack = await invoke({ action: 'authorize', request: { protocol: r.protocol, requestId: r.requestId, inputDigest: r.inputDigest, runId: r.runId, taskId: r.taskId, hostId: 'host:one', binding: r.binding, context: r.context } });
    checks.push({ requestId: r.requestId, inputDigest: r.inputDigest, bindingId: ack.bindingId, contextDigest: ack.contextDigest }); return ack;
  } } });
const runtime = new PidaRuntime({ provider: nativeProvider(selected, {}, undefined, credentials), personaProvider: persona, storageDir: join(workspace, 'runtime'), workspaceDir: workspace,
  instructionRoot: workspace, skills: [], skillPaths: [], tools: [], autoCompaction: false, maxTurns: 1, maxProviderRetries: 0, maxOutputRetries: 0, maxRunMs: 20000, maxTotalTokens: 2048,
  systemPrompt: 'This is a single synthetic connection check. Return only the exact requested short marker; do not call tools.' });
let count = 0;
try {
  const owner = { id: 'smoke-owner', permissions: [] }, stop = new AbortController(), { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, 'Return exactly PIDA_PERSONA_OK and nothing else.', event => { if (event.type === 'text_delta') { count += event.delta.length; if (count > 128) stop.abort(); } }, stop.signal);
  const bundle = runtime.exportRun(sessionId, result.runId, owner), validation = validateObservationBundle(bundle), included = bundle.events.filter(e => e.activity === 'context_input_included');
  await writeFile(join(args.output, 'observation-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
  Object.assign(summary, { finishedAt: new Date().toISOString(), status: result.status, code: result.code ?? null, runId: result.runId, sessionId,
    observedTextCharacters: count, markerMatched: result.text.trim() === 'PIDA_PERSONA_OK', inputReceipts: included.length, authorizationChecks: checks,
    bundleValid: validation.valid, inputScope: 'pi-logical-context', outcomeScope: 'one configured provider task with synthetic public Persona source; no desktop or organization acceptance' });
} catch (error) { Object.assign(summary, { finishedAt: new Date().toISOString(), status: 'failed', code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'LIVE_SMOKE_FAILED', errorType: error.name }); }
finally {
  await runtime.close(); child.stdin.end(); const timer = setTimeout(() => child.kill(), 3000); await finish; clearTimeout(timer); summary.producerExitCode = exitCode;
  await writeFile(join(args.output, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
}
console.log(JSON.stringify({ status: summary.status, code: summary.code, markerMatched: summary.markerMatched, inputReceipts: summary.inputReceipts, output: args.output }));
