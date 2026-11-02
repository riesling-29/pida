import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime, PidaError } from '../dist/runtime.js';
import { AgentSupervisor } from '../dist/agent-supervisor.js';

const alice = { id: 'alice', permissions: ['wait:read'] }, bob = { id: 'bob', permissions: [] };
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pida-agents-'));
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
async function until(check) {
  for (let i = 0; i < 400; i++) { const result = await check(); if (result) return result; await delay(10); }
  assert.fail('supervisor did not reach expected state');
}
const finished = (s, id) => until(() => { const j = s.getJob(id, alice); return !['queued', 'running'].includes(j.status) && j; });
function factory(directory, state, waitMs = 50) {
  return profile => new PidaRuntime({ storageDir: join(directory, 'agents', profile.id, 'runtime'),
    provider: () => { const f = fauxProvider({ tokensPerSecond: 100000 });
      f.setResponses(Array.from({ length: 12 }, () => [answer(call('wait', {}), { stopReason: 'toolUse' }), answer('observed finished')]).flat());
      return { provider: f.provider, modelId: f.getModel().id }; },
    tools: [{ name: 'wait', description: 'fixture wait', parameters: Type.Object({}), permission: 'wait:read', effect: 'read',
      async execute(_args, { signal }) {
        state.calls++; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
        try { await delay(waitMs, undefined, { signal }); return { ok: true }; }
        finally { state.active--; }
      } }], maxRunMs: 5000,
  });
}

test('three persistent profiles run real Pi sessions with bounded parallelism, idempotent requests and owner isolation', async t => {
  const directory = temporary(t), state = { calls: 0, active: 0, maxActive: 0 };
  const s = await AgentSupervisor.open({ directory, maxConcurrent: 2, workspaceKey: p => p.id, resolvePrincipal: id => id === alice.id ? alice : undefined, createRuntime: factory(directory, state, 100) });
  t.after(() => s.close());
  const agents = ['code', 'research', 'assistant'].map(name => s.register(alice, { name, role: 'fixture role' }));
  assert.equal(s.list(alice).length, 3); assert.equal(s.list(bob).length, 0);
  assert.throws(() => s.get(agents[0].id, bob), { code: 'AGENT_NOT_FOUND' });
  assert.throws(() => s.register(alice, { name: 'bad', root: '/tmp' }), { code: 'AGENT_PROFILE_INVALID' });
  const jobs = agents.map((p, i) => s.enqueue(p.id, alice, { input: 'perform fixture', requestId: 'request-' + i }));
  assert.equal(s.enqueue(agents[0].id, alice, { input: 'perform fixture', requestId: 'request-0' }).id, jobs[0].id);
  assert.throws(() => s.enqueue(agents[0].id, alice, { input: 'different', requestId: 'request-0' }), { code: 'AGENT_REQUEST_CONFLICT' });
  assert.equal(state.calls, 0); s.start();
  const results = await Promise.all(jobs.map(j => finished(s, j.id)));
  assert.deepEqual(results.map(j => j.status), ['completed', 'completed', 'completed']);
  assert.equal(state.calls, 3); assert.equal(state.maxActive, 2);
  assert.equal(new Set(results.map(j => j.sessionId)).size, 3);
  assert.ok(results.every(j => j.runId && j.activity.some(e => e.type === 'tool_completed') && j.latestText === 'observed finished'));
  const disk = readFileSync(join(directory, 'supervisor.json'), 'utf8'); assert.ok(!disk.includes('permissions'));
  const firstSession = s.get(agents[0].id, alice).sessionId;
  await s.close();
  const next = await AgentSupervisor.open({ directory, workspaceKey: p => p.id, resolvePrincipal: () => alice, createRuntime: factory(directory, state) });
  t.after(() => next.close()); next.start();
  assert.equal(next.enqueue(agents[0].id, alice, { input: 'perform fixture', requestId: 'request-0' }).id, jobs[0].id);
  const resumed = next.enqueue(agents[0].id, alice, { input: 'continue fixture', requestId: 'followup' });
  assert.equal((await finished(next, resumed.id)).sessionId, firstSession); assert.equal(state.calls, 4);
  const runtime = await next.getRuntime(agents[0].id, alice);
  assert.equal(runtime.getSession(firstSession, alice).runs, 2);
});

