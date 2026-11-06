import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { endpointProvider } from '../dist/providers.js';
import { AgentMemoryStore } from '../dist/agent-memory.js';

const owner = { id: 'recovery-owner', permissions: ['save'] };
const failed = text => answer('', { stopReason: 'error', errorMessage: text });
async function fixture(t, responses, options = {}) {
  const f = fauxProvider({ tokensPerSecond: 100000, models: [{ id: 'recovery', contextWindow: 32768, maxTokens: 4096 }] });
  f.setResponses(responses);
  const provider = () => ({ provider: f.provider, modelId: f.getModel().id });
  const runtime = new PidaRuntime({ provider, retryBaseDelayMs: 5, retryMaxDelayMs: 10, ...options });
  t.after(() => runtime.close());
  return { runtime, f, provider, id: (await runtime.createSession(owner)).sessionId };
}
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'pida-recovery082-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('real Pi session retry recovers a model attempt without replaying an already applied tool (faux model)', async t => {
  let writes = 0;
  const { runtime, f, id } = await fixture(t, [
    answer(call('save', {}), { stopReason: 'toolUse' }), failed('429 rate limit PRIVATE_PROVIDER_ERROR'),
    context => { assert.equal(context.messages.filter(m => m.role === 'toolResult').length, 1); return answer('Saved once.'); },
  ], { tools: [{ name: 'save', description: 'save', permission: 'save', parameters: Type.Object({}), effect: 'write', async execute() { writes++; return { saved: true }; } }] });
  const result = await runtime.run(id, owner, 'Save once');
  assert.equal(result.status, 'completed'); assert.equal(writes, 1); assert.equal(f.state.callCount, 3);
  const bundle = runtime.exportRun(id, result.runId, owner);
  assert.equal(bundle.events.filter(e => e.activity === 'retry_scheduled').length, 1);
  assert.ok(bundle.events.some(e => e.activity === 'retry_scheduled' && e.payload.attempt === 1));
  assert.equal(JSON.stringify(bundle).includes('PRIVATE_PROVIDER_ERROR'), false);
});

test('retry budget is bounded and permanent authentication failures do not retry', async t => {
  const { runtime, f, id } = await fixture(t, [failed('503 overloaded'), failed('503 overloaded'), failed('503 overloaded')]);
  const exhausted = await runtime.run(id, owner, 'retry bounded');
  assert.equal(exhausted.status, 'failed'); assert.equal(exhausted.code, 'PROVIDER_RETRY_EXHAUSTED'); assert.equal(f.state.callCount, 3);
  f.setResponses([failed('401 invalid API key')]);
  const permanent = await runtime.run(id, owner, 'auth failure');
  assert.equal(permanent.code, 'PROVIDER_FAILED'); assert.equal(f.state.callCount, 4);
});

test('cancelling backoff wins over provider failure and never starts another request', async t => {
  const { runtime, f, id } = await fixture(t, [failed('503 overloaded'), answer('must not run')], { retryBaseDelayMs: 1000, retryMaxDelayMs: 1000 });
  const abort = new AbortController();
  const result = await runtime.run(id, owner, 'cancel retry', event => { if (event.type === 'trace' && event.trace.type === 'retry_scheduled') abort.abort(); }, abort.signal);
  assert.equal(result.status, 'cancelled'); assert.equal(result.code, 'CANCELLED'); assert.equal(f.state.callCount, 1);
});

test('an uncertain external effect blocks Pi retry and remains available for reconciliation', async t => {
  let applied = 0;
  const { runtime, f, id } = await fixture(t, [answer(call('save', {}), { stopReason: 'toolUse' }), failed('503 overloaded'), answer('must not run')], {
    tools: [{ name: 'save', description: 'uncertain effect', permission: 'save', effect: 'write', parameters: Type.Object({}), effectResult: () => 'unknown', async execute() { applied++; return {}; } }],
  });
  const result = await runtime.run(id, owner, 'save');
  assert.equal(result.code, 'EFFECT_STATE_UNKNOWN'); assert.equal(applied, 1); assert.equal(f.state.callCount, 1);
  assert.equal(result.recovery.pendingEffectIds.length, 1);
});

