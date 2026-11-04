import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { initWorkspace, readConfig, createWorkspace, workspaceEnvironment } from '../dist/workspace.js';
import { PidaClient } from '../dist/client.js';
import { compositionRevision } from '../dist/composition.js';

const principal = permissions => ({ id: 'local-user', permissions });
const digest = value => createHash('sha256').update(value).digest('hex');
// Explicitly synthetic context: this exercises Pida routing, not a deployed Persona service.
function namedPersonaSource(overrides = {}) {
  return { id: 'persona-fixture', label: 'Persona fixture', principalIds: ['local-user'], create(host) {
    const text = JSON.stringify({ marker: 'EXTERNAL_ONLY', agentId: host.agentId });
    return { id: 'mixed-contract-fixture/1', agentId: host.agentId, authority: 'external', resolveContext(req) {
      assert.equal(req.principal.id, host.principal.id); assert.equal(req.agentId, host.agentId);
      return { text, descriptor: { schemaVersion: 1, rendererVersion: 'mixed-fixture/1', personaRevision: 1,
        informationState: null, experiences: [], truncated: false, personaBinding: {
          schemaVersion: 1, providerId: 'mixed-contract-fixture/1', personaId: 'fixture:persona', authority: 'external', agentId: host.agentId,
          role: host.role, scopeId: digest(host.workspaceId + ':' + host.principal.id), contextRevision: digest('fixture-revision-1'),
          contextDigest: digest(text), rendererVersion: 'mixed-fixture/1', omitted: false,
        } } };
    } };
  }, ...overrides };
}
async function until(check) {
  for (let i = 0; i < 400; i++) { const value = await check(); if (value) return value; await delay(10); }
  assert.fail('workspace did not reach expected state');
}
const finishedJob = (client, agent, job) => until(async () => {
  const value = await client.getAgentJob(agent.id, job.id);
  return !['queued', 'running'].includes(value.status) && value;
});
const root = fileURLToPath(new URL('../', import.meta.url));
async function workspace(t, patch = {}, options = {}) {
  const directory = await mkdtemp(join(root, '.pida-test-persona-'));
  let app;
  const close = async () => {
    if (app) {
      await app.close();
      if (app.server.listening) {
        app.server.closeAllConnections();
        await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
      }
    }
  };
  t.after(async () => {
    await close();
    await rm(directory, { force: true, recursive: true });
  });
  initWorkspace(directory);
  const config = { ...readConfig(directory), preset: 'personal', workbench: { enabled: false }, codingPacks: [], permissions: ['lots:read'], ...patch };
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  app = await createWorkspace(directory, options);
  const start = async () => {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    return new PidaClient({ baseUrl: `http://127.0.0.1:${app.server.address().port}`, token: () => workspaceEnvironment(directory).PIDA_API_TOKEN });
  };
  return { get app() { return app; }, config, directory, start,
    async restart(nextOptions = options) { await close(); app = await createWorkspace(directory, nextOptions); return app; } };
}
function configure(runtime, responses) {
  const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(responses);
  runtime.configureProvider(() => ({ provider: f.provider, modelId: f.getModel().id }), { mode: 'protocol-fixture', model: 'faux' });
  return f;
}