test('shared workspace serializes agents; pause and queued cancellation do not invoke models; active cancellation is terminal', async t => {
  const directory = temporary(t), state = { calls: 0, active: 0, maxActive: 0 };
  const s = await AgentSupervisor.open({ directory, maxConcurrent: 3, resolvePrincipal: () => alice, createRuntime: factory(directory, state, 80) }); t.after(() => s.close());
  const a = s.register(alice, { name: 'first' }), b = s.register(alice, { name: 'second' });
  s.pause(b.id, alice);
  const cancelled = s.enqueue(b.id, alice, { input: 'never start', requestId: 'cancel-queued' });
  assert.equal((await s.cancel(cancelled.id, alice)).status, 'cancelled');
  const paused = s.enqueue(b.id, alice, { input: 'wait until resumed', requestId: 'paused' });
  s.start(); await delay(30); assert.equal(state.calls, 0);
  const first = s.enqueue(a.id, alice, { input: 'first', requestId: 'first' });
  await s.resume(b.id, alice);
  await Promise.all([finished(s, first.id), finished(s, paused.id)]); assert.equal(state.calls, 2); assert.equal(state.maxActive, 1);
  const active = s.enqueue(a.id, alice, { input: 'cancel active', requestId: 'cancel-active' });
  await until(() => state.active === 1);
  assert.equal((await s.cancel(active.id, alice)).status, 'cancelled'); assert.equal(state.active, 0);
});

test('delegation is explicit and bounded, persisted grants are never used, duplicate supervisors are rejected', async t => {
  const directory = temporary(t), state = { calls: 0, active: 0, maxActive: 0 }; let principal;
  const s = await AgentSupervisor.open({ directory, resolvePrincipal: () => principal, maxDelegationDepth: 1, createRuntime: factory(directory, state) }); t.after(() => s.close());
  await assert.rejects(() => AgentSupervisor.open({ directory, resolvePrincipal: () => alice, createRuntime: factory(directory, state) }), { code: 'AGENT_SUPERVISOR_LOCKED' });
  const a = s.register(alice, { name: 'first' }), b = s.register(alice, { name: 'second' });
  const parent = s.enqueue(a.id, alice, { input: 'parent', requestId: 'parent' });
  const child = s.enqueue(b.id, alice, { input: 'child', requestId: 'child', parentJobId: parent.id });
  assert.equal(child.depth, 1);
  assert.throws(() => s.enqueue(a.id, alice, { input: 'grandchild', requestId: 'grandchild', parentJobId: child.id }), { code: 'AGENT_DELEGATION_LIMIT' });
  s.start(); assert.equal((await finished(s, parent.id)).code, 'AGENT_OWNER_UNAVAILABLE'); assert.equal((await finished(s, child.id)).status, 'failed'); assert.equal(state.calls, 0);
  principal = { id: alice.id, permissions: [] };
  const revoked = s.enqueue(a.id, alice, { input: 'no saved grants', requestId: 'revoked' });
  assert.equal((await finished(s, revoked.id)).status, 'failed'); assert.equal(state.calls, 0);
});

