import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PidaRuntime, mockProvider, lotStatusTool } from '../dist/index.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { PidaClient } from '../dist/client.js';
import { exportOcel } from '../dist/ocel.js';
import { canonical, sha256 } from '../dist/private-state.js';
import { ProcessIntelligence } from '../dist/process-intelligence.js';
import { owner as piOwner, runtimeFixture } from './fixtures/pi-snapshots.mjs';
import { codingPacks } from '../dist/coding-packs.js';
import { PidaWorkbench, workbenchPermissions } from '../dist/index.js';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { resolveComposition } from '../dist/composition.js';

test('native Pi turns materialize standard OCEL, preserve IDs through restart, and retain HTTP ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ocel-'));
  const owner = { id: 'alice', permissions: ['lots:read'] };
  const options = { storageDir: root, provider: mockProvider, tools: [lotStatusTool] };
  let runtime = new PidaRuntime(options), server;
  t.after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const { sessionId } = await runtime.createSession(owner), checkpoints = [];
  const run = await runtime.run(sessionId, owner, 'LOT-001 PRIVATE_PROMPT', event => {
    if (event.type === 'trace' && event.trace.type === 'turn_finished') checkpoints.push(readFile(join(root, 'observations', sessionId, event.trace.runId + '.ocel.json'), 'utf8'));
  });
  assert.equal(run.status, 'completed');
  assert.equal(checkpoints.length, 2);
  for (const cut of await Promise.all(checkpoints)) assert.ok(JSON.parse(cut).events.some(e => e.type === 'turn_finished'));
  const bundle = runtime.exportRun(sessionId, run.runId, owner), result = runtime.exportRunOcel(sessionId, run.runId, owner);
  assert.equal(result.complete, true); assert.equal(result.sourceDigest, sha256(canonical(bundle)));
  assert.equal(result.digest, sha256(canonical(result.document)));
  assert.deepEqual(Object.keys(result.document).sort(), ['eventTypes', 'events', 'objectTypes', 'objects']);
  assert.equal(result.document.objects.filter(o => o.type === 'Turn').length, 2);
  const ids = new Set(result.document.objects.map(o => o.id));
  for (const entity of [...result.document.events, ...result.document.objects]) for (const relation of entity.relationships) assert.ok(ids.has(relation.objectId));
  for (const turn of result.document.objects.filter(o => o.type === 'Turn')) {
    assert.equal(result.document.events.filter(e => e.type === 'turn_started' && e.relationships.some(r => r.objectId === turn.id)).length, 1);
    assert.equal(result.document.events.filter(e => e.type === 'turn_finished' && e.relationships.some(r => r.objectId === turn.id)).length, 1);
  }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROMPT|LOT-001/);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'observations', sessionId, run.runId + '.ocel.json'), 'utf8')), result.document);
  await runtime.close(); runtime = new PidaRuntime(options);
  assert.deepEqual(runtime.exportRunOcel(sessionId, run.runId, owner), result);
  const token = 'a'.repeat(40), otherToken = 'b'.repeat(40);
  server = createPidaServer({ runtime, authenticate: staticTokenAuth([{ token, principal: owner }, { token: otherToken, principal: { ...owner, id: 'bob' } }]) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`, client = new PidaClient({ baseUrl, token: () => token });
  assert.deepEqual(await client.exportRunOcel(sessionId, run.runId), result);
  const response = await fetch(`${baseUrl}/v1/sessions/${sessionId}/runs/${run.runId}/export?format=ocel`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('X-Pida-Ocel-Digest'), result.digest);
  assert.deepEqual(await response.json(), result.document);
  await assert.rejects(new PidaClient({ baseUrl, token: () => otherToken }).exportRunOcel(sessionId, run.runId), { code: 'SESSION_NOT_FOUND' });
  const duplicate = structuredClone(bundle); duplicate.events.splice(1, 0, duplicate.events[0]);
  assert.equal(exportOcel(duplicate).document.events.length, bundle.events.length);
  const forged = structuredClone(bundle); forged.events[0].payload.prompt = 'PRIVATE';
  assert.throws(() => exportOcel(forged), /OCEL_SOURCE_INVALID/);
});

test('PIX skill is bundled; absent engine stays unavailable with durable evidence and scoped access', async t => {
  assert.ok(codingPacks().skills.some(s => s.name === 'pix-process-verification'));
  assert.deepEqual(resolveComposition({ preset: 'headless' }, 'agent').codingPacks, ['pix']);
  assert.deepEqual(resolveComposition({ preset: 'headless', codingPacks: [] }, 'agent').codingPacks, []);
  const guide = await codingPacks().tools[0].execute({ id: 'pix' }); assert.match(guide.guidance, /pi_verify_run/);
  const root = await mkdtemp(join(tmpdir(), 'pida-ocel-service-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = runtimeFixture(root), ref = journal.ref(journal.add());
  const options = { directory: join(root, 'results'), agentId: journal.agentId, runtime: () => journal.runtime, maxCallsPerRun: 1 };
  const service = new ProcessIntelligence(options), context = { principal: piOwner, sessionId: 'fixture-session', runId: 'fixture-run', signal: new AbortController().signal };
  const result = await service.verifyOcel(piOwner, ref, context);
  assert.equal(result.native.status, 'unavailable'); assert.equal(result.native.processJudgment, 'unknown');
  assert.equal(result.native.structure, 'UNKNOWN'); assert.equal(result.artifactVerification, 'UNKNOWN');
  assert.deepEqual(result.native.issues, ['PIX_NOT_CONFIGURED']); assert.ok(result.resultRef);
  assert.deepEqual(new ProcessIntelligence(options).readOcelVerification(piOwner, result.resultRef), result);
  await assert.rejects(service.verifyOcel(piOwner, ref, context), { code: 'PI_CALL_BUDGET' });
  await assert.rejects(service.verifyOcel({ ...piOwner, permissions: [] }, ref), { code: 'FORBIDDEN' });
  assert.throws(() => service.readOcelVerification({ ...piOwner, id: 'other' }, result.resultRef), { code: 'PI_ARTIFACT_NOT_FOUND' });
  journal.revoke(ref);
  assert.throws(() => service.readOcelVerification(piOwner, result.resultRef), { code: 'SESSION_NOT_FOUND' });
});

test('actual workbench verification relates to tested artifact versions and stays stale after a later edit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ocel-artifact-'));
  const owner = { id: 'alice', permissions: workbenchPermissions }, area = new PidaWorkbench(join(root, 'files'));
  const f = fauxProvider({ tokensPerSecond: 100000 });
  const tool = (name, args) => answer(call(name, args), { stopReason: 'toolUse' });
  f.setResponses([
    tool('workspace_write', { path: 'value.txt', content: '1' }),
    tool('workspace_write', { path: 'check.js', content: 'assert(pida.readText("value.txt") === "1", "expected one");' }),
    tool('workspace_test', { path: 'check.js' }),
    tool('workspace_write', { path: 'value.txt', content: '2' }), answer('Model claims done.'),
  ]);
  const runtime = new PidaRuntime({ storageDir: join(root, 'runtime'), provider: () => ({ provider: f.provider, modelId: f.getModel().id }),
    tools: area.tools(), inspectArtifacts: p => area.captureArtifacts(p) });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const { sessionId } = await runtime.createSession(owner), run = await runtime.run(sessionId, owner, 'write, test, edit');
  assert.equal(run.status, 'completed');
  const bundle = runtime.exportRun(sessionId, run.runId, owner), cut = runtime.exportRunOcel(sessionId, run.runId, owner);
  assert.equal(bundle.manifest.verification_results[0].status, 'PASSED');
  assert.equal(bundle.manifest.verification_results[0].current_at_run_end, false);
  const check = cut.document.objects.find(o => o.type === 'Verification');
  assert.ok(check); assert.equal(check.attributes.find(a => a.name === 'current_at_run_end').value, false);
  assert.equal(check.attributes.find(a => a.name === 'current_at_run_end').time, bundle.events.at(-1).occurred_at);
  const artifact = cut.document.objects.find(o => o.type === 'Artifact' && o.attributes.some(a => a.name === 'path' && a.value === 'value.txt'));
  const versions = cut.document.objects.filter(o => o.type === 'ArtifactVersion' && o.relationships.some(r => r.objectId === artifact.id && r.qualifier === 'version_of'));
  assert.equal(versions.length, 2);
  const checked = versions.filter(v => check.relationships.some(r => r.objectId === v.id && r.qualifier === 'checks'));
  assert.equal(checked.length, 1); assert.equal(checked[0].attributes.find(a => a.name === 'sha256').value, sha256('1'));
});