test('local and named Persona workers run concurrently without sharing memory authority', async t => {
  const { app, start } = await workspace(t, {}, { personaSources: [namedPersonaSource()] });
  const client = await start(), p = principal(['lots:read']);
  const catalogue = (await client.listAgents()).personaSources;
  assert.equal(catalogue.defaultSourceId, 'local');
  assert.deepEqual(catalogue.sources.map(s => s.id), ['local', 'persona-fixture']);
  assert.equal(JSON.stringify(catalogue).includes('principalIds'), false);
  const local = await client.createAgent({ name: 'ordinary', persona: 'LOCAL_ONLY' });
  const external = await client.createAgent({ name: 'bound', personaSourceId: 'persona-fixture' });
  assert.equal(local.personaSourceId, 'local'); assert.equal(external.personaSourceId, 'persona-fixture');
  const localRuntime = await app.agents.getRuntime(local.id, p), externalRuntime = await app.agents.getRuntime(external.id, p);
  const entered = new Set(), release = Promise.withResolvers();
  for (const [runtime, marker, other] of [[localRuntime, 'LOCAL_ONLY', 'EXTERNAL_ONLY'], [externalRuntime, 'EXTERNAL_ONLY', 'LOCAL_ONLY']]) {
    configure(runtime, [async context => {
      const input = JSON.stringify(context); assert.match(input, new RegExp(marker)); assert.doesNotMatch(input, new RegExp(other));
      entered.add(marker); await release.promise; return answer(marker + ' completed');
    }]);
  }
  let localJob, externalJob;
  try {
    localJob = await client.enqueueAgentJob(local.id, { input: 'local task', requestId: 'local-task' });
    externalJob = await client.enqueueAgentJob(external.id, { input: 'external task', requestId: 'external-task' });
    await until(() => entered.size === 2);
    assert.equal((await client.getAgentJob(local.id, localJob.id)).status, 'running');
    assert.equal((await client.getAgentJob(external.id, externalJob.id)).status, 'running');
    assert.equal((await client.getAgentMemory(local.id)).persona.text, 'LOCAL_ONLY');
    await assert.rejects(client.getAgentMemory(external.id), { code: 'MEMORY_UNAVAILABLE', status: 404 });
    await client.rememberAgentExperience(local.id, { kind: 'fact', text: 'local experience', sourceRefs: ['test:local'] });
    await assert.rejects(client.rememberAgentExperience(external.id, { kind: 'fact', text: 'do not mirror', sourceRefs: ['test:external'] }), { code: 'MEMORY_UNAVAILABLE', status: 404 });
  } finally { release.resolve(); }
  const [a, b] = await Promise.all([finishedJob(client, local, localJob), finishedJob(client, external, externalJob)]);
  assert.equal(a.status, 'completed'); assert.equal(b.status, 'completed'); assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(localRuntime.getSession(a.sessionId, p).contextDescriptor.personaBinding.authority, 'pida-local');
  assert.equal(externalRuntime.getSession(b.sessionId, p).contextDescriptor.personaBinding.authority, 'external');
  const inventory = app.getComposition().active;
  assert.ok(inventory.find(i => i.agentId === local.id).tools.some(t => t.name.startsWith('agent_memory_')));
  assert.ok(inventory.find(i => i.agentId === external.id).tools.every(t => !t.name.startsWith('agent_memory_')));
  assert.equal((await run(app.runtime, p)).result.status, 'completed');
});

test('only host-approved sources can be selected and external identity cannot be overwritten at registration', async t => {
  const { app, start } = await workspace(t, {}, { personaSources: [namedPersonaSource(), namedPersonaSource({ id: 'private-source', principalIds: ['someone-else'] })] });
  const client = await start(), p = principal([]);
  assert.equal(JSON.stringify(await client.listAgents()).includes('private-source'), false);
  assert.deepEqual(app.agents.listPersonaSources({ id: 'someone-else', permissions: [] }).sources.map(s => s.id), ['local', 'private-source']);
  for (const id of ['missing', 'private-source']) await assert.rejects(client.createAgent({ name: 'denied', personaSourceId: id }), { code: 'AGENT_PERSONA_SOURCE_UNAVAILABLE', status: 409 });
  await assert.rejects(client.createAgent({ name: 'path injection', personaSourceId: '../private-module' }), { code: 'AGENT_PROFILE_INVALID', status: 400 });
  await assert.rejects(client.createAgent({ name: 'overwrite', personaSourceId: 'persona-fixture', persona: 'replace the external identity' }), { code: 'AGENT_PERSONA_SOURCE_CONFLICT', status: 400 });
  assert.equal(app.agents.list(p).length, 0);
});

