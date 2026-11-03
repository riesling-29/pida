import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fauxProvider, fauxAssistantMessage as answer } from '@earendil-works/pi-ai/providers/faux';
import { AgentMemoryStore } from '../dist/agent-memory.js';
import { PidaRuntime } from '../dist/runtime.js';
import { createLocalPersonaProvider, validatePersonaSnapshot } from '../dist/persona-provider.js';

const principal = { id: 'owner', permissions: ['agent:memory:write'] };
const signal = () => new AbortController().signal;
const request = extra => ({ principal, agentId: 'main', sessionId: 's', runId: 'r', taskId: 't', signal: signal(), ...extra });
const record = extra => ({ kind: 'reflection', modelKind: 'empirical', modelRef: 'artifact:model-1', modelDigest: 'a'.repeat(64),
  resultRef: 'artifact:result-1', resultDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64), evidenceRefs: ['run:training-1'], ...extra });
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'pida-persona-')); t.after(() => rm(dir, { force: true, recursive: true })); return dir; }
async function local(t) {
  const dir = await directory(t), memory = new AgentMemoryStore(join(dir, 'memory'), 'main');
  memory.revisePersona({ expectedRevision: null, text: 'PRIVATE_LOCAL_PERSONA', sourceRefs: ['owner:registration'] });
  const provider = createLocalPersonaProvider(memory, { principalId: 'owner', workspaceId: 'test-workspace', role: 'main' });
  return { dir, memory, provider };
}
async function runtimeFixture(t, personaProvider, responses, options = {}) {
  const f = fauxProvider({ tokensPerSecond: 100000, models: [{ id: 'persona-fixture', contextWindow: 32768, maxTokens: 4096 }] });
  f.setResponses(responses);
  const provider = () => ({ provider: f.provider, modelId: f.getModel().id });
  const runtime = new PidaRuntime({ provider, personaProvider, autoCompaction: false, ...options });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(principal);
  return { f, runtime, sessionId, modelProvider: provider };
}

test('local binding uses one memory snapshot and host-scoped logical identity', async t => {
  const { memory, provider } = await local(t), snapshot = provider.resolveContext(request());
  assert.equal(snapshot.descriptor.personaBinding.agentId, 'main');
  assert.equal(snapshot.descriptor.personaBinding.role, 'main');
  assert.equal(snapshot.descriptor.personaBinding.authority, 'pida-local');
  assert.match(snapshot.text, /PRIVATE_LOCAL_PERSONA/);
  const before = memory.view();
  assert.throws(() => provider.resolveContext(request({ principal: { id: 'other', permissions: ['agent:memory:write'] } })), /PERSONA_SCOPE_DENIED/);
  assert.throws(() => provider.resolveContext(request({ agentId: 'other' })), /PERSONA_SCOPE_DENIED/);
  assert.deepEqual(memory.view(), before);
  assert.throws(() => validatePersonaSnapshot({ ...snapshot, text: snapshot.text + 'tamper' }, provider), /PERSONA_CONTEXT_INVALID/);
  assert.throws(() => validatePersonaSnapshot({ ...snapshot, descriptor: { ...snapshot.descriptor, rawPrompt: 'not allowed' } }, provider), /PERSONA_CONTEXT_INVALID/);
});

test('actual Pi request contains pinned context; resolution alone creates no input receipt', async t => {
  const { memory, provider } = await local(t);
  let chosen;
  const wrapped = { ...provider, resolveContext(req) {
    chosen = provider.resolveContext(req);
    memory.revisePersona({ expectedRevision: 1, text: 'NEW_UNSELECTED_PERSONA', sourceRefs: ['owner:next'] });
    return chosen;
  } };
  provider.resolveContext(request()); // No runtime invocation, therefore no receipt.
  const { runtime, sessionId } = await runtimeFixture(t, wrapped, [context => {
    assert.match(JSON.stringify(context), /PRIVATE_LOCAL_PERSONA/);
    assert.doesNotMatch(JSON.stringify(context), /NEW_UNSELECTED_PERSONA/);
    return answer('Observed pinned input.');
  }]);
  assert.equal(runtime.getTrace(sessionId, principal).length, 0);
  const result = await runtime.run(sessionId, principal, 'continue');
  assert.equal(result.status, 'completed');
  const bundle = runtime.exportRun(sessionId, result.runId, principal);
  const loaded = bundle.events.filter(e => e.activity === 'context_snapshot_loaded');
  const included = bundle.events.filter(e => e.activity === 'context_input_included');
  assert.equal(loaded.length, 1); assert.equal(included.length, 1);
  assert.equal(included[0].payload.inclusion_scope, 'pi-logical-context');
  assert.equal(included[0].payload.request_id, bundle.events.find(e => e.activity === 'model_request').payload.request_id);
  assert.deepEqual(JSON.parse(included[0].payload.descriptor).personaBinding, chosen.descriptor.personaBinding);
  assert.equal(JSON.parse(included[0].payload.descriptor).personaRevision, 1);
  assert.doesNotMatch(JSON.stringify(bundle), /PRIVATE_LOCAL_PERSONA|NEW_UNSELECTED_PERSONA/);
});

