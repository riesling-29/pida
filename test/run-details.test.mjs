import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { PidaClient } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';

test('owned tool details preserve actual failure and run attribution across restart without leaking to observations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-details-'));
  const owner = { id: 'alice', permissions: ['check:run'] };
  const provider = () => {
    const f = fauxProvider({ tokensPerSecond: 100000 });
    f.setResponses([answer(call('check_result', { command: 'run-private-check' }), { stopReason: 'toolUse' }), answer('Model claims completion')]);
    return { provider: f.provider, modelId: f.getModel().id };
  };
  const options = { storageDir: root, provider, maxTraceEvents: 2, tools: [{ name: 'check_result', permission: 'check:run', effect: 'read', description: 'Test fixture',
    parameters: Type.Object({ command: Type.String() }), classifyResult: () => ({ status: 'failed', code: 'TEST_FAILED' }),
    execute: async () => ({ ok: false, output: '', stderr: 'private-test-output', exitCode: 7, cwd: '/fixture-at-execution', artifact_refs: [{ id: 'output_' + 'a'.repeat(32), readTool: 'program_fixture_output', stream: 'stderr' }] }) }] };
  let runtime = new PidaRuntime(options);
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  const { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, 'do work');
  assert.equal(result.status, 'failed');
  let detail = runtime.getSessionTools(sessionId, owner);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].runId, result.runId);
  assert.equal(detail.items[0].status, 'failed');
  assert.equal(detail.items[0].exitCode, 7);
  assert.equal(detail.items[0].command, 'run-private-check');
  assert.equal(detail.items[0].output, '');
  assert.equal(detail.items[0].stderr, 'private-test-output');
  assert.deepEqual(detail.items[0].artifactRefs, ['output_' + 'a'.repeat(32) + ' · program_fixture_output']);
  assert.equal(runtime.getSessionTools(sessionId, { id: 'alice', permissions: [] }).items.length, 0);
  assert.throws(() => runtime.getSessionTools(sessionId, { id: 'bob', permissions: owner.permissions }), /SESSION_NOT_FOUND/);
  assert.doesNotMatch(JSON.stringify(runtime.exportRun(sessionId, result.runId, owner)), /run-private-check|private-test-output/);
  const page = runtime.getTracePage(sessionId, owner);
  assert.equal(page.truncated, true);
  assert.equal(runtime.getTracePage(sessionId, owner, page.nextSequence - 1).events.length, 0);
  assert.equal(runtime.getTracePage(sessionId, owner, page.nextSequence - 1).truncated, false);
  assert.throws(() => runtime.getTracePage(sessionId, owner, -1), /INVALID_CURSOR/);
  await runtime.close(); runtime = new PidaRuntime(options);
  await runtime.resumeSession(sessionId, owner);
  detail = runtime.getSessionTools(sessionId, owner);
  assert.equal(detail.items[0].runId, result.runId);
  assert.equal(detail.items[0].exitCode, 7);
});

test('HTTP client exposes bounded detail and trace cursor under session ownership', async t => {
  const runtime = new PidaRuntime({ provider: () => { const f = fauxProvider(); f.setResponses([answer('hi')]); return { provider: f.provider, modelId: f.getModel().id }; } });
  const token = 'details-fixture-token'.repeat(3), other = 'other-fixture-token'.repeat(3);
  const server = createPidaServer({ runtime, authenticate: staticTokenAuth([{ token, principal: { id: 'alice', permissions: [] } }, { token: other, principal: { id: 'bob', permissions: [] } }]) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await runtime.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new PidaClient({ baseUrl, token: () => token });
  const { sessionId } = await client.createSession();
  assert.equal((await client.getSessionTools(sessionId)).historyScope, 'retained-pi-context');
  assert.equal((await client.getTrace(sessionId, 0)).nextSequence, 1);
  await assert.rejects(() => client.getTrace(sessionId, NaN), { code: 'INVALID_CURSOR' });
  await assert.rejects(() => new PidaClient({ baseUrl, token: () => other }).getSessionTools(sessionId), { code: 'SESSION_NOT_FOUND' });
});