test('source choice survives restart; a removed external source fails closed while local jobs and old results remain usable', async t => {
  const f = await workspace(t, {}, { personaSources: [namedPersonaSource()] }), p = principal(['lots:read']);
  let client = await f.start();
  const local = await client.createAgent({ name: 'local survives', persona: 'LOCAL_ONLY' });
  const external = await client.createAgent({ name: 'bound survives', personaSourceId: 'persona-fixture' });
  configure(await f.app.agents.getRuntime(external.id, p), [answer('external history')]);
  const old = await client.enqueueAgentJob(external.id, { input: 'record history', requestId: 'history' });
  const result = await finishedJob(client, external, old); assert.equal(result.status, 'completed');
  await f.restart(); client = await f.start();
  assert.equal((await client.getAgent(external.id)).personaSourceId, 'persona-fixture');
  const restored = await f.app.agents.getRuntime(external.id, p);
  configure(restored, [context => { assert.match(JSON.stringify(context), /EXTERNAL_ONLY/); return answer('external continued'); }]);
  const continued = await client.enqueueAgentJob(external.id, { input: 'continue after restart', requestId: 'continued' });
  const resumed = await finishedJob(client, external, continued);
  assert.equal(resumed.status, 'completed'); assert.equal(resumed.sessionId, result.sessionId);
  assert.equal(restored.getSession(resumed.sessionId, p).contextDescriptor.personaBinding.authority, 'external');
  await f.restart({}); client = await f.start();
  assert.equal((await client.getAgentJob(external.id, old.id)).result.text, 'external history');
  await assert.rejects(f.app.agents.getRuntime(external.id, p), { code: 'AGENT_PERSONA_SOURCE_UNAVAILABLE' });
  await assert.rejects(client.getAgentMemory(external.id), { code: 'MEMORY_UNAVAILABLE', status: 404 });
  const blocked = await client.enqueueAgentJob(external.id, { input: 'must not fall back', requestId: 'missing-source' });
  const failed = await finishedJob(client, external, blocked);
  assert.equal(failed.status, 'failed'); assert.equal(failed.code, 'AGENT_PERSONA_SOURCE_UNAVAILABLE');
  configure(await f.app.agents.getRuntime(local.id, p), [context => { assert.match(JSON.stringify(context), /LOCAL_ONLY/); assert.doesNotMatch(JSON.stringify(context), /EXTERNAL_ONLY/); return answer('local still works'); }]);
  const next = await client.enqueueAgentJob(local.id, { input: 'continue locally', requestId: 'local-after-restart' });
  assert.equal((await finishedJob(client, local, next)).result.text, 'local still works');
});

test('external factory failure is isolated and incompatible routing configurations fail before activation', async t => {
  const f = await workspace(t, {}, { personaSources: [namedPersonaSource({ create() { throw new Error('synthetic provider unavailable'); } })] });
  const client = await f.start(), p = principal(['lots:read']);
  const external = await client.createAgent({ name: 'unavailable', personaSourceId: 'persona-fixture' });
  const broken = await client.enqueueAgentJob(external.id, { input: 'try external', requestId: 'broken' });
  assert.equal((await finishedJob(client, external, broken)).status, 'failed');
  const local = await client.createAgent({ name: 'healthy local' });
  configure(await f.app.agents.getRuntime(local.id, p), [answer('healthy')]);
  const good = await client.enqueueAgentJob(local.id, { input: 'local task', requestId: 'healthy' });
  assert.equal((await finishedJob(client, local, good)).status, 'completed');
  await assert.rejects(createWorkspace(f.directory, { personaProvider: () => { throw new Error('must not activate'); }, personaSources: [] }), { code: 'PERSONA_SOURCE_CONFIG_CONFLICT' });
  await assert.rejects(createWorkspace(f.directory, { personaSources: [namedPersonaSource({ id: 'local' })] }), { code: 'PERSONA_SOURCES_INVALID' });
  await assert.rejects(createWorkspace(f.directory, { personaSources: [namedPersonaSource(), namedPersonaSource()] }), { code: 'PERSONA_SOURCES_INVALID' });
});