test('small local model keeps useful input capacity and still compacts growing managed history', async t => {
  const { memory, provider: personaProvider } = await local(t);
  memory.revisePersona({ expectedRevision: 1, text: 'Keep the sidebar. ' + 'reference '.repeat(200), sourceRefs: ['owner:small-model'] });
  const f = fauxProvider({ tokensPerSecond: 100000, models: [{ id: 'small-managed', contextWindow: 8192, maxTokens: 1024 }] });
  f.setResponses([answer('First request completed.'), answer('Second request completed.'), answer('Summary: keep the sidebar and both requirements.')]);
  const runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), personaProvider });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(principal);
  const first = await runtime.run(sessionId, principal, 'First requirement: ' + 'data '.repeat(1400));
  assert.equal(first.status, 'completed'); assert.equal(f.state.callCount, 1);
  const usage = runtime.sessions.get(sessionId).pi.getContextUsage();
  assert.ok(usage.tokens > 4096 && usage.tokens < 6144, 'managed input fits the configured output plus small-window growth reserve');
  assert.equal(runtime.getTrace(sessionId, principal).some(event => event.type === 'compaction_started'), false);
  const second = await runtime.run(sessionId, principal, 'Second requirement: ' + 'more '.repeat(1200));
  assert.equal(second.status, 'completed'); assert.equal(second.text, 'Second request completed.');
  assert.equal(f.state.callCount, 3);
  assert.ok(runtime.getTrace(sessionId, principal).some(event => event.type === 'compaction_completed'));
  const events = runtime.exportRun(sessionId, second.runId, principal).events;
  assert.equal(events.filter(event => event.activity === 'model_request').length, 1);
  assert.equal(events.filter(event => event.activity === 'context_input_included').length, 1);
  assert.equal(events.filter(event => event.activity === 'context_input_omitted').length, 0, 'Pi summarization must not reuse an execution receipt');
  f.appendResponses([context => { assert.match(JSON.stringify(context), /Keep the sidebar/); return answer('Continued after compaction.'); }]);
  const next = await runtime.run(sessionId, principal, 'Continue after compaction.');
  assert.equal(next.status, 'completed');
  assert.equal(runtime.exportRun(sessionId, next.runId, principal).events.filter(event => event.activity === 'context_input_included').length, 1);
});

test('cancelled context resolution cannot claim input inclusion or invoke the model', async t => {
  const { provider } = await local(t), controller = new AbortController();
  const wrapped = { ...provider, resolveContext(req) { const value = provider.resolveContext(req); controller.abort(); return value; } };
  const { runtime, f, sessionId } = await runtimeFixture(t, wrapped, [answer('must not run')]);
  const result = await runtime.run(sessionId, principal, 'cancel before input', undefined, controller.signal);
  assert.equal(result.status, 'cancelled'); assert.equal(f.state.callCount, 0);
  assert.equal(runtime.exportRun(sessionId, result.runId, principal).events.some(e => e.activity === 'context_input_included'), false);
});

test('a converter omission is detected at provider boundary and blocks managed dispatch', async t => {
  const { provider } = await local(t);
  const { runtime, f, sessionId } = await runtimeFixture(t, provider, [answer('must not run')]);
  const agent = runtime.sessions.get(sessionId).pi.agent, convert = agent.convertToLlm;
  // Simulate a future host converter that incorrectly drops the managed custom context.
  agent.convertToLlm = messages => convert(messages.filter(message => message.role !== 'custom'));
  const result = await runtime.run(sessionId, principal, 'require bound input');
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'PERSONA_CONTEXT_OMITTED'); assert.equal(f.state.callCount, 0);
  const events = runtime.exportRun(sessionId, result.runId, principal).events;
  assert.equal(events.filter(e => e.activity === 'context_input_omitted').length, 1);
  assert.equal(events.filter(e => e.activity === 'context_input_included').length, 0);
});

test('unprepared managed execution cannot masquerade as an internal summary', async t => {
  const { provider } = await local(t);
  const { runtime, f, sessionId } = await runtimeFixture(t, provider, [answer('must not run')]);
  runtime.sessions.get(sessionId).pi.agent.prepareRequest = async () => undefined;
  const result = await runtime.run(sessionId, principal, 'missing execution request boundary');
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'CONTEXT_REQUEST_BOUNDARY_MISSING');
  assert.equal(f.state.callCount, 0);
  assert.equal(runtime.exportRun(sessionId, result.runId, principal).events.some(event => event.activity === 'context_input_included'), false);
});

