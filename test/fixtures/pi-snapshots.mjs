// Contract-only test support. Actual Pida journal, synthetic event metadata and a PIX port double.
// Nothing in this file is evidence that the real PIX engine or a live model computed these outputs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ObservationArchive } from '../../dist/observation.js';
import { canonical, sha256 } from '../../dist/private-state.js';
import { PidaError } from '../../dist/runtime.js';
import { validateObservationBundle } from '../../dist/integration-contract.js';

export const owner = { id: 'pi-fixture-owner', permissions: ['pi:read', 'pi:analyze', 'pi:remember', 'pi:policy:register', 'agent:memory:write'] };
export const fixtureEngine = {
  repository: 'contract-only-fixture/PIX', sourceCommit: '1'.repeat(40), sourceDigest: '2'.repeat(64),
  packageVersion: 'test-double', pythonVersion: 'NOT_RUN', sourceVerified: true,
};
export const enginePin = { sourceCommit: fixtureEngine.sourceCommit, sourceDigest: fixtureEngine.sourceDigest };
export function runtimeFixture(directory, agentId = 'fixture-agent') {
  const archives = new Map(), runs = new Map(), overrides = new Map();
  const archive = id => {
    if (!archives.has(id)) archives.set(id, new ObservationArchive(join(directory, 'journals', sha256(id)), id));
    return archives.get(id);
  };
  const authorized = (sessionId, runId, principal) => {
    const row = runs.get(`${sessionId}/${runId}`);
    if (!row || row.owner !== principal.id) throw new PidaError('SESSION_NOT_FOUND', 404);
    return row;
  };
  const runtime = {
    exportRun(sessionId, runId, principal) {
      const row = authorized(sessionId, runId, principal);
      const bundle = archive(row.agentId).bundle(sessionId, runId);
      overrides.get(`${sessionId}/${runId}`)?.(bundle);
      return bundle;
    },
    listSessions(principal) { return [...new Set([...runs.values()].filter(r => r.owner === principal.id).map(r => r.context.sessionId))].map(sessionId => ({ sessionId })); },
    listRuns(sessionId, principal) { return [...runs.values()].filter(r => r.owner === principal.id && r.context.sessionId === sessionId).map(r => r.context.runId); },
  };
  function add(options = {}) {
    const actor = options.agentId ?? agentId, journal = archive(actor);
    const context = { sessionId: randomUUID(), runId: randomUUID(), taskId: options.taskId ?? randomUUID() };
    runs.set(`${context.sessionId}/${context.runId}`, { context, owner: options.owner ?? owner.id, agentId: actor });
    journal.record(context, 'run_started');
    const descriptor = {
      schemaVersion: 1, rendererVersion: 'test-fixture/1', personaRevision: 1, informationState: null, experiences: [], truncated: false,
      digest: '3'.repeat(64), personaBinding: { schemaVersion: 1, providerId: 'test-provider/1', personaId: options.personaId ?? 'test-persona',
        authority: 'external', agentId: actor, role: options.role ?? 'coder', scopeId: '4'.repeat(64), contextRevision: '5'.repeat(64),
        contextDigest: '6'.repeat(64), rendererVersion: 'test-fixture/1', omitted: false },
    };
    journal.record(context, 'context_snapshot_loaded', { descriptor: JSON.stringify(descriptor) });
    const requestId = randomUUID();
    journal.record(context, 'model_request', { model: options.model ?? 'fixture-model', api: 'contract-only', request_id: requestId, attempt: 1,
      effective_config_digest: options.configuration ?? '7'.repeat(64), tools_digest: options.toolset ?? '8'.repeat(64) });
    journal.record(context, 'context_input_included', { request_id: requestId, attempt: 1, descriptor: JSON.stringify(descriptor), inclusion_scope: 'pi-logical-context' });
    if (options.concurrent) {
      journal.record(context, 'tool_started', { tool_name: 'edit', tool_call_id: 'call-1' });
      journal.record(context, 'tool_started', { tool_name: 'check', tool_call_id: 'call-2' });
      journal.record(context, 'tool_completed', { tool_name: 'check', tool_call_id: 'call-2' });
      journal.record(context, 'tool_completed', { tool_name: 'edit', tool_call_id: 'call-1' });
    } else for (const [i, name] of (options.tools ?? ['edit']).entries()) {
      const payload = { tool_name: name, tool_call_id: `call-${i}`, ...(options.nested ? { parent_tool_call_id: 'parent' } : {}) };
      journal.record(context, 'tool_started', payload);
      journal.record(context, options.toolFailure ? 'tool_failed' : 'tool_completed', payload);
    }
    const status = options.status ?? 'completed';
    if (!options.incomplete) {
      journal.record(context, 'run_finished', { status });
      journal.finish(context, { schema_version: 'pida.result/0.1-draft', task_id: context.taskId, run_id: context.runId, agent_id: actor,
        session_id: context.sessionId, reported_status: status, reported_by: 'runtime', verification_status: 'UNKNOWN',
        artifact_refs: [], current_artifact_refs: [], evidence_refs: [], verification_results: [], runtime_version: 'contract-only-fixture', known_limits: [] });
    }
    const bundle = runtime.exportRun(context.sessionId, context.runId, { ...owner, id: options.owner ?? owner.id });
    assert.equal(validateObservationBundle(bundle).valid, true, JSON.stringify(validateObservationBundle(bundle)));
    return { sessionId: context.sessionId, runId: context.runId, digest: sha256(canonical(bundle)), taskId: context.taskId };
  }
  return { runtime, agentId, add,
    ref: ({ sessionId, runId, digest }) => ({ sessionId, runId, digest }),
    change: (ref, callback) => overrides.set(`${ref.sessionId}/${ref.runId}`, callback),
    revoke: ref => runs.delete(`${ref.sessionId}/${ref.runId}`),
  };
}

