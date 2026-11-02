import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkspace, initWorkspace, workspaceEnvironment } from '../dist/workspace.js';
import { PidaClient } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { PidaWorkbench } from '../dist/workbench.js';
import { AgentMemoryStore } from '../dist/agent-memory.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const workPermissions = ['workbench:read', 'workbench:write', 'workbench:history'];
const owner = { id: 'local-user', permissions: ['pida:agents', 'agent:memory:write', ...workPermissions] };
const information = {
  goal: 'Understand the maintenance cause before recommending a change',
  understanding: 'The owner reports a repeat alarm; the cause is still unconfirmed',
  uncertainties: ['Does the alarm correlate with the temperature sensor?'],
  nextAction: 'Compare the owner-supplied observations',
  relationships: [{ subject: 'alarm:A', predicate: 'observed-on', object: 'equipment:E' }],
};
const error = (code, status) => ({ code, status });

async function until(check, message = 'Expected agent state was not reached') {
  const deadline = Date.now() + 6000;
  do { const value = await check(); if (value) return value; await delay(10); } while (Date.now() < deadline);
  assert.fail(message);
}
async function completed(client, agent, job) {
  const result = await until(async () => {
    const current = await client.getAgentJob(agent, job);
    return !['queued', 'running'].includes(current.status) && current;
  });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  return result;
}
async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
async function fixture(t) {
  const directory = await mkdtemp(join(root, '.pida-test-agents-http-'));
  let app;
  const extraServers = [];
  t.after(async () => {
    for (const server of extraServers) await closeServer(server);
    if (app) { await app.close(); await closeServer(app.server); }
    await rm(directory, { recursive: true, force: true });
  });
  initWorkspace(directory);
  // The ordinary deterministic mock model calls this real authorized tool through Pi.
  // The delay lets the test observe the run after its submitting client has disconnected.
  const toolPath = join(directory, 'tools', 'lot-status.mjs');
  await writeFile(toolPath, `
    import { setTimeout as delay } from 'node:timers/promises';
    let calls = 0, active = 0;
    export const counts = () => ({ calls, active });
    export default {
      name: 'get_lot_status', description: 'Deterministic integration fixture, not live factory data',
      permission: 'lots:read', effect: 'read',
      parameters: { type: 'object', properties: { lotId: { type: 'string' } }, required: ['lotId'], additionalProperties: false },
      async execute({ lotId }, { signal }) {
        calls++; active++;
        try { await delay(150, undefined, { signal }); return { lotId, status: 'processing', source: 'mock-fixture' }; }
        finally { active--; }
      }
    };
  `);
  const tool = await import(pathToFileURL(toolPath).href);
  const client = (server = app.server, token = workspaceEnvironment(directory).PIDA_API_TOKEN) => new PidaClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`, token: () => token,
    // Each request really closes its transport; reconnection cannot reuse a stale Undici socket.
    fetch: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Connection: 'close' } }),
  });
  const start = async () => {
    app = await createWorkspace(directory);
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    return client();
  };
  const stop = async () => { await app.close(); await closeServer(app.server); app = undefined; };
  const agentRoot = () => join(directory, app.config.stateDir, 'agents-service');
  return {
    directory, start, stop, client, tool, extraServers,
    get app() { return app; },
    memory: id => new AgentMemoryStore(join(agentRoot(), 'memory'), id),
    bench: id => new PidaWorkbench(join(agentRoot(), 'agents', id, 'workbench')),
  };
}

test('workspace SDK preserves three agents, sourced information, isolated artifacts and jobs across reconnect/restart (mock model; real Pi/tool/HTTP)', async t => {
  const f = await fixture(t);
  let client = await f.start();
  assert.equal((await client.getInfo()).provider.mode, 'mock');
  const agents = [];
  for (const name of ['code', 'research', 'assistant']) agents.push(await client.createAgent({ name, role: `${name} fixture role`, persona: `Owner-selected ${name} persona` }));
  assert.equal((await client.listAgents()).agents.length, 3);
  assert.equal(new Set(agents.map(a => a.id)).size, 3);
  const first = agents[0].id;
  const initial = await client.getAgentMemory(first);
  assert.equal(initial.persona.revision, 1);
  assert.deepEqual(initial.persona.sourceRefs, ['owner:registration']);
  assert.equal(initial.head, null);
  const revised = await client.reviseAgentPersona(first, { expectedRevision: 1, text: 'Ask for evidence before making a recommendation', sourceRefs: ['message:owner-persona-2'] });
  assert.equal(revised.revision, 2);
  await assert.rejects(client.reviseAgentPersona(first, { expectedRevision: 1, text: 'stale edit', sourceRefs: ['message:stale'] }), error('PERSONA_REVISION_CONFLICT', 409));
  const fact = await client.rememberAgentExperience(first, { kind: 'fact', text: 'Owner reports alarm A on equipment E', sourceRefs: ['message:alarm-report'] });
  assert.equal(fact.authority, 'owner');
  await assert.rejects(client.rememberAgentExperience(first, { kind: 'fact', text: 'unsourced claim', sourceRefs: [] }), error('INVALID_MEMORY_INPUT', 400));
  const state = await client.transitionAgentMemory(first, { expectedHead: null, parentIds: [], information, sourceRefs: ['message:alarm-report'] });
  await assert.rejects(client.transitionAgentMemory(first, { expectedHead: null, parentIds: [], information: { ...information, understanding: 'stale overwrite' }, sourceRefs: ['message:stale'] }), error('MEMORY_HEAD_CONFLICT', 409));
  assert.equal((await client.getAgentMemory(agents[1].id)).head, null);

  // Seed distinct host-owned fixture artifacts; no claim that the mock model generated them.
  for (const [i, agent] of agents.entries()) {
    await f.bench(agent.id).write(owner, 'artifacts/report.txt', `private artifact ${i}`);
    const view = await client.getAgentWorkbench(agent.id);
    assert.deepEqual(view.files.map(file => file.path), ['artifacts/report.txt']);
    assert.equal((await client.readAgentFile(agent.id, 'artifacts/report.txt')).content, `private artifact ${i}`);
    await client.pauseAgent(agent.id);
  }
  assert.deepEqual((await client.getWorkbench()).files, []);
  const jobs = [];
  for (const [i, agent] of agents.entries()) jobs.push(await client.enqueueAgentJob(agent.id, { input: `Look up LOT-00${i + 1}`, requestId: `request-${i}` }));
  const duplicate = await client.enqueueAgentJob(first, { input: 'Look up LOT-001', requestId: 'request-0' });
  assert.equal(duplicate.id, jobs[0].id);
  await assert.rejects(client.enqueueAgentJob(first, { input: 'different input', requestId: 'request-0' }), error('AGENT_REQUEST_CONFLICT', 409));
  await delay(25);
  assert.equal(f.tool.counts().calls, 0);
  for (const [i, agent] of agents.entries()) assert.equal((await client.getAgentJob(agent.id, jobs[i].id)).status, 'queued');
  for (const agent of agents) await client.resumeAgent(agent.id);
  await until(() => f.tool.counts().active > 0);
  f.app.server.closeAllConnections(); // Request sockets are observers; the supervisor owns execution.
  client = f.client();
  const results = await Promise.all(agents.map((agent, i) => completed(client, agent.id, jobs[i].id)));
  assert.equal(f.tool.counts().calls, 3, 'request dedup must avoid duplicate tool execution');
  assert.equal(new Set(results.map(r => r.sessionId)).size, 3);
  for (const [i, result] of results.entries()) {
    assert.ok(result.activity.some(event => event.type === 'tool_completed' && event.toolName === 'get_lot_status'));
    assert.match(result.latestText, /mock-fixture/);
    const bundle = await client.exportAgentJob(agents[i].id, result.id);
    assert.equal(bundle.manifest.agent_id, agents[i].id);
    assert.equal(bundle.manifest.task_id, result.id);
    assert.equal(bundle.manifest.verification_status, 'UNKNOWN');
    assert.ok(bundle.manifest.artifact_refs.some(ref => ref.path === 'artifacts/report.txt'));
  }
  assert.deepEqual((await client.listSessions()).sessions, [], 'agent sessions must not enter the unrelated main runtime');
  const beforeRestart = await client.getAgentMemory(first);
  assert.equal(beforeRestart.head, state.id);
  assert.deepEqual(beforeRestart.states[0].information, information, 'completed job status must not overwrite information state');
  assert.equal(beforeRestart.states.length, 1);
  assert.equal(beforeRestart.experiences.length, 1);
  assert.equal(beforeRestart.personaHistory.length, 2);
  await f.stop();
  client = await f.start();
  assert.deepEqual((await client.listAgents()).agents.map(a => a.id), agents.map(a => a.id));
  assert.deepEqual(await client.getAgentMemory(first), beforeRestart);
  assert.equal((await client.enqueueAgentJob(first, { input: 'Look up LOT-001', requestId: 'request-0' })).id, jobs[0].id);
  assert.equal(f.tool.counts().calls, 3);
  for (const [i, agent] of agents.entries()) {
    assert.equal((await client.getAgent(agent.id)).sessionId, results[i].sessionId);
    assert.equal((await client.listAgentJobs(agent.id)).jobs[0].status, 'completed');
    assert.equal((await client.readAgentFile(agent.id, 'artifacts/report.txt')).content, `private artifact ${i}`);
    assert.equal((await client.exportAgentJob(agent.id, jobs[i].id)).run_id, results[i].runId);
  }
  const followup = await client.enqueueAgentJob(first, { input: 'Now look up LOT-002', requestId: 'followup' });
  const continued = await completed(client, first, followup.id);
  assert.equal(continued.sessionId, results[0].sessionId);
  assert.equal(f.tool.counts().calls, 4);
  const runtime = await f.app.agents.getRuntime(first, owner);
  const session = runtime.getSession(continued.sessionId, owner);
  assert.equal(session.runs, 2);
  assert.ok(session.messages.some(message => message.role === 'user' && message.text.includes('Look up LOT-001')));
  assert.ok(session.messages.some(message => message.role === 'user' && message.text.includes('Now look up LOT-002')));
  assert.equal((await client.getAgentMemory(first)).head, state.id);
});

test('paused and cancelled queued agent jobs survive restart without invoking the mock model/tool', async t => {
  const f = await fixture(t);
  let client = await f.start();
  const agent = await client.createAgent({ name: 'paused fixture' });
  await client.pauseAgent(agent.id);
  const cancelled = await client.enqueueAgentJob(agent.id, { input: 'LOT-001', requestId: 'cancel-me' });
  const queued = await client.enqueueAgentJob(agent.id, { input: 'LOT-002', requestId: 'hold-me' });
  assert.equal((await client.cancelAgentJob(agent.id, cancelled.id)).status, 'cancelled');
  await f.stop(); client = await f.start();
  assert.equal((await client.getAgent(agent.id)).paused, true);
  assert.equal((await client.getAgentJob(agent.id, cancelled.id)).status, 'cancelled');
  assert.equal((await client.getAgentJob(agent.id, queued.id)).status, 'queued');
  assert.equal((await client.getAgent(agent.id)).sessionId, undefined);
  assert.equal(f.tool.counts().calls, 0);
  await client.resumeAgent(agent.id);
  await completed(client, agent.id, queued.id);
  assert.equal(f.tool.counts().calls, 1);
  assert.equal((await client.getAgentJob(agent.id, cancelled.id)).status, 'cancelled');
  assert.deepEqual((await client.getAgentMemory(agent.id)).states, []);
});

test('agent HTTP routes enforce identity, ownership and write/tool grants before accessing private state', async t => {
  const f = await fixture(t), client = await f.start();
  const agent = await client.createAgent({ name: 'owner private agent', persona: 'private persona' });
  await client.pauseAgent(agent.id);
  const job = await client.enqueueAgentJob(agent.id, { input: 'private job input', requestId: 'private-request' });
  await f.bench(agent.id).write(owner, 'artifacts/private.txt', 'private output');
  const tokens = { owner: 'owner-token-'.repeat(4), other: 'other-token-'.repeat(4), denied: 'denied-token-'.repeat(4), read: 'readonly-token-'.repeat(4) };
  const server = createPidaServer({
    runtime: f.app.runtime, agents: f.app.agents, agentMemory: f.memory, agentWorkbench: f.bench,
    authenticate: staticTokenAuth([
      { token: tokens.owner, principal: owner },
      { token: tokens.other, principal: { ...owner, id: 'different-owner' } },
      { token: tokens.denied, principal: { id: owner.id, permissions: [] } },
      { token: tokens.read, principal: { id: owner.id, permissions: ['pida:agents'] } },
    ]),
  });
  f.extraServers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const other = f.client(server, tokens.other), denied = f.client(server, tokens.denied), read = f.client(server, tokens.read);
  await assert.rejects(f.client(server, 'invalid').listAgents(), error('UNAUTHORIZED', 401));
  await assert.rejects(denied.listAgents(), error('FORBIDDEN', 403));
  assert.deepEqual((await other.listAgents()).agents, []);
  for (const operation of [
    () => other.getAgent(agent.id), () => other.getAgentMemory(agent.id),
    () => other.getAgentJob(agent.id, job.id), () => other.cancelAgentJob(agent.id, job.id),
    () => other.getAgentWorkbench(agent.id), () => other.readAgentFile(agent.id, 'artifacts/private.txt'),
    () => other.reviseAgentPersona(agent.id, { expectedRevision: 1, text: 'intrusion', sourceRefs: ['message:intrusion'] }),
  ]) await assert.rejects(operation, error('AGENT_NOT_FOUND', 404));
  await assert.rejects(read.getAgentWorkbench(agent.id), error('FORBIDDEN', 403));
  await assert.rejects(read.reviseAgentPersona(agent.id, { expectedRevision: 1, text: 'unauthorized revision', sourceRefs: ['message:unauthorized'] }), error('FORBIDDEN', 403));
  assert.equal((await client.getAgentMemory(agent.id)).persona.text, 'private persona');
  assert.equal((await client.getAgentJob(agent.id, job.id)).status, 'queued');
  assert.equal(f.tool.counts().calls, 0);
  await assert.rejects(client.createAgent({ name: 'escalation', owner: 'different-owner', permissions: ['shell:execute'] }), error('UNKNOWN_FIELD', 400));
  await assert.rejects(client.readAgentFile(agent.id, '../pida.config.json'), error('INVALID_PATH', 400));
});