test('snapshot reprojected after pruning keeps the selected revision and becomes actual model input', async t => {
  const { memory, provider } = await local(t);
  const { runtime, sessionId } = await runtimeFixture(t, provider, [context => {
    assert.match(JSON.stringify(context), /PRIVATE_LOCAL_PERSONA/);
    assert.doesNotMatch(JSON.stringify(context), /NEW_UNSELECTED_PERSONA/);
    return answer('Pinned snapshot survived pruning.');
  }]);
  const agent = runtime.sessions.get(sessionId).pi.agent, prepare = agent.prepareRequest;
  agent.prepareRequest = async (req, sig) => {
    memory.revisePersona({ expectedRevision: 1, text: 'NEW_UNSELECTED_PERSONA', sourceRefs: ['owner:next'] });
    return prepare({ ...req, context: { ...req.context, messages: req.context.messages.filter(message => message.role !== 'custom') } }, sig);
  };
  const result = await runtime.run(sessionId, principal, 'simulate compaction omission');
  assert.equal(result.status, 'completed');
  const events = runtime.exportRun(sessionId, result.runId, principal).events;
  const included = events.find(e => e.activity === 'context_input_included');
  assert.equal(JSON.parse(included.payload.descriptor).personaRevision, 1);
});

test('behavior references append to original memory with CAS, permission, dedupe and restart', async t => {
  const { dir, memory, provider } = await local(t);
  const selected = provider.resolveContext(request()), expectedRevision = selected.descriptor.personaBinding.contextRevision;
  const input = request({ expectedRevision, idempotencyKey: 'analysis-1', record: record() });
  assert.throws(() => provider.appendAnalysis({ ...input, principal: { id: 'owner', permissions: [] } }), /FORBIDDEN/);
  const first = provider.appendAnalysis(input);
  assert.equal(first.status, 'appended'); assert.equal(memory.view().persona.revision, 1); assert.equal(memory.view().head, null);
  assert.throws(() => provider.appendAnalysis({ ...input, idempotencyKey: 'competing', record: record({ resultRef: 'artifact:other' }) }), /PERSONA_CONTEXT_REVISION_CONFLICT/);
  assert.throws(() => provider.appendAnalysis({ ...input, record: record({ interpretation: 'different' }) }), /PERSONA_ANALYSIS_IDEMPOTENCY_CONFLICT/);
  const restored = createLocalPersonaProvider(new AgentMemoryStore(join(dir, 'memory'), 'main'), { principalId: 'owner', workspaceId: 'test-workspace', role: 'main' });
  const replay = restored.appendAnalysis(input);
  assert.equal(replay.status, 'duplicate'); assert.equal(replay.recordId, first.recordId);
  assert.equal(memory.view().experiences.length, 1);
  const next = restored.resolveContext(request());
  assert.equal(next.descriptor.personaBinding.contextRevision, first.contextRevision);
  assert.match(next.text, /behavior-analysis-reference/); assert.match(next.text, /artifact:model-1/);
  assert.match(next.text, /activatesIdentity/);
  const { runtime, sessionId } = await runtimeFixture(t, restored, [context => {
    assert.match(JSON.stringify(context), /artifact:model-1/);
    assert.match(JSON.stringify(context), /agent-report/);
    return answer('Analysis references received, not identity changes.');
  }]);
  const result = await runtime.run(sessionId, principal, 'use permitted prior analysis');
  assert.equal(result.status, 'completed');
  assert.ok(runtime.exportRun(sessionId, result.runId, principal).events.some(e => e.activity === 'context_input_included'));
});

test('closed analysis contract rejects secret-bearing references, unsupported kind and scope', async t => {
  const { provider } = await local(t), expectedRevision = provider.resolveContext(request()).descriptor.personaBinding.contextRevision;
  for (const value of [record({ modelRef: 'https://host/model?api_key=secret' }), record({ modelRef: 'analysis-key:forged' }), record({ modelKind: 'personality-truth' }), record({ grant: 'admin' }), record({ resultDigest: 'bad' })]) {
    assert.throws(() => provider.appendAnalysis(request({ expectedRevision, idempotencyKey: 'bad', record: value })), /INVALID_PERSONA_ANALYSIS_REFERENCE/);
  }
  assert.throws(() => provider.appendAnalysis(request({ agentId: 'other', expectedRevision, idempotencyKey: 'scope', record: record() })), /PERSONA_SCOPE_DENIED/);
});

