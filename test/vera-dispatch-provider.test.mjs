import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVeraDispatchPersonaProvider, validVeraDispatchDescription, veraDispatchCapabilities } from '../dist/vera-dispatch-provider.js';
import { canonical, sha256 } from '../dist/private-state.js';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/vera-dispatch/public-fixture.json', import.meta.url), 'utf8'));
const owner = { id: 'owner', permissions: [] };
const request = { principal: owner, agentId: 'main', sessionId: 'session:one', runId: 'run:manifest', taskId: 'task:manifest', signal: new AbortController().signal };
function options(description = () => fixture.description, select = () => fixture.selection) {
  return { protocol: 'vera-dispatch/0.1.0', requiredCapabilities: [...veraDispatchCapabilities], agentId: 'main', principalId: 'owner', providerPrincipal: 'principal:fixture', personaId: 'persona:synthetic-vera',
    hostId: 'host:one', projectId: 'alpha', organizationSessionId: 'session:fixture', agentInstanceId: 'instance:main', role: 'main', memoryScope: fixture.selection.binding.memory_scope, now: () => 1000,
    port: { describe: async () => structuredClone(description()), resolve: async r => { assert.equal(r.protocol, 'vera-dispatch/0.1.0'); return structuredClone(select()); },
      authorizeInput: async r => ({ authorized: true, requestId: r.requestId, bindingId: r.binding.binding_id, contextDigest: r.context.digest, inputDigest: r.inputDigest }) } };
}
test('explicit limited profile produces distinct observation identity and exact dispatch authorization', async () => {
  const p = createVeraDispatchPersonaProvider(options()), snapshot = await p.resolveContext(request);
  assert.equal(p.id, 'pida.vera-dispatch/0.1.0'); assert.equal(snapshot.descriptor.personaBinding.providerId, p.id);
  assert.equal(snapshot.text, fixture.selection.context.text);
  assert.equal(Object.isFrozen(snapshot.descriptor.personaBinding), true);
  await p.authorizeInput({ ...request, snapshot, requestId: 'request:one', attempt: 1, inputDigest: 'a'.repeat(64), fingerprintScope: 'synthetic', modelId: 'fake', api: 'openai-completions' });
});
test('unknown protocol, unsupported required capability and missing explicit capability list fail before transport', () => {
  for (const delta of [{ protocol: 'vera-continuity/0.2.0' }, { requiredCapabilities: ['working-graph'] }, { requiredCapabilities: undefined }, { requiredCapabilities: [] }])
    assert.throws(() => createVeraDispatchPersonaProvider({ ...options(), ...delta }), { code: 'VERA_DISPATCH_PROFILE_UNSUPPORTED' });
});
test('unknown description semantics and stale policy are not silently interpreted as the .2 wire contract', async () => {
  for (const delta of [{ protocol: 'other' }, { stalePolicy: 'cached' }, { capabilities: [...veraDispatchCapabilities, 'working-graph'] }, { unsupported: [] }, { unexpected: true }]) {
    assert.equal(validVeraDispatchDescription({ ...fixture.description, ...delta }), false);
    let resolved = false; const o = options(() => ({ ...fixture.description, ...delta })); o.port.resolve = async () => { resolved = true; return fixture.selection; };
    await assert.rejects(createVeraDispatchPersonaProvider(o).resolveContext(request), { code: 'VERA_DISPATCH_PROFILE_UNSUPPORTED' }); assert.equal(resolved, false);
  }
});
test('wire-shaped contexts cannot smuggle unsupported graph/model semantics into opted-in subset', async () => {
  for (const change of [s => { s.protocol = 'other'; }, s => { s.context.branch = 'branch:other'; }, s => { s.context.model_refs = ['model:one']; }, s => { s.context.artifact_refs = ['artifact:one']; }, s => { const rendered = JSON.parse(s.context.text); delete rendered.producer_profile; s.context.text = canonical(rendered); s.context.text_digest = sha256(s.context.text); }]) {
    const selected = structuredClone(fixture.selection); change(selected);
    await assert.rejects(createVeraDispatchPersonaProvider(options(undefined, () => selected)).resolveContext(request), { code: 'VERA_DISPATCH_PROFILE_UNSUPPORTED' });
  }
});
test('changed producer description blocks a subsequent dispatch before calling authorizeInput', async () => {
  let changed = false, called = 0; const o = options(() => changed ? { ...fixture.description, stalePolicy: 'cached' } : fixture.description);
  o.port.authorizeInput = async () => { called++; throw Error('must not authorize'); };
  const p = createVeraDispatchPersonaProvider(o), snapshot = await p.resolveContext(request); changed = true;
  await assert.rejects(p.authorizeInput({ ...request, snapshot, requestId: 'r', inputDigest: 'a'.repeat(64) }), { code: 'VERA_DISPATCH_PROFILE_UNSUPPORTED' }); assert.equal(called, 0);
});
