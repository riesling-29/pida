import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { activateMcp } from '../dist/mcp.js';
import { PidaRuntime } from '../dist/runtime.js';

const serverScript = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
const principal = { id: 'owner', permissions: ['mcp:test:read', 'mcp:test:write'] };
const context = (signal = new AbortController().signal, who = principal) => ({ principal: who, sessionId: 's', runId: 'r', signal });
async function until(check, message = 'MCP fixture did not reach expected state') {
  const end = Date.now() + 5000;
  do { const value = await check(); if (value) return value; await delay(10); } while (Date.now() < end);
  assert.fail(message);
}
async function fixture(t, state = {}, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-mcp-')), stateFile = join(directory, 'state.json'), logFile = join(directory, 'events.jsonl');
  await writeFile(stateFile, JSON.stringify(state)); await writeFile(logFile, '');
  const resources = [];
  t.after(async () => { for (const resource of resources.reverse()) await resource.close(); await rm(directory, { recursive: true, force: true }); });
  const server = { id: 'fixture', transport: { kind: 'stdio', command: process.execPath, args: [serverScript], envFrom: { MCP_FIXTURE_STATE: 'FIXTURE_STATE_PATH', MCP_FIXTURE_LOG: 'FIXTURE_LOG_PATH' } },
    connectTimeoutMs: 1500, callTimeoutMs: 1000, reconnect: { maxAttempts: 2, baseDelayMs: 20, maxDelayMs: 40 },
    tools: Object.fromEntries(['echo', 'wait', 'crash', 'list_change', 'env_keys'].map(name => [name, { permission: 'mcp:test:read', effect: 'read' }]).concat([['write_crash', { permission: 'mcp:test:write', effect: 'write' }]])), ...overrides };
  const options = { cwd: directory, env: { ...process.env, FIXTURE_STATE_PATH: stateFile, FIXTURE_LOG_PATH: logFile, PIDA_PRIVATE_TEST_SECRET: 'never-inherit-this-secret' } };
  return { directory, server, options, resources,
    update: value => writeFile(stateFile, JSON.stringify(value)),
    events: async () => (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)),
    async activate(extra = {}) { const activation = await activateMcp({ servers: [server] }, { ...options, ...extra }); resources.push(activation); return activation; },
  };
}
function scripted(responses) {
  return () => { const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(responses); return { provider: f.provider, modelId: f.getModel().id }; };
}
function named(activation, rawName) { return activation.tools.find(tool => tool.name === `mcp_fixture_${rawName}`); }

test('real stdio discovery/call uses stable schema names, minimal env and the Pi BusinessTool permission pipeline', async t => {
  const f = await fixture(t), activation = await f.activate();
  const inventory = activation.inventory(principal)[0];
  assert.equal(inventory.state, 'ready'); assert.equal(inventory.generation, 1);
  assert.equal(inventory.instructions.authority, 'untrusted-server-data'); assert.equal(inventory.instructions.available, true);
  assert.ok(!JSON.stringify(inventory).includes('UNTRUSTED_SERVER_INSTRUCTION'));
  assert.ok(!JSON.stringify(inventory).includes('secret-fixture-stderr'));
  assert.equal(inventory.tools.find(tool => tool.rawName === 'write_crash').effect, 'write', 'untrusted readOnlyHint cannot override host policy');
  const tool = named(activation, 'echo');
  assert.deepEqual(tool.parameters.required, ['value']);
  const invalid = await tool.execute({ value: 123 }, context()); assert.equal(invalid.error, 'MCP_INPUT_INVALID'); assert.equal(invalid.effect, 'not_applied');
  const env = await named(activation, 'env_keys').execute({}, context());
  assert.ok(!env.result.content[0].text.includes('PIDA_PRIVATE_TEST_SECRET'));
  const denied = new PidaRuntime({ tools: activation.tools, provider: scripted([answer(call(tool.name, { value: 'denied' }), { stopReason: 'toolUse' })]) });
  f.resources.push(denied); const other = { id: 'other', permissions: [] }, deniedSession = await denied.createSession(other);
  assert.equal((await denied.run(deniedSession.sessionId, other, 'try fixture')).code, 'TOOL_FORBIDDEN');
  assert.equal((await f.events()).filter(e => e.type === 'call' && e.name === 'echo').length, 0);
  const runtime = new PidaRuntime({ tools: activation.tools, provider: scripted([answer(call(tool.name, { value: 'hello' }), { stopReason: 'toolUse' }), answer('Observed fixture response.')]) });
  f.resources.push(runtime); const { sessionId } = await runtime.createSession(principal);
  assert.equal((await runtime.run(sessionId, principal, 'call fixture')).status, 'completed');
  assert.equal((await f.events()).filter(e => e.type === 'call' && e.name === 'echo').length, 1);
  assert.ok(runtime.getTrace(sessionId, principal).some(e => e.type === 'tool_completed' && e.toolName === tool.name));
  const large = await tool.execute({ value: 'x'.repeat(40000) }, context());
  assert.equal(large.ok, true); assert.equal(large.truncated, true); assert.equal(large.effect, 'applied');
  assert.ok(JSON.stringify(large).length < 32000);
});

