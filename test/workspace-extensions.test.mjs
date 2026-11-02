import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { initWorkspace, readConfig, createWorkspace } from '../dist/workspace.js';
import { activateExtensions, ResourceLifetime } from '../dist/extensions.js';
import { resolveComposition, compositionRevision } from '../dist/composition.js';
import { AgentSupervisor } from '../dist/agent-supervisor.js';

const principal = { id: 'local-user', permissions: ['lots:read'] };
const tool = (name = 'fixture', permission = 'fixture:read') => ({ name, permission, description: 'fixture', parameters: Type.Object({}), effect: 'read', async execute() { return {}; } });
async function workspace(t, patch = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-extensions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  initWorkspace(directory);
  const config = { ...readConfig(directory), tools: { directory: 'tools', enabled: [] }, preset: 'personal', workbench: { enabled: false }, ...patch };
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  return { directory, config };
}

test('partial activation unwinds in reverse order, including early registered resources and failed close', async () => {
  const events = [];
  await assert.rejects(activateExtensions([
    { id: 'first', scope: 'workspace', activate({ onDispose }) { onDispose(() => events.push('first early')); return { tools: [], close() { events.push('first close'); throw new Error('close failure'); } }; } },
    { id: 'second', scope: 'workspace', activate({ onDispose }) { onDispose(() => events.push('second early')); throw new Error('activate failure'); } },
  ], { workspaceDir: '/host' }), error => error instanceof AggregateError && error.cause.message === 'activate failure');
  assert.deepEqual(events, ['second early', 'first close', 'first early']);
  const owner = new ResourceLifetime();
  let release, calls = 0;
  owner.add(async () => { calls++; await new Promise(resolve => { release = resolve; }); });
  const first = owner.close(), second = owner.close();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1); release(); await Promise.all([first, second]);
});

test('approved agent factory gives main and persistent agents separate state; workspace extension has one owner', async t => {
  const { directory, config } = await workspace(t);
  config.tools.enabled = ['counter.mjs'];
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  await writeFile(join(directory, 'tools/counter.mjs'), `
    import { appendFileSync } from 'node:fs';
    import { join } from 'node:path';
    export default { id:'counter', scope:'agent', activate(context) {
      let count=0;
      context.onDispose(()=>appendFileSync(join(context.workspaceDir,'closed.txt'),context.agentId+'\\n'));
      return { tools:[{name:'get_lot_status',description:'counter',permission:'lots:read',effect:'read',
        parameters:{type:'object',properties:{lotId:{type:'string'}},required:['lotId'],additionalProperties:false},
        async execute(){return {owner:context.agentId,count:++count}}}] };
    }};
  `);
  let sharedStarts = 0, sharedCloses = 0;
  const app = await createWorkspace(directory, { extensions: [{ id: 'shared', scope: 'workspace', revision: 'a', activate() { sharedStarts++; return { tools: [tool()], close() { sharedCloses++; } }; } }] });
  t.after(() => app.close());
  const a = app.agents.register(principal, { name: 'a' }), b = app.agents.register(principal, { name: 'b' });
  const ar = await app.agents.getRuntime(a.id, principal), br = await app.agents.getRuntime(b.id, principal);
  const run = async runtime => { const session = await runtime.createSession(principal); return runtime.run(session.sessionId, principal, 'LOT-001'); };
  const main = await run(app.runtime), first = await run(ar), second = await run(br);
  assert.equal(main.status, 'completed');
  for (const result of [first, second]) assert.ok(result.status === 'completed');
  assert.match(main.text, /"count":1/); assert.match(first.text, /"count":1/); assert.match(second.text, /"count":1/);
  assert.equal(sharedStarts, 1);
  const inventory = app.getComposition();
  assert.equal(inventory.active.length, 3);
  assert.ok(inventory.active.every(v => v.extensions.some(e => e.id === 'counter' && e.scope === 'agent')));
  assert.ok(inventory.active.every(v => v.tools.find(t => t.name === 'fixture').permitted === false));
  const close = app.close(); assert.equal(app.close(), close); await close;
  assert.equal(sharedCloses, 1);
  assert.deepEqual((await readFile(join(directory, 'closed.txt'), 'utf8')).trim().split('\n').sort(), ['main', a.id, b.id].sort());
});

