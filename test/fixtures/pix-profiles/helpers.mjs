import { readFileSync } from 'node:fs';
import { canonical, sha256 } from '../../../dist/private-state.js';
const doc = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
export function sequential(word = ['request', 'edit'], closed = false) {
  return { schemaVersion: 'pida.pix.profiles/1', profile: 'sequential-prefix/1', generation: 'fixture/generation-1',
    model: doc('sequential.model.json'), proxyPaths: [['t0', 't1', 't2', 't3']],
    sequential: { caseId: 'fixture-case', events: word.map((activity, sequence) => ({ id: 'observed-' + sequence, sequence, activity })),
      closed, ...(closed ? { closeId: 'source-close' } : {}) } };
}
export function objects() {
  const input = doc('objects.input.json');
  return { schemaVersion: 'pida.pix.profiles/1', profile: 'object-terminal/1', generation: 'fixture/objects-1', model: doc('objects.model.json'),
    objects: { closed: true, objects: input.objects.map(([id, type]) => ({ id, type })),
      events: input.events.map(e => ({ id: e.id, activity: e.activity, time: e.time, relations: e.relations.map(([objectId, qualifier]) => ({ objectId, qualifier })) })),
      objectTypes: ['artifact_revision'], qualifiers: ['uses'] } };
}
export function selection(request = sequential(), ownerId = 'owner', agentId = 'main') {
  const events = request.sequential?.events ?? request.objects.events;
  return { ownerId, agentId, cutRef: 'cut:fixture', modelRef: 'model:fixture',
    cutRevision: sha256(canonical(request.sequential ?? request.objects)), modelRevision: sha256(canonical(request.model)),
    policyRevision: sha256('fixture-policy-1'), scopeDigest: sha256('fixture-scope'), taskId: 'task:fixture', generation: request.generation,
    profile: request.profile, modelKind: 'aspirational', modelProvenance: { sourceRef: 'fixture:explicit-model', derivation: 'independently-provided-no-DFG-conversion' },
    artifactRefs: request.objects ? ['artifact-a@r1', 'artifact-b@r7'] : [],
    coverage: { complete: true, sourceEventCount: events.length, exclusions: [], ordering: request.sequential ? 'source-sequence' : 'selected-object-point-time', evidenceRefs: ['fixture:source-record'] },
    model: request.model, ...(request.sequential ? { sequential: request.sequential, proxyPaths: request.proxyPaths } : { objects: request.objects }) };
}