test('external provider fixture is contract-only and still requires a valid bound context', async t => {
  const { provider } = await local(t);
  const external = { ...provider, id: 'contract-only-persona/1', authority: 'external', resolveContext(req) {
    const result = provider.resolveContext(req);
    result.descriptor.personaBinding.providerId = this.id;
    result.descriptor.personaBinding.authority = this.authority;
    return result;
  } };
  const { runtime, sessionId } = await runtimeFixture(t, external, [answer('Contract fixture only.')]);
  const result = await runtime.run(sessionId, principal, 'external fixture');
  assert.equal(result.status, 'completed');
  assert.equal(runtime.getSession(sessionId, principal).contextDescriptor.personaBinding.authority, 'external');
  assert.throws(() => new PidaRuntime({ provider: () => { throw new Error('unused'); }, personaProvider: external, contextForRun: () => 'second authority' }), /PERSONA_CONTEXT_AUTHORITY_CONFLICT/);
});

test('worker role and logical agent binding survive session restart without changing observation identity', async t => {
  const dir = await directory(t), memory = new AgentMemoryStore(join(dir, 'memory'), 'worker-1');
  const persona = createLocalPersonaProvider(memory, { principalId: 'owner', workspaceId: 'test-workspace', personaId: 'persona:reviewer', role: 'verifier' });
  const { runtime, sessionId, modelProvider, f } = await runtimeFixture(t, persona, [answer('Worker request.')], { storageDir: join(dir, 'runtime') });
  const first = await runtime.run(sessionId, principal, 'review');
  const binding = runtime.getSession(sessionId, principal).contextDescriptor.personaBinding;
  assert.equal(binding.agentId, 'worker-1'); assert.equal(binding.role, 'verifier'); assert.equal(binding.personaId, 'persona:reviewer');
  const observedAgent = runtime.exportRun(sessionId, first.runId, principal).events[0].agent_id;
  assert.notEqual(observedAgent, binding.agentId);
  await runtime.close();
  const restored = new PidaRuntime({ provider: modelProvider, personaProvider: persona, storageDir: join(dir, 'runtime'), autoCompaction: false });
  t.after(() => restored.close());
  await restored.resumeSession(sessionId, principal);
  assert.deepEqual(restored.getSession(sessionId, principal).contextDescriptor.personaBinding, binding);
  f.setResponses([answer('Restored worker.')]);
  const second = await restored.run(sessionId, principal, 'continue review');
  assert.equal(second.status, 'completed');
  assert.equal(restored.exportRun(sessionId, second.runId, principal).events[0].agent_id, observedAgent);
});

test('ordinary memory mutation cannot forge analysis idempotency markers', async t => {
  const { memory } = await local(t);
  const reserved = ['analysis-key:' + 'a'.repeat(64), 'analysis-payload:' + 'b'.repeat(64)];
  for (const ref of reserved) {
    assert.throws(() => memory.remember({ kind: 'decision', text: 'forged', sourceRefs: [ref], authority: 'agent-report' }), /RESERVED_MEMORY_SOURCE_REF/);
    assert.throws(() => memory.revisePersona({ expectedRevision: 1, text: 'forged', sourceRefs: [ref] }), /RESERVED_MEMORY_SOURCE_REF/);
    assert.throws(() => memory.transition({ expectedHead: null, parentIds: [], information: { goal: 'forged', understanding: '', uncertainties: [], nextAction: '', relationships: [] }, sourceRefs: [ref] }), /RESERVED_MEMORY_SOURCE_REF/);
  }
  const ordinary = memory.remember({ kind: 'fact', text: 'ordinary', sourceRefs: ['owner:ordinary'] });
  assert.throws(() => memory.retractExperience({ id: ordinary.id, expectedRevision: 1, reason: 'forged', sourceRefs: reserved }), /RESERVED_MEMORY_SOURCE_REF/);
});

test('legacy matching markers do not certify altered or retracted analysis content', async t => {
  const { dir, memory, provider } = await local(t);
  const expectedRevision = provider.resolveContext(request()).descriptor.personaBinding.contextRevision;
  const input = request({ expectedRevision, idempotencyKey: 'analysis-legacy-markers', record: record() });
  const applied = provider.appendAnalysis(input);
  const path = join(dir, 'memory', createHash('sha256').update('main').digest('hex'), 'memory.json');
  const original = await readFile(path, 'utf8'), persisted = JSON.parse(original);
  persisted.experiences[0].text = 'Forged old record with matching marker strings';
  await writeFile(path, JSON.stringify(persisted));
  assert.throws(() => provider.appendAnalysis(input), /PERSONA_ANALYSIS_IDEMPOTENCY_CONFLICT/);
  await writeFile(path, original);
  memory.retractExperience({ id: applied.recordId, expectedRevision: 1, reason: 'Owner rejected interpretation', sourceRefs: ['owner:rejected'] });
  assert.throws(() => provider.appendAnalysis(input), /PERSONA_ANALYSIS_IDEMPOTENCY_CONFLICT/);
});