test('preset defaults and effective revisions do not grant permissions or import new configuration mid-run', async t => {
  const { directory, config } = await workspace(t, { preset: 'coding', permissions: [], workbench: undefined });
  assert.equal(resolveComposition(config, 'main').workbench, true);
  assert.equal(resolveComposition({ ...config, preset: 'personal' }, 'main').workbench, false);
  assert.equal(resolveComposition({ ...config, preset: 'headless' }, 'main').web, false);
  assert.equal(resolveComposition({ ...config, preset: undefined, workbench: { enabled: false } }, 'agent').workbench, true);
  assert.equal(compositionRevision({ b: 1, a: 2 }), compositionRevision({ a: 2, b: 1 }));
  const app = await createWorkspace(directory); t.after(() => app.close());
  const before = app.getComposition();
  assert.equal(before.restartRequired, false);
  assert.ok(before.active[0].tools.some(t => t.name === 'ui_patch' && !t.permitted));
  assert.ok(!JSON.stringify(before).includes(config.systemPrompt));
  config.permissions = ['fixture:read'];
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  const after = app.getComposition();
  assert.equal(after.restartRequired, true);
  assert.notEqual(after.configuredRevision, before.configuredRevision);
  assert.equal(after.active[0].revision, before.active[0].revision);
  const a = app.agents.register(principal, { name: 'blocked-new-composition' });
  await assert.rejects(app.agents.getRuntime(a.id, principal), { code: 'WORKSPACE_RESTART_REQUIRED' });
});

test('startup failure after main runtime construction releases runtime locks and extension resources', async t => {
  const { directory, config } = await workspace(t);
  const existing = await AgentSupervisor.open({ directory: join(directory, config.stateDir, 'agents-service'), resolvePrincipal: () => principal, createRuntime() { throw new Error('unused'); } });
  t.after(() => existing.close());
  const events = [];
  await assert.rejects(createWorkspace(directory, { extensions: [
    { id: 'shared', scope: 'workspace', activate() { return { tools: [], close() { events.push('workspace'); } }; } },
    { id: 'per-agent', scope: 'agent', activate() { return { tools: [], close() { events.push('main'); } }; } },
  ] }), { code: 'AGENT_SUPERVISOR_LOCKED' });
  assert.deepEqual(events, ['main', 'workspace']);
  assert.equal(existsSync(join(directory, config.stateDir, 'runtime.lock')), false);
});

test('supervisor joins pending runtime creation and reports cleanup errors to every close caller', async t => {
  const { directory } = await workspace(t);
  let release, calls = 0;
  const supervisor = await AgentSupervisor.open({ directory: join(directory, 'supervisor'), resolvePrincipal: () => principal,
    createRuntime: () => new Promise(resolve => { release = () => resolve({ close: async () => { calls++; throw new Error('fixture close failed'); } }); }),
  });
  const agent = supervisor.register(principal, { name: 'pending' });
  const pending = supervisor.getRuntime(agent.id, principal);
  await Promise.resolve();
  const close = supervisor.close(); assert.equal(supervisor.close(), close);
  release(); await pending;
  await assert.rejects(close, error => error instanceof AggregateError && error.errors[0].message === 'fixture close failed');
  assert.equal(calls, 1); assert.equal(existsSync(join(directory, 'supervisor/supervisor.lock')), false);
  await assert.rejects(supervisor.close(), AggregateError);
});