test('cancellation reaches the actual MCP server and teardown terminates the child without reconnecting', async t => {
  const f = await fixture(t), activation = await f.activate(), abort = new AbortController();
  const response = named(activation, 'wait').execute({ ms: 4000 }, context(abort.signal));
  await until(async () => (await f.events()).some(e => e.type === 'call' && e.name === 'wait'));
  abort.abort(); assert.equal((await response).error, 'MCP_CALL_CANCELLED');
  await until(async () => (await f.events()).some(e => e.type === 'cancel'));
  const closing = activation.close(); assert.equal(activation.close(), closing); await closing;
  assert.equal(activation.inventory()[0].state, 'closed');
  await delay(100);
  const events = await f.events(); assert.equal(events.filter(e => e.type === 'spawn').length, 1);
  assert.ok(events.some(e => e.type === 'exit'));
  assert.throws(() => process.kill(events[0].pid, 0), e => e.code === 'ESRCH');
});

test('write-then-crash reconnects transport but never retries the tool or clears its unknown effect', async t => {
  const f = await fixture(t), activation = await f.activate();
  const runtime = new PidaRuntime({ tools: activation.tools, storageDir: join(f.directory, 'runtime'),
    provider: scripted([answer(call('mcp_fixture_write_crash', {}), { stopReason: 'toolUse' }), answer('No confirmed tool result.'),
      answer(call('mcp_fixture_write_crash', {}), { stopReason: 'toolUse' }), answer('Inspect the unknown effect first.')]) });
  f.resources.push(runtime); const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, 'perform write fixture');
  assert.equal(result.status, 'failed'); assert.ok(result.recovery);
  assert.equal(runtime.getRecovery(sessionId, principal).pendingEffects.length, 1);
  await until(() => activation.inventory()[0].state === 'ready' && activation.inventory()[0].generation === 2);
  assert.equal((await f.events()).filter(e => e.type === 'external-write').length, 1);
  assert.equal((await f.events()).filter(e => e.type === 'call' && e.name === 'write_crash').length, 1);
  assert.equal((await runtime.run(sessionId, principal, 'must inspect first')).code, 'EFFECT_STATE_UNKNOWN');
  assert.equal((await f.events()).filter(e => e.type === 'external-write').length, 1);
  const healthy = await named(activation, 'echo').execute({ value: 'reconnected' }, context()); assert.equal(healthy.ok, true);
});

test('schema changes replace inventory atomically, reject stale wrappers and mark restart required', async t => {
  const f = await fixture(t), activation = await f.activate(), stale = named(activation, 'echo');
  const firstDigest = activation.inventory()[0].tools.find(tool => tool.rawName === 'echo').schemaDigest;
  const oldRequest = named(activation, 'wait').execute({ ms: 4000 }, context());
  await until(async () => (await f.events()).some(e => e.type === 'call' && e.name === 'wait'));
  await f.update({ variant: 2 });
  await named(activation, 'crash').execute({}, context());
  const obsolete = await oldRequest; assert.equal(obsolete.ok, false); assert.equal(obsolete.effect, 'unknown');
  await until(() => activation.inventory()[0].state === 'ready' && activation.inventory()[0].generation === 2);
  assert.equal(activation.inventory()[0].restartRequired, true);
  assert.notEqual(activation.inventory()[0].tools.find(tool => tool.rawName === 'echo').schemaDigest, firstDigest);
  const blocked = await stale.execute({ value: 'old schema' }, context());
  assert.equal(blocked.error, 'MCP_SCHEMA_CHANGED_RESTART_REQUIRED'); assert.equal(blocked.effect, 'not_applied');
  assert.equal((await named(activation, 'echo').execute({ value: 42 }, context())).ok, true);
  await f.update({ removeEcho: true });
  await named(activation, 'list_change').execute({}, context());
  await until(() => activation.inventory()[0].state === 'ready' && activation.inventory()[0].generation === 3);
  assert.ok(!activation.tools.some(tool => tool.name === stale.name));
  assert.equal((await stale.execute({ value: 'removed' }, context())).effect, 'not_applied');
});

