// Regression scenarios from independent review of frozen 50d1ed4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentSupervisor } from '../dist/agent-supervisor.js';
import { collaborationDigest } from '../dist/collaboration.js';
import { PidaRuntime } from '../dist/runtime.js';
import { fauxProvider, fauxAssistantMessage as answer } from '@earendil-works/pi-ai/providers/faux';
const owner = { id: 'owner', permissions: ['pida:agents', 'pida:collaborate', 'agent:delegate'] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const directory = t => { const p = mkdtempSync(join(tmpdir(), 'pida-collab-fix-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
async function until(fn) { for (let i = 0; i < 500; i++) { const v = await fn(); if (v) return v; await delay(10); } assert.fail('did not settle'); }
const done = (s, id) => until(() => { const j = s.getJob(id, owner); return !['running', 'queued'].includes(j.status) && j; });
function envelope(agent, org, changes = {}) { const e = { schema_version: 'pida.collaboration.envelope/1', producer_id: 'schumpeter', request_id: 'external', room_id: 'room', room_revision: 1, contract_id: 'contract', contract_revision: 1, sender_binding_id: 'sender', recipient: { organization_id: 'external-org', host_id: 'host-1', org_session_id: org.id, agent_id: agent.id }, input: 'external work', ...changes }; return { ...e, payload_digest: collaborationDigest(e) }; }
function runtimeFactory(path, calls) { return p => { const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(Array.from({ length: 6 }, () => () => { calls.push(p.name); return answer('done'); })); return new PidaRuntime({ storageDir: join(path, p.id), provider: () => ({ provider: f.provider, modelId: f.getModel().id }) }); }; }

test('corrupt persisted delegated depth without parent cannot erase collaboration ancestry', async t => {
  const path = directory(t), file = join(path, 'supervisor.json'), o = { directory: path, resolvePrincipal: () => owner, createRuntime: () => { throw Error('must not dispatch'); }, collaboration: { hostId: 'host-1', authorize: () => true } };
  const s = await AgentSupervisor.open(o), root = s.register(owner, { name: 'root' }), child = s.register(owner, { name: 'child' });
  const org = s.createOrganization(owner, { requestId: 'org', goal: 'root', agentId: root.id, participants: [root.id, child.id], criterionIds: [] });
  const receipt = await s.receiveCollaboration(owner, envelope(root, org));
  const delegated = s.enqueue(child.id, owner, { requestId: 'child', input: 'child', parentJobId: receipt.job_id }); await s.close();
  const state = JSON.parse(readFileSync(file, 'utf8')); delete state.jobs.find(j => j.id === delegated.id).parentJobId;
  const corrupt = JSON.stringify(state); writeFileSync(file, corrupt);
  await assert.rejects(AgentSupervisor.open({ ...o, collaboration: { hostId: 'host-1', authorize: () => false } }), { code: 'AGENT_STATE_INVALID' });
  assert.equal(readFileSync(file, 'utf8'), corrupt, 'preserve malformed evidence without loading or dispatching');
});

for (const mode of ['child', 'continuation']) test(`persisted ${mode} derives current external grant from native lineage after restart`, async t => {
  const path = directory(t), calls = [], phases = []; let allowed = true;
  const o = { directory: path, resolvePrincipal: () => owner, createRuntime: runtimeFactory(path, calls), collaboration: { hostId: 'host-1', authorize: ({ phase }) => { phases.push({ phase, allowed }); return allowed; } } };
  let s = await AgentSupervisor.open(o);
  try {
    const root = s.register(owner, { name: 'root' }), external = s.register(owner, { name: 'external' }), child = s.register(owner, { name: 'child' }); s.pause(root.id, owner);
    const org = s.createOrganization(owner, { requestId: 'org', goal: 'root', agentId: root.id, participants: [root.id, external.id, child.id], criterionIds: [] });
    const receipt = await s.receiveCollaboration(owner, envelope(external, org));
    s.pause(child.id, owner);
    const delegated = s.enqueue(child.id, owner, { requestId: 'child', input: 'child', parentJobId: receipt.job_id }); s.start(); await done(s, receipt.job_id);
    let target = delegated.id;
    if (mode === 'continuation') {
      s.pause(external.id, owner); await s.resume(child.id, owner); await done(s, delegated.id);
      const joined = s.registerJoin(receipt.job_id, owner, { requestId: 'join', required: [delegated.id] });
      target = await until(async () => { const v = await s.getOrganization(org.id, owner); return v.joins.find(j => j.id === joined.id)?.continuationJobId; });
    }
    await s.close(); allowed = false; s = await AgentSupervisor.open(o); s.start(); await s.resume(mode === 'child' ? child.id : external.id, owner);
    assert.equal((await done(s, target)).code, 'COLLABORATION_FORBIDDEN');
    assert.deepEqual(calls, mode === 'child' ? ['external'] : ['external', 'child']);
    assert.ok(phases.some(p => p.phase === 'dispatch' && !p.allowed));
    assert.equal(s.getJob(receipt.job_id, owner).collaborationReceiptId, receipt.receipt_id);
  } finally { await s.close(); }
});

for (const boundary of ['principal', 'capture']) test(`new admission during async acceptance ${boundary} discards the obsolete capture`, async t => {
  const path = directory(t), calls = [], entered = deferred(), release = deferred(); let principals = 0, captures = 0;
  const s = await AgentSupervisor.open({ directory: path, createRuntime: runtimeFactory(path, calls), resolvePrincipal: async () => {
    principals++; if (boundary === 'principal' && principals === 2) { entered.resolve(); await release.promise; } return owner;
  }, collaboration: { hostId: 'host-1', authorize: () => true }, acceptance: { criteria: [{ id: 'ok', kind: 'file-contains', path: 'out.txt', expected: 'ok', required: true }], capture: async () => {
    captures++; if (boundary === 'capture' && captures === 1) { entered.resolve(); await release.promise; } return { 'out.txt': 'ok' };
  } } });
  try {
    const p = s.register(owner, { name: 'worker' }), org = s.createOrganization(owner, { requestId: 'org', goal: 'root', agentId: p.id, participants: [p.id], criterionIds: ['ok'] });
    s.start(); await entered.promise; const r = await s.receiveCollaboration(owner, envelope(p, org)); release.resolve();
    assert.equal((await done(s, r.job_id)).status, 'completed');
    const view = await until(async () => { const v = await s.getOrganization(org.id, owner); return v.organization.status === 'accepted' && v; });
    assert.equal(view.currentAcceptance, 'PASS'); assert.deepEqual(calls, ['worker', 'worker']);
    assert.equal(view.tasks.find(t => t.id === org.rootTaskId).receipts.length, 1, 'no stale receipt or retry intent was committed');
    assert.ok(captures >= 2, 'captured again after changed admitted work settled');
  } finally { release.resolve(); await s.close(); }
});

test('byte-capacity rejection rolls back admission, preserves prior receipts and reopens; no history eviction', async t => {
  const path = directory(t), file = join(path, 'supervisor.json'), o = { directory: path, resolvePrincipal: () => owner, createRuntime: () => { throw Error('must not dispatch'); }, collaboration: { hostId: 'host-1', authorize: () => true } };
  let s = await AgentSupervisor.open(o);
  try {
    const p = s.register(owner, { name: 'worker' }), org = s.createOrganization(owner, { requestId: 'org', goal: 'root', agentId: p.id, participants: [p.id], criterionIds: [] });
    const original = envelope(p, org), receipt = await s.receiveCollaboration(owner, original); await s.close();
    const state = JSON.parse(readFileSync(file, 'utf8')), record = state.collaboration[0], job = state.jobs.find(j => j.id === receipt.job_id), task = state.organization.tasks.find(t => t.id === job.organizationTaskId), attempt = state.organization.attempts.find(a => a.jobId === job.id);
    const input = '\uAC80'.repeat(12000), inputDigest = createHash('sha256').update(input).digest('hex');
    const add = i => { const r = structuredClone(record), j = structuredClone(job), t = structuredClone(task), a = structuredClone(attempt); const rid = randomUUID(), jid = randomUUID(), tid = randomUUID(), aid = randomUUID();
      r.envelope = envelope(p, org, { request_id: 'seed-' + i, input }); Object.assign(r.receipt, { receipt_id: rid, job_id: jid, payload_digest: r.envelope.payload_digest, request_id: r.envelope.request_id });
      Object.assign(j, { id: jid, requestId: 'collab-' + rid, input, collaborationReceiptId: rid, organizationTaskId: tid, attemptId: aid }); Object.assign(t, { id: tid, inputDigest, attempts: [aid] }); Object.assign(a, { id: aid, taskId: tid, jobId: jid });
      state.collaboration.push(r); state.jobs.push(j); state.organization.tasks.push(t); state.organization.attempts.push(a);
    };
    // Synthetic valid native history isolates the real admission/reopen boundary without hundreds of costly public writes.
    const limit = 32 * 1024 * 1024, first = Buffer.byteLength(JSON.stringify(state)); add(0);
    const perRecord = Buffer.byteLength(JSON.stringify(state)) - first, count = Math.floor((limit - first - 1000) / perRecord);
    for (let i = 1; i < count; i++) add(i);
    let raw = JSON.stringify(state);
    while (Buffer.byteLength(raw) + perRecord < limit) { add(state.collaboration.length); raw = JSON.stringify(state); }
    writeFileSync(file, raw); assert.ok(statSync(file).size < limit);
    s = await AgentSupervisor.open(o); const before = readFileSync(file, 'utf8'), jobs = s.jobs(p.id, owner).length;
    const crossing = envelope(p, org, { request_id: 'crossing', input });
    await assert.rejects(s.receiveCollaboration(owner, crossing), { code: 'COLLABORATION_STORAGE_LIMIT' });
    assert.equal(s.jobs(p.id, owner).length, jobs); assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(await s.receiveCollaboration(owner, original), receipt);
    await assert.rejects(s.receiveCollaboration(owner, envelope(p, org, { input: 'changed' })), { code: 'COLLABORATION_REQUEST_CONFLICT' });
    await s.close(); s = await AgentSupervisor.open(o);
    assert.deepEqual(await s.receiveCollaboration(owner, original), receipt);
    await assert.rejects(s.receiveCollaboration(owner, crossing), { code: 'COLLABORATION_STORAGE_LIMIT' });
    assert.equal(statSync(file).size, Buffer.byteLength(before));
    // A different public mutation also cannot replace the bounded disk snapshot with an unreadable one.
    let lastDisk = readFileSync(file, 'utf8'), overflow = false;
    for (let i = 0; i < 10; i++) {
      try { s.register(owner, { name: 'large-profile-' + i, role: '\uAC80'.repeat(4000), persona: '\uAC80'.repeat(8000) }); lastDisk = readFileSync(file, 'utf8'); }
      catch (error) { assert.equal(error.code, 'AGENT_STATE_LIMIT'); overflow = true; break; }
    }
    assert.equal(overflow, true); assert.equal(readFileSync(file, 'utf8'), lastDisk);
    await s.close(); s = await AgentSupervisor.open(o);
    assert.deepEqual(await s.receiveCollaboration(owner, original), receipt);
  } finally { await s.close(); }
});
