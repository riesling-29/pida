import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { createVeraPersonaProvider } from '../dist/vera-persona-provider.js';
import { PidaRuntime } from '../dist/runtime.js';
import { canonical, sha256 } from '../dist/private-state.js';
import { validateObservationBundle } from '../dist/integration-contract.js';

const source = JSON.parse(await readFile(new URL('./fixtures/vera/context.json', import.meta.url), 'utf8'));
const principal = { id: 'owner', permissions: ['test:read'] };
const scope = ['organization:fixture', 'personal:fixture', 'project:alpha', 'project:beta'];
const sign = c => { const { digest, ...body } = c; return { ...body, digest: sha256(canonical(body)) }; };
export function fixture(change = () => {}, authorize = async () => {}) {
  const calls = [], selections = [];
  let now = 1000;
  const options = { agentId: 'main', principalId: 'owner', providerPrincipal: 'principal:fixture', personaId: source.persona_id,
    hostId: 'host:one', projectId: 'alpha', organizationSessionId: 'session:fixture', agentInstanceId: 'instance:main', role: 'main', memoryScope: scope,
    now: () => now, port: {
      async resolve(request) {
        const binding = { schema_version: '1.0.0', binding_id: source.binding_id, persona_id: source.persona_id, principal: 'principal:fixture', recorded_at: 1000,
          agent_instance_id: 'instance:main', project_id: 'alpha', organization_session_id: 'session:fixture', task_id: request.taskId,
          attempt_id: 'attempt:one', run_id: request.runId, host_id: 'host:one', memory_scope: scope };
        const context = structuredClone(source); change(context, binding, request);
        const selected = { binding, context }; selections.push(selected); return selected;
      },
      async authorizeInput(request) {
        calls.push(request); await authorize(request);
        return { authorized: true, requestId: request.requestId, bindingId: request.binding.binding_id, contextDigest: request.context.digest, inputDigest: request.inputDigest };
      },
    } };
  return { provider: createVeraPersonaProvider(options), options, calls, selections, clock: value => { now = value; } };
}
const request = extra => ({ principal, agentId: 'main', sessionId: 'session:one', runId: 'run:one', taskId: 'task:alpha', signal: new AbortController().signal, ...extra });
async function runtime(t, persona, responses, extra = {}) {
  const f = fauxProvider({ tokensPerSecond: 100000, models: [{ id: 'vera-fixture', contextWindow: 8192, maxTokens: 1024 }] }); f.setResponses(responses);
  const p = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), personaProvider: persona, autoCompaction: false, ...extra });
  t.after(() => p.close()); const { sessionId } = await p.createSession(principal); return { p, sessionId, f };
}

test('Vera closed adapter preserves exact context and external lineage without local ID invention', async () => {
  const fx = fixture(), snapshot = await fx.provider.resolveContext(request());
  assert.equal(snapshot.text, source.text); assert.equal(snapshot.descriptor.informationState, null);
  const binding = snapshot.descriptor.personaBinding;
  assert.equal(binding.contextRevision, source.digest); assert.equal(binding.externalContext.stateRef, source.state_ref);
  assert.equal(binding.externalContext.runId, 'run:one'); assert.equal(binding.externalContext.taskId, 'task:alpha');
  assert.equal(binding.externalContext.modelsDigest, sha256(canonical({ refs: source.model_refs, activations: source.model_activations })));
  assert.equal(fx.calls.length, 0, 'projection alone is not input authorization or receipt');
  assert.equal(Object.isFrozen(snapshot), true);
  await assert.rejects(fx.provider.resolveContext(request({ principal: { id: 'intruder', permissions: [] } })), /PERSONA_SCOPE_DENIED/);
});

test('Vera rejects unsupported wire, tampering, wrong binding, authority, budget and expiry', async () => {
  for (const change of [
    c => { c.schema_version = 'vera-continuity/next'; }, c => { c.text += 'tamper'; },
    (c, b) => { b.run_id = 'run:other'; }, (c, b) => { b.task_id = 'task:other'; },
    (c, b) => { b.principal = 'principal:other'; }, (c, b) => { b.memory_scope = ['project:other']; },
    c => { c.unknown = true; }, c => { c.identity_revision = 1.5; },
    c => { Object.assign(c, sign({ ...c, budget: { ...c.budget, used: 1 } })); },
    c => { Object.assign(c, sign({ ...c, valid_until: 1000 })); },
  ]) await assert.rejects(fixture(change).provider.resolveContext(request()), /VERA_CONTEXT_(INVALID|EXPIRED)/);
});

test('both observed renderers are negotiated explicitly', async () => {
  const fx = fixture(c => {
    c.renderer_version = 'vera-reference-text/1'; c.text = 'Vera continuity reference (vera-continuity/0.2.0)\n' + c.text;
    c.text_digest = sha256(c.text); c.budget.used = Buffer.byteLength(c.text); Object.assign(c, sign(c));
  });
  assert.match((await fx.provider.resolveContext(request())).text, /^Vera continuity reference/);
});

