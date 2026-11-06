// Opt-in real, pinned PIX integration. Model/tool requests are synthetic; the PIX calculation is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PidaRuntime, lotStatusTool } from '../dist/index.js';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { createPixOcelPort, pixOcelSchema } from '../dist/pix-ocel.js';
import { ProcessIntelligence } from '../dist/process-intelligence.js';
import { canonical, sha256 } from '../dist/private-state.js';
const source = process.env.PIDA_TEST_PIX_SOURCE;
const pin = { sourceCommit: '3205d832d5dcdc6901f916b35496a0c60b657e7a', sourceDigest: 'b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510' };
test('real pinned PIX imports runtime OCEL and distinguishes complete, incomplete, invalid and deviating lifecycles', { skip: !source && 'Set PIDA_TEST_PIX_SOURCE to the documented pinned checkout; real PIX NOT_RUN' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-native-ocel-'));
  const owner = { id: 'synthetic-ocel-owner', permissions: ['lots:read', 'pi:read', 'pi:analyze'] };
  let runtime;
  t.after(async () => { await runtime?.close(); await rm(root, { recursive: true, force: true }); });
  const probe = spawnSync(process.env.PIDA_TEST_PYTHON || 'python3', ['-I', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, 'Python is required for an explicitly requested native test');
  const ocelPort = createPixOcelPort({ pythonExecutable: probe.stdout.trim(), workerPath: fileURLToPath(new URL('../scripts/pix-worker.py', import.meta.url)), sourceDirectory: resolve(source),
    expectedSourceCommit: pin.sourceCommit, expectedSourceDigest: pin.sourceDigest, timeoutMs: 10000 });
  const service = new ProcessIntelligence({ directory: join(root, 'pi'), agentId: 'native-pix-fixture-agent', runtime: () => runtime, ocelPort, enginePin: pin });
  const f = fauxProvider({ tokensPerSecond: 100000 });
  f.setResponses([answer(call('get_lot_status', { lotId: 'LOT-001' }), { stopReason: 'toolUse' }), answer('done')]);
  runtime = new PidaRuntime({ agentId: 'native-pix-fixture-agent', storageDir: join(root, 'runtime'), provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: [lotStatusTool, ...service.tools()] });
  const { sessionId } = await runtime.createSession(owner), run = await runtime.run(sessionId, owner, 'LOT-001');
  const bundle = runtime.exportRun(sessionId, run.runId, owner), cut = runtime.exportRunOcel(sessionId, run.runId, owner);
  const ref = { sessionId, runId: run.runId, digest: sha256(canonical(bundle)) };
  const evidence = await service.verifyOcel(owner, ref), result = evidence.native;
  assert.equal(result.status, 'computed', JSON.stringify(result)); assert.equal(result.structure, 'PASSED'); assert.equal(result.processJudgment, 'conforms');
  assert.equal(result.businessAcceptance, 'UNKNOWN'); assert.equal(bundle.manifest.verification_status, 'UNKNOWN');
  assert.equal(result.engine.sourceCommit, pin.sourceCommit); assert.equal(result.engine.sourceVerified, true);
  assert.equal(result.checkedObjects.filter(o => o.type === 'Turn').length, 2);
  assert.ok(result.nativeResults.length > 0); assert.ok(evidence.resultRef);
  assert.deepEqual(service.readOcelVerification(owner, evidence.resultRef), evidence);
  f.setResponses([answer(call('pi_verify_run', ref), { stopReason: 'toolUse' }), answer('Report process evidence, not business completion.')]);
  const analysisRun = await runtime.run(sessionId, owner, 'Verify the preceding run with PIX');
  assert.equal(analysisRun.status, 'completed');
  const message = runtime.getSessionTools(sessionId, owner).items.find(m => m.runId === analysisRun.runId && m.toolName === 'pi_verify_run');
  assert.ok(message); assert.equal(message.status, 'completed');
  const toolResult = JSON.parse(message.output);
  assert.equal(toolResult.native.processJudgment, 'conforms'); assert.equal(toolResult.artifactVerification, 'UNKNOWN');
  assert.equal(toolResult.resultDigest, evidence.resultDigest);
  const request = { schemaVersion: pixOcelSchema, document: cut.document, complete: true };
  const missing = structuredClone(request); missing.document.events = missing.document.events.filter(e => e.type !== 'tool_completed');
  const deviation = await ocelPort.compute(missing);
  assert.equal(deviation.structure, 'PASSED'); assert.equal(deviation.processJudgment, 'deviates');
  assert.ok(deviation.checkedObjects.some(o => o.type === 'ToolCall' && o.cost > 0));
  const open = await ocelPort.compute({ ...missing, complete: false }); assert.equal(open.processJudgment, 'pending');
  const invalid = structuredClone(request); invalid.document.events[0].relationships.push({ objectId: 'missing-object', qualifier: 'bad' });
  const rejected = await ocelPort.compute(invalid); assert.equal(rejected.structure, 'FAILED'); assert.equal(rejected.processJudgment, 'unknown');
  // Interleaved concurrent calls have distinct object projections; no false sequential-case exclusion.
  const parallel = structuredClone(request), callObject = parallel.document.objects.find(o => o.type === 'ToolCall');
  const callEvents = parallel.document.events.filter(e => ['tool_started', 'tool_completed'].includes(e.type));
  const second = structuredClone(callObject); second.id += ':parallel'; parallel.document.objects.push(second);
  const extra = callEvents.map(e => ({ ...structuredClone(e), id: e.id + ':parallel', relationships: e.relationships.map(r => r.objectId === callObject.id ? { ...r, objectId: second.id } : r) }));
  parallel.document.events.splice(parallel.document.events.indexOf(callEvents[1]), 0, extra[0]);
  parallel.document.events.splice(parallel.document.events.indexOf(callEvents[1]) + 1, 0, extra[1]);
  parallel.document.events.forEach((e, i) => { e.attributes.find(a => a.name === 'sequence_number').value = i + 1; });
  const concurrent = await ocelPort.compute(parallel); assert.equal(concurrent.processJudgment, 'conforms');
  assert.equal(concurrent.checkedObjects.filter(o => o.type === 'ToolCall').length, 2);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(ocelPort.compute(request, aborted.signal));
  if (process.env.PIDA_TEST_OCEL_OUTPUT) {
    const output = resolve(process.env.PIDA_TEST_OCEL_OUTPUT); await mkdir(output, { recursive: true });
    const files = [];
    for (const [name, value] of Object.entries({ 'runtime.bundle.json': bundle, 'runtime.ocel.json': cut.document, 'runtime.ocel.meta.json': { ...cut, document: undefined },
      'pix-verification.json': evidence, 'pix-negative-results.json': { deviation, open, rejected, concurrent } })) {
      const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(join(output, name), bytes); files.push({ path: name, sha256: sha256(bytes) });
    }
    await writeFile(join(output, 'index.json'), JSON.stringify({ schemaVersion: 'pida.pix-ocel-fixture/1', runtimeVersion: bundle.manifest.runtime_version,
      profile: 'actual-pinned-pix-scripted-pi', inputData: 'synthetic', liveModel: 'NOT_RUN', actualSchumpeterIntegration: 'NOT_RUN', engine: result.engine,
      outcomes: { normal: result.processJudgment, missingToolEnd: deviation.processJudgment, openCut: open.processJudgment, invalidReference: rejected.structure, parallelCalls: concurrent.processJudgment,
        agentToolDispatch: toolResult.native.processJudgment }, files }, null, 2) + '\n');
  }
});
