import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { PidaClient } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';

test('HTTP response loss and concurrent retries admit one input; receipts never replay after restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pida-input-retry-'));
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), requests = [];
  const owner = { id: 'owner', permissions: ['fixture:hold'] }, token = 'a'.repeat(32);
  const model = fauxProvider({ tokensPerSecond: 100000 });
  model.setResponses([answer(call('hold', {}), { stopReason: 'toolUse' }), context => { requests.push(JSON.stringify(context)); return answer('steered'); }, context => { requests.push(JSON.stringify(context)); return answer('follow-up done'); }, answer('fresh run')]);
  const runtime = new PidaRuntime({ storageDir: directory, provider: () => ({ provider: model.provider, modelId: model.getModel().id }), tools: [{ name: 'hold', description: 'test', parameters: Type.Object({}), permission: 'fixture:hold', effect: 'read', async execute() { entered.resolve(); await release.promise; return {}; } }] });
  const server = createPidaServer({ runtime, authenticate: staticTokenAuth([{ token, principal: owner }, { token: 'b'.repeat(32), principal: { ...owner, id: 'other' } }]) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { release.resolve(); await runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`, bodies = [];
  let lose = true;
  const client = new PidaClient({ baseUrl, token: () => token, fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith('/steer')) {
      bodies.push(JSON.parse(init.body));
      if (lose) { lose = false; assert.equal(response.status, 200); await response.json(); throw new TypeError('simulated lost ACK'); }
    }
    return response;
  } });
  const { sessionId } = await client.createSession(), running = runtime.run(sessionId, owner, 'hold'); await entered.promise;
  const runId = runtime.getSession(sessionId, owner).activeRunId;
  assert.equal((await client.getInfo()).capabilities.queuedInputDeduplication, 'current-run');
  await assert.rejects(client.steer(sessionId, 'ONE_STEERING_INPUT', runId), /simulated lost ACK/);
  const receipt = await client.steer(sessionId, 'ONE_STEERING_INPUT', runId);
  assert.equal(bodies[0].requestId, bodies[1].requestId); assert.equal(receipt.requestId, bodies[0].requestId);
  assert.equal(runtime.getSession(sessionId, owner).pendingInput.steering, 1);
  await assert.rejects(client.steer(sessionId, 'CHANGED', runId, receipt.requestId), { code: 'INPUT_REQUEST_CONFLICT' });
  await assert.rejects(client.followUp(sessionId, 'ONE_STEERING_INPUT', runId, receipt.requestId), { code: 'INPUT_REQUEST_CONFLICT' });
  const duplicates = await Promise.all([client.followUp(sessionId, 'ONE_FOLLOWUP_INPUT', runId, 'follow-1'), client.followUp(sessionId, 'ONE_FOLLOWUP_INPUT', runId, 'follow-1')]);
  assert.deepEqual(duplicates[0], duplicates[1]); assert.equal(runtime.getSession(sessionId, owner).pendingInput.followUp, 1);
  const other = new PidaClient({ baseUrl, token: () => 'b'.repeat(32) });
  await assert.rejects(other.steer(sessionId, 'ONE_STEERING_INPUT', runId, receipt.requestId), { code: 'SESSION_NOT_FOUND' });
  await assert.rejects(client.steer(sessionId, 'invalid id', runId, {}), { code: 'INVALID_REQUEST_ID' });
  release.resolve(); assert.equal((await running).status, 'completed');
  assert.match(requests[0], /ONE_STEERING_INPUT/); assert.match(requests.at(-1), /ONE_FOLLOWUP_INPUT/);
  assert.deepEqual(await client.steer(sessionId, 'ONE_STEERING_INPUT', runId, receipt.requestId), receipt, 'a lost ACK can be recovered after settlement, until the next run');
  assert.equal(receipt.durable, false);
  await runtime.close();
  const restored = new PidaRuntime({ storageDir: directory, provider: () => ({ provider: model.provider, modelId: model.getModel().id }) });
  try {
    await restored.resumeSession(sessionId, owner);
    await assert.rejects(restored.steer(sessionId, owner, 'ONE_STEERING_INPUT', runId, receipt.requestId), { code: 'RUN_ID_MISMATCH' });
    assert.deepEqual(restored.getSession(sessionId, owner).pendingInput, { steering: 0, followUp: 0, durable: false });
  } finally { await restored.close(); }
});
