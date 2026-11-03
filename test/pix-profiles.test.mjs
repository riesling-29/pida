import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessProfileAnalysis } from '../dist/process-profiles.js';
import { PidaError } from '../dist/runtime.js';
import { validPixProfileRequest, pixProfileBuild } from '../dist/pix-profiles.js';
import { validatePersonaSnapshot } from '../dist/persona-provider.js';
import { sequential, objects, selection } from './fixtures/pix-profiles/helpers.mjs';
const owner = { id: 'owner', permissions: ['pi:read', 'pi:analyze'] };
const refs = { cutRef: 'cut:fixture', modelRef: 'model:fixture' };
async function service(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-profile-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let current = selection();
  const source = { async resolve() { return structuredClone(current); }, async list() { return [refs]; } };
  const config = { directory, agentId: 'main', source, enginePin: pixProfileBuild, ...options };
  return { directory, config, get current() { return current; }, set current(v) { current = v; }, service: new ProcessProfileAnalysis(config) };
}
test('profile contracts preserve source sequence, native models, explicit closure and object participation', () => {
  assert.ok(validPixProfileRequest(sequential())); assert.ok(validPixProfileRequest(objects()));
  for (const change of [r => r.sequential.events[1].sequence++, r => r.sequential.events[1].id = r.sequential.events[0].id,
    r => r.sequential.closeId = 'invented', r => r.sequential.events[0].time = '2026-01-01', r => r.model = { activities: ['request'] },
    r => r.authority = 'invented', r => r.proxyPaths = [], r => r.limits = { maxStates: 10001 }]) {
    const r = sequential(); change(r); assert.equal(validPixProfileRequest(r), false);
  }
  for (const change of [r => r.objects.events[1].time = 'unknown', r => r.objects.events[0].relations[0].objectId = 'foreign',
    r => r.objects.events.push(r.objects.events[0]), r => r.objects.tiePolicy = 'event_id', r => r.resume = {}]) {
    const r = objects(); change(r); assert.equal(validPixProfileRequest(r), false);
  }
});
test('host selection requires principal, agent, provenance and exact coverage; compute does not create grants', async t => {
  const f = await service(t);
  await assert.rejects(f.service.analyze({ ...owner, permissions: [] }, refs), { code: 'FORBIDDEN' });
  const original = structuredClone(f.current);
  for (const mutate of [s => s.ownerId = 'foreign', s => s.agentId = 'foreign', s => s.coverage.sourceEventCount++,
    s => s.coverage.exclusions = [{ eventId: s.sequential.events[0].id, reason: 'excluded' }], s => s.coverage.ordering = 'selected-object-point-time']) {
    f.current = structuredClone(original); mutate(f.current);
    await assert.rejects(f.service.analyze(owner, refs), e => ['PI_PROFILE_SCOPE_MISMATCH','PI_PROFILE_COVERAGE_INVALID'].includes(e.code));
  }
  assert.deepEqual(await readdir(f.directory), []);
});
test('immutable analysis survives restart; changed source is stale and denied access hides historical evidence', async t => {
  const f = await service(t), r = await f.service.analyze(owner, refs);
  assert.equal(r.status, 'unavailable'); assert.deepEqual(r.issues, ['PIX_PROFILE_NOT_CONFIGURED']); assert.equal(r.businessAcceptance, 'UNKNOWN');
  const restored = new ProcessProfileAnalysis(f.config);
  assert.equal((await restored.read(owner, r.resultRef)).applicability, 'CURRENT');
  f.current.policyRevision = 'f'.repeat(64);
  assert.equal((await restored.read(owner, r.resultRef)).applicability, 'STALE');
  f.current.ownerId = 'revoked';
  await assert.rejects(restored.read(owner, r.resultRef), { code: 'PI_PROFILE_SCOPE_MISMATCH' });
  await assert.rejects(restored.read({ ...owner, id: 'other' }, r.resultRef), { code: 'PI_PROFILE_RESULT_NOT_FOUND' });
});
test('source mutation, revoke, cancellation and self-reference prevent publishing an applicable result', async t => {
  const f = await service(t);
  let calls = 0;
  const source = { async resolve() { calls++; const s = structuredClone(f.current); if (calls > 1) s.cutRevision = 'e'.repeat(64); return s; } };
  await assert.rejects(new ProcessProfileAnalysis({ ...f.config, source }).analyze(owner, refs), { code: 'PI_STALE_CUT' });
  const revoked = new ProcessProfileAnalysis({ ...f.config, source: { async resolve() { throw new PidaError('FORBIDDEN', 403); } } });
  await assert.rejects(revoked.analyze(owner, refs), { code: 'FORBIDDEN' });
  const controller = new AbortController(); controller.abort();
  const context = { principal: owner, sessionId: 'session', runId: 'run', signal: controller.signal };
  await assert.rejects(f.service.analyze(owner, refs, context), { name: 'AbortError' });
  f.current.sourceRun = { sessionId: 'session', runId: 'run' };
  await assert.rejects(f.service.analyze(owner, refs, { ...context, signal: new AbortController().signal }), { code: 'PI_ANALYSIS_SELF_REFERENCE' });
  assert.deepEqual(await readdir(f.directory), []);
});
test('optional append stays unavailable and current Pida accepts the new Site formatter without treating it as authority', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/vera-site/pida-fixture.json', import.meta.url), 'utf8'));
  const b = fixture.descriptor.personaBinding;
  const provider = { id: b.providerId, agentId: b.agentId, authority: 'external', resolveContext: () => fixture };
  validatePersonaSnapshot(fixture, provider);
  assert.equal(provider.appendAnalysis, undefined); assert.equal(provider.authorizeInput, undefined);
  assert.equal(b.providerId, 'vera-sites/2'); assert.equal(b.personaId, 'vera-site');
  assert.throws(() => validatePersonaSnapshot({ ...fixture, text: fixture.text + 'changed' }, provider), { code: 'PERSONA_CONTEXT_INVALID' });
  assert.throws(() => validatePersonaSnapshot(fixture, { ...provider, agentId: 'foreign' }), { code: 'PERSONA_CONTEXT_INVALID' });
});
