#!/usr/bin/env node
// Real pinned PIX + Pida SDK/workspace; synthetic source facts and scripted Pi model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { createPixProfileProcessPort, pixProfileBuild } from '../dist/pix-profiles.js';
import { ProcessProfileAnalysis } from '../dist/process-profiles.js';
import { initWorkspace, createWorkspace, readConfig } from '../dist/workspace.js';
import { PidaError } from '../dist/runtime.js';
import { canonical, sha256 } from '../dist/private-state.js';
import { sequential, objects, selection } from '../test/fixtures/pix-profiles/helpers.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--source', '--output', '--python'].includes(process.argv[i]) && process.argv[i + 1]); args[process.argv[i].slice(2)] = resolve(process.argv[i + 1]);
}
assert.ok(args.source && args.output, 'Required --source PINNED_SOURCE --output EMPTY_DIR');
await mkdir(args.output, { recursive: true }); assert.deepEqual(await readdir(args.output), []);
const python = args.python ?? execFileSync('python3', ['-I', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
const paths = ['package.json', 'scripts/pix-worker.py', 'scripts/pix-profiles-check.mjs', 'src/pix-port.ts', 'src/pix-profiles.ts', 'src/process-profiles.ts', 'src/workspace.ts',
  'dist/pix-port.js', 'dist/pix-profiles.js', 'dist/process-profiles.js', 'dist/workspace.js', 'test/fixtures/pix-profiles/helpers.mjs',
  'test/fixtures/pix-profiles/sequential.model.json', 'test/fixtures/pix-profiles/objects.model.json', 'test/fixtures/pix-profiles/objects.input.json'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async p => [p, createHash('sha256').update(await readFile(join(root, p))).digest('hex')])));
const before = await hashes(), checks = [], files = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push({ name, status: 'PASS' }); };
const save = async (name, value) => { const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(join(args.output, name), bytes); files.push({ path: name, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) }); };
const port = createPixProfileProcessPort({ pythonExecutable: python, sourceDirectory: args.source, workerPath: join(root, 'scripts/pix-worker.py'),
  expectedSourceCommit: pixProfileBuild.sourceCommit, expectedSourceDigest: pixProfileBuild.sourceDigest, timeoutMs: 10000 });
