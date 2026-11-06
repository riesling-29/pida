// Actual Pi session + CodemodeSandbox integration. Model choices are scripted, not live-LLM evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { normalizeCodemodeConfig } from '../dist/codemode.js';

const principal = { id: 'compose-owner', permissions: ['programs:compose', 'lookup:read', 'records:write', 'pida:recover'] };
const parameters = Type.Object({ value: Type.String() }, { additionalProperties: false });
const noArguments = Type.Object({}, { additionalProperties: false });
const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('');
const tool = (name, execute, effect = 'read', schema = noArguments) => ({ name, description: name, permission: effect === 'read' ? 'lookup:read' : 'records:write', effect, parameters: schema, execute });
const compose = code => answer(call('program_compose', { code }, { id: 'compose-root' }), { stopReason: 'toolUse' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, code, tools, options = {}, who = principal) {
  const f = fauxProvider({ tokensPerSecond: 100000 });
  let observed;
  f.setResponses([compose(code), context => {
    const result = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'program_compose').at(-1);
    if (result) { try { observed = JSON.parse(textOf(result)); } catch { observed = { raw: textOf(result) }; } }
    return answer('Reported completion; execution evidence remains authoritative.');
  }]);
  const runtime = new PidaRuntime({
    provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools,
    codemode: { enabled: true, tools: tools.map(item => item.name), timeoutMs: 5000 },
    ...options,
  });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(who);
  return { runtime, sessionId, f, who, observed: () => observed, run: (signal, emit) => runtime.run(sessionId, who, 'Run the authorized tool composition.', emit, signal) };
}

async function stateDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-codemode-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function nestedTrace(runtime, sessionId, who) {
  const traces = runtime.getTrace(sessionId, who);
  const root = traces.find(row => row.type === 'tool_started' && row.toolName === 'program_compose');
  assert.ok(root, 'the outer composition is an observed tool call');
  return { traces, root, nested: traces.filter(row => row.parentToolCallId === root.toolCallId) };
}