test('unlabelled legacy sessions never migrate from external authority to local memory silently', async t => {
  const f = await workspace(t, {}, { personaSources: [namedPersonaSource()] }), p = principal(['lots:read']);
  let client = await f.start();
  const local = await client.createAgent({ name: 'legacy ordinary', persona: 'LOCAL_ONLY' });
  const external = await client.createAgent({ name: 'legacy external', personaSourceId: 'persona-fixture' });
  for (const agent of [local, external]) {
    configure(await f.app.agents.getRuntime(agent.id, p), [answer('history')]);
    const job = await client.enqueueAgentJob(agent.id, { input: 'remember origin', requestId: 'old-history' });
    assert.equal((await finishedJob(client, agent, job)).status, 'completed');
  }
  await f.app.close();
  const statePath = join(f.directory, f.config.stateDir, 'agents-service', 'supervisor.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  for (const profile of state.profiles) delete profile.personaSourceId;
  await writeFile(statePath, JSON.stringify(state));
  await f.restart(); client = await f.start();
  assert.equal((await client.getAgentMemory(local.id)).persona.text, 'LOCAL_ONLY');
  assert.equal((await client.getAgent(local.id)).personaSourceId, 'local');
  await assert.rejects(client.getAgentMemory(external.id), { code: 'MEMORY_UNAVAILABLE', status: 404 });
  await assert.rejects(f.app.agents.getRuntime(external.id, p), { code: 'AGENT_PERSONA_SOURCE_MIGRATION_REQUIRED' });
  assert.equal((await client.getAgent(external.id)).personaSourceId, undefined);
});
async function run(runtime, p, prompt = 'LOT-001') {
  const { sessionId } = await runtime.createSession(p);
  return { sessionId, result: await runtime.run(sessionId, p, prompt) };
}

test('ordinary workspace needs no PIX or Schumpeter and binds main and managed worker before first input', async t => {
  const { app } = await workspace(t), p = principal(['lots:read']);
  const main = await run(app.runtime, p);
  assert.equal(main.result.status, 'completed');
  const mainDescriptor = app.runtime.getSession(main.sessionId, p).contextDescriptor;
  assert.equal(mainDescriptor.personaBinding.agentId, 'main'); assert.equal(mainDescriptor.personaBinding.role, 'main');
  assert.equal(mainDescriptor.personaBinding.authority, 'pida-local');
  const mainEvents = app.runtime.exportRun(main.sessionId, main.result.runId, p).events;
  assert.equal(mainEvents.find(e => e.activity === 'context_input_included').payload.attempt, 1);
  assert.notEqual(mainEvents[0].agent_id, 'main');
  const agent = app.agents.register(p, { name: 'bound worker', role: 'verifier', persona: 'Synthetic reviewer persona' });
  const worker = await app.agents.getRuntime(agent.id, p), child = await run(worker, p);
  assert.equal(child.result.status, 'completed');
  const childDescriptor = worker.getSession(child.sessionId, p).contextDescriptor;
  assert.equal(childDescriptor.personaBinding.agentId, agent.id); assert.equal(childDescriptor.personaBinding.role, 'role:' + compositionRevision('verifier'));
  assert.equal(childDescriptor.personaRevision, 1);
  assert.notEqual(childDescriptor.personaBinding.personaId, mainDescriptor.personaBinding.personaId);
  assert.ok(worker.exportRun(child.sessionId, child.result.runId, p).events.some(e => e.activity === 'context_input_included'));
  const pi = app.processIntelligence.get('main');
  const analyst = principal(['pi:read', 'pi:analyze']);
  const history = pi.history(analyst);
  assert.equal(history.configured, false);
  const selected = history.items.find(item => item.runId === main.result.runId);
  const result = await pi.reflect(analyst, [{ sessionId: selected.sessionId, runId: selected.runId, digest: selected.digest }]);
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.issues, ['PIX_NOT_CONFIGURED']);
  assert.equal(result.businessAcceptance, 'UNKNOWN');
});

