// Synthetic input, real Pi and local MCP transport. No live provider or consumer acceptance claim.
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { activateMcp } from '../dist/mcp.js';
import { validateObservationBundle, bundleJsonSchema, manifestJsonSchema, observationJsonSchema } from '../dist/integration-contract.js';
import { observationContractRevision } from '../dist/execution-contract.js';
import { canonical, sha256 } from '../dist/private-state.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'pida-export-fixture-'));
let mcp, runtime;
try {
  const state = join(directory, 'state.json'), log = join(directory, 'log.jsonl');
  await writeFile(state, '{}'); await writeFile(log, '');
  mcp = await activateMcp({ servers: [{ id: 'fixture', transport: {
    kind: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../test/fixtures/mcp-server.mjs', import.meta.url))],
    envFrom: { MCP_FIXTURE_STATE: 'FIXTURE_STATE_PATH', MCP_FIXTURE_LOG: 'FIXTURE_LOG_PATH' },
  }, tools: { echo: { permission: 'fixture:read', effect: 'read' } } }] }, {
    cwd: directory, env: { ...process.env, FIXTURE_STATE_PATH: state, FIXTURE_LOG_PATH: log },
  });
  const f = fauxProvider({ tokensPerSecond: 100000 });
  f.setResponses([answer('', { stopReason: 'error', errorMessage: '503 temporary fixture failure' }),
    answer(call('mcp_fixture_echo', { value: 'synthetic fixture input' }), { stopReason: 'toolUse' }), answer('Synthetic fixture complete.')]);
  runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: mcp.tools,
    maxProviderRetries: 1, retryBaseDelayMs: 0, retryMaxDelayMs: 0,
    contextForRun: () => ({ text: 'Synthetic context fixture. Not production or live model data.', descriptor: {
      schemaVersion: 1, rendererVersion: 'fixture/1', personaRevision: 1, informationState: null, experiences: [], truncated: false,
    } }),
  });
  const owner = { id: 'synthetic-fixture-owner', permissions: ['fixture:read'] };
  const { sessionId } = await runtime.createSession(owner), run = await runtime.run(sessionId, owner, 'Call fixture echo.');
  const bundle = runtime.exportRun(sessionId, run.runId, owner), validation = validateObservationBundle(bundle);
  if (run.status !== 'completed' || !validation.valid) throw new Error(JSON.stringify({ status: run.status, validation }));
  const content = JSON.stringify(bundle, null, 2) + '\n', output = new URL('../fixtures/current-producer/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('context-mcp-retry.json', output), content);
  for (const [name, schema] of Object.entries({ observation: observationJsonSchema, manifest: manifestJsonSchema, bundle: bundleJsonSchema })) {
    await writeFile(new URL(name + '.schema.json', output), JSON.stringify(schema, null, 2) + '\n');
  }
  const badDescriptor = structuredClone(bundle), contextEvent = badDescriptor.events.find(event => event.activity === 'context_snapshot_loaded');
  contextEvent.payload.descriptor = JSON.stringify({ ...JSON.parse(contextEvent.payload.descriptor), raw_text: 'synthetic forbidden field' });
  contextEvent.payload_digest = sha256(canonical(contextEvent.payload));
  const conflict = structuredClone(bundle), repeated = structuredClone(conflict.events[0]);
  repeated.payload.code = 'SYNTHETIC_CONFLICT'; repeated.payload_digest = sha256(canonical(repeated.payload));
  conflict.events.splice(1, 0, repeated);
  const negativeCases = [];
  for (const [name, invalid] of Object.entries({ 'invalid-context-descriptor': badDescriptor, 'conflicting-event-id': conflict })) {
    const bytes = JSON.stringify(invalid, null, 2) + '\n';
    await writeFile(new URL(name + '.json', output), bytes);
    negativeCases.push({ fixture: name + '.json', sha256: sha256(bytes), validation: validateObservationBundle(invalid) });
  }
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  await writeFile(new URL('index.json', output), JSON.stringify({ validator_revision: observationContractRevision,
    producer_package_version: version, profile: 'protocol', input_data: 'synthetic', model: 'Pi faux scripted',
    mcp: 'actual stdio JSON-RPC fixture', actual_schumpeter_integration: 'NOT_RUN',
    fixture: 'context-mcp-retry.json', sha256: sha256(content), validation, negative_cases: negativeCases,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ status: run.status, event_count: bundle.events.length, validation, sha256: sha256(content) }));
} finally {
  await runtime?.close(); await mcp?.close(); await rm(directory, { recursive: true, force: true });
}