test('config.mcp activates a real child, appears in effective inventory and executes through the common Pi tool pipeline', async t => {
  const { directory, config } = await workspace(t, { permissions: ['mcp:fixture:read'] });
  const state = join(directory, 'mcp-state.json'), log = join(directory, 'mcp-log.jsonl');
  await writeFile(state, '{}'); await writeFile(log, '');
  await writeFile(join(directory, '.env'), (await readFile(join(directory, '.env'), 'utf8')) + `\nFIXTURE_STATE_PATH=${state}\nFIXTURE_LOG_PATH=${log}\n`);
  config.mcp = { servers: [{ id: 'fixture', transport: { kind: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))],
    envFrom: { MCP_FIXTURE_STATE: 'FIXTURE_STATE_PATH', MCP_FIXTURE_LOG: 'FIXTURE_LOG_PATH' } },
    connectTimeoutMs: 1500, reconnect: { maxAttempts: 0 }, tools: { echo: { permission: 'mcp:fixture:read', effect: 'read' } },
  }] };
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  const app = await createWorkspace(directory); t.after(() => app.close());
  const inventory = app.getComposition();
  assert.equal(inventory.mcp[0].state, 'ready');
  assert.ok(inventory.active[0].tools.some(t => t.name === 'mcp_fixture_echo' && t.permitted));
  assert.ok(!JSON.stringify(inventory).includes('secret-fixture-stderr'));
  app.runtime.configureProvider(() => {
    const f = fauxProvider({ tokensPerSecond: 100000 });
    f.setResponses([answer(call('mcp_fixture_echo', { value: 'from workspace configuration' }), { stopReason: 'toolUse' }), answer('MCP response observed')]);
    return { provider: f.provider, modelId: f.getModel().id };
  }, { mode: 'fixture', model: 'faux' });
  const p = { id: 'local-user', permissions: config.permissions }, session = await app.runtime.createSession(p);
  assert.equal((await app.runtime.run(session.sessionId, p, 'call configured MCP')).status, 'completed');
  const events = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.type === 'call' && e.name === 'echo').length, 1);
  await app.close();
  assert.throws(() => process.kill(events[0].pid, 0), e => e.code === 'ESRCH');
});

test('changed approved source requires restart, then reopening in the same process loads the new source', async t => {
  const { directory, config } = await workspace(t);
  config.tools.enabled = ['version.mjs'];
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  const source = version => `export default {name:'get_lot_status',description:'source fixture',permission:'lots:read',effect:'read',parameters:{type:'object',properties:{lotId:{type:'string'}},required:['lotId'],additionalProperties:false},async execute(){return {version:${JSON.stringify(version)}}}};`;
  await writeFile(join(directory, 'tools/version.mjs'), source('old'));
  const first = await createWorkspace(directory); t.after(() => first.close());
  const old = first.getComposition();
  await writeFile(join(directory, 'tools/version.mjs'), source('new'));
  assert.equal(first.getComposition().restartRequired, true);
  assert.equal(first.getComposition().active[0].revision, old.active[0].revision);
  const a = first.agents.register(principal, { name: 'wait for restart' });
  await assert.rejects(first.agents.getRuntime(a.id, principal), { code: 'WORKSPACE_RESTART_REQUIRED' });
  await first.close();
  const second = await createWorkspace(directory); t.after(() => second.close());
  const session = await second.runtime.createSession(principal);
  const result = await second.runtime.run(session.sessionId, principal, 'LOT-001');
  assert.match(result.text, /"version":"new"/);
  assert.equal(second.getComposition().restartRequired, false);
});