test('PI tool registration and PIX configuration never grant analysis permission', async t => {
  const { app } = await workspace(t, { permissions: [], processIntelligence: {
    pythonExecutable: 'missing-python', sourceDirectory: 'missing-pix-source', sourceCommit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64),
  } });
  const inventory = app.getComposition().active.find(entry => entry.agentId === 'main');
  const tools = inventory.tools.filter(tool => tool.name.startsWith('pi_'));
  assert.equal(tools.length, 5); assert.ok(tools.every(tool => tool.permitted === false));
  configure(app.runtime, [answer(call('pi_history', {}), { stopReason: 'toolUse' }), answer('must not claim analysis')]);
  const outcome = await run(app.runtime, principal([]), 'list my process history');
  assert.equal(outcome.result.status, 'failed'); assert.equal(outcome.result.code, 'TOOL_FORBIDDEN');
  assert.throws(() => app.processIntelligence.get('main').history(principal([])), { code: 'FORBIDDEN', status: 403 });
});

test('explicit broken PIX paths degrade analysis to unavailable while normal model runs still work', async t => {
  const { app } = await workspace(t, { permissions: ['lots:read', 'pi:read', 'pi:analyze'], processIntelligence: {
    pythonExecutable: 'missing-python', sourceDirectory: 'missing-pix-source', sourceCommit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), timeoutMs: 100,
  } });
  const p = principal(['lots:read', 'pi:read', 'pi:analyze']);
  const completed = await run(app.runtime, p);
  assert.equal(completed.result.status, 'completed');
  const pi = app.processIntelligence.get('main'), history = pi.history(p);
  assert.equal(history.configured, false);
  const selected = history.items.find(item => item.runId === completed.result.runId);
  const result = await pi.reflect(p, [{ sessionId: selected.sessionId, runId: selected.runId, digest: selected.digest }]);
  assert.equal(result.status, 'unavailable'); assert.equal(result.processJudgment, 'unknown');
  assert.ok(result.issues.length > 0); assert.equal(result.native, undefined);
  assert.ok(!JSON.stringify(result).includes('missing-pix-source'));
  assert.equal((await run(app.runtime, p, 'LOT-002')).result.status, 'completed');
});

test('external contract factory owns main and worker context; local canonical tools and HTTP writes are disabled', async t => {
  const created = [], received = [];
  const fixtureFactory = async host => {
    created.push({ agentId: host.agentId, role: host.role });
    const text = JSON.stringify({ profile: 'contract-only-external-persona', agentId: host.agentId, role: host.role });
    return { id: 'contract-fixture/1', agentId: host.agentId, authority: 'external', resolveContext(req) {
      assert.equal(req.principal.id, host.principal.id); assert.equal(req.agentId, host.agentId);
      received.push({ agentId: req.agentId, runId: req.runId });
      return { text, descriptor: { schemaVersion: 1, rendererVersion: 'contract-fixture/1', personaRevision: 1,
        informationState: null, experiences: [], truncated: false, personaBinding: {
          schemaVersion: 1, providerId: 'contract-fixture/1', personaId: `fixture:${host.agentId}`, authority: 'external', agentId: host.agentId,
          role: host.role, scopeId: digest(host.workspaceId + ':' + host.principal.id), contextRevision: digest('fixture-revision-1'), contextDigest: digest(text),
          rendererVersion: 'contract-fixture/1', omitted: false,
        } } };
    } };
  };
  const { app, config, directory, start } = await workspace(t, { permissions: ['pi:read', 'pi:analyze', 'pi:remember'] }, { personaProvider: fixtureFactory });
  configure(app.runtime, [context => { assert.match(JSON.stringify(context), /contract-only-external-persona/); return answer('External contract context received.'); }]);
  const client = await start(), agent = await client.createAgent({ name: 'external worker', role: 'researcher', persona: 'Registration is not canonical Persona storage' });
  const p = principal(['pi:read', 'pi:analyze', 'pi:remember']), worker = await app.agents.getRuntime(agent.id, p);
  configure(worker, [context => {
    assert.match(JSON.stringify(context), /contract-only-external-persona/);
    assert.doesNotMatch(JSON.stringify(context), /Use agent_memory_recall/);
    return answer('Worker context received.');
  }]);
  const main = await run(app.runtime, p, 'read bound context'), child = await run(worker, p, 'read worker context');
  assert.equal(main.result.status, 'completed'); assert.equal(child.result.status, 'completed');
  assert.deepEqual(created.map(entry => entry.agentId).sort(), ['main', agent.id].sort());
  assert.deepEqual(received.map(entry => entry.agentId).sort(), ['main', agent.id].sort());
  assert.ok(app.getComposition().active.every(entry => !entry.tools.some(tool => tool.name.startsWith('agent_memory_'))));
  assert.equal(app.runtime.getSession(main.sessionId, p).contextDescriptor.personaBinding.authority, 'external');
  assert.equal(worker.getSession(child.sessionId, p).contextDescriptor.personaBinding.role, 'role:' + compositionRevision('researcher'));
  const unavailable = { code: 'MEMORY_UNAVAILABLE', status: 404 };
  await assert.rejects(client.getAgentMemory(agent.id), unavailable);
  await assert.rejects(client.reviseAgentPersona(agent.id, { expectedRevision: null, text: 'do not write', sourceRefs: ['owner:test'] }), unavailable);
  await assert.rejects(client.rememberAgentExperience(agent.id, { kind: 'fact', text: 'do not write', sourceRefs: ['owner:test'] }), unavailable);
  await assert.rejects(client.retractAgentExperience(agent.id, { id: '11111111-1111-1111-1111-111111111111', expectedRevision: 1, reason: 'do not write', sourceRefs: ['owner:test'] }), unavailable);
  await assert.rejects(client.transitionAgentMemory(agent.id, { expectedHead: null, parentIds: [], information: { goal: 'do not write', understanding: '', uncertainties: [], nextAction: '', relationships: [] }, sourceRefs: ['owner:test'] }), unavailable);
  assert.equal(existsSync(join(directory, config.stateDir, 'agents-service', 'memory')), false);
});

