import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { initWorkspace, readConfig, createWorkspace, workspaceEnvironment } from '../dist/workspace.js';
import { PidaClient } from '../dist/client.js';
import { compositionRevision } from '../dist/composition.js';

const principal = permissions => ({ id: 'local-user', permissions });
const digest = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url));
async function workspace(t, patch = {}, options = {}) {
  const directory = await mkdtemp(join(root, '.pida-test-persona-'));
  let app;
  t.after(async () => {
    if (app) {
      await app.close();
      if (app.server.listening) {
        app.server.closeAllConnections();
        await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
      }
    }
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
  return { app, config, directory, start };
}
function configure(runtime, responses) {
  const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(responses);
  runtime.configureProvider(() => ({ provider: f.provider, modelId: f.getModel().id }), { mode: 'protocol-fixture', model: 'faux' });
  return f;
}
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
