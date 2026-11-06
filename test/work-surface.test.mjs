import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime, PidaWorkbench, workbenchPermissions } from '../dist/index.js';
import { WorkSurface } from '../dist/work-surface.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { PidaClient, formatWorkReview } from '../dist/client.js';
import { TuiController } from '../dist/tui-controller.js';
const owner = { id: 'owner', permissions: workbenchPermissions };

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pida-target-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bench = new PidaWorkbench(join(dir, 'bench')); let runtime, server, calls = 0;
  const start = async () => {
    const faux = fauxProvider();
    faux.setResponses([() => { calls++; return answer(call('workspace_write', { path: 'a.txt', content: 'changed\n' }), { stopReason: 'toolUse' }); }, () => { calls++; return answer('done'); }]);
    runtime = new PidaRuntime({ provider: () => ({ provider: faux.provider, modelId: faux.getModel().id }), tools: bench.tools(), storageDir: join(dir, 'runtime'),
      inspectArtifacts: p => bench.captureArtifacts(p), workSurface: new WorkSurface(join(dir, 'reviews'), bench) });
    server = createPidaServer({ runtime, workbench: bench, authenticate: staticTokenAuth([{ token: 'x'.repeat(32), principal: owner }, { token: 'y'.repeat(32), principal: { ...owner, id: 'other' } }]) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return new PidaClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: () => 'x'.repeat(32) });
  };
  const stop = async () => { server.closeAllConnections(); await new Promise(ok => server.close(ok)); await runtime.close(); };
  let client = await start(); t.after(stop);
  return { bench, client, calls: () => calls, restart: async () => { await stop(); return client = await start(); }, runtime: () => runtime, dir };
}
const target = f => ({ kind: 'file', resource: 'workbench', path: f.path, contentSha256: f.revision });

test('byte-bound target rejects stale/range/path errors before Pi, then both clients reopen one durable review', async t => {
  const f = await fixture(t); await f.bench.write(owner, 'a.txt', 'first\r\nsecond\r\n');
  const file = await f.client.readWorkspaceFile('a.txt');
  assert.equal(file.revision, createHash('sha256').update('first\r\nsecond\r\n').digest('hex'));
  const { sessionId } = await f.client.createSession();
  const bound = { ...target(file), kind: 'source-range', range: { startLine: 2, endLine: 2 } };
  await f.bench.write(owner, 'a.txt', 'external\n');
  await assert.rejects(f.client.run(sessionId, 'change selected', { requestId: 'r1', targets: [bound] }), /TARGET_STALE/);
  assert.equal(f.calls(), 0); assert.equal((await f.client.getSession(sessionId)).runs, 0);
  const latest = await f.client.readWorkspaceFile('a.txt');
  await assert.rejects(f.client.run(sessionId, 'bad', { requestId: 'bad-range', targets: [{ ...target(latest), kind: 'source-range', range: { startLine: 1, endLine: 99 } }] }), /TARGET_RANGE_INVALID/);
  await assert.rejects(f.client.run(sessionId, 'bad', { requestId: 'bad-path', targets: [{ ...target(latest), path: '../secret' }] }));
  assert.equal(f.calls(), 0);
  const options = { requestId: 'r1', targets: [target(latest)] };
  const result = await f.client.run(sessionId, 'change selected', options);
  assert.equal(result.status, 'completed'); assert.equal(f.calls(), 2);
  let review = await f.client.getWorkReview(sessionId, result.runId);
  assert.equal(review.binding.targets[0].contentSha256, latest.revision);
  assert.equal(review.before[0].content, 'external\n'); assert.equal(review.end[0].content, 'changed\n');
  assert.match(review.changes.diff, /\+changed/); assert.equal(review.freshness[0].state, 'current');
  assert.equal(review.manifest.verification_status, 'UNKNOWN');
  assert.match(formatWorkReview(review), /독립 과제 판정: 미확인/);
  const repeated = await f.client.run(sessionId, 'change selected', options);
  assert.equal(repeated.runId, result.runId); assert.equal(f.calls(), 2);
  await assert.rejects(f.client.run(sessionId, 'different', options), /WORK_REQUEST_CONFLICT/);
  await f.bench.write(owner, 'a.txt', 'later edit\n');
  review = await f.client.getWorkReview(sessionId, result.runId);
  assert.equal(review.freshness[0].state, 'changed'); assert.equal(review.verificationCurrent, 'changed');
  const otherClient = await f.restart();
  assert.deepEqual((await otherClient.getWorkReview(sessionId, result.runId)).binding, review.binding);
  assert.equal((await otherClient.run(sessionId, 'change selected', options)).runId, result.runId);
  assert.equal(f.calls(), 2);
  await assert.rejects(f.runtime().getWorkReview(sessionId, result.runId, { ...owner, id: 'other' }), /SESSION_NOT_FOUND/);
  await assert.rejects(f.runtime().getWorkReview(sessionId, result.runId, { id: 'owner', permissions: [] }), /FORBIDDEN/);
});

test('persisted admission without an outcome is inspectable and never automatically replayed', async t => {
  const f = await fixture(t); const { sessionId } = await f.client.createSession();
  const surface = new WorkSurface(join(f.dir, 'uncertain'), f.bench);
  await surface.prepare(sessionId, '11111111-1111-4111-a111-111111111111', owner, 'once', { requestId: 'uncertain' });
  const restored = new WorkSurface(join(f.dir, 'uncertain'), f.bench);
  assert.throws(() => restored.replay(sessionId, owner, 'once', { requestId: 'uncertain' }), /WORK_REQUEST_ALREADY_ACCEPTED/);
  assert.equal((await restored.get(sessionId, '11111111-1111-4111-a111-111111111111', owner)).status, 'interrupted');
});

test('TUI keeps a pinned range while browsing another file, restores refused draft and opens shared review without execution', async t => {
  const f = await fixture(t); await f.bench.write(owner, 'a.txt', 'one\ntwo\n'); await f.bench.write(owner, 'b.txt', 'another');
  const c = new TuiController(f.client, { pollMs: 60000 }); t.after(() => c.close());
  await c.start({ newSession: true });
  await c.submit('/read a.txt'); await c.submit('/bind 2 2');
  await c.submit('/read b.txt'); assert.equal(c.state.draftBinding.path, 'a.txt');
  assert.equal(c.state.draftBinding.range.startLine, 2);
  await f.bench.write(owner, 'a.txt', 'newer\nversion\n');
  let restored; c.onRestoreDraft = text => { restored = text; };
  await c.submit('change A'); await c.settled();
  assert.equal(restored, 'change A'); assert.equal(f.calls(), 0); assert.equal(c.state.draftBinding.path, 'a.txt');
  await c.submit('/read a.txt'); await c.submit('/bind 2 2'); await c.submit('/read b.txt');
  await c.submit('change A'); await c.settled();
  assert.equal(f.calls(), 2); await c.submit('/review');
  assert.match(c.state.panel.text, /workbench\/a.txt:2-2/);
  assert.match(c.state.panel.text, /\+changed/); assert.equal(f.calls(), 2);
  const same = await f.client.listWorkReviews(c.state.session.sessionId);
  assert.equal(same.reviews.length, 1);
});
