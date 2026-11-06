import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProcessIntelligence } from '../dist/process-intelligence.js';
import { owner, runtimeFixture, contractPort, enginePin, fixtureEngine } from './fixtures/pi-snapshots.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-pi-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = runtimeFixture(directory), stub = contractPort(options.portOptions);
  const settings = { directory: join(directory, 'analysis'), agentId: journal.agentId, runtime: () => journal.runtime,
    port: stub.port, enginePin, ...options };
  delete settings.portOptions;
  const service = new ProcessIntelligence(settings);
  return { directory, journal, stub, settings, service, add: o => journal.ref(journal.add(o)) };
}
const context = (principal = owner) => ({ principal, sessionId: randomUUID(), runId: randomUUID(), signal: new AbortController().signal });
const code = expected => error => error.code === expected;

test('PI host contract: failures and excluded snapshots stay in selected denominator; restart reuses exact result', async t => {
  const f = await fixture(t);
  const refs = [f.add(), f.add(), f.add({ tools: ['edit', 'check'] }), f.add({ tools: ['edit'], toolFailure: true, status: 'failed' }), f.add({ incomplete: true })];
  const result = await f.service.reflect(owner, refs, 0.9);
  assert.equal(result.status, 'partial'); assert.equal(result.businessAcceptance, 'UNKNOWN');
  assert.deepEqual({ selected: result.coverage.selectedCases, included: result.coverage.includedCases, excluded: result.coverage.excludedCases }, { selected: 5, included: 4, excluded: 1 });
  assert.equal(result.coverage.failedCases, 1);
  assert.equal(result.coverage.outcomeCounts.unknown, 1, 'unfinished observation is not fabricated failure');
  assert.equal(result.coverage.observationCoverage, 0.8);
  assert.deepEqual(result.variants.map(v => v.frequency), [2, 1, 1]);
  assert.equal(result.variants[0].proportion, 2 / 5); assert.equal(result.selectedCaseCoverage, 4 / 5);
  assert.ok(result.limits.includes('TARGET_COVERAGE_UNREACHABLE_WITH_EXCLUSIONS'));
  assert.equal(result.native.nativeResults[0].profile, 'contract-only');
  assert.equal(result.empiricalDeviationIsViolation, false); assert.equal(result.automaticCorrection, false);
  const restarted = new ProcessIntelligence(f.settings);
  assert.deepEqual(await restarted.reflect(owner, refs, 0.9), result); assert.equal(f.stub.calls.length, 1);
  const files = await readdir(f.settings.directory);
  assert.equal(files.filter(p => p.startsWith('model-')).length, 1);
  assert.equal(files.filter(p => p.startsWith('result-')).length, 1);
  assert.equal(files.filter(p => p.startsWith('request-')).length, 1);
  assert.deepEqual(restarted.read(owner, result.resultRef), result);
});

test('PI host contract: absent PIX stays unavailable and source access stays principal scoped', async t => {
  const f = await fixture(t, { port: undefined }), own = f.add(), other = f.add({ owner: 'another-owner' });
  const result = await f.service.reflect(owner, [own]);
  assert.equal(result.status, 'unavailable'); assert.equal(result.processJudgment, 'unknown');
  assert.deepEqual(result.issues, ['PIX_NOT_CONFIGURED']); assert.equal(result.native, undefined); assert.equal(result.resultRef, undefined);
  assert.equal(f.service.history(owner).items.length, 1);
  await assert.rejects(f.service.reflect(owner, [other]), code('SESSION_NOT_FOUND'));
  await assert.rejects(f.service.reflect({ ...owner, permissions: [] }, [own]), code('FORBIDDEN'));
});

