import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fauxProvider, fauxAssistantMessage as answer } from '@earendil-works/pi-ai/providers/faux';
import { AgentSupervisor } from '../dist/agent-supervisor.js';
import { collaborationDigest, validCollaborationEnvelope } from '../dist/collaboration.js';
import { PidaRuntime } from '../dist/runtime.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { PidaClient } from '../dist/client.js';

const owner = { id: 'owner', permissions: ['pida:agents', 'pida:collaborate'] };
const other = { ...owner, id: 'other' };
const directory = t => { const p = mkdtempSync(join(tmpdir(), 'pida-collab-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
const options = (path, extra = {}) => ({ directory: path, resolvePrincipal: () => owner, createRuntime: () => { throw Error('unexpected runtime'); }, collaboration: { hostId: 'host-1', authorize: () => true }, ...extra });
function setup(s, requestId = 'org') {
  const agent = s.register(owner, { name: 'worker' });
  const org = s.createOrganization(owner, { requestId, goal: 'root goal', agentId: agent.id, participants: [agent.id], criterionIds: [] });
  return { agent, org };
}
function envelope(agent, org, changes = {}) {
  const e = { schema_version: 'pida.collaboration.envelope/1', producer_id: 'schumpeter', request_id: 'message-1',
    room_id: 'room-1', room_revision: 1, contract_id: 'contract-1', contract_revision: 1, sender_binding_id: 'sender-1',
    recipient: { organization_id: 'organization-A', host_id: 'host-1', org_session_id: org.id, agent_id: agent.id }, input: '검토해 주세요 🙂\nAn external request.', ...changes };
  return { ...e, payload_digest: collaborationDigest(e) };
}
async function until(fn) { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await delay(10); } assert.fail('did not settle'); }
const done = (s, id) => until(() => { const j = s.getJob(id, owner); return !['queued', 'running'].includes(j.status) && j; });
function runtimeFactory(path, called) {
  return profile => { const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(Array.from({ length: 5 }, () => () => { called.push(profile.id); return answer('done'); }));
    return new PidaRuntime({ storageDir: join(path, 'runtime', profile.id), provider: () => ({ provider: f.provider, modelId: f.getModel().id }) }); };
}

test('closed envelope and shared canonical digest golden vector', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/collaboration/envelope-v1.json', import.meta.url), 'utf8'));
  assert.equal(collaborationDigest(fixture), fixture.payload_digest);
  assert.equal(validCollaborationEnvelope(fixture), true);
  assert.equal(validCollaborationEnvelope({ ...fixture, unexpected: true }), false);
  assert.equal(validCollaborationEnvelope({ ...fixture, input: '\ud800' }), false);
  assert.equal(validCollaborationEnvelope({ ...fixture, room_revision: 1.5 }), false);
  assert.equal(validCollaborationEnvelope({ ...fixture, recipient: { ...fixture.recipient, principal: 'owner' } }), false);
});

test('concurrent delivery, lost ACK and persisted restart reuse the exact receipt/job; changed payload conflicts', async t => {
  const path = directory(t), o = options(path); let s = await AgentSupervisor.open(o);
  try {
    const { agent, org } = setup(s), e = envelope(agent, org);
    const receipts = await Promise.all(Array.from({ length: 8 }, () => s.receiveCollaboration(owner, e)));
    assert.ok(receipts.every(r => JSON.stringify(r) === JSON.stringify(receipts[0])));
    assert.equal(s.jobs(agent.id, owner).length, 2);
    assert.equal(receipts[0].phase, 'job_enqueued'); assert.equal(receipts[0].durable, true);
    assert.equal(s.getJob(receipts[0].job_id, owner).runId, undefined);
    await assert.rejects(s.receiveCollaboration(owner, envelope(agent, org, { input: 'changed' })), { code: 'COLLABORATION_REQUEST_CONFLICT' });
    await s.close(); s = await AgentSupervisor.open(o);
    assert.deepEqual(await s.receiveCollaboration(owner, e), receipts[0]);
    assert.deepEqual(await s.getCollaborationReceipt(receipts[0].receipt_id, owner), receipts[0]);
    assert.equal(s.jobs(agent.id, owner).length, 2);
    await assert.rejects(s.getCollaborationReceipt(receipts[0].receipt_id, other), { code: 'COLLABORATION_RECEIPT_NOT_FOUND' });
  } finally { await s.close(); }
});

test('actual process exits before/after file replacement and after ACK preserve all-or-nothing job binding', async t => {
  for (const [mode, status] of [['before', 66], ['after', 67], ['ack', 68]]) {
    const path = directory(t), called = [], o = options(path, { createRuntime: runtimeFactory(path, called) });
    let s = await AgentSupervisor.open(o); const { agent, org } = setup(s), e = envelope(agent, org); await s.close();
    const child = spawnSync(process.execPath, ['test/fixtures/collaboration-crash.mjs', path, mode, JSON.stringify(e)], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, status, child.stderr);
    const disk = JSON.parse(readFileSync(join(path, 'supervisor.json'), 'utf8'));
    assert.equal(disk.collaboration.length, mode === 'before' ? 0 : 1);
    assert.equal(disk.jobs.length, mode === 'before' ? 1 : 2);
    s = await AgentSupervisor.open(o);
    try {
      const receipt = await s.receiveCollaboration(owner, e);
      if (mode !== 'before') assert.deepEqual(receipt, disk.collaboration[0].receipt);
      if (mode === 'ack') assert.deepEqual(receipt, JSON.parse(child.stdout));
      assert.equal(s.jobs(agent.id, owner).length, 2);
      s.start(); assert.equal((await done(s, receipt.job_id)).status, 'completed');
      assert.equal(called.length, 2, 'one root and one mapped job actually invoked scripted Pi');
      assert.deepEqual(await s.receiveCollaboration(owner, e), receipt, 'terminal organization permits historical duplicate only');
      assert.equal(called.length, 2);
    } finally { await s.close(); }
  }
});

test('policy rejects foreign host, sender/mapping, stale revisions and revoked read/dispatch; absence disables delivery', async t => {
  const path = directory(t), called = []; let allowed = true;
  const o = options(path, { createRuntime: runtimeFactory(path, called), collaboration: { hostId: 'host-1', authorize: ({ envelope: e }) => allowed && e.room_revision === 1 && e.contract_revision === 1 && e.sender_binding_id === 'sender-1' && e.recipient.organization_id === 'organization-A' } });
  let s = await AgentSupervisor.open(o);
  try {
    const { agent, org } = setup(s), e = envelope(agent, org);
    for (const change of [{ room_revision: 2 }, { contract_revision: 2 }, { sender_binding_id: 'foreign' }, { recipient: { ...e.recipient, organization_id: 'foreign' } }, { recipient: { ...e.recipient, host_id: 'foreign' } }])
      await assert.rejects(s.receiveCollaboration(owner, envelope(agent, org, change)), { code: 'COLLABORATION_FORBIDDEN' });
    await assert.rejects(s.receiveCollaboration(other, e), { code: 'AGENT_NOT_FOUND' });
    await assert.rejects(s.receiveCollaboration({ ...owner, permissions: ['pida:agents'] }, e), { code: 'FORBIDDEN' });
    const receipt = await s.receiveCollaboration(owner, e); allowed = false;
    await assert.rejects(s.getCollaborationReceipt(receipt.receipt_id, owner), { code: 'COLLABORATION_FORBIDDEN' });
    s.start(); assert.equal((await done(s, receipt.job_id)).code, 'COLLABORATION_FORBIDDEN');
    assert.equal(called.length, 1, 'only root invokes model; receive never grants dispatch');
    await s.close(); s = await AgentSupervisor.open({ ...o, collaboration: undefined });
    assert.equal(s.collaborationCapabilities(owner).enabled, false);
    await assert.rejects(s.receiveCollaboration(owner, e), { code: 'COLLABORATION_DISABLED' });
  } finally { await s.close(); }
});

test('cancelled organization returns immutable duplicate history only, rejects new messages and late replies', async t => {
  const path = directory(t), s = await AgentSupervisor.open(options(path));
  try {
    const { agent, org } = setup(s), e = envelope(agent, org), first = await s.receiveCollaboration(owner, e);
    const reply = envelope(agent, org, { request_id: 'reply', reply_to_job_id: first.job_id });
    await s.cancel(first.job_id, owner);
    await assert.rejects(s.receiveCollaboration(owner, reply), { code: 'COLLABORATION_REPLY_OBSOLETE' });
    const otherOrg = setup(s, 'other');
    await assert.rejects(s.receiveCollaboration(owner, envelope(otherOrg.agent, otherOrg.org, { request_id: 'foreign-reply', reply_to_job_id: first.job_id })), { code: 'COLLABORATION_REPLY_OBSOLETE' });
    await s.cancelOrganization(org.id, owner);
    assert.deepEqual(await s.receiveCollaboration(owner, e), first);
    await assert.rejects(s.receiveCollaboration(owner, envelope(agent, org, { request_id: 'new' })), { code: 'COLLABORATION_TARGET_INACTIVE' });
    assert.equal(s.jobs(agent.id, owner).length, 2);
  } finally { await s.close(); }
});

test('restart rechecks host dispatch authority instead of replaying the saved grant', async t => {
  const path = directory(t), calls = [], o = options(path, { createRuntime: runtimeFactory(path, calls) });
  let s = await AgentSupervisor.open(o); const { agent, org } = setup(s), e = envelope(agent, org);
  const receipt = await s.receiveCollaboration(owner, e); await s.close();
  s = await AgentSupervisor.open({ ...o, collaboration: { hostId: 'host-1', authorize: () => false } });
  try {
    await assert.rejects(s.receiveCollaboration(owner, e), { code: 'COLLABORATION_FORBIDDEN' });
    s.start(); assert.equal((await done(s, receipt.job_id)).code, 'COLLABORATION_FORBIDDEN');
    assert.equal(calls.length, 1); assert.equal(s.jobs(agent.id, owner).length, 2);
  } finally { await s.close(); }
});

test('reply cancellation while dispatch authorization awaits prevents model invocation', async t => {
  const path = directory(t), calls = []; let release, entered;
  const gate = new Promise(r => { release = r; }), start = new Promise(r => { entered = r; });
  const s = await AgentSupervisor.open(options(path, { createRuntime: runtimeFactory(path, calls), collaboration: { hostId: 'host-1', authorize: async ({ phase, envelope: e }) => {
    if (phase === 'dispatch' && e.reply_to_job_id) { entered(); return gate; } return true;
  } } }));
  try {
    const { agent, org } = setup(s), original = await s.receiveCollaboration(owner, envelope(agent, org));
    // Reply to root while original job is independently cancelled; queued parent cancellation stays observable.
    const root = s.jobs(agent.id, owner)[0];
    const reply = await s.receiveCollaboration(owner, envelope(agent, org, { request_id: 'reply', reply_to_job_id: original.job_id }));
    s.start(); await start;
    // Completed native jobs are immutable, so emulate late target authority revocation via organization cancellation.
    const cancel = s.cancelOrganization(org.id, owner); release(true); await cancel;
    assert.equal((await done(s, reply.job_id)).status, 'cancelled');
    assert.equal(calls.length, 2, 'root and original ran; reply did not');
    assert.equal(s.getJob(root.id, owner).status, 'completed');
  } finally { release(false); await s.close(); }
});

test('async receive policy cannot bypass cancellation during its await', async t => {
  const path = directory(t); let release; const gate = new Promise(r => { release = r; });
  const s = await AgentSupervisor.open(options(path, { collaboration: { hostId: 'host-1', authorize: () => gate } }));
  try {
    const { agent, org } = setup(s), pending = s.receiveCollaboration(owner, envelope(agent, org));
    await s.cancelOrganization(org.id, owner); release(true);
    await assert.rejects(pending, { code: 'COLLABORATION_TARGET_INACTIVE' });
    assert.equal(s.jobs(agent.id, owner).length, 1);
  } finally { release(false); await s.close(); }
});

test('persisted corrupt receipt/job mapping fails closed and preserves file evidence', async t => {
  const path = directory(t), o = options(path), s = await AgentSupervisor.open(o);
  const { agent, org } = setup(s); await s.receiveCollaboration(owner, envelope(agent, org)); await s.close();
  const file = join(path, 'supervisor.json'), original = readFileSync(file, 'utf8');
  for (const corrupt of [v => { v.collaboration[0].receipt.job_id = v.jobs[0].id; }, v => { v.collaboration[0].envelope.input = 'changed'; }, v => { v.collaboration = []; }]) {
    const value = JSON.parse(original); corrupt(value); const raw = JSON.stringify(value); writeFileSync(file, raw);
    await assert.rejects(AgentSupervisor.open(o), { code: 'COLLABORATION_STATE_INVALID' });
    assert.equal(readFileSync(file, 'utf8'), raw);
  }
});

test('v2 migration preserves native jobs and creates no fictional receipts', async t => {
  const path = directory(t), o = options(path); let s = await AgentSupervisor.open(o); const { agent } = setup(s); await s.close();
  const file = join(path, 'supervisor.json'), prior = JSON.parse(readFileSync(file, 'utf8')); prior.version = 2; delete prior.collaboration; writeFileSync(file, JSON.stringify(prior));
  s = await AgentSupervisor.open(o);
  try { assert.equal(s.jobs(agent.id, owner).length, 1); const current = JSON.parse(readFileSync(file, 'utf8')); assert.equal(current.version, 4); assert.deepEqual(current.collaboration, []); assert.deepEqual(current.organizationAdmissions, []); }
  finally { await s.close(); }
});

test('HTTP + SDK enforce dedicated permission and current authority; native organization API still works', async t => {
  const path = directory(t), s = await AgentSupervisor.open(options(path)), runtime = new PidaRuntime({});
  const server = createPidaServer({ runtime, agents: s, authenticate: staticTokenAuth([{ token: 'allowed-token'.repeat(4), principal: owner }, { token: 'denied-token'.repeat(4), principal: { ...owner, permissions: ['pida:agents'] } }]) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const baseUrl = 'http://127.0.0.1:' + server.address().port, client = new PidaClient({ baseUrl, token: () => 'allowed-token'.repeat(4) }), denied = new PidaClient({ baseUrl, token: () => 'denied-token'.repeat(4) });
    const { agent, org } = setup(s), e = envelope(agent, org);
    await assert.rejects(denied.receiveCollaboration(e), { code: 'FORBIDDEN' });
    const receipt = await client.receiveCollaboration(e);
    assert.deepEqual(await client.getCollaborationReceipt(receipt.receipt_id), receipt);
    assert.equal((await client.listOrganizations()).organizations.length, 1);
    assert.equal((await client.getOrganization(org.id)).currentAcceptance, 'UNKNOWN');
    assert.equal((await client.cancelOrganization(org.id)).status, 'cancelled');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await s.close(); await runtime.close(); }
});