test('actual Pi compose runs two declared reads concurrently, passes JSON to a guarded write, and exports parent IDs', { timeout: 15000 }, async t => {
  const bothStarted = Promise.withResolvers(); let reads = 0, saved, saveContext;
  const read = number => async (_args, { signal }) => {
    if (++reads === 2) bothStarted.resolve();
    await bothStarted.promise; signal.throwIfAborted(); return { value: number };
  };
  const f = await fixture(t, `
    const [a, b] = await Promise.all([tools.read_alpha({}), tools.read_beta({})]);
    const saved = await tools.save_record({ value: String(a.value + b.value) });
    text('read and write finished'); return saved;
  `, [tool('read_alpha', read(2)), tool('read_beta', read(3)), tool('save_record', async (args, context) => { saved = args.value; saveContext = context; return { saved: args.value }; }, 'write', parameters)]);
  const result = await f.run();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(reads, 2); assert.equal(saved, '5');
  assert.equal(f.observed().ok, true); assert.deepEqual(f.observed().value, { saved: '5' });
  assert.equal(f.observed().autoReplay, false);
  const { root, nested } = nestedTrace(f.runtime, f.sessionId, principal);
  assert.deepEqual(nested.filter(row => row.type === 'tool_started').map(row => row.toolName).sort(), ['read_alpha', 'read_beta', 'save_record']);
  assert.equal(nested.filter(row => row.type === 'tool_completed').length, 3);
  assert.ok(saveContext.toolCallId.startsWith(root.toolCallId + '/'));
  assert.match(saveContext.idempotencyKey, /^[a-f0-9]{64}$/);
  const bundle = f.runtime.exportRun(f.sessionId, result.runId, principal);
  assert.equal(bundle.events.filter(event => event.activity === 'tool_started' && event.payload.parent_tool_call_id === root.toolCallId).length, 3);
  assert.doesNotMatch(JSON.stringify(bundle), /read and write finished|String\(a\.value/);
});

test('Promise.all writes stay serial inside the Pi nested-call execution lane', { timeout: 15000 }, async t => {
  let active = 0, maximum = 0; const applied = [];
  const f = await fixture(t, `return await Promise.all([tools.save_record({value:'first'}), tools.save_record({value:'second'})]);`, [tool('save_record', async ({ value }) => {
    maximum = Math.max(maximum, ++active); await delay(15); applied.push(value); active--; return { value };
  }, 'write', parameters)]);
  const result = await f.run();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(maximum, 1); assert.deepEqual(applied, ['first', 'second']);
});

test('nested argument validation runs before the Pida changing tool and does not create effects', { timeout: 15000 }, async t => {
  let writes = 0;
  const f = await fixture(t, `await tools.save_record({});`, [tool('save_record', async () => { writes++; return {}; }, 'write', parameters)]);
  const result = await f.run();
  assert.equal(result.status, 'failed'); assert.equal(writes, 0);
  assert.equal(f.runtime.getRecovery(f.sessionId, principal).pendingEffects.length, 0);
  const { nested } = nestedTrace(f.runtime, f.sessionId, principal);
  assert.ok(nested.some(row => row.type === 'tool_failed' && row.toolName === 'save_record'));
});

test('composition permission and every nested host policy are enforced without executing denied code', { timeout: 15000 }, async t => {
  let reads = 0;
  const business = tool('lookup_record', async () => { reads++; return { found: true }; });
  const denied = { ...principal, permissions: ['lookup:read'] };
  const outer = await fixture(t, `return await tools.lookup_record({});`, [business], {}, denied);
  const deniedResult = await outer.run();
  assert.equal(deniedResult.status, 'failed'); assert.equal(deniedResult.code, 'TOOL_FORBIDDEN'); assert.equal(reads, 0);
  const decisions = [];
  const inner = await fixture(t, `return await tools.lookup_record({});`, [business], { authorize: request => { decisions.push(request.toolName); return request.toolName !== 'lookup_record'; } });
  const innerResult = await inner.run();
  assert.equal(innerResult.status, 'failed'); assert.equal(reads, 0);
  assert.deepEqual(decisions, ['program_compose', 'lookup_record']);
  assert.ok(nestedTrace(inner.runtime, inner.sessionId, principal).nested.some(row => row.type === 'tool_failed'));
  const noReadPermission = { ...principal, permissions: ['programs:compose'] };
  const unpermitted = await fixture(t, `return await tools.lookup_record({});`, [business], {}, noReadPermission);
  assert.equal((await unpermitted.run()).status, 'failed'); assert.equal(reads, 0);
});

test('only allowlisted tools enter the sandbox; recursive composition and ambient host APIs are unavailable', { timeout: 15000 }, async t => {
  let privateCalls = 0;
  const f = await fixture(t, `return { names: ALL_TOOLS.map(tool => tool.name), process: typeof process, fetch: typeof fetch, require: typeof require };`, [
    tool('lookup_record', async () => ({ ok: true })), tool('private_record', async () => { privateCalls++; return {}; }),
  ], { codemode: { enabled: true, tools: ['lookup_record'], timeoutMs: 5000 } });
  assert.equal((await f.run()).status, 'completed');
  assert.deepEqual(f.observed().value, { names: ['lookup_record'], process: 'undefined', fetch: 'undefined', require: 'undefined' });
  assert.equal(privateCalls, 0);
  const recursive = await fixture(t, `await tools.program_compose({code:'return 1'});`, [tool('lookup_record', async () => ({}))]);
  assert.equal((await recursive.run()).status, 'failed');
  assert.equal(nestedTrace(recursive.runtime, recursive.sessionId, principal).nested.length, 0);
  const disabled = new PidaRuntime({ provider: () => ({ provider: f.f.provider, modelId: f.f.getModel().id }), tools: [], codemode: { enabled: false, tools: [] } });
  t.after(() => disabled.close());
  assert.equal(disabled.getInfo(principal).tools.some(item => item.name === 'program_compose'), false);
});

test('a script failure after a completed write preserves its effect receipt and never automatically repeats the composition', { timeout: 15000 }, async t => {
  const directory = await stateDirectory(t); let writes = 0;
  const f = await fixture(t, `await tools.save_record({value:'applied-once'}); throw new Error('script failed after write');`, [tool('save_record', async () => { writes++; return { saved: true }; }, 'write', parameters)], { storageDir: directory });
  const result = await f.run();
  assert.equal(result.status, 'failed'); assert.equal(writes, 1); assert.equal(f.f.state.callCount, 2);
  const receipts = JSON.parse(await readFile(join(directory, 'effects', f.sessionId + '.json'), 'utf8'));
  assert.equal(receipts.length, 1, 'the composition itself adds no duplicate changing receipt');
  assert.equal(receipts[0].toolName, 'save_record'); assert.equal(receipts[0].state, 'applied');
  assert.ok(receipts[0].toolCallId.includes('/'));
  assert.equal(f.runtime.getRecovery(f.sessionId, principal).pendingEffects.length, 0);
  assert.equal(f.observed().autoReplay, false);
});

test('cancelling a composition aborts its actual nested tool and retains uncertain side effects without replay', { timeout: 15000 }, async t => {
  const entered = Promise.withResolvers(); let writes = 0, sawAbort = false;
  const f = await fixture(t, `await tools.save_record({value:'external mutation'});`, [tool('save_record', async (_args, { signal }) => {
    writes++; entered.resolve();
    await new Promise((resolve, reject) => {
      const abort = () => { sawAbort = true; reject(new Error('cancelled after mutation')); };
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
  }, 'write', parameters)]);
  const abort = new AbortController(), execution = f.run(abort.signal);
  await entered.promise; abort.abort(); const result = await execution;
  assert.equal(result.status, 'cancelled'); assert.equal(writes, 1); assert.equal(sawAbort, true);
  const pending = f.runtime.getRecovery(f.sessionId, principal).pendingEffects;
  assert.equal(pending.length, 1); assert.equal(pending[0].toolName, 'save_record'); assert.equal(result.recovery.autoRetry, false);
  f.f.setResponses([compose(`await tools.save_record({value:'must not repeat'});`), answer('cannot continue')]);
  const firstTrace = f.runtime.getTrace(f.sessionId, principal);
  const nestedEnd = firstTrace.findIndex(event => event.toolName === 'save_record' && event.type === 'tool_failed');
  const parentEnd = firstTrace.findIndex(event => event.toolName === 'program_compose' && event.type === 'tool_failed');
  const runEnd = firstTrace.findIndex(event => event.type === 'run_finished');
  assert.ok(nestedEnd >= 0 && parentEnd > nestedEnd && runEnd > parentEnd, 'nested outcomes settle before parent and run termination');
  const retry = await f.runtime.run(f.sessionId, principal, 'Continue without inspection');
  assert.equal(retry.code, 'EFFECT_STATE_UNKNOWN'); assert.equal(writes, 1);
});

test('local call budget prevents additional nested executions and reports failure even if the model declares completion', { timeout: 15000 }, async t => {
  let count = 0;
  const f = await fixture(t, `for(let i=0;i<3;i++) await tools.lookup_record({});`, [tool('lookup_record', async () => ({ count: ++count }))], { codemode: { enabled: true, tools: ['lookup_record'], maxCalls: 2, timeoutMs: 5000 } });
  const result = await f.run();
  assert.equal(result.status, 'failed'); assert.equal(count, 2);
  assert.equal(f.observed().ok, false); assert.equal(f.observed().autoReplay, false);
});

test('the sandbox deadline ends a CPU loop and output is explicitly bounded', { timeout: 15000 }, async t => {
  const timed = await fixture(t, `while(true) {}`, [], { codemode: { enabled: true, tools: [], timeoutMs: 100, memoryLimitBytes: 8 * 1024 * 1024 } });
  const result = await timed.run();
  assert.equal(result.status, 'failed'); assert.equal(timed.observed().ok, false); assert.match(timed.observed().code, /TIMEOUT/);
  const limited = await fixture(t, `text('x'.repeat(5000)); return { retained: true };`, [], { codemode: { enabled: true, tools: [], maxOutputChars: 256, timeoutMs: 5000 } });
  assert.equal((await limited.run()).status, 'completed');
  assert.equal(limited.observed().truncated, true); assert.ok(JSON.stringify(limited.observed()).length <= 256); assert.equal(limited.observed().autoReplay, false);
});


test('the VM memory cap stops allocation before a following write can execute', { timeout: 15000 }, async t => {
  let writes = 0;
  const f = await fixture(t, `const huge = new Array(5000000).fill('x'); await tools.save_record({value:String(huge.length)});`, [tool('save_record', async () => { writes++; return {}; }, 'write', parameters)], { codemode: { enabled: true, tools: ['save_record'], memoryLimitBytes: 8 * 1024 * 1024, timeoutMs: 5000 } });
  const result = await f.run();
  assert.equal(result.status, 'failed'); assert.equal(writes, 0); assert.equal(f.observed().ok, false);
  assert.equal(f.runtime.getRecovery(f.sessionId, principal).pendingEffects.length, 0);
});


test('an abort-ignoring nested write keeps its host lease and mutation fences until the real callback settles', { timeout: 15000 }, async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  let acquired = 0, released = 0, writes = 0;
  const f = await fixture(t, `await tools.save_record({value:'slow actual write'});`, [tool('save_record', async () => {
    writes++; entered.resolve(); await complete.promise; return { saved: true };
  }, 'write', parameters)], { singleWriter: true, acquireRunLease: () => {
    assert.equal(acquired - released, 0, 'a new writer must not acquire an outstanding host lease');
    acquired++; return () => { released++; };
  } });
  try {
    const abort = new AbortController(), execution = f.run(abort.signal);
    await entered.promise; abort.abort();
    const result = await execution;
    assert.equal(result.status, 'cancelled'); assert.equal(writes, 1); assert.equal(released, 0);
    assert.throws(() => f.runtime.assertIdle(), { code: 'PROVIDER_BUSY' });
    const effect = f.runtime.getRecovery(f.sessionId, principal).pendingEffects[0];
    assert.ok(effect); assert.throws(() => f.runtime.reconcileEffect(f.sessionId, principal, effect.id, 'applied'), { code: 'SESSION_BUSY' });
    await assert.rejects(f.runtime.deleteSession(f.sessionId, principal), { code: 'SESSION_BUSY' });
    await assert.rejects(f.runtime.run(f.sessionId, principal, 'same session cannot race'), { code: 'SESSION_BUSY' });
    const next = await f.runtime.createSession(principal);
    await assert.rejects(f.runtime.run(next.sessionId, principal, 'other writer cannot race'), { code: 'WORKSPACE_BUSY' });
    assert.equal(acquired, 1); assert.equal(released, 0);
    complete.resolve();
    for (let i=0;i<100 && released===0;i++) await delay(5);
    assert.equal(released, 1, 'only actual callback settlement releases the host lease');
    f.runtime.reconcileEffect(f.sessionId, principal, effect.id, 'applied');
    f.f.setResponses([answer('The pending callback settled and its state was inspected.')]);
    assert.equal((await f.runtime.run(next.sessionId, principal, 'continue after settlement')).status, 'completed');
    assert.equal(acquired, 2); assert.equal(released, 2); assert.equal(writes, 1);
  } finally { complete.resolve(); }
});


test('host configuration rejects recursive, missing, unknown, and unbounded composition capabilities', () => {
  for (const value of [{ enabled: true }, { enabled: true, tools: ['program_compose'] }, { enabled: true, tools: ['lookup_record'], maxCalls: 65 }, { enabled: true, tools: [], timeoutMs: Infinity }, { enabled: true, tools: [], memoryLimitBytes: 0 }, { enabled: true, tools: [], maxOutputChars: 25000 }, { enabled: true, tools: [], escape: true }]) assert.throws(() => normalizeCodemodeConfig(value), /INVALID_CODEMODE/);
  assert.throws(() => new PidaRuntime({ provider: () => { throw new Error('must not call provider'); }, codemode: { enabled: true, tools: ['missing_tool'] } }), /CODEMODE_TOOL_UNAVAILABLE/);
  assert.equal(normalizeCodemodeConfig({ enabled: true, tools: [] }).maxCalls, 16);
});

test('the composition deadline aborts a pending host authorization without invoking the business tool', { timeout: 10000 }, async t => {
  let executed = false, aborted = false;
  const entered = Promise.withResolvers();
  const f = await fixture(t, `await tools.lookup_record({});`, [tool('lookup_record', async () => { executed = true; return {}; })], {
    codemode: { enabled: true, tools: ['lookup_record'], timeoutMs: 500 },
    authorize: request => request.toolName === 'program_compose' ? true : new Promise(() => { entered.resolve(); request.signal.addEventListener('abort', () => { aborted = true; }, { once: true }); }),
  });
  const execution = f.run(); await entered.promise;
  assert.equal((await execution).status, 'failed'); assert.equal(executed, false); assert.equal(aborted, true);
  assert.ok(f.runtime.getTrace(f.sessionId, principal).some(event => event.type === 'tool_failed' && event.toolName === 'program_compose'));
});