test('actual HTTP stalled response is bounded by idle timeout independently of run deadline', async t => {
  const server = createServer(async (req, res) => { for await (const _ of req) {} res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const runtime = new PidaRuntime({ provider: endpointProvider({ id: 'idle', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'idle', contextWindow: 32768, maxTokens: 4096, allowInsecureHttp: true, authMode: 'none', apiKeyEnv: 'UNUSED' }), maxProviderRetries: 0, httpIdleTimeoutMs: 120, maxRunMs: 5000 });
  t.after(async () => { await runtime.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const { sessionId } = await runtime.createSession(owner), start = Date.now();
  const result = await runtime.run(sessionId, owner, 'stall');
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'PROVIDER_IDLE_TIMEOUT'); assert.ok(Date.now() - start < 3000);
});

test('active HTTP SSE resets idle time but never extends the overall run budget', async t => {
  const server = createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const timer = setInterval(() => res.write(`data: ${JSON.stringify({ id: 'stream', object: 'chat.completion.chunk', model: 'idle', choices: [{ index: 0, delta: { content: '.' }, finish_reason: null }] })}\n\n`), 25);
    res.on('close', () => clearInterval(timer));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const runtime = new PidaRuntime({ provider: endpointProvider({ id: 'active', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'idle', contextWindow: 32768, maxTokens: 4096, allowInsecureHttp: true, authMode: 'none', apiKeyEnv: 'UNUSED' }), httpIdleTimeoutMs: 150, maxRunMs: 400 });
  t.after(async () => { await runtime.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, 'keep streaming');
  assert.equal(result.status, 'limited'); assert.equal(result.code, 'RUN_TIMEOUT'); assert.ok(result.text.length > 2);
});

test('overflow recovery requires a committed smaller compaction and never loops on no progress', async t => {
  for (const progress of [true, false]) {
    const { runtime, f, id } = await fixture(t, [answer('One.'), answer('Two.'), answer('Three.')]);
    await runtime.run(id, owner, 'Keep requirement A. ' + 'x'.repeat(14000));
    await runtime.run(id, owner, 'Keep requirement B. ' + 'y'.repeat(14000));
    await runtime.run(id, owner, 'Keep requirement C. ' + 'z'.repeat(14000));
    f.setResponses([failed('context_length_exceeded'), answer(progress ? 'Summary: keep requirements A and B.' : 'bloated '.repeat(6000)), answer('Recovered.')]);
    const before = f.state.callCount;
    const result = await runtime.run(id, owner, 'Continue.');
    assert.equal(result.status, progress ? 'completed' : 'failed', JSON.stringify({result,trace:runtime.getTrace(id,owner)}));
    if (progress) assert.equal(result.text, 'Recovered.');
    else { assert.equal(result.code, 'COMPACTION_NO_PROGRESS'); assert.equal(f.state.callCount - before, 2); }
  }
});

test('context text and provenance use one snapshot; changes apply next run and descriptors survive restart/handoff', async t => {
  const dir = await directory(t), memory = new AgentMemoryStore(join(dir, 'memory'), 'agent');
  memory.revisePersona({ expectedRevision: null, text: 'PRIVATE_PERSONA_OLD', sourceRefs: ['owner:1'] });
  const exp = memory.remember({ kind: 'fact', text: 'PRIVATE_EXPERIENCE', sourceRefs: ['run:1'] });
  const state = memory.transition({ expectedHead: null, parentIds: [], sourceRefs: ['run:1'], information: { goal: 'PRIVATE_GOAL', understanding: '', uncertainties: [], nextAction: '', relationships: [] } });
  const options = { autoCompaction: false, storageDir: join(dir, 'runtime'), contextForRun: () => {
    const snapshot = memory.contextForRun(12000);
    if (snapshot.descriptor.personaRevision === 1) memory.revisePersona({ expectedRevision: 1, text: 'PRIVATE_PERSONA_NEW', sourceRefs: ['owner:2'] });
    return snapshot;
  } };
  const { runtime, f, id, provider } = await fixture(t, [context => { assert.match(JSON.stringify(context), /PRIVATE_PERSONA_OLD/); assert.doesNotMatch(JSON.stringify(context), /PRIVATE_PERSONA_NEW/); return answer('First.'); }], options);
  const result = await runtime.run(id, owner, 'initial');
  const first = runtime.getSession(id, owner).contextDescriptor;
  assert.deepEqual(first.informationState, { id: state.id, revision: state.revision });
  assert.equal(first.personaRevision, 1); assert.deepEqual(first.experiences, [{ id: exp.id, revision: 1 }]);
  const archive = JSON.stringify(runtime.exportRun(id, result.runId, owner));
  assert.doesNotMatch(archive, /PRIVATE_PERSONA|PRIVATE_EXPERIENCE|PRIVATE_GOAL/); assert.match(archive, /context_snapshot_loaded/);
  await runtime.close();
  const restored = new PidaRuntime({ provider, ...options }); t.after(() => restored.close());
  await restored.resumeSession(id, owner); assert.deepEqual(restored.getSession(id, owner).contextDescriptor, first);
  f.setResponses([answer('Second.'), answer('Prior task summary')]);
  const second = await restored.run(id, owner, 'next');
  assert.equal(restored.getSession(id, owner).contextDescriptor.personaRevision, 2);
  const child = await restored.compactSession(id, owner, true), lineage = restored.getSession(child.sessionId, owner).handoff;
  assert.equal(lineage.sourceSessionId, id); assert.equal(lineage.sourceRunId, second.runId); assert.equal(lineage.filesRestored, false);
  assert.equal(restored.listSessions(owner).find(s => s.sessionId === child.sessionId).handoff.operationId, lineage.operationId);
});

test('future memory format is distinguished from corruption and preserved byte-for-byte', async t => {
  const dir = await directory(t), store = new AgentMemoryStore(dir, 'agent');
  store.revisePersona({ expectedRevision: null, text: 'persona', sourceRefs: ['owner:1'] });
  const path = join(dir, (await readdir(dir))[0], 'memory.json'), data = JSON.parse(await readFile(path, 'utf8'));
  data.schemaVersion = 2; const original = JSON.stringify(data); await writeFile(path, original);
  assert.throws(() => store.view(), /MEMORY_SCHEMA_UNSUPPORTED/); assert.equal(await readFile(path, 'utf8'), original);
});