test('workspace close keeps releasing resources after failure and exposes the same rejection to repeat callers', async t => {
  const { directory, config } = await workspace(t);
  const events = [];
  const app = await createWorkspace(directory, { extensions: [
    { id: 'one', scope: 'workspace', activate() { return { tools: [], close() { events.push('one'); } }; } },
    { id: 'two', scope: 'workspace', activate() { return { tools: [], close() { events.push('two'); throw new Error('teardown failed'); } }; } },
  ] });
  const first = app.close(), second = app.close(); assert.equal(first, second);
  await assert.rejects(first, AggregateError); await assert.rejects(second, AggregateError);
  assert.ok(app.closeError instanceof AggregateError);
  assert.deepEqual(events, ['two', 'one']);
  assert.equal(existsSync(join(directory, config.stateDir, 'runtime.lock')), false);
  assert.equal(existsSync(join(directory, config.stateDir, 'agents-service/supervisor.lock')), false);
});

test('failed runtime replacement cleanup prevents another factory from starting over unknown live resources', async t => {
  const { directory } = await workspace(t);
  let revision = 'one', creates = 0;
  const supervisor = await AgentSupervisor.open({ directory: join(directory, 'supervisor'), resolvePrincipal: () => principal,
    runtimeKey: () => revision, createRuntime: () => { creates++; return { assertIdle() {}, async close() { throw new Error('not released'); } }; },
  });
  const a = supervisor.register(principal, { name: 'failing replacement' });
  await supervisor.getRuntime(a.id, principal); revision = 'two';
  await assert.rejects(supervisor.getRuntime(a.id, principal), /not released/);
  await assert.rejects(supervisor.getRuntime(a.id, principal), { code: 'AGENT_RUNTIME_CLOSE_FAILED' });
  assert.equal(creates, 1);
  await assert.rejects(supervisor.close(), AggregateError);
});

test('busy runtime replacement keeps the previous owner until it can be safely closed', async t => {
  const { directory } = await workspace(t);
  let revision = 'one', busy = true, creates = 0, closes = 0;
  const supervisor = await AgentSupervisor.open({ directory: join(directory, 'supervisor'), resolvePrincipal: () => principal,
    runtimeKey: () => revision, createRuntime: () => { creates++; return { assertIdle() { if (busy) throw new Error('still busy'); }, async close() { closes++; } }; },
  });
  const a = supervisor.register(principal, { name: 'busy replacement' });
  await supervisor.getRuntime(a.id, principal); revision = 'two';
  await assert.rejects(supervisor.getRuntime(a.id, principal), /still busy/);
  assert.equal(closes, 0); assert.equal(creates, 1);
  busy = false;
  await supervisor.getRuntime(a.id, principal);
  assert.equal(closes, 1); assert.equal(creates, 2);
  await supervisor.close(); assert.equal(closes, 2);
});

test('workspace close aborts an agent extension still activating and waits for its partial cleanup', async t => {
  const { directory, config } = await workspace(t);
  let started, signalAborted = false, partialCleanup = 0, returnedCleanup = 0;
  const activating = new Promise(resolve => { started = resolve; });
  const app = await createWorkspace(directory, { extensions: [{ id: 'blocking-activation', scope: 'agent',
    async activate({ agentId, signal, onDispose }) {
      if (agentId === 'main') return { tools: [] };
      onDispose(async () => { await Promise.resolve(); partialCleanup++; });
      started();
      await new Promise(resolve => signal.addEventListener('abort', () => { signalAborted = true; resolve(); }, { once: true }));
      return { tools: [], close() { returnedCleanup++; } };
    },
  }] });
  const agent = app.agents.register(principal, { name: 'pending activation' });
  const pending = app.agents.getRuntime(agent.id, principal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await activating;
  let timer;
  try {
    await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close did not cancel pending activation')), 1000); })]);
  } finally { clearTimeout(timer); }
  await rejected;
  assert.equal(signalAborted, true); assert.equal(partialCleanup, 1); assert.equal(returnedCleanup, 1);
  assert.equal(existsSync(join(directory, config.stateDir, 'agents-service/agents', agent.id, 'runtime/runtime.lock')), false);
  assert.equal(existsSync(join(directory, config.stateDir, 'agents-service/supervisor.lock')), false);
  assert.equal(existsSync(join(directory, config.stateDir, 'runtime.lock')), false);
});