test('PI host contract: cohort selection separates role, model, toolset, persona and agent', async t => {
  const f = await fixture(t), baseline = f.add();
  for (const options of [{ role: 'reviewer' }, { model: 'other-model' }, { toolset: '9'.repeat(64) }, { personaId: 'other-persona' }, { agentId: 'other-agent' }]) {
    const result = await f.service.reflect(owner, [baseline, f.add(options)]);
    assert.equal(result.status, 'unsupported', JSON.stringify(options));
    assert.ok(result.issues.includes('COHORT_MISMATCH_SELECT_ONE_ROLE_MODEL_TOOLSET'));
  }
  assert.equal(f.stub.calls.length, 0);
});

test('PI host contract: overlap is rejected by run and by task; good empirical deviation is not a mandatory violation', async t => {
  const f = await fixture(t, { portOptions: { cost: 2 } }), train = f.journal.add(), ref = f.journal.ref(train);
  const learned = await f.service.reflect(owner, [ref]);
  const same = await f.service.awareness(owner, [ref], learned.modelRef);
  assert.ok(same.issues.includes('TRAIN_EVALUATION_OVERLAP'));
  const retry = await f.service.awareness(owner, [f.add({ taskId: train.taskId })], learned.modelRef);
  assert.ok(retry.issues.includes('TRAIN_EVALUATION_TASK_OVERLAP'));
  const evaluation = f.add({ tools: ['reproduce', 'edit', 'check'] });
  const empirical = await f.service.awareness(owner, [evaluation], learned.modelRef);
  assert.equal(empirical.processJudgment, 'deviates'); assert.equal(empirical.mandatoryDeviation, undefined);
  assert.equal(empirical.empiricalDeviationIsViolation, false); assert.equal(empirical.automaticCorrection, false);
  const policy = f.service.registerReferenceModel(owner, { model: learned.native.model, kind: 'mandatory', cohortFrom: ref,
    policyRef: 'policy:fixture', policyDigest: 'a'.repeat(64), engine: fixtureEngine });
  const mandatory = await f.service.awareness(owner, [evaluation], policy.ref);
  assert.equal(mandatory.modelKind, 'mandatory'); assert.equal(mandatory.mandatoryDeviation, true);
  assert.equal(mandatory.businessAcceptance, 'UNKNOWN'); assert.equal(mandatory.automaticCorrection, false);
});

test('PI host contract: parallel, nested and analysis-bearing traces are explicitly excluded', async t => {
  const f = await fixture(t);
  for (const [options, reason] of [[{ concurrent: true }, 'CONCURRENT_TOOL_ORDER_UNSUPPORTED'], [{ nested: true }, 'NESTED_TOOL_ORDER_UNSUPPORTED'], [{ tools: ['pi_reflect'] }, 'ANALYSIS_RUN_EXCLUDED_RECURSION']]) {
    const result = await f.service.reflect(owner, [f.add(options)]);
    assert.equal(result.status, 'unavailable'); assert.equal(result.processJudgment, 'unknown');
    assert.ok(result.coverage.exclusions[0].reasons.includes(reason));
  }
  assert.equal(f.stub.calls.length, 0);
});

test('PI host contract: call budget, recursion guard and stale cuts prevent extra computation', async t => {
  const f = await fixture(t, { maxCallsPerRun: 1 }), ref = f.add(), ctx = context();
  await f.service.reflect(owner, [ref], 0.8, ctx);
  await assert.rejects(f.service.reflect(owner, [ref], 0.8, ctx), code('PI_CALL_BUDGET'));
  assert.equal(f.stub.calls.length, 1);
  await assert.rejects(f.service.reflect(owner, [{ ...ref, digest: '0'.repeat(64) }]), code('PI_STALE_CUT'));
  let nested;
  const g = await fixture(t, { portOptions: { compute: async () => {
    nested = g.service.reflect(owner, [gref]); await assert.rejects(nested, code('PI_RECURSION_OR_CONCURRENT_CALL'));
    return { status: 'unavailable', issues: [{ code: 'FIXTURE_UNAVAILABLE' }], limits: [], nativeResults: [] };
  } } }), gref = g.add();
  assert.equal((await g.service.reflect(owner, [gref])).status, 'unavailable');
  assert.equal(g.stub.calls.length, 1);
});