test('actual process crash leaves interrupted work paused and deduplicated; restart never replays it', async t => {
  const directory = temporary(t);
  const script = `
    import { join } from 'node:path';
    import { Type } from 'typebox';
    import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
    import { PidaRuntime } from './dist/runtime.js';
    import { AgentSupervisor } from './dist/agent-supervisor.js';
    const principal = {id:'alice',permissions:['wait:read']};
    const s = await AgentSupervisor.open({directory:process.argv[1],resolvePrincipal:()=>principal,createRuntime:profile=>new PidaRuntime({storageDir:join(process.argv[1],'agents',profile.id,'runtime'),provider:()=>{const f=fauxProvider({tokensPerSecond:100000});f.setResponses([answer(call('wait',{}),{stopReason:'toolUse'})]);return {provider:f.provider,modelId:f.getModel().id}},tools:[{name:'wait',description:'hold until killed',parameters:Type.Object({}),permission:'wait:read',effect:'read',execute:async()=>{process.stdout.write('READY\\n');await new Promise(r=>setTimeout(r,60000));return {ok:true}}}]})});
    const a=s.register(principal,{name:'crash fixture'});s.enqueue(a.id,principal,{input:'crash fixture',requestId:'stable-request'});s.start();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, directory], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  await until(() => { if (child.exitCode !== null) assert.fail(stderr); return stdout.includes('READY'); });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  let factories = 0;
  const s = await AgentSupervisor.open({ directory, resolvePrincipal: () => alice, createRuntime: () => { factories++; throw new Error('must not replay'); } }); t.after(() => s.close());
  const a = s.list(alice)[0], old = s.jobs(a.id, alice)[0];
  assert.equal(a.paused, true); assert.equal(a.needsReconciliation, true); assert.equal(old.status, 'interrupted');
  assert.equal(s.enqueue(a.id, alice, { input: 'crash fixture', requestId: 'stable-request' }).id, old.id);
  const next = s.enqueue(a.id, alice, { input: 'new work', requestId: 'new-request' });
  s.start(); await delay(50); assert.equal(factories, 0); assert.equal(s.getJob(next.id, alice).status, 'queued');
});

test('host workspace lease contention queues without model retries or a busy loop', async t => {
  const directory = temporary(t), state = { calls: 0, active: 0, maxActive: 0 }; let held = true, attempts = 0;
  const base = factory(directory, state);
  const s = await AgentSupervisor.open({ directory, resolvePrincipal: () => alice, createRuntime: p => {
    const r = base(p), run = r.run.bind(r);
    r.run = (...args) => { attempts++; if (held) throw new PidaError('WORKSPACE_BUSY', 409); return run(...args); }; return r;
  } }); t.after(() => s.close());
  const a = s.register(alice, { name: 'lease fixture' }), job = s.enqueue(a.id, alice, { input: 'work', requestId: 'lease' });
  s.start(); await until(() => attempts === 1); await delay(70);
  assert.equal(attempts, 1); assert.equal(state.calls, 0); assert.equal(s.getJob(job.id, alice).status, 'queued');
  held = false; assert.equal((await finished(s, job.id)).status, 'completed'); assert.equal(state.calls, 1); assert.equal(attempts, 2);
});

test('interruption blocks all agents sharing the workspace until explicit authorized inspection, never replays old work', async t => {
  const directory = temporary(t), state = { calls: 0, active: 0, maxActive: 0 };
  const options = { directory, resolvePrincipal: () => alice, createRuntime: factory(directory, state, 150) };
  const s = await AgentSupervisor.open(options);
  const a = s.register(alice, { name: 'interrupted' }), b = s.register(alice, { name: 'blocked neighbor' });
  const first = s.enqueue(a.id, alice, { input: 'interrupted', requestId: 'old' });
  s.start(); await until(() => state.active === 1); await s.close();
  const next = await AgentSupervisor.open(options); t.after(() => next.close());
  const neighbor = next.enqueue(b.id, alice, { input: 'neighbor', requestId: 'neighbor' }); next.start();
  await delay(30); assert.equal(next.getJob(neighbor.id, alice).status, 'queued'); assert.equal(state.calls, 1);
  assert.deepEqual(next.blockedWorkspaceKeys(), ['shared-host-workspace']);
  await assert.rejects(() => next.resume(a.id, alice), { code: 'AGENT_RECOVERY_REQUIRED' });
  await assert.rejects(() => next.reconcile(a.id, alice, { inspected: true, effects: [] }), { code: 'FORBIDDEN' });
  const recoveryPrincipal = { ...alice, permissions: [...alice.permissions, 'pida:recover'] };
  await next.reconcile(a.id, recoveryPrincipal, { inspected: true, effects: [], note: 'Inspected fixture; read-only wait has no effects.' });
  assert.equal(next.get(a.id, alice).paused, true); assert.deepEqual(next.blockedWorkspaceKeys(), []);
  assert.equal((await finished(next, neighbor.id)).status, 'completed');
  assert.equal(next.getJob(first.id, alice).status, 'interrupted'); assert.equal(state.calls, 2);
  assert.ok(next.getJob(first.id, alice).reconciliation);
});
