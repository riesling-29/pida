import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { PidaClient } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';

async function fixture(t, options = {}) {
  let release, started;
  const gate = new Promise(r => { release = r; }), entered = new Promise(r => { started = r; });
  const principal = { id: 'alice', permissions: ['gate:read'] }, token = 'fixture-only'.repeat(4);
  const provider = () => {
    const f = fauxProvider({ tokensPerSecond: 100000 });
    f.setResponses([answer(call('gate', {}), { stopReason: 'toolUse' }), answer('finished')]);
    return { provider: f.provider, modelId: f.getModel().id };
  };
  const runtime = new PidaRuntime({ provider, singleWriter: true, evidenceLimits: ['HOST_PROJECT_ARTIFACTS_NOT_CAPTURED'],
    tools: [{ name: 'gate', description: 'controlled test wait', parameters: Type.Object({}), permission: 'gate:read', effect: 'read',
      execute: async (_, { signal }) => { started(); await Promise.race([gate, new Promise(r => signal.addEventListener('abort', r, { once: true }))]); return { ok: true }; } }], ...options });
  const server = createPidaServer({ runtime, authenticate: staticTokenAuth([{ token, principal }, { token: 'other'.repeat(9), principal: { id: 'bob', permissions: [] } }]) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new PidaClient({ baseUrl, token: () => token });
  t.after(async () => { release(); await runtime.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { runtime, client, principal, baseUrl, token, release, entered };
}
async function settled(client, id) {
  for (let i = 0; i < 200; i++) { const state = await client.getSession(id); if (!state.running) return state; await delay(10); }
  assert.fail('run did not settle');
}
test('detached stream survives disconnect, reattaches via owned trace, and executes once', async t => {
  const f = await fixture(t), { sessionId: id } = await f.client.createSession();
  const stream = f.client.stream(id, 'work', { disconnectPolicy: 'continue' });
  await stream.next(); await f.entered; await stream.return(); await delay(50);
  assert.equal((await f.client.getSession(id)).running, true);
  const trace = await f.client.getTrace(id); assert.ok(trace.events.some(e => e.type === 'tool_started'));
  const stranger = new PidaClient({ baseUrl: f.baseUrl, token: () => 'other'.repeat(9) });
  await assert.rejects(() => stranger.getTrace(id), { code: 'SESSION_NOT_FOUND' });
  const second = await f.client.createSession();
  await assert.rejects(() => f.client.run(second.sessionId, 'conflicting edit'), { code: 'WORKSPACE_BUSY' });
  f.release(); const state = await settled(f.client, id);
  assert.equal(state.lastStatus, 'completed'); assert.equal(state.runs, 1);
  const end = (await f.client.getTrace(id)).events.find(e => e.type === 'run_finished');
  const manifest = await f.client.getManifest(id, end.runId);
  assert.equal(manifest.verification_status, 'UNKNOWN'); assert.ok(manifest.known_limits.includes('HOST_PROJECT_ARTIFACTS_NOT_CAPTURED'));
});
test('legacy disconnect still cancels and detached explicit cancellation still stops', async t => {
  for (const policy of [undefined, 'continue']) {
    const f = await fixture(t), { sessionId: id } = await f.client.createSession();
    const stream = f.client.stream(id, 'work', { disconnectPolicy: policy });
    await stream.next(); await f.entered; await stream.return();
    if (policy) { await delay(25); assert.equal((await f.client.getSession(id)).running, true); await f.client.cancel(id); }
    assert.equal((await settled(f.client, id)).lastStatus, 'cancelled');
  }
});
test('detached runs retain runtime deadlines and invalid policy is rejected before execution', async t => {
  const f = await fixture(t, { maxRunMs: 250 }), { sessionId: id } = await f.client.createSession();
  await assert.rejects(() => f.client.run(id, 'bad', { disconnectPolicy: 'forever' }), { code: 'INVALID_DISCONNECT_POLICY' });
  assert.equal((await f.client.getSession(id)).runs, 0);
  const stream = f.client.stream(id, 'work', { disconnectPolicy: 'continue' }); await stream.next(); await stream.return();
  assert.equal((await settled(f.client, id)).lastStatus, 'limited');
  assert.equal((await f.client.getTrace(id)).events.at(-1).code, 'RUN_TIMEOUT');
});