const q = sequential(), open = await port.compute(q);
check('actual engine build pin', open.engine.sourceCommit === pixProfileBuild.sourceCommit && open.engine.sourceDigest === pixProfileBuild.sourceDigest);
check('open prefix is partial zero-cost witness with pending completion', open.status === 'partial' && open.summary.cost === 0 && open.summary.finalCostUnresolved && open.summary.metric === 'prefix-witness-upper-bound');
await save('open.json', { request: q, result: open });
const early = await port.compute(sequential(['request', 'edit'], true));
check('explicit early close includes terminal cost two but remains approximate', early.status === 'partial' && early.summary.cost === 2 && !early.summary.finalCostUnresolved);
await save('early-close.json', { request: sequential(['request', 'edit'], true), result: early });
const completeRequest = sequential(['request', 'edit', 'test', 'deliver'], true);
const continued = await port.compute({ ...completeRequest, resume: { checkpoint: open.checkpoint, offset: 2 } });
const fresh = await port.compute(completeRequest);
check('serialized checkpoint continuation equals uninterrupted native bytes', continued.status === 'partial' && continued.nativeResults.at(-1).json === fresh.nativeResults.at(-1).json && continued.checkpoint.json === fresh.checkpoint.json);
check('completed witness remains partial and does not imply business acceptance', continued.summary.cost === 0 && continued.summary.closed && continued.summary.metric === 'terminal-witness-upper-bound');
check('native fractional-number bytes preserved across JavaScript transport', open.checkpoint.json.includes('1.0') && sha256(open.checkpoint.json) === open.checkpoint.sha256);
await save('continued.json', { request: { ...completeRequest, resume: { checkpoint: open.checkpoint, offset: 2 } }, result: continued });
const changedGeneration = await port.compute({ ...completeRequest, generation: 'other-generation', resume: { checkpoint: open.checkpoint, offset: 2 } });
check('checkpoint cannot cross generation', changedGeneration.status === 'invalid_input' && changedGeneration.issues[0].code === 'checkpoint_mismatch');
const rewritten = JSON.stringify(JSON.parse(open.checkpoint.json));
const roundtrip = await port.compute({ ...completeRequest, resume: { checkpoint: { json: rewritten, sha256: sha256(rewritten) }, offset: 2 } });
check('reserializing native numbers cannot forge valid native checkpoint', roundtrip.status === 'invalid_input' && roundtrip.issues[0].code === 'checkpoint_mismatch');
const proxyLimited = await port.compute({ ...q, limits: { maxProxyNodes: 1 } });
check('proxy budget leaves computation unavailable without invented cost', proxyLimited.status === 'unavailable' && !proxyLimited.summary);
const wrongModel = await port.compute({ ...q, model: objects().model });
check('object model is not silently converted into sequential model', wrongModel.status === 'invalid_input' && wrongModel.issues[0].code === 'unsupported_model');
const oq = objects(), joint = await port.compute(oq), native = JSON.parse(joint.nativeResults[0].json).computation.value;
check('actual whole-object alignment is optimal for selected complete scope', joint.status === 'computed' && joint.summary.cost === 0 && joint.summary.eventCount === 4);
check('shared verification occurs once and carries both artifact revisions', native.moves.filter(m => m.event_id === 'verify').length === 1 && native.moves.find(m => m.event_id === 'verify').objects.flat(2).includes('artifact-a@r1') && native.moves.find(m => m.event_id === 'verify').objects.flat(2).includes('artifact-b@r7'));
check('independent reads remain incomparable', !native.scope.precedence.some(p => ['read-a', 'read-b'].includes(p.predecessor_event_id) && ['read-a', 'read-b'].includes(p.successor_event_id)));
check('actor exclusion and relation loss remain explicit', joint.summary.selectedObjectCount === 2 && joint.summary.excludedObjectCount === 1 && joint.summary.excludedRelationCount > 0);
await save('objects.json', { request: oq, result: joint });
const tied = structuredClone(oq); tied.objects.events.find(e => e.id === 'verify').time = tied.objects.events.find(e => e.id === 'read-a').time;
const tie = await port.compute(tied);
check('same-object time tie has no invented ID ordering', tie.status === 'unavailable' && tie.issues.some(i => i.code === 'ambiguous_event_order'));
const limited = await port.compute({ ...oq, limits: { maxStates: 1 } });
check('bounded object search retains partial unknown cost', limited.status === 'partial' && limited.summary.cost === null);
const nonterminal = structuredClone(oq); nonterminal.objects.closed = false;
const notClosed = await port.compute(nonterminal);
check('open object cut is rejected by terminal-only consumer profile', notClosed.status === 'unavailable' && notClosed.issues[0].code === 'nonterminal_object_cut' && !notClosed.summary);
await save('negative-results.json', { changedGeneration, roundtrip, proxyLimited, wrongModel, tie, limited, notClosed });

const principal = { id: 'owner', permissions: ['pi:read', 'pi:analyze'] }, refs = { cutRef: 'cut:fixture', modelRef: 'model:fixture' };
let selected = selection(), revoked = false;
const source = { async resolve(p) { if (revoked || p.id !== principal.id) throw new PidaError('FORBIDDEN', 403); return structuredClone(selected); }, async list() { return [refs]; } };
const options = { directory: join(args.output, 'private-state'), agentId: 'main', source, port, enginePin: pixProfileBuild };
let service = new ProcessProfileAnalysis(options);
const first = await service.analyze(principal, refs);
check('Pida open-cut interpretation is pending with UNKNOWN business acceptance', first.processJudgment === 'pending' && first.businessAcceptance === 'UNKNOWN' && first.status === 'partial');
service = new ProcessProfileAnalysis(options);
selected = selection(completeRequest);
const resumed = await service.analyze(principal, { ...refs, previousResultRef: first.resultRef });
check('Pida restart resumes only stored matching native checkpoint', resumed.transition === 'resumed' && resumed.native.summary.cost === 0);
selected = selection(completeRequest); selected.taskId = 'task:replacement'; selected.artifactRefs = ['artifact:replacement@r2'];
const rebound = await service.analyze(principal, { ...refs, previousResultRef: first.resultRef });
check('new task and artifact identity cannot reuse old checkpoint', rebound.transition === 'recomputed' && rebound.request.generation !== first.request.generation);
selected = selection(); selected.sequential.events[1].activity = 'review'; selected.cutRevision = sha256(canonical(selected.sequential));
await assert.rejects(service.analyze(principal, { ...refs, previousResultRef: first.resultRef }), { code: 'PI_CORRECTION_REQUIRES_NEW_GENERATION' });
check('same-generation correction cannot mutate an old checkpoint', true);
selected.generation = 'fixture/generation-2';
const corrected = await service.analyze(principal, { ...refs, previousResultRef: first.resultRef });
check('explicit new generation recomputes and preserves prior evidence', corrected.transition === 'recomputed' && corrected.limits.includes('CHECKPOINT_IDENTITY_CHANGED_RECOMPUTED') && (await service.read(principal, first.resultRef)).applicability === 'STALE');
revoked = true;
await assert.rejects(service.read(principal, first.resultRef), { code: 'FORBIDDEN' });
check('current source revocation blocks historical result access', true); revoked = false;
selected = selection();
const stale = new ProcessProfileAnalysis({ ...options, port: { async compute(request, signal) { const r = await port.compute(request, signal); selected.policyRevision = 'f'.repeat(64); return r; } } });
await assert.rejects(stale.analyze(principal, refs), { code: 'PI_STALE_CUT' });
check('source policy change during actual compute prevents applicability publication', true);
await save('host-results.json', { first, resumed, rebound, corrected });