test('PI host contract: edited sources and revoked ownership invalidate cached derived results', async t => {
  const f = await fixture(t), ref = f.add(), result = await f.service.reflect(owner, [ref]);
  f.journal.change(ref, bundle => bundle.manifest.known_limits.push('SOURCE_CHANGED'));
  assert.throws(() => f.service.read(owner, result.resultRef), code('PI_STALE_CUT'));
  f.journal.change(ref, () => {}); f.journal.revoke(ref);
  assert.throws(() => f.service.read(owner, result.resultRef), code('SESSION_NOT_FOUND'));
  assert.throws(() => f.service.read({ ...owner, id: 'another-owner' }, result.resultRef), code('PI_ARTIFACT_NOT_FOUND'));
});

test('PI host contract: changed model artifact is rejected when reading its cached result', async t => {
  const f = await fixture(t), ref = f.add(), result = await f.service.reflect(owner, [ref]);
  const path = join(f.settings.directory, result.modelRef.replace('pi-model:', 'model-') + '.json');
  const model = JSON.parse(await readFile(path, 'utf8')); model.value.model.activities.push('tampered'); await writeFile(path, JSON.stringify(model));
  assert.throws(() => f.service.read(owner, result.resultRef), code('PI_ARTIFACT_DIGEST_MISMATCH'));
});

test('PI host contract: request cache cannot substitute another valid same-owner result', async t => {
  const f = await fixture(t), a = f.add(), first = await f.service.reflect(owner, [a]);
  const requestA = (await readdir(f.settings.directory)).find(name => name.startsWith('request-'));
  const b = f.add({ tools: ['check'] }), second = await f.service.reflect(owner, [b]);
  assert.notEqual(second.resultRef, first.resultRef);
  await writeFile(join(f.settings.directory, requestA), JSON.stringify({ resultRef: second.resultRef }));
  await assert.rejects(f.service.reflect(owner, [a]), code('PI_CACHE_REQUEST_MISMATCH'));
});

test('PI host contract: incomplete native computation never becomes positive conformance', async t => {
  const f = await fixture(t, { portOptions: { partial: true } }), model = await f.service.reflect(owner, [f.add()]);
  const result = await f.service.awareness(owner, [f.add()], model.modelRef);
  assert.equal(result.status, 'partial'); assert.equal(result.processJudgment, 'unknown'); assert.equal(result.mandatoryDeviation, undefined);
});

test('PI host contract: persisted evidence is bounded before a custom port can create unreadable artifacts', async t => {
  const normal = contractPort();
  const f = await fixture(t, { portOptions: { compute: async request => {
    const result = await normal.port.compute(request);
    result.nativeResults.push({ profile: 'contract-only', oversized: 'x'.repeat(9 * 1024 * 1024) });
    return result;
  } } });
  await assert.rejects(f.service.reflect(owner, [f.add()]), code('PI_ARTIFACT_SIZE_LIMIT'));
  assert.equal((await readdir(f.settings.directory)).filter(file => file.startsWith('result-')).length, 0);
});

test('PI host contract: variant membership cannot substitute cases while retaining the aggregate denominator', async t => {
  for (const mutate of [
    result => { result.variants[0].caseIds[0] = 'unselected-case'; },
    result => { result.variants[0].caseIds[1] = result.variants[0].caseIds[0]; },
    result => { result.variants[0].caseIds.pop(); },
  ]) {
    const normal = contractPort(), f = await fixture(t, { portOptions: { compute: async request => {
      const result = await normal.port.compute(request); mutate(result); return result;
    } } });
    const result = await f.service.reflect(owner, [f.add(), f.add()]);
    assert.equal(result.status, 'unavailable'); assert.equal(result.processJudgment, 'unknown');
    assert.ok(result.issues.includes('PIX_VARIANT_CASE_MISMATCH'));
    assert.equal(result.modelRef, undefined); assert.equal(result.resultRef, undefined);
    assert.equal((await readdir(f.settings.directory)).length, 0);
  }
});