test('actual Pi input receipt follows fresh authorization and pins converted input on every request', async t => {
  const fx = fixture();
  const { p, sessionId, f } = await runtime(t, fx.provider, [answer(call('inspect', {}), { stopReason: 'toolUse' }), context => {
    assert.match(JSON.stringify(context), /Synthetic correction/); return answer('done');
  }], { tools: [{ name: 'inspect', description: 'Synthetic inspection', permission: 'test:read', effect: 'read', parameters: Type.Object({}), execute: async () => ({ inspected: true }) }] });
  const r = await p.run(sessionId, principal, 'inspect', undefined, undefined, { taskId: 'task:separate' });
  assert.equal(r.status, 'completed'); assert.equal(f.state.callCount, 2); assert.equal(fx.calls.length, 2);
  const bundle = p.exportRun(sessionId, r.runId, principal);
  assert.equal(bundle.manifest.task_id, 'task:separate');
  assert.equal(fx.calls[0].binding.task_id, 'task:separate');
  assert.equal(validateObservationBundle(bundle).valid, true);
  const receipts = bundle.events.filter(e => e.activity === 'context_input_included');
  assert.equal(receipts.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(receipts[i].payload.input_digest, fx.calls[i].inputDigest);
    assert.equal(receipts[i].payload.authorization, 'current-provider-check');
    assert.equal(receipts[i].payload.fingerprint_scope, receipts[i].source_id);
  }
  assert.notEqual(receipts[0].payload.input_digest, receipts[1].payload.input_digest);
  assert.doesNotMatch(JSON.stringify(bundle), /Synthetic correction/);
  const bad = structuredClone(bundle), event = bad.events.find(e => e.activity === 'context_input_included');
  event.payload.fingerprint_scope = 'different-source'; event.payload_digest = sha256(canonical(event.payload));
  assert.ok(validateObservationBundle(bad).issues.includes('CONTEXT_INPUT_BINDING_INVALID'));
  const reordered = structuredClone(bundle), receiptIndex = reordered.events.findIndex(e => e.activity === 'context_input_included');
  [reordered.events[receiptIndex - 1], reordered.events[receiptIndex]] = [reordered.events[receiptIndex], reordered.events[receiptIndex - 1]];
  reordered.events.forEach((e, i) => { e.sequence_number = i + 1; });
  assert.ok(validateObservationBundle(reordered).issues.includes('CONTEXT_RECEIPT_INVALID'));
});

test('revocation between tool turns blocks next provider call without a false inclusion receipt', async t => {
  let revoked = false;
  const fx = fixture(() => {}, async () => { if (revoked) throw new Error('private grant revoked'); });
  const { p, sessionId, f } = await runtime(t, fx.provider, [answer(call('revoke', {}), { stopReason: 'toolUse' }), answer('must not dispatch')],
    { tools: [{ name: 'revoke', description: 'Synthetic revoke trigger', permission: 'test:read', effect: 'read', parameters: Type.Object({}), execute: async () => { revoked = true; return {}; } }] });
  const r = await p.run(sessionId, principal, 'test revocation');
  assert.equal(r.status, 'failed'); assert.equal(r.code, 'PERSONA_INPUT_NOT_AUTHORIZED'); assert.equal(f.state.callCount, 1);
  const b = p.exportRun(sessionId, r.runId, principal);
  assert.equal(b.events.filter(e => e.activity === 'context_input_included').length, 1);
  assert.equal(b.events.filter(e => e.activity === 'context_input_rejected').length, 1);
  assert.doesNotMatch(JSON.stringify(b), /private grant revoked/);
});

test('expired context, mismatched authorization ack and cancellation never dispatch', async t => {
  for (const mode of ['expired', 'expire-after-check', 'ack', 'cancel']) {
    const stop = new AbortController(), fx = fixture();
    const port = fx.options.port, resolve = port.resolve, authorize = port.authorizeInput;
    if (mode === 'expired') port.resolve = async r => { const value = await resolve(r); fx.clock(1300); return value; };
    if (mode === 'expire-after-check') port.authorizeInput = async r => { const value = await authorize(r); fx.clock(1300); return value; };
    if (mode === 'ack') port.authorizeInput = async r => ({ ...await authorize(r), requestId: 'wrong' });
    if (mode === 'cancel') port.authorizeInput = async r => { const value = await authorize(r); stop.abort(); return value; };
    const { p, sessionId, f } = await runtime(t, fx.provider, [answer('must not dispatch')]);
    const r = await p.run(sessionId, principal, 'blocked input', undefined, stop.signal);
    assert.notEqual(r.status, 'completed'); assert.equal(f.state.callCount, 0);
    assert.equal(p.exportRun(sessionId, r.runId, principal).events.some(e => e.activity === 'context_input_included'), false);
  }
});

