import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentSupervisor } from '../dist/agent-supervisor.js';
import { collaborationDigest } from '../dist/collaboration.js';
import { organizationDefinitionDigest, organizationAdmissionDigest } from '../dist/organization-admission.js';
import { PidaRuntime } from '../dist/runtime.js';
import { createAgentTools } from '../dist/agent-tools.js';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
const owner = { id: 'owner', permissions: ['pida:agents', 'pida:collaborate', 'agent:delegate', 'agent:read'] };
const other = { ...owner, id: 'other' };
const golden = JSON.parse(readFileSync(new URL('../fixtures/organization-admission/admission-v1.json', import.meta.url), 'utf8'));
const directory = t => { const p = mkdtempSync(join(tmpdir(), 'pida-admit-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
async function until(fn) { for (let i = 0; i < 600; i++) { const value = await fn(); if (value) return value; await delay(10); } assert.fail('did not settle'); }
const done = (s, id) => until(() => { const j = s.getJob(id, owner); return !['queued', 'running'].includes(j.status) && j; });
const sign = a => { a.envelope.payload_digest = collaborationDigest(a.envelope); a.definition_digest = organizationDefinitionDigest(a.definition); a.admission_digest = organizationAdmissionDigest(a); return a; };
function admission(s, agent, edits = {}) {
  const a = structuredClone(golden), cap = s.organizationAdmissionCapabilities(owner).acceptance;
  a.envelope.recipient.org_session_id = randomUUID(); a.envelope.recipient.agent_id = agent.id;
  a.definition = { ...a.definition, root_agent_id: agent.id, participants: [agent.id], criterion_ids: cap.criterion_ids, criteria_digest: cap.criteria_digest, environment_revision: cap.environment_revision, ...edits };
  a.envelope.input = a.definition.goal; return sign(a);
}
function options(path, calls = [], extra = {}) { return { directory: path, resolvePrincipal: () => owner,
  collaboration: { hostId: 'host-1', authorize: () => true, authorizeAdmission: () => true },
  createRuntime: profile => { const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses([() => { calls.push(profile.id); return answer('done'); }]);
    return new PidaRuntime({ storageDir: join(path, profile.id), provider: () => ({ provider: f.provider, modelId: f.getModel().id }) }); }, ...extra }; }

test('one atomic native root precedes ACK; lost ACK/restart returns same receipt without duplicate goal or replay', async t => {
  const path = directory(t), calls = [], o = options(path, calls); let s = await AgentSupervisor.open(o); t.after(() => s.close());
  const agent = s.register(owner, { name: 'root' }), a = admission(s, agent), receipt = await s.admitOrganization(owner, a);
  const stored = JSON.parse(readFileSync(join(path, 'supervisor.json'), 'utf8'));
  assert.equal(stored.version, 4); assert.deepEqual([stored.jobs.length, stored.organization.sessions.length, stored.organization.tasks.length, stored.organization.attempts.length, stored.organizationAdmissions.length], [1, 1, 1, 1, 1]);
  assert.equal(stored.organization.sessions[0].rootTaskId, receipt.root_task_id); assert.equal(stored.jobs[0].attemptId, receipt.root_attempt_id); assert.deepEqual(calls, []);
  await s.close(); s = await AgentSupervisor.open(o); assert.deepEqual(await s.admitOrganization(owner, a), receipt); s.start();
  assert.equal((await done(s, receipt.job_id)).status, 'completed');
  await until(async () => (await s.getOrganization(a.envelope.recipient.org_session_id, owner)).organization.status !== 'active');
  assert.deepEqual(calls, [agent.id]); await s.close(); s = await AgentSupervisor.open(o); s.start();
  assert.deepEqual(await s.getOrganizationAdmissionReceipt(receipt.receipt_id, owner), receipt); assert.deepEqual(await s.admitOrganization(owner, a), receipt);
  await delay(50); assert.deepEqual(calls, [agent.id]); assert.equal(s.jobs(agent.id, owner).length, 1);
  await assert.rejects(s.getOrganizationAdmissionReceipt(receipt.receipt_id, other), { code: 'ORGANIZATION_ADMISSION_RECEIPT_NOT_FOUND' });
});

test('same scoped request altered definition, reservation or native ID conflicts; stale host profile and foreign participant do not publish', async t => {
  const path = directory(t), s = await AgentSupervisor.open(options(path)); t.after(() => s.close());
  const agent = s.register(owner, { name: 'root' }), foreign = s.register(other, { name: 'foreign' }), a = admission(s, agent);
  await s.admitOrganization(owner, a);
  for (const edit of [b => b.definition.timeout_ms++, b => b.definition.max_repair_attempts++, b => b.reservation_id += '-changed', b => b.envelope.recipient.org_session_id = randomUUID(),
    b => { b.definition.goal += ' changed'; b.envelope.input = b.definition.goal; }]) {
    const b = structuredClone(a); edit(b); await assert.rejects(s.admitOrganization(owner, sign(b)), { code: 'ORGANIZATION_ADMISSION_CONFLICT' });
  }
  for (const change of [b => b.envelope.request_id += '-new', b => { b.envelope.request_id += '-new'; b.reservation_id += '-new'; }]) {
    const b = structuredClone(a); change(b); await assert.rejects(s.admitOrganization(owner, sign(b)), { code: 'ORGANIZATION_ADMISSION_CONFLICT' });
  }
  const fresh = () => { const b = admission(s, agent); b.envelope.request_id += '-fresh'; b.reservation_id += '-fresh'; return b; };
  for (const edit of [b => b.definition.environment_revision += '-stale', b => b.definition.criteria_digest = '0'.repeat(64)]) {
    const b = fresh(); edit(b); await assert.rejects(s.admitOrganization(owner, sign(b)), { code: 'ORGANIZATION_ADMISSION_PROFILE_STALE' });
  }
  const b = fresh(); b.definition.participants.push(foreign.id); await assert.rejects(s.admitOrganization(owner, sign(b)), { code: 'AGENT_NOT_FOUND' });
  assert.equal(s.listOrganizations(owner).length, 1); assert.equal(s.jobs(agent.id, owner).length, 1);
});

test('current reservation revoked after durable admission blocks dispatch/read/retry, default admission remains disabled', async t => {
  const path = directory(t), calls = []; let allowed = true;
  const o = options(path, calls, { collaboration: { hostId: 'host-1', authorize: () => true, authorizeAdmission: () => allowed } });
  let s = await AgentSupervisor.open(o); t.after(() => s.close()); const agent = s.register(owner, { name: 'root' }), a = admission(s, agent), r = await s.admitOrganization(owner, a);
  await s.close(); allowed = false; s = await AgentSupervisor.open(o); s.start();
  assert.equal((await done(s, r.job_id)).code, 'ORGANIZATION_ADMISSION_FORBIDDEN'); assert.deepEqual(calls, []);
  await assert.rejects(s.admitOrganization(owner, a), { code: 'ORGANIZATION_ADMISSION_FORBIDDEN' });
  await assert.rejects(s.getOrganizationAdmissionReceipt(r.receipt_id, owner), { code: 'ORGANIZATION_ADMISSION_FORBIDDEN' });
  await s.close(); s = await AgentSupervisor.open({ ...o, collaboration: { hostId: 'host-1', authorize: () => true } });
  assert.equal(s.organizationAdmissionCapabilities(owner).enabled, false); await assert.rejects(s.admitOrganization(owner, a), { code: 'ORGANIZATION_ADMISSION_DISABLED' });
});

for (const revoke of [false, true]) test(`real Pi first root delegates and joins without parked coordinator; native descendant authority revoke=${revoke}`, async t => {
  const path = directory(t), calls = [], phases = []; let s, root, child, allowed = true;
  const createRuntime = p => {
    const f = fauxProvider({ tokensPerSecond: 100000 });
    f.setResponses(p.id === root.id ? [() => { calls.push('root'); return answer(call('agent_delegate', { agentId: child.id, input: 'child check' }), { stopReason: 'toolUse' }); },
      () => answer(call('agent_join', { required: [s.jobs(child.id, owner)[0].id] }), { stopReason: 'toolUse' }),
      () => { if (revoke) allowed = false; return answer('End initial attempt.'); }, () => { calls.push('continuation'); return answer('Combined.'); }]
      : [() => { calls.push('child'); return answer('Child result.'); }]);
    return new PidaRuntime({ storageDir: join(path, p.id), tools: createAgentTools(s, p.id), provider: () => ({ provider: f.provider, modelId: f.getModel().id }), maxRunMs: 5000 });
  };
  s = await AgentSupervisor.open(options(path, [], { createRuntime, maxConcurrent: 1, collaboration: { hostId: 'host-1', authorize: () => true,
    authorizeAdmission: ({ phase }) => { phases.push({ phase, allowed }); return allowed; } } })); t.after(() => s.close());
  root = s.register(owner, { name: 'root' }); child = s.register(owner, { name: 'child' });
  const a = admission(s, root, { participants: [root.id, child.id] }), r = await s.admitOrganization(owner, a); s.start();
  const result = await until(async () => { const view = await s.getOrganization(a.envelope.recipient.org_session_id, owner); return view.organization.status !== 'active' && view; });
  assert.equal(s.getJob(r.job_id, owner).status, 'completed'); assert.equal(result.joins.length, 1);
  if (revoke) { assert.deepEqual(calls, ['root']); assert.equal(s.jobs(child.id, owner)[0].code, 'ORGANIZATION_ADMISSION_FORBIDDEN'); }
  else { assert.deepEqual(calls, ['root', 'child', 'continuation']); assert.equal(result.joins[0].status, 'ready'); assert.equal(s.jobs(root.id, owner).length, 2);
    assert.equal(phases.filter(p => p.phase === 'dispatch').length, 3); }
});

test('corrupt admission/native mapping is rejected on reopen and original bytes preserved', async t => {
  const path = directory(t), o = options(path); const s = await AgentSupervisor.open(o), agent = s.register(owner, { name: 'root' });
  await s.admitOrganization(owner, admission(s, agent)); await s.close(); const file = join(path, 'supervisor.json'), original = readFileSync(file, 'utf8');
  for (const edit of [v => v.organizationAdmissions = [], v => delete v.jobs[0].organizationAdmissionReceiptId,
    v => v.organizationAdmissions[0].receipt.root_attempt_id = randomUUID(), v => v.organizationAdmissions[0].admission.definition.timeout_ms++]) {
    const value = JSON.parse(original); edit(value); const raw = JSON.stringify(value); writeFileSync(file, raw);
    await assert.rejects(AgentSupervisor.open(o), { code: 'ORGANIZATION_ADMISSION_STATE_INVALID' }); assert.equal(readFileSync(file, 'utf8'), raw);
  }
});

test('admitted descendant retains reservation authority across restart; cancelled reply never creates a fresh goal', async t => {
  const path = directory(t), calls = []; let allowed = true;
  const o = options(path, calls, { collaboration: { hostId: 'host-1', authorize: () => true, authorizeAdmission: () => allowed } });
  let s = await AgentSupervisor.open(o); t.after(() => s.close());
  const root = s.register(owner, { name: 'root' }), child = s.register(owner, { name: 'child' }); s.pause(child.id, owner);
  const a = admission(s, root, { participants: [root.id, child.id] }), receipt = await s.admitOrganization(owner, a);
  const delegated = s.enqueue(child.id, owner, { input: 'child', requestId: 'child', parentJobId: receipt.job_id }); s.start(); await done(s, receipt.job_id);
  await s.close(); allowed = false; s = await AgentSupervisor.open(o); s.start(); await s.resume(child.id, owner);
  assert.equal((await done(s, delegated.id)).code, 'ORGANIZATION_ADMISSION_FORBIDDEN'); assert.deepEqual(calls, [root.id]);
  allowed = true; s.pause(root.id, owner); const next = admission(s, root); next.envelope.request_id += '-next'; next.reservation_id += '-next'; next.envelope.reply_to_job_id = receipt.job_id;
  const correlated = await s.admitOrganization(owner, sign(next)); assert.notEqual(correlated.recipient.org_session_id, receipt.recipient.org_session_id);
  const cancelled = admission(s, root); cancelled.envelope.request_id += '-cancel'; cancelled.reservation_id += '-cancel';
  const cancelledReceipt = await s.admitOrganization(owner, sign(cancelled)); await s.cancel(cancelledReceipt.job_id, owner);
  const badReply = admission(s, root); badReply.envelope.request_id += '-badreply'; badReply.reservation_id += '-badreply'; badReply.envelope.reply_to_job_id = cancelledReceipt.job_id;
  const count = s.listOrganizations(owner).length; await assert.rejects(s.admitOrganization(owner, sign(badReply)), { code: 'ORGANIZATION_ADMISSION_REPLY_OBSOLETE' }); assert.equal(s.listOrganizations(owner).length, count);
});

test('native repair attempt rechecks original reservation before a second model call', async t => {
  const path = directory(t), calls = []; let allowed = true;
  const s = await AgentSupervisor.open(options(path, calls, { collaboration: { hostId: 'host-1', authorize: () => true, authorizeAdmission: () => allowed },
    acceptance: { criteria: [{ id: 'artifact', kind: 'file-contains', path: 'answer.txt', expected: 'ok', required: true }], capture: async () => { allowed = false; return {}; } } }));
  t.after(() => s.close()); const agent = s.register(owner, { name: 'root' }), a = admission(s, agent, { max_repair_attempts: 1 });
  const r = await s.admitOrganization(owner, a); s.start(); await done(s, r.job_id);
  const repair = await until(() => s.jobs(agent.id, owner).find(j => j.id !== r.job_id)); assert.equal((await done(s, repair.id)).code, 'ORGANIZATION_ADMISSION_FORBIDDEN'); assert.deepEqual(calls, [agent.id]);
});

test('v3 migration preserves existing native and delivery records without fictional admission', async t => {
  const path = directory(t), o = options(path); let s = await AgentSupervisor.open(o); const agent = s.register(owner, { name: 'legacy' });
  const org = s.createOrganization(owner, { requestId: 'legacy', goal: 'legacy goal', agentId: agent.id, participants: [agent.id], criterionIds: [] });
  const e = admission(s, agent).envelope; e.recipient.org_session_id = org.id; e.payload_digest = collaborationDigest(e); const r = await s.receiveCollaboration(owner, e); await s.close();
  const file = join(path, 'supervisor.json'), prior = JSON.parse(readFileSync(file, 'utf8')); prior.version = 3; delete prior.organizationAdmissions; writeFileSync(file, JSON.stringify(prior));
  s = await AgentSupervisor.open(o); t.after(() => s.close()); assert.deepEqual(await s.receiveCollaboration(owner, e), r);
  const current = JSON.parse(readFileSync(file, 'utf8')); assert.equal(current.version, 4); assert.deepEqual(current.organizationAdmissions, []); assert.deepEqual(current.jobs, prior.jobs); assert.deepEqual(current.organization, prior.organization);
});

test('admission capacity failure rolls back all five collections and preserves previous receipt through restart', async t => {
  const path = directory(t), o = options(path); let s = await AgentSupervisor.open(o); t.after(() => s.close());
  const agent = s.register(owner, { name: 'root' }), a = admission(s, agent), r = await s.admitOrganization(owner, a); await s.close();
  const file = join(path, 'supervisor.json'), state = JSON.parse(readFileSync(file, 'utf8')), profile = state.profiles[0];
  const add = () => state.profiles.push({ ...profile, id: randomUUID(), role: '\uac80'.repeat(4000), persona: '\uac80'.repeat(8000) });
  const baseBytes = Buffer.byteLength(JSON.stringify(state)), limit = 32 * 1024 * 1024;
  add(); const perProfile = Buffer.byteLength(JSON.stringify(state)) - baseBytes;
  const count = Math.ceil((limit - 80000 - baseBytes) / perProfile);
  for (let i = 1; i < count; i++) add();
  const raw = JSON.stringify(state);
  assert.ok(Buffer.byteLength(raw) < limit); writeFileSync(file, raw); s = await AgentSupervisor.open(o);
  const b = admission(s, agent, { goal: '\uac80'.repeat(12000) }); b.envelope.request_id += '-large'; b.reservation_id += '-large'; sign(b);
  const before = readFileSync(file, 'utf8'); await assert.rejects(s.admitOrganization(owner, b), { code: 'ORGANIZATION_ADMISSION_STORAGE_LIMIT' });
  assert.equal(readFileSync(file, 'utf8'), before); assert.equal(s.jobs(agent.id, owner).length, 1); assert.equal(s.listOrganizations(owner).length, 1);
  assert.deepEqual(await s.admitOrganization(owner, a), r); await s.close(); s = await AgentSupervisor.open(o); assert.deepEqual(await s.admitOrganization(owner, a), r);
  await assert.rejects(s.admitOrganization(owner, b), { code: 'ORGANIZATION_ADMISSION_STORAGE_LIMIT' });
});