test('legacy empty and long private roles bind without exporting role instruction text', async t => {
  const { app } = await workspace(t), p = principal(['lots:read']);
  for (const role of ['', 'PRIVATE_ROLE_TEXT_'.repeat(235).slice(0, 4000)]) {
    const agent = app.agents.register(p, { name: role ? 'long private role' : 'legacy empty role', role });
    const worker = await app.agents.getRuntime(agent.id, p), outcome = await run(worker, p);
    assert.equal(outcome.result.status, 'completed');
    assert.equal(worker.getSession(outcome.sessionId, p).contextDescriptor.personaBinding.role, 'role:' + compositionRevision(role));
    assert.doesNotMatch(JSON.stringify(worker.exportRun(outcome.sessionId, outcome.result.runId, p)), /PRIVATE_ROLE_TEXT_/);
  }
});

test('embedded SDK main principals retain isolated canonical memory and context scopes', async t => {
  const { app } = await workspace(t);
  const permissions = ['agent:memory:write', 'agent:memory:read'];
  const alice = { id: 'sdk-alice', permissions }, bob = { id: 'sdk-bob', permissions };
  const f = configure(app.runtime, [answer(call('agent_memory_remember', { kind: 'fact', text: 'ALICE_PRIVATE_REFERENCE', sourceRefs: ['owner:alice'] }), { stopReason: 'toolUse' }), answer('Stored Alice reference.')]);
  const a = await run(app.runtime, alice, 'remember owned source'); assert.equal(a.result.status, 'completed');
  f.setResponses([context => { assert.doesNotMatch(JSON.stringify(context), /ALICE_PRIVATE_REFERENCE/); return answer('Bob scope.'); }]);
  const b = await run(app.runtime, bob, 'read context'); assert.equal(b.result.status, 'completed');
  assert.notEqual(app.runtime.getSession(a.sessionId, alice).contextDescriptor.personaBinding.scopeId, app.runtime.getSession(b.sessionId, bob).contextDescriptor.personaBinding.scopeId);
  assert.notEqual(app.runtime.getSession(a.sessionId, alice).contextDescriptor.personaBinding.personaId, app.runtime.getSession(b.sessionId, bob).contextDescriptor.personaBinding.personaId);
  f.setResponses([context => { assert.match(JSON.stringify(context), /ALICE_PRIVATE_REFERENCE/); return answer('Alice retained her reference.'); }]);
  assert.equal((await app.runtime.run(a.sessionId, alice, 'continue')).status, 'completed');
});
