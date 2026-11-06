#!/usr/bin/env node
// Opt-in integration: synthetic tasks + actual Pi runtime + pinned, unmodified PIX.
// No live LLM, external PersonaSubstrate, Schumpeter or production data is used.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { AgentMemoryStore } from '../dist/agent-memory.js';
import { createLocalPersonaProvider } from '../dist/persona-provider.js';
import { ProcessIntelligence } from '../dist/process-intelligence.js';
import { createPixProcessPort } from '../dist/pix-port.js';
import { validateObservationBundle } from '../dist/integration-contract.js';
import { observationContractRevision } from '../dist/execution-contract.js';
import { canonical, sha256 } from '../dist/private-state.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['src/runtime.ts', 'src/process-intelligence.ts', 'src/persona-provider.ts', 'src/agent-memory.ts', 'src/run-context.ts', 'src/integration-contract.ts', 'src/execution-contract.ts', 'src/pix-port.ts', 'scripts/pix-worker.py', 'scripts/pi-native-integration-check.mjs'];
const compiledFiles = sourceFiles.filter(path => path.startsWith('src/')).map(path => path.replace('src/', 'dist/').replace(/\.ts$/, '.js'));
const hashes = paths => Promise.all(paths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') })));
const sourceDigests = await hashes(sourceFiles), executedDistDigests = await hashes(compiledFiles);
const packageBytes = await readFile(join(root, 'package.json'), 'utf8'), packageJson = JSON.parse(packageBytes);
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--source', '--python', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --source PATH, --python PATH and/or --output PATH');
  options[args[i].slice(2)] = args[i + 1];
}
const pin = { sourceCommit: '3205d832d5dcdc6901f916b35496a0c60b657e7a', sourceDigest: 'b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510' };
const python = options.python ?? process.env.PIDA_TEST_PYTHON ?? execFileSync('python3', ['-I', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
const sourceDirectory = resolve(options.source ?? join(root, '.pida-test-pix-source'));
const output = resolve(options.output ?? join(root, '.pida-test-pi-native', randomUUID()));
await mkdir(output, { recursive: true, mode: 0o700 });
assert.deepEqual(await readdir(output), [], 'Evidence output directory must be empty; existing evidence is never overwritten.');
const stateDirectory = join(output, 'private-state'), evidenceDirectory = join(output, 'evidence');
await mkdir(evidenceDirectory, { mode: 0o700 });
const files = [], checks = [];
const checked = (name, condition) => { assert.ok(condition, name); checks.push({ name, status: 'PASS' }); };
async function evidence(name, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  await writeFile(join(evidenceDirectory, name), bytes, { mode: 0o600 });
  files.push({ path: 'evidence/' + name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
const principal = { id: 'synthetic-pi-integration-owner', permissions: ['fixture:execute', 'pi:read', 'pi:analyze', 'pi:remember', 'agent:memory:write'] };
const memory = new AgentMemoryStore(join(stateDirectory, 'memory'), 'main');
memory.revisePersona({ expectedRevision: null, text: 'Synthetic integration persona: inspect evidence and keep observations separate from acceptance.', sourceRefs: ['fixture:pi-native-integration'] });
const persona = createLocalPersonaProvider(memory, { principalId: principal.id, workspaceId: 'synthetic-pi-integration-workspace', role: 'main' });
const port = createPixProcessPort({ pythonExecutable: resolve(python), workerPath: join(root, 'scripts/pix-worker.py'), sourceDirectory,
  expectedSourceCommit: pin.sourceCommit, expectedSourceDigest: pin.sourceDigest, timeoutMs: 20000 });
const faux = fauxProvider({ tokensPerSecond: 1_000_000, models: [{ id: 'pi-integration-faux', contextWindow: 262144, maxTokens: 8192 }] });
let runtime;
const analysisDirectory = join(stateDirectory, 'analysis');
const pi = new ProcessIntelligence({ directory: analysisDirectory, agentId: 'main', runtime: () => runtime, port, personaProvider: persona, enginePin: pin, maxRuns: 32, maxEvents: 4096 });
const fixtureTools = ['edit_code', 'verify_code', 'reproduce_issue', 'inspect_context', 'fail_case'].map(name => ({
  name, description: 'Synthetic integration action ' + name + '; no production effect or business acceptance.', permission: 'fixture:execute', effect: 'read', parameters: Type.Object({}, { additionalProperties: false }),
  async execute() { return { profile: 'synthetic-action-fixture', observed: name, ok: name !== 'fail_case' }; },
  ...(name === 'fail_case' ? { classifyResult: () => ({ status: 'failed', code: 'SYNTHETIC_ACTION_FAILURE' }) } : {}),
}));
runtime = new PidaRuntime({ provider: () => ({ provider: faux.provider, modelId: faux.getModel().id }), personaProvider: persona,
  storageDir: join(stateDirectory, 'runtime'), autoCompaction: false, maxSessions: 32, maxRunMs: 60000, tools: [...fixtureTools, ...pi.tools()] });
const started = performance.now();
function resultFrom(context, name) {
  const message = [...context.messages].reverse().find(m => m.role === 'toolResult' && m.toolName === name);
  assert.ok(message, 'Actual Pi tool result present: ' + name);
  assert.equal(message.isError, false, 'Actual Pi tool succeeded: ' + name);
  return JSON.parse(message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'));
}
function bundleFor(result) {
  const bundle = runtime.exportRun(result.sessionId, result.runId, principal);
  const validation = validateObservationBundle(bundle);
  assert.deepEqual(validation.issues, [], 'Actual current producer export validates');
  assert.equal(validation.valid, true);
  return bundle;
}
const reference = bundle => ({ sessionId: bundle.session_id, runId: bundle.run_id, digest: sha256(canonical(bundle)) });
async function actionRun(label, names) {
  const session = await runtime.createSession(principal);
  faux.setResponses([...names.map(name => answer(call(name, {}), { stopReason: 'toolUse' })), answer('Synthetic action sequence ended; business acceptance remains unknown.')]);
  const result = await runtime.run(session.sessionId, principal, label);
  assert.equal(result.status, names.includes('fail_case') ? 'failed' : 'completed', label + ': runtime outcome');
  return bundleFor(result);
}
try {
  const training = [];
  for (let i = 0; i < 20; i++) {
    const names = i < 12 ? ['edit_code', 'verify_code'] : i < 18 ? ['reproduce_issue', 'edit_code', 'verify_code'] : ['fail_case'];
    training.push(await actionRun('Synthetic training task ' + (i + 1), names));
  }
  const refs = training.map(reference);
  checked('20 current run bundles validate with actual context inclusion receipts', training.length === 20 && training.every(b => b.events.some(e => e.activity === 'context_input_included')));
  await evidence('training-bundles.json', training);
  const analyzeSession = await runtime.createSession(principal);
  let reflectionSummary;
  faux.setResponses([answer(call('pi_reflect', { runs: refs, targetCoverage: 0.9 }), { stopReason: 'toolUse' }), context => {
    reflectionSummary = resultFrom(context, 'pi_reflect');
    return answer('Actual PIX reflection received. These patterns are empirical, not identity or policy.');
  }]);
  const reflectionRun = await runtime.run(analyzeSession.sessionId, principal, 'Analyze the 20 explicitly selected synthetic completed runs, retaining failures in the denominator.');
  assert.equal(reflectionRun.status, 'completed', JSON.stringify(reflectionRun));
  const reflectionBundle = bundleFor(reflectionRun), reflected = pi.read(principal, reflectionSummary.resultRef);
  checked('actual Pi pi_reflect route invokes actual PIX', reflected.status === 'computed' && reflected.native.engine.sourceVerified && reflectionBundle.events.some(e => e.activity === 'tool_completed' && e.payload.tool_name === 'pi_reflect'));
  assert.deepEqual(reflected.variants.map(v => v.frequency), [12, 6, 2]);
  assert.deepEqual(reflected.variants.map(v => v.proportion), [0.6, 0.3, 0.1]);
  checked('20-case denominator preserves two failures; top two variants cover 18/20', reflected.coverage.selectedCases === 20 && reflected.coverage.includedCases === 20 && reflected.coverage.failedCases === 2 && reflected.selectedCaseCount === 18 && reflected.selectedCaseCoverage === 0.9);
  checked('computed results retain native PIX lineage and unknown business acceptance', reflected.native.nativeResults.length === 3 && reflected.native.nativeResults.every(r => r.format === 'pix.analysis-result' && r.version === '1.3.0') && reflected.businessAcceptance === 'UNKNOWN');
  await evidence('reflection-run.json', reflectionBundle); await evidence('reflection-result.json', reflected);
  const fixedModelRef = reflected.modelRef, fixedModelDigest = reflected.modelDigest;
  // The extra inspection is intended as a beneficial action in this synthetic scenario.
  // No independent experiment here proves quality improvement.
  const holdout = await actionRun('Separate holdout task with additional inspection', ['inspect_context', 'reproduce_issue', 'edit_code', 'verify_code']);
  const evalRef = reference(holdout);
  checked('holdout is a separate task after the reference model was frozen', !training.some(b => b.manifest.task_id === holdout.manifest.task_id) && !refs.some(r => r.runId === evalRef.runId));
  let awarenessSummary;
  faux.setResponses([answer(call('pi_awareness', { runs: [evalRef], modelRef: fixedModelRef }), { stopReason: 'toolUse' }), context => {
    awarenessSummary = resultFrom(context, 'pi_awareness');
    return answer('The extra inspection deviates from an empirical model; it is not a mandatory violation.');
  }]);
  const awarenessRun = await runtime.run(analyzeSession.sessionId, principal, 'Compare only the new holdout task against the already frozen empirical model.');
  assert.equal(awarenessRun.status, 'completed', JSON.stringify(awarenessRun));
  const awarenessBundle = bundleFor(awarenessRun), aware = pi.read(principal, awarenessSummary.resultRef);
  checked('actual Pi pi_awareness aligns the separate trace against the same frozen model', aware.status === 'computed' && aware.modelRef === fixedModelRef && aware.modelDigest === fixedModelDigest && aware.alignments[0].status === 'optimal' && aware.alignments[0].cost > 0);
  checked('intended-good empirical deviation is not promoted to mandatory failure or correction', aware.processJudgment === 'deviates' && aware.empiricalDeviationIsViolation === false && aware.mandatoryDeviation === undefined && aware.automaticCorrection === false && aware.businessAcceptance === 'UNKNOWN');
  await evidence('holdout-bundle.json', holdout); await evidence('awareness-run.json', awarenessBundle); await evidence('awareness-result.json', aware);
  const expectedContextRevision = runtime.getSession(analyzeSession.sessionId, principal).contextDescriptor.personaBinding.contextRevision;
  let rememberReceipt;
  faux.setResponses([answer(call('pi_analysis_remember', { resultRef: aware.resultRef, expectedContextRevision }), { stopReason: 'toolUse' }), context => {
    rememberReceipt = resultFrom(context, 'pi_analysis_remember');
    return answer('The reference was appended under CAS; identity and policy were not activated.');
  }]);
  const rememberRun = await runtime.run(analyzeSession.sessionId, principal, 'Store this analysis reference in the selected local Persona authority using the expected revision.');
  assert.equal(rememberRun.status, 'completed', JSON.stringify(rememberRun));
  checked('actual Pi remember tool persists into the existing canonical local memory', rememberReceipt.receipt.status === 'appended' && rememberReceipt.actualPersonaIntegration === 'pida-local' && rememberReceipt.identityChanged === false && memory.view().experiences.length === 1 && memory.view().persona.revision === 1);
  await evidence('remember-run.json', bundleFor(rememberRun)); await evidence('remember-receipt.json', rememberReceipt);
  let inputObserved = false;
  faux.setResponses([context => {
    const text = JSON.stringify(context);
    assert.ok(text.includes(aware.resultRef) && text.includes(fixedModelRef) && text.includes('behavior-analysis-reference') && text.includes('agent-report'));
    inputObserved = true;
    return answer('The next actual Pi logical input contains the stored evidence reference, still an agent report.');
  }]);
  const nextRun = await runtime.run(analyzeSession.sessionId, principal, 'Continue using permitted stored evidence references.');
  assert.equal(nextRun.status, 'completed');
  const nextBundle = bundleFor(nextRun), included = nextBundle.events.filter(e => e.activity === 'context_input_included');
  const binding = JSON.parse(included[0].payload.descriptor).personaBinding;
  checked('next actual model dispatch includes the appended reference and host receipt', inputObserved && included.length === 1 && binding.contextRevision === rememberReceipt.receipt.contextRevision && binding.contextRevision !== expectedContextRevision);
  await evidence('next-context-run.json', nextBundle);
  const restarted = new ProcessIntelligence({ directory: analysisDirectory, agentId: 'main', runtime: () => runtime, port, personaProvider: persona, enginePin: pin });
  checked('same immutable reflection request after service restart reuses exact evidence', (await restarted.reflect(principal, refs, 0.9)).resultRef === reflected.resultRef);
  const noPix = new ProcessIntelligence({ directory: join(stateDirectory, 'no-pix'), agentId: 'main', runtime: () => runtime });
  const unavailable = await noPix.reflect(principal, refs);
  checked('unconfigured PIX returns unavailable without a fabricated analysis', unavailable.status === 'unavailable' && unavailable.issues.includes('PIX_NOT_CONFIGURED') && unavailable.native === undefined);
  await evidence('pix-unconfigured-result.json', unavailable);
  const overlap = await pi.awareness(principal, [refs[0]], fixedModelRef);
  checked('training trace cannot be represented as held-out evaluation', overlap.status === 'unsupported' && overlap.issues.includes('TRAIN_EVALUATION_OVERLAP'));
  await evidence('overlap-result.json', overlap);
  for (const name of await readdir(analysisDirectory)) if (/^(model|result)-[a-f0-9]{64}\.json$/.test(name)) {
    const value = JSON.parse(await readFile(join(analysisDirectory, name), 'utf8')); await evidence(name, value);
  }
  assert.deepEqual(await hashes(sourceFiles), sourceDigests, 'Source files must remain unchanged during this evidence run.');
  assert.deepEqual(await hashes(compiledFiles), executedDistDigests, 'Executed build files must remain unchanged during this evidence run.');
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), packageBytes, 'Package identity must remain unchanged during this evidence run.');
  checked('source and executed build identities remained fixed during the integration run', true);
  const report = { schemaVersion: 'pida.pi-integration-evidence/1', status: 'PASS', createdAt: new Date().toISOString(),
    profile: 'synthetic-input+real-Pi+real-PIX+pida-local-Persona', liveLlm: 'NOT_RUN', externalPersonaSubstrate: 'NOT_RUN', schumpeter: 'NOT_REQUIRED_OR_USED', businessAcceptance: 'UNKNOWN', improvementEffect: 'NOT_MEASURED',
    environment: { node: process.version, platform: process.platform, arch: process.arch, runtimeVersion: packageJson.version, piVersion: packageJson.dependencies['@earendil-works/pi-ai'], producerContractRevision: observationContractRevision, pix: reflected.native.engine },
    sourceDigests, sourcePatchDigest: sha256(canonical(sourceDigests)), executedDistDigests, executedBuildDigest: sha256(canonical(executedDistDigests)), durationMs: performance.now() - started,
    expectedOracle: { cases: 20, common: 12, reproduce: 6, failed: 2, topTwoCoverage: 0.9 },
    model: { ref: fixedModelRef, digest: fixedModelDigest }, reflection: { ref: reflected.resultRef, digest: reflected.resultDigest, inputDigest: reflected.inputDigest },
    awareness: { ref: aware.resultRef, digest: aware.resultDigest, inputDigest: aware.inputDigest, processJudgment: aware.processJudgment, costs: aware.alignments.map(a => a.cost) },
    context: { before: expectedContextRevision, after: binding.contextRevision, receipt: rememberReceipt.receipt, includedRequestId: included[0].payload.request_id },
    nativeComputationIds: { reflection: reflected.native.nativeResults.map(r => r.computation.computation_id), awareness: aware.native.nativeResults.map(r => r.computation.computation_id) }, checks, files,
    limits: ['All task inputs, persona and action tools are explicitly synthetic.', 'Faux model scripts decisions; no live LLM quality claim.', 'Actual PIX computes discovery and alignment; no substitute statistics engine.', 'Input receipt proves Pi logical context inclusion, not model understanding or raw network bytes.', 'Local memory adapter is not actual external PersonaSubstrate integration.', 'Batch only; TUI, Windows, live-current-cut and organization join not exercised.'] };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, checks: checks.length, profile: report.profile, output, modelRef: fixedModelRef, reflectionRef: reflected.resultRef, awarenessRef: aware.resultRef, holdoutCost: aware.alignments[0].cost, sourcePatchDigest: report.sourcePatchDigest }, null, 2));
} finally { await runtime.close(); }
