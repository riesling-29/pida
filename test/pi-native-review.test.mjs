// Selective regressions for the integrated 0.8.4 review.
// Actual Pida/Pi/effect ledger + synthetic source journals and a contract-only PIX port.
// These tests do not claim real PIX calculation or actual PersonaSubstrate integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime } from '../dist/runtime.js';
import { AgentMemoryStore } from '../dist/agent-memory.js';
import { createLocalPersonaProvider } from '../dist/persona-provider.js';
import { ProcessIntelligence } from '../dist/process-intelligence.js';
import { owner, runtimeFixture, contractPort, enginePin } from './fixtures/pi-snapshots.mjs';

async function setup(t, makePersona) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-pi-review-'));
  let runtime;
  t.after(async () => { await runtime?.close(); await rm(directory, { recursive: true, force: true }); });
  const journal = runtimeFixture(directory), stub = contractPort();
  const persona = makePersona?.(directory, journal.agentId);
  const sources = { exportRun(sessionId, runId, principal) {
    try { return journal.runtime.exportRun(sessionId, runId, principal); }
    catch (error) {
      if (error.code !== 'SESSION_NOT_FOUND' || !runtime) throw error;
      return runtime.exportRun(sessionId, runId, principal);
    }
  } };
  const service = new ProcessIntelligence({ directory: join(directory, 'analysis'), agentId: journal.agentId,
    runtime: () => sources, port: stub.port, enginePin, personaProvider: persona });
  const model = await service.reflect(owner, [journal.ref(journal.add())]);
  const f = fauxProvider({ tokensPerSecond: 100000 });
  runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: service.tools(), autoCompaction: false });
  const { sessionId } = await runtime.createSession(owner);
  const remember = async (expectedContextRevision, taskId) => {
    f.setResponses([answer(call('pi_analysis_remember', { resultRef: model.resultRef, expectedContextRevision }), { stopReason: 'toolUse' }), answer('Reference handling finished.')]);
    return runtime.run(sessionId, owner, 'Store the selected analysis reference.', undefined, undefined, taskId ? { taskId } : {});
  };
  return { directory, journal, stub, service, persona, model, runtime, f, sessionId, remember };
}

test('review regression: Awareness preserves incomplete selected cases as partial unknown without dereferencing a missing manifest', async t => {
  const f = await setup(t);
  const selected = [f.journal.ref(f.journal.add()), f.journal.ref(f.journal.add({ incomplete: true }))];
  const result = await f.service.awareness(owner, selected, f.model.modelRef);
  assert.equal(result.status, 'partial');
  assert.equal(result.processJudgment, 'unknown');
  assert.equal(result.businessAcceptance, 'UNKNOWN');
  assert.deepEqual([result.coverage.selectedCases, result.coverage.includedCases, result.coverage.excludedCases], [2, 1, 1]);
  assert.equal(result.coverage.observationCoverage, 0.5);
  assert.equal(result.alignments.length, 1);
  assert.ok(result.coverage.exclusions[0].reasons.includes('INCOMPLETE_OR_NON_RUN_SNAPSHOT'));
});

test('review regression: actual Pi CAS rejection records not_applied and permits later work without manual effect reconciliation', async t => {
  let memory;
  const f = await setup(t, (directory, agentId) => {
    memory = new AgentMemoryStore(join(directory, 'memory'), agentId);
    return createLocalPersonaProvider(memory, { principalId: owner.id, workspaceId: 'review-fixture' });
  });
  const selected = f.persona.resolveContext({ principal: owner, agentId: f.journal.agentId, sessionId: f.sessionId,
    runId: 'selection-only', taskId: 'selection-only', signal: new AbortController().signal });
  memory.remember({ kind: 'fact', text: 'A concurrent memory update.', sourceRefs: ['owner:concurrent-update'] });
  const result = await f.remember(selected.descriptor.personaBinding.contextRevision);
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'PERSONA_CONTEXT_REVISION_CONFLICT');
  assert.equal(result.recovery, undefined);
  assert.deepEqual(f.runtime.getRecovery(f.sessionId, owner).pendingEffects, []);
  assert.equal(memory.view().experiences.length, 1, 'rejected append must not add an analysis reference');
  f.f.setResponses([answer('Following work can proceed.')]);
  assert.equal((await f.runtime.run(f.sessionId, owner, 'Continue after a known rejected append.')).status, 'completed');
});

test('review regression: unknown external append outcome remains unknown and cannot be classified as a safe local rejection', async t => {
  const received = [];
  const f = await setup(t, (_directory, agentId) => ({
    id: 'external-append-contract-fixture', agentId, authority: 'external',
    resolveContext() { throw new Error('Not used by this append-only contract test.'); },
    appendAnalysis(request) { received.push(request); throw new Error('Connection lost after possible external append.'); },
  }));
  const result = await f.remember('a'.repeat(64));
  assert.equal(result.status, 'failed');
  assert.equal(received.length, 1);
  assert.equal(result.recovery?.autoRetry, false);
  assert.equal(result.recovery?.action, 'inspect-and-reconcile');
  const pending = f.runtime.getRecovery(f.sessionId, owner).pendingEffects;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].toolName, 'pi_analysis_remember');
  assert.equal(pending[0].state, 'unknown');
});

test('review regression: Persona append uses actual task identity including supported non-UUID task IDs', async t => {
  const received = [];
  const f = await setup(t, (_directory, agentId) => ({
    id: 'external-append-contract-fixture', agentId, authority: 'external',
    resolveContext() { throw new Error('Not used by this append-only contract test.'); },
    appendAnalysis(request) {
      received.push(request);
      return { status: 'appended', recordId: 'contract-record', revision: 1, contextRevision: 'b'.repeat(64) };
    },
  }));
  const taskId = 'review-task:acceptance-17';
  const result = await f.remember('a'.repeat(64), taskId);
  assert.equal(result.status, 'completed');
  assert.equal(result.taskId, taskId);
  assert.equal(received.length, 1);
  assert.equal(received[0].taskId, taskId);
  assert.equal(received[0].runId, result.runId);
  assert.notEqual(received[0].taskId, received[0].runId);
  assert.equal(f.runtime.exportRun(f.sessionId, result.runId, owner).events[0].task_id, taskId);
  assert.deepEqual(received[0].record.evidenceRefs, [f.model.resultRef, f.model.modelRef]);
  await assert.rejects(f.service.remember({ principal: owner, sessionId: f.sessionId, runId: result.runId,
    taskId: 'different-task', signal: new AbortController().signal }, f.model.resultRef, 'a'.repeat(64)), { code: 'PI_TASK_CONTEXT_MISMATCH' });
  assert.equal(received.length, 1, 'mismatched task identity must fail before provider dispatch');
});