test('brief successful connections do not reset the bounded crash-loop budget', async t => {
  const f = await fixture(t, { mode: 'crashloop' }), activation = await f.activate();
  await until(() => activation.inventory()[0].state === 'failed');
  const inventory = activation.inventory()[0];
  assert.equal(inventory.code, 'MCP_RECONNECT_EXHAUSTED'); assert.equal(inventory.reconnectAttempts, 2); assert.equal(inventory.generation, 3);
  await delay(150); assert.equal((await f.events()).filter(e => e.type === 'spawn').length, 3);
  assert.equal((await named(activation, 'echo').execute({ value: 'offline' }, context())).effect, 'not_applied');
});

test('normalization collisions and reserved-name conflicts clean up the actual server; diagnostics exclude secrets', async t => {
  const f = await fixture(t, { mode: 'collision' });
  await assert.rejects(f.activate(), { code: 'MCP_NAME_COLLISION' });
  await until(async () => (await f.events()).some(e => e.type === 'exit'));
  await f.update({});
  await assert.rejects(f.activate({ reservedToolNames: ['mcp_fixture_echo'] }), { code: 'MCP_NAME_COLLISION' });
  await until(async () => (await f.events()).filter(e => e.type === 'exit').length === 2);
  await assert.rejects(activateMcp({ servers: [{ ...f.server, transport: { ...f.server.transport, envFrom: { TOKEN: 'MISSING_SECRET_VAR' } } }] }, { env: {} }), e => e.code === 'MCP_ENV_UNAVAILABLE' && !e.message.includes('MISSING_SECRET_VAR'));
  assert.equal((await f.events()).filter(e => e.type === 'spawn').length, 2);
});

test('discovery has total time/page limits and failures terminate the child before activation rejects', async t => {
  const pages = await fixture(t, { mode: 'pages' });
  await assert.rejects(pages.activate(), { code: 'MCP_INVENTORY_LIMIT' });
  assert.equal((await pages.events()).filter(e => e.type === 'list').length, 8);
  assert.ok((await pages.events()).some(e => e.type === 'exit'));
  const slow = await fixture(t, { mode: 'slowlist' }, { connectTimeoutMs: 150 });
  await assert.rejects(slow.activate(), e => ['MCP_DISCOVERY_TIMEOUT', 'MCP_CONNECT_FAILED'].includes(e.code));
  assert.ok((await slow.events()).some(e => e.type === 'exit'));
});

test('real Streamable HTTP initialization/list/call/cancel uses secret references without replay or credential redirects', async t => {
  const events = [], pending = new Map();
  const server = createServer(async (req, res) => {
    events.push({ method: req.method, auth: req.headers.authorization, path: req.url });
    if (req.url === '/redirect') { req.resume(); res.writeHead(302, { location: '/target' }).end(); return; }
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body); events.push({ rpc: message.method });
    const send = result => { if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })); };
    if (message.method === 'initialize') send({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } });
    else if (message.method === 'tools/list') send({ tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { hold: { type: 'boolean' } } } }] });
    else if (message.method === 'tools/call') {
      if (message.params.arguments.hold) { pending.set(message.id, res); res.once('close', () => pending.delete(message.id)); return; }
      send({ content: [{ type: 'text', text: 'http fixture response' }] });
    } else { if (message.method === 'notifications/cancelled') { pending.get(message.params.requestId)?.end(); pending.delete(message.params.requestId); } res.writeHead(202).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let activation;
  t.after(async () => { await activation?.close(); for (const res of pending.values()) res.destroy(); server.closeAllConnections(); await new Promise(ok => server.close(ok)); });
  const credential = 'Bearer fixture-private-value';
  activation = await activateMcp({ servers: [{ id: 'http', transport: { kind: 'streamable-http', url: `http://127.0.0.1:${server.address().port}/mcp`, allowInsecureHttp: true, headersEnv: { authorization: 'MCP_TEST_CREDENTIAL' } },
    tools: { echo: { permission: 'mcp:test:read', effect: 'read' } }, connectTimeoutMs: 1500, callTimeoutMs: 1000 }] }, { env: { MCP_TEST_CREDENTIAL: credential } });
  assert.ok(!JSON.stringify(activation.inventory()).includes(credential));
  assert.equal((await activation.tools[0].execute({}, context())).ok, true);
  const abort = new AbortController(), held = activation.tools[0].execute({ hold: true }, context(abort.signal));
  await until(() => pending.size === 1); abort.abort(); assert.equal((await held).error, 'MCP_CALL_CANCELLED');
  // Cancellation notifications are best effort; retiring the transport must close the POST regardless.
  await until(() => pending.size === 0);
  assert.equal(events.filter(event => event.rpc === 'tools/call').length, 2);
  assert.ok(events.filter(event => event.method).every(event => event.auth === credential));
  await activation.close(); assert.equal(events.filter(event => event.method === 'DELETE').length, 1);
  await assert.rejects(activateMcp({ servers: [{ id: 'redirect', transport: { kind: 'streamable-http', url: `http://127.0.0.1:${server.address().port}/redirect`, allowInsecureHttp: true, headersEnv: { authorization: 'MCP_TEST_CREDENTIAL' } }, connectTimeoutMs: 500 }] }, { env: { MCP_TEST_CREDENTIAL: credential } }), { code: 'MCP_CONNECT_FAILED' });
  assert.ok(!events.some(event => event.path === '/target'));
});