const directory = join(args.output, 'private-workspace'); initWorkspace(directory);
const config = { ...readConfig(directory), preset: 'personal', codingPacks: [], workbench: { enabled: false }, permissions: ['pi:read', 'pi:analyze'] };
await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
const app = await createWorkspace(directory, { processProfiles({ agentId }) { return { source: {
  async list() { return [refs]; }, async resolve(p) { if (p.id !== 'local-user') throw new PidaError('FORBIDDEN', 403); return selection(sequential(), p.id, agentId); }
}, port, enginePin: pixProfileBuild }; } });
try {
  const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses([answer(call('pi_profile_analyze', refs), { stopReason: 'toolUse' }), answer('Prefix completion remains pending.')]);
  app.runtime.configureProvider(() => ({ provider: f.provider, modelId: f.getModel().id }), { mode: 'protocol-fixture', model: 'faux' });
  const p = { id: 'local-user', permissions: ['pi:read', 'pi:analyze'] };
  const { sessionId } = await app.runtime.createSession(p), run = await app.runtime.run(sessionId, p, 'Analyze the authorized current cut.');
  const bundle = app.runtime.exportRun(sessionId, run.runId, p);
  check('actual Pi workspace tool invokes real PIX and completes', run.status === 'completed' && bundle.events.some(e => e.activity === 'tool_completed' && e.payload.tool_name === 'pi_profile_analyze'));
  check('PI tool remains permission guarded and contributes no host writer', app.getComposition().active.find(a => a.agentId === 'main').tools.filter(t => t.name.startsWith('pi_profile_')).length === 3);
  check('runtime completion still has UNKNOWN independent verification', bundle.manifest.verification_status === 'UNKNOWN');
  await save('workspace-run.json', bundle);
} finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
await rm(options.directory, { recursive: true, force: true });
const after = await hashes(); assert.deepEqual(after, before); check('executed Pida source and build unchanged during probe', true);
await save('report.json', { profile: 'pida-real-pix-profiles-synthetic/1', occurredAt: new Date().toISOString(), version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  engine: open.engine, environment: { node: process.version, platform: process.platform }, checks, executedFiles: before, artifacts: files.slice(),
  integration: { pix: 'PASS_PINNED_SOURCE', workspace: 'PASS_ACTUAL_PI_SCRIPTED_MODEL', personaSite: 'NOT_RUN_IN_THIS_PROBE', schumpeter: 'SEE_SEPARATE_CURRENT_CONSUMER_PROBE' },
  limitations: ['Synthetic source facts; host must implement its authoritative publication/CAS and access port.', 'No live LLM, remote Persona grant, Windows Pida run or independent task acceptance.', 'No generic DFG conversion or live object alignment.', 'No source publication, automatic model adoption, memory write or policy change.'] });
console.log(JSON.stringify({ status: 'PASS', checks: checks.length, engine: open.engine.sourceCommit, output: args.output }));