test('required input receipt failure stops dispatch; restart preserves accepted receipt IDs', async t => {
  const fx = fixture();
  const blocked = await runtime(t, fx.provider, [answer('must not dispatch')], { maxObservationEvents: 2 });
  const stopped = await blocked.p.run(blocked.sessionId, principal, 'receipt unavailable');
  assert.equal(stopped.code, 'PERSONA_INPUT_RECEIPT_UNAVAILABLE'); assert.equal(blocked.f.state.callCount, 0);
  const dir = await mkdtemp(join(tmpdir(), 'pida-vera-receipt-')); t.after(() => rm(dir, { force: true, recursive: true }));
  const ready = await runtime(t, fx.provider, [answer('done')], { storageDir: dir });
  const r = await ready.p.run(ready.sessionId, principal, 'persist receipt'); assert.equal(r.status, 'completed');
  const b = ready.p.exportRun(ready.sessionId, r.runId, principal); await ready.p.close();
  const restored = new PidaRuntime({ storageDir: dir }); t.after(() => restored.close());
  assert.deepEqual(restored.exportRun(ready.sessionId, r.runId, principal), b);
});

test('manual compaction uses a fresh binding and authorization without claiming execution inclusion', async t => {
  const fx = fixture(), { p, sessionId, f } = await runtime(t, fx.provider, [answer('First task complete.'), answer('Summary of requirements and pending work.')]);
  const first = await p.run(sessionId, principal, 'Requirement: ' + 'synthetic detail '.repeat(500));
  assert.equal(first.status, 'completed');
  const compacted = await p.compactSession(sessionId, principal);
  assert.equal(compacted.compacted, true); assert.equal(f.state.callCount, 2); assert.equal(fx.calls.length, 2);
  assert.notEqual(fx.calls[0].runId, fx.calls[1].runId);
  const operation = p.listRuns(sessionId, principal).find(id => id !== first.runId);
  const b = p.exportRun(sessionId, operation, principal);
  assert.equal(b.events.filter(e => e.activity === 'context_summary_authorized').length, 1);
  assert.equal(JSON.parse(b.events.find(e => e.activity === 'context_summary_authorized').payload.descriptor).personaBinding.externalContext.runId, operation);
  assert.equal(b.events.filter(e => e.activity === 'context_input_included').length, 0);
  assert.equal(validateObservationBundle(b).valid, true);
});

test('provider retries reauthorize the same selected context with a fresh request ID', async t => {
  const fx = fixture(), { p, sessionId, f } = await runtime(t, fx.provider,
    [answer('', { stopReason: 'error', errorMessage: '503 temporary fixture failure' }), answer('recovered')],
    { maxProviderRetries: 1, retryBaseDelayMs: 0, retryMaxDelayMs: 0 });
  const result = await p.run(sessionId, principal, 'retry read-only provider failure');
  assert.equal(result.status, 'completed'); assert.equal(f.state.callCount, 2); assert.equal(fx.calls.length, 2);
  assert.equal(fx.selections.length, 1); assert.notEqual(fx.calls[0].requestId, fx.calls[1].requestId);
  assert.equal(fx.calls[0].context.digest, fx.calls[1].context.digest);
  assert.equal(validateObservationBundle(p.exportRun(sessionId, result.runId, principal)).valid, true);
});

test('authorization failure prevents internal summary dispatch too', async t => {
  let revoked = false;
  const fx = fixture(() => {}, async () => { if (revoked) throw new Error('revoked'); });
  const { p, sessionId, f } = await runtime(t, fx.provider, [answer('done'), answer('must not summarize')]);
  await p.run(sessionId, principal, 'Requirement: ' + 'detail '.repeat(1000)); revoked = true;
  await assert.rejects(p.compactSession(sessionId, principal), /PERSONA_INPUT_NOT_AUTHORIZED/);
  assert.equal(f.state.callCount, 1);
});

test('a new run projects its selected Persona text without re-sending the prior custom snapshot', async t => {
  let generation = 0;
  const fx = fixture(c => {
    if (++generation > 1) { c.text = c.text.replaceAll('Synthetic correction', 'UPDATED correction'); c.text_digest = sha256(c.text); c.budget.used = Buffer.byteLength(c.text); Object.assign(c, sign(c)); }
  });
  const { p, sessionId } = await runtime(t, fx.provider, [answer('first'), context => {
    assert.match(JSON.stringify(context), /UPDATED correction/); assert.doesNotMatch(JSON.stringify(context), /Synthetic correction/); return answer('second');
  }]);
  await p.run(sessionId, principal, 'first');
  assert.equal((await p.run(sessionId, principal, 'second')).status, 'completed');
});
