import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { codingPacks } from '../dist/coding-packs.js';
const owner = { id: 'owner', permissions: ['workbench:read', 'edit'] };
async function fixture(t, responses, options = {}) {
  const f = fauxProvider({ tokensPerSecond: 100000, models: [{ id: 'local', contextWindow: 16384, maxTokens: 4096 }] });
  f.setResponses(responses);
  const runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), ...options });
  t.after(() => runtime.close());
  return { runtime, f, id: (await runtime.createSession(owner)).sessionId };
}
test('length-truncated tool is not executed; one smaller retry can complete', async t => {
  let applied = 0;
  const { runtime, id, f } = await fixture(t, [
    answer(call('save', {}), { stopReason: 'length' }),
    context => { assert.match(JSON.stringify(context.messages), /much smaller edits/); return answer(call('save', { text: 'complete' }), { stopReason: 'toolUse' }); },
    answer('Saved.'),
  ], { tools: [{ name: 'save', permission: 'edit', description: 'save', parameters: Type.Object({ text: Type.String() }), async execute() { applied++; return { ok: true }; } }] });
  const result = await runtime.run(id, owner, 'Save my change.');
  assert.equal(result.status, 'completed'); assert.equal(result.text, 'Saved.');
  assert.equal(applied, 1); assert.equal(f.state.callCount, 3);
  assert.equal(runtime.getTrace(id, owner).filter(e => e.type === 'output_retry').length, 1);
});
test('repeated truncation ends with OUTPUT_LIMIT and never reports success', async t => {
  const { runtime, id, f } = await fixture(t, [answer('partial', { stopReason: 'length' }), answer('partial again', { stopReason: 'length' })]);
  const result = await runtime.run(id, owner, 'long change');
  assert.equal(result.status, 'limited'); assert.equal(result.code, 'OUTPUT_LIMIT'); assert.equal(f.state.callCount, 2);
});
test('manual compaction and handoff retain recent requirements and enforce ownership', async t => {
  const { runtime, id, f } = await fixture(t, [answer('Understood.'), answer('Goal: keep sidebar; pending: chart.'), answer('Goal: keep sidebar; pending: chart.')], { autoCompaction: false });
  await runtime.run(id, owner, 'Keep the sidebar and add a chart.');
  await assert.rejects(runtime.compactSession(id, { ...owner, id: 'stranger' }), /SESSION_NOT_FOUND/);
  const next = await runtime.compactSession(id, owner, true);
  assert.notEqual(next.sessionId, id);
  assert.ok(runtime.listSessions(owner).some(s => s.sessionId === id));
  f.setResponses([context => { assert.match(JSON.stringify(context.messages), /sidebar/); return answer('Continuing.'); }]);
  // New sessions use the same faux provider handle, so the request exposes transferred context.
  assert.equal((await runtime.run(next.sessionId, owner, 'Continue')).text, 'Continuing.');
});
test('automatic compaction emits events and does not lose the current response after history shrinks', async t => {
  const { runtime, id, f } = await fixture(t, []);
  let turn = 0;
  const respond = context => {
    f.appendResponses([respond]);
    if (JSON.stringify(context.messages.at(-1)).includes('<conversation>')) return answer('Summary: preserve sidebar.');
    return answer('Response ' + ++turn);
  };
  f.setResponses([respond]);
  for (let i = 1; i <= 4; i++) {
    const result = await runtime.run(id, owner, 'Requirement: preserve sidebar. ' + 'data '.repeat(2800));
    assert.equal(result.status, 'completed'); assert.equal(result.text, 'Response ' + i);
  }
  assert.ok(runtime.getTrace(id, owner).some(e => e.type === 'compaction_completed'));
});
test('only selected pinned coding guides are readable through the tool', async t => {
  const packs = codingPacks(['verification']);
  assert.equal(packs.skills.length, 1);
  const tool = packs.tools[0];
  assert.match((await tool.execute({ id: 'verification' })).guidance, /verification/i);
  await assert.rejects(tool.execute({ id: 'debugging' }), /CODING_GUIDE_NOT_FOUND/);
  await assert.rejects(tool.execute({ id: '../../.env' }), /CODING_GUIDE_NOT_FOUND/);
  assert.equal(codingPacks([]).tools.length, 0);
});
test('empty responses fail explicitly and short conversations report nothing to compact', async t => {
  const { runtime, id } = await fixture(t, [answer('')]);
  const result = await runtime.run(id, owner, 'hello');
  assert.equal(result.code, 'EMPTY_RESPONSE');
  await assert.rejects(runtime.compactSession(id, owner), /NOTHING_TO_COMPACT/);
});
test('failed or truncated summaries preserve the original conversation', async t => {
  const { runtime, id, f } = await fixture(t, [answer('Understood.'), answer('Recent.')], { autoCompaction: false });
  await runtime.run(id, owner, 'Critical requirement ' + 'x'.repeat(14000));
  await runtime.run(id, owner, 'Recent requirement ' + 'y'.repeat(14000));
  const before = runtime.getSession(id, owner).messages;
  f.setResponses([answer('unfinished summary', { stopReason: 'length' })]);
  await assert.rejects(runtime.compactSession(id, owner), /COMPACTION_FAILED/);
  assert.deepEqual(runtime.getSession(id, owner).messages, before);
});