export function contractPort(options = {}) {
  const calls = [];
  const port = { async compute(request, signal) {
    calls.push(structuredClone(request));
    if (options.compute) return options.compute(request, signal, calls.length);
    const common = { schemaVersion: 'pida.pix.worker.v1', operation: request.operation, status: 'computed', engine: fixtureEngine,
      issues: [], nativeResults: [{ profile: 'contract-only', computation: 'test-double' }], limits: ['CONTRACT_ONLY_TEST_DOUBLE'] };
    if (request.operation === 'reflect') {
      const variants = new Map();
      for (const trace of request.traces) {
        const activities = trace.events.map(e => e.activity), key = JSON.stringify(activities);
        if (!variants.has(key)) variants.set(key, { variantId: sha256(key), caseIds: [], activities, frequency: 0, cumulativeCaseCount: 0 });
        const variant = variants.get(key); variant.caseIds.push(trace.caseId); variant.frequency++;
      }
      const all = [...variants.values()].sort((a, b) => b.frequency - a.frequency), activities = [...new Set(all.flatMap(v => v.activities))];
      let count = 0; for (const v of all) v.cumulativeCaseCount = count += v.frequency;
      const edgeMap = new Map(all.flatMap(v => v.activities.slice(1).map((name, i) => [JSON.stringify([v.activities[i], name]), [v.activities[i], name]])));
      return { ...common, sampleCount: request.traces.length, variants: all, model: {
        activities, edges: [...edgeMap.values()], starts: [...new Set(all.map(v => v.activities[0]))], ends: [...new Set(all.map(v => v.activities.at(-1)))], acceptsEmpty: false,
      } };
    }
    return { ...common, status: options.partial ? 'partial' : 'computed', alignments: request.traces.map(trace => ({
      caseId: trace.caseId, status: options.alignmentStatus ?? 'optimal', cost: options.cost ?? 0, moves: [], lowerBoundCost: 0,
    })) };
  } };
  return { port, calls };
}