test('HTTP timeout/cancel retires the generation and closes ignored POSTs without replaying dispatched writes', async t => {
  const pending = new Set(); let calls = 0, initializations = 0, activation, runtime;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    const send = result => res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': `hanging-${initializations}` })
      .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    if (message.method === 'initialize') { initializations++; send({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'ignores-cancellation', version: '1' } }); }
    else if (message.method === 'tools/list') send({ tools: ['read', 'mutate'].map(name => ({ name, inputSchema: { type: 'object', properties: {}, additionalProperties: false } })) });
    else if (message.method === 'tools/call') {
      calls++; pending.add(res); res.on('close', () => pending.delete(res));
      // Deliberately never reply, including after cancellation notification or session DELETE.
    } else res.writeHead(202).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await runtime?.close(); await activation?.close(); for (const res of pending) res.destroy();
    server.closeAllConnections(); await new Promise(ok => server.close(ok));
  });
  activation = await activateMcp({ servers: [{ id: 'hang', transport: { kind: 'streamable-http', url: `http://127.0.0.1:${server.address().port}/mcp`, allowInsecureHttp: true },
    tools: { read: { permission: 'mcp:test:read', effect: 'read' }, mutate: { permission: 'mcp:test:write', effect: 'write' } },
    connectTimeoutMs: 500, callTimeoutMs: 100, reconnect: { maxAttempts: 4, baseDelayMs: 20, maxDelayMs: 20 } }] });
  const read = activation.tools.find(tool => tool.name === 'mcp_hang_read');
  for (let index = 0; index < 4; index++) {
    const result = await read.execute({}, context()); assert.equal(result.error, 'MCP_CALL_TIMEOUT');
    await until(() => pending.size === 0, 'Timed-out tools/call POST remained open');
    await until(() => activation.inventory()[0].state === 'ready' && activation.inventory()[0].generation === index + 2);
    assert.equal(calls, index + 1, 'Connection recovery must not replay tools/call');
  }
  runtime = new PidaRuntime({ tools: activation.tools, provider: scripted([answer(call('mcp_hang_mutate', {}), { stopReason: 'toolUse' }), answer('No confirmed write result.')]) });
  const { sessionId } = await runtime.createSession(principal);
  const running = runtime.run(sessionId, principal, 'Start the write fixture.');
  await until(() => pending.size === 1 && calls === 5);
  await runtime.cancel(sessionId, principal);
  const result = await running; assert.equal(result.status, 'cancelled');
  assert.equal(runtime.getRecovery(sessionId, principal).pendingEffects.length, 1, 'A dispatched cancelled write must stay unknown');
  await until(() => pending.size === 0, 'Cancelled tools/call POST remained open');
  assert.equal(activation.inventory()[0].state, 'failed');
  assert.equal(activation.inventory()[0].code, 'MCP_RECONNECT_EXHAUSTED');
  assert.equal(initializations, 5); assert.equal(calls, 5);
  await delay(80); assert.equal(initializations, 5); assert.equal(calls, 5);
});
