import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { activateMcp } from '../dist/mcp.js';
import { validateObservationBundle, bundleJsonSchema, manifestJsonSchema, observationJsonSchema } from '../dist/integration-contract.js';
import { observationContractRevision } from '../dist/execution-contract.js';
import { canonical, sha256 } from '../dist/private-state.js';

const owner = { id: 'synthetic-export-owner', permissions: ['mcp:export:read'] };
const valid = bundle => assert.deepEqual(validateObservationBundle(bundle), { valid: true, issues: [], duplicateEventIds: [] });
const rehash = event => { event.payload_digest = sha256(canonical(event.payload)); };

test('current native Pi context, retry and actual MCP export passes closed contract and preserves IDs across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pida-export-'));
  let runtime, restored, mcp;
  t.after(async () => { await restored?.close(); await runtime?.close(); await mcp?.close(); await rm(directory, { recursive: true, force: true }); });
  const state = join(directory, 'mcp-state.json'), log = join(directory, 'mcp-log.jsonl');
  await writeFile(state, '{}'); await writeFile(log, '');
  mcp = await activateMcp({ servers: [{ id: 'export', transport: {
    kind: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))],
    envFrom: { MCP_FIXTURE_STATE: 'FIXTURE_STATE_PATH', MCP_FIXTURE_LOG: 'FIXTURE_LOG_PATH' },
  }, tools: { echo: { permission: 'mcp:export:read', effect: 'read' } } }] }, {
    cwd: directory, env: { ...process.env, FIXTURE_STATE_PATH: state, FIXTURE_LOG_PATH: log },
  });
  const f = fauxProvider({ tokensPerSecond: 100000 });
  f.setResponses([
    answer('', { stopReason: 'error', errorMessage: '503 temporary fixture failure' }),
    answer(call('mcp_export_echo', { value: 'PRIVATE_TOOL_DATA_MUST_NOT_EXPORT' }), { stopReason: 'toolUse' }),
    answer('Fixture completed.'),
  ]);
  const descriptor = { schemaVersion: 1, rendererVersion: 'export-fixture/1', personaRevision: 1,
    informationState: { id: randomUUID(), revision: 1 },
    experiences: Array.from({ length: 32 }, () => ({ id: randomUUID(), revision: 1 })), truncated: false };
  const options = { storageDir: join(directory, 'runtime'), autoCompaction: false, maxProviderRetries: 1, retryBaseDelayMs: 0, retryMaxDelayMs: 0,
    provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: mcp.tools,
    contextForRun: () => ({ text: 'PRIVATE_CONTEXT_MUST_NOT_EXPORT', descriptor }) };
  runtime = new PidaRuntime(options);
  const { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, 'PRIVATE_PROMPT_MUST_NOT_EXPORT');
  assert.equal(result.status, 'completed');
  const first = runtime.exportRun(sessionId, result.runId, owner);
  valid(first); assert.equal(first.complete, true);
  const loaded = first.events.find(event => event.activity === 'context_snapshot_loaded');
  assert.ok(loaded.payload.descriptor.length > 512, 'bounded full descriptor must not be silently shortened');
  assert.equal(JSON.parse(loaded.payload.descriptor).experiences.length, 32);
  assert.ok(first.events.some(event => event.activity === 'retry_scheduled' && event.payload.source === 'provider'));
  assert.ok(first.events.some(event => event.activity === 'tool_completed' && event.payload.tool_name === 'mcp_export_echo'));
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_CONTEXT|PRIVATE_PROMPT|PRIVATE_TOOL_DATA/);
  assert.deepEqual(runtime.exportRun(sessionId, result.runId, owner), first);
  await runtime.close(); runtime = undefined;
  restored = new PidaRuntime(options);
  const afterRestart = restored.exportRun(sessionId, result.runId, owner);
  valid(afterRestart); assert.deepEqual(afterRestart, first, 'export retry/restart must never regenerate event identities');
  assert.throws(() => restored.exportRun(sessionId, result.runId, { id: 'other', permissions: owner.permissions }), { code: 'SESSION_NOT_FOUND' });

  const forbidden = structuredClone(first), descriptorEvent = forbidden.events.find(event => event.activity === 'context_snapshot_loaded');
  descriptorEvent.payload.descriptor = JSON.stringify({ ...JSON.parse(descriptorEvent.payload.descriptor), privateText: 'must-reject' }); rehash(descriptorEvent);
  assert.ok(validateObservationBundle(forbidden).issues.includes('CONTEXT_DESCRIPTOR_INVALID'));
  const malformed = structuredClone(first), bad = malformed.events.find(event => event.activity === 'context_snapshot_loaded');
  bad.payload.descriptor = '{bad-json'; rehash(bad);
  assert.ok(validateObservationBundle(malformed).issues.includes('CONTEXT_DESCRIPTOR_INVALID'));
  const secretField = structuredClone(first); secretField.events[0].payload.rawPrompt = 'must-reject'; rehash(secretField.events[0]);
  assert.deepEqual(validateObservationBundle(secretField).issues, ['SCHEMA_INVALID']);
  const negative = structuredClone(first), response = negative.events.find(event => event.activity === 'model_response');
  response.payload.output_tokens = -1; rehash(response);
  assert.deepEqual(validateObservationBundle(negative).issues, ['SCHEMA_INVALID']);
  const unbound = structuredClone(first), receipt = unbound.events.find(event => event.activity === 'context_input_included');
  assert.ok(receipt, 'host receipt must follow actual Pi input preparation');
  receipt.payload.request_id = randomUUID(); rehash(receipt);
  assert.ok(validateObservationBundle(unbound).issues.includes('CONTEXT_RECEIPT_INVALID'));
  const duplicate = structuredClone(first); duplicate.events.splice(1, 0, structuredClone(first.events[0]));
  assert.equal(validateObservationBundle(duplicate).valid, true);
  assert.deepEqual(validateObservationBundle(duplicate).duplicateEventIds, [first.events[0].source_event_id]);
  duplicate.events[1].payload.code = 'CONFLICT'; rehash(duplicate.events[1]);
  assert.ok(validateObservationBundle(duplicate).issues.includes('EVENT_ID_CONFLICT'));
  const gap = structuredClone(first); gap.events.splice(1, 1);
  assert.ok(validateObservationBundle(gap).issues.includes('SEQUENCE_GAP'));
  assert.ok(validateObservationBundle(gap).issues.includes('FALSE_COMPLETENESS'));
});

test('versioned current producer fixture is locally valid without claiming external consumer acceptance', async () => {
  const root = new URL('../fixtures/current-producer/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('index.json', root), 'utf8'));
  assert.equal(index.validator_revision, observationContractRevision);
  assert.equal(index.profile, 'protocol');
  assert.equal(index.actual_schumpeter_integration, 'NOT_RUN');
  const bytes = await readFile(new URL(index.fixture, root));
  assert.equal(sha256(bytes), index.sha256);
  valid(JSON.parse(bytes));
  for (const [name, schema] of Object.entries({ observation: observationJsonSchema, manifest: manifestJsonSchema, bundle: bundleJsonSchema })) {
    assert.deepEqual(JSON.parse(await readFile(new URL(name + '.schema.json', root), 'utf8')), schema);
  }
  for (const entry of index.negative_cases) {
    const bytes = await readFile(new URL(entry.fixture, root));
    assert.equal(sha256(bytes), entry.sha256);
    const result = validateObservationBundle(JSON.parse(bytes));
    assert.equal(result.valid, false, entry.fixture);
    assert.deepEqual(result, entry.validation, entry.fixture);
  }
});
