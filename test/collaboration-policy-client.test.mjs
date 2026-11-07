import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createCollaborationPolicyClient } from '../dist/collaboration-policy-client.js';
import { collaborationDigest } from '../dist/collaboration.js';
import { organizationDefinitionDigest, organizationAdmissionDigest } from '../dist/organization-admission.js';
import { PidaClient } from '../dist/client.js';
const root = fileURLToPath(new URL('../', import.meta.url)), token = 'synthetic-policy-token-'.repeat(3);
const golden = JSON.parse(await readFile(join(root, 'fixtures/collaboration/envelope-v1.json'), 'utf8'));
function pipe(child, readyType) {
  let readyResolve, readyReject, seq = 0, exited = false; const pending = new Map();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => { readyReject(Error('ready timeout')); child.kill(); }, 10000);
  let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
  child.once('error', readyReject);
  const closed = new Promise(resolve => child.once('close', code => { exited = true; clearTimeout(timer); readyReject(Error('child exit: ' + code + ':' + stderr)); for (const p of pending.values()) p.reject(Error('child closed')); pending.clear(); resolve(code); }));
  createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); if (message.type === readyType) { clearTimeout(timer); readyResolve(message); } else { const p = pending.get(message.id); if (p) { pending.delete(message.id); p.resolve(message); } } });
  return { ready, child, closed, command(value) { return new Promise((resolve, reject) => { if (exited) return reject(Error('closed')); const id = ++seq; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, ...value }) + '\n'); }); }, async close() { child.stdin.end(); const timer = setTimeout(() => child.kill(), 3000); try { return await closed; } finally { clearTimeout(timer); } } };
}
async function policyServer(t) {
  const p = pipe(spawn(process.env.PYTHON ?? 'python', ['-I', '-B', join(root, 'test/fixtures/collaboration-policy-server.py')], { env: { ...process.env, POLICY_FIXTURE_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] }), 'ready');
  const info = await p.ready; t.after(() => p.close());
  return { ...p, url: `http://127.0.0.1:${info.port}/v1/pida-authorization` };
}
const grantFor = e => ({ host_id: e.recipient.host_id, principal_id: 'local-user', recipient: e.recipient, sender_binding_id: e.sender_binding_id, room_id: e.room_id, room_revision: e.room_revision, contract_id: e.contract_id, contract_revision: e.contract_revision });

test('trusted endpoint is literal loopback, credential-free URL and exact path only', () => {
  for (const url of ['https://example.com/v1/pida-authorization', 'http://localhost/v1/pida-authorization', 'http://user:secret@127.0.0.1/v1/pida-authorization', 'http://127.0.0.1/other', 'http://127.0.0.1/v1/pida-authorization?token=x'])
    assert.throws(() => createCollaborationPolicyClient({ hostId: 'host-1', authorizationUrl: url, token: () => token }), { code: 'COLLABORATION_POLICY_CONFIG_INVALID' });
  assert.throws(() => createCollaborationPolicyClient({ hostId: 'host-1\n', authorizationUrl: 'http://127.0.0.1/v1/pida-authorization', token: () => token }), { code: 'COLLABORATION_POLICY_CONFIG_INVALID' });
});

for (const fault of ['reject', 'hang']) test(`parent EOF closes HTTP and Persona even when runtime close ${fault}s`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pida-close-'));
  const host = pipe(spawn(process.execPath, ['--import', pathToFileURL(join(root, 'test/fixtures/host-close-fault.mjs')).href,
    join(root, 'examples/schumpeter-host.mjs'), '--workspace', directory, '--host-id', 'close-host',
    '--persona-module', join(root, 'test/fixtures/host-close-persona.mjs')], {
    env: { ...process.env, PIDA_SCHUMPETER_AUTH_URL: 'http://127.0.0.1:9/v1/pida-authorization', PIDA_SCHUMPETER_AUTH_TOKEN: token, PIDA_TEST_CLOSE_FAULT: fault },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }), 'pida-host-ready');
  t.after(async () => { await host.close(); await rm(directory, { recursive: true, force: true }); });
  const ready = await host.ready; host.child.stdin.end();
  await delay(150);
  await assert.rejects(fetch(ready.base_url + '/health', { signal: AbortSignal.timeout(1000) }));
  assert.equal(await readFile(join(directory, 'persona-closed.txt'), 'utf8'), 'closed');
  assert.equal(await host.closed, 1, 'bounded shutdown retains a failure exit status');
});

test('actual Python policy independently verifies Unicode digest, current grant and strict nonce/echo binding', async t => {
  const server = await policyServer(t), policy = createCollaborationPolicyClient({ hostId: 'host-1', authorizationUrl: server.url, token: () => token, timeoutMs: 100 });
  const input = { principal: { id: 'local-user', permissions: [] }, envelope: golden, phase: 'receive', signal: new AbortController().signal };
  assert.equal(await policy.authorize(input), false, 'no authoritative grant'); await server.command({ grant: grantFor(golden) });
  for (const phase of ['receive', 'dispatch', 'read']) assert.equal(await policy.authorize({ ...input, phase }), true);
  assert.equal(await policy.authorize({ ...input, principal: { id: 'foreign', permissions: [] } }), false);
  const stale = { ...golden, room_revision: 2 }; stale.payload_digest = collaborationDigest(stale);
  assert.equal(await policy.authorize({ ...input, envelope: stale }), false);
  for (const mode of ['nonce', 'phase', 'owner', 'host', 'stale', 'recipient', 'redirect', 'malformed', 'oversize', 'delay']) { await server.command({ mode }); assert.equal(await policy.authorize(input), false, mode); }
  await server.command({ mode: 'normal' });
  const aborted = new AbortController(); aborted.abort(); assert.equal(await policy.authorize({ ...input, signal: aborted.signal }), false);
  await server.command({ grant: null }); assert.equal(await policy.authorize(input), false, 'revoked grant');
});

for (const personaMode of process.env.PIDA_TEST_VERA_SOURCE ? ['local', 'public-fixture'] : ['local']) test(`supported local-host process (${personaMode}) uses Python current policy, capability/readback and exact native job mapping`, async t => {
  const server = await policyServer(t), directory = await mkdtemp(join(tmpdir(), 'pida-host-'));
  const host = pipe(spawn(process.execPath, [join(root, 'examples/schumpeter-host.mjs'), '--workspace', directory, '--host-id', 'host-1',
    ...(personaMode === 'public-fixture' ? ['--persona-module', join(root, 'examples/vera-dispatch-persona.mjs')] : [])],
    { env: { ...process.env, PIDA_SCHUMPETER_AUTH_URL: server.url, PIDA_SCHUMPETER_AUTH_TOKEN: token, PIDA_VERA_SOURCE: process.env.PIDA_TEST_VERA_SOURCE, PIDA_VERA_PYTHON: process.env.PYTHON ?? 'python' }, stdio: ['pipe', 'pipe', 'pipe'] }), 'pida-host-ready');
  t.after(async () => { await host.close(); await rm(directory, { recursive: true, force: true }); });
  const ready = await host.ready; assert.equal(ready.protocol, 'pida.local-host/2'); assert.equal(ready.host_id, 'host-1'); assert.equal(ready.persona_mode, personaMode === 'local' ? 'pida-local' : 'vera-dispatch-synthetic/0.1.0');
  assert.equal(new URL(ready.base_url).hostname, '127.0.0.1');
  const client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  const cap = await client.getCollaborationCapabilities(); assert.equal(cap.enabled, true); assert.equal(cap.host_id, ready.host_id); assert.equal(cap.reply_mode, 'fresh-task-only');
  const coordinator = await client.createAgent({ name: 'coordinator' }), worker = await client.createAgent({ name: 'worker' }); await client.pauseAgent(coordinator.id);
  const org = await client.createOrganization({ requestId: 'host-org', goal: 'coordinate', agentId: coordinator.id, participants: [coordinator.id, worker.id], criterionIds: [] });
  const e = { ...golden, request_id: 'host-task', recipient: { ...golden.recipient, org_session_id: org.id, agent_id: worker.id } }; e.payload_digest = collaborationDigest(e);
  await assert.rejects(client.receiveCollaboration(e), { code: 'COLLABORATION_FORBIDDEN' }); await server.command({ grant: grantFor(e) });
  const receipt = await client.receiveCollaboration(e); assert.deepEqual(await client.receiveCollaboration(e), receipt); assert.deepEqual(await client.getCollaborationReceipt(receipt.receipt_id), receipt);
  let job; for (let i = 0; i < 200; i++) { job = await client.getAgentJob(worker.id, receipt.job_id); if (!['queued', 'running'].includes(job.status)) break; await delay(10); }
  assert.equal(job.status, 'completed', JSON.stringify({ status: job.status, code: job.code })); assert.equal((await client.listAgentJobs(worker.id)).jobs.length, 1);
  if (personaMode === 'public-fixture') {
    const bundle = await client.exportAgentJob(worker.id, job.id), included = bundle.events.find(e => e.activity === 'context_input_included');
    assert.ok(included); const binding = JSON.parse(included.payload.descriptor).personaBinding;
    assert.equal(binding.providerId, 'pida.vera-dispatch/0.1.0'); assert.equal(binding.externalContext.hostId, 'host-1');
    assert.equal(binding.externalContext.organizationSessionId, org.id); assert.equal(binding.externalContext.agentInstanceId, worker.id);
    assert.equal(binding.externalContext.taskId, job.id, 'Persona taskId denotes exact native runtime job');
    assert.equal(binding.externalContext.attemptId, job.attemptId, 'actual native OrgAttempt, not a synthetic run prefix');
    const view = await client.getOrganization(org.id);
    assert.ok(view.attempts.some(a => a.id === binding.externalContext.attemptId && a.taskId === job.organizationTaskId && a.jobId === job.id));
  }
  await client.pauseAgent(worker.id);
  const next = { ...e, request_id: 'host-task-revoked' }; next.payload_digest = collaborationDigest(next);
  const deniedReceipt = await client.receiveCollaboration(next);
  await server.command({ grant: null }); await assert.rejects(client.getCollaborationReceipt(receipt.receipt_id), { code: 'COLLABORATION_FORBIDDEN' });
  await client.resumeAgent(worker.id);
  for (let i = 0; i < 100; i++) { job = await client.getAgentJob(worker.id, deniedReceipt.job_id); if (!['queued', 'running'].includes(job.status)) break; await delay(10); }
  assert.equal(job.code, 'COLLABORATION_FORBIDDEN'); assert.equal(job.runId, undefined, 'revocation before dispatch creates no model invocation');
  await client.cancelOrganization(org.id);
  // Existing workspace cannot be reused by a fresh-host launcher.
  const second = pipe(spawn(process.execPath, [join(root, 'examples/schumpeter-host.mjs'), '--workspace', directory, '--host-id', 'host-1'], { env: { ...process.env, PIDA_SCHUMPETER_AUTH_URL: server.url, PIDA_SCHUMPETER_AUTH_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] }), 'pida-host-ready');
  await assert.rejects(second.ready, /HOST_WORKSPACE_NOT_EMPTY/); await second.close();
});

test('explicit resume preserves native identity and lost ACK dedup; wrong profile, live lock and revoked policy fail closed', async t => {
  const server = await policyServer(t), directory = await mkdtemp(join(tmpdir(), 'pida-resume-'));
  let host;
  const launch = (mode = 'resume', hostId = 'host-1', selectedToken = token) => pipe(spawn(process.execPath,
    [join(root, 'examples/schumpeter-host.mjs'), '--workspace', directory, '--host-id', hostId, '--workspace-mode', mode],
    { env: { ...process.env, PIDA_SCHUMPETER_AUTH_URL: server.url, PIDA_SCHUMPETER_AUTH_TOKEN: selectedToken }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }), 'pida-host-ready');
  t.after(async () => { await host?.close(); await rm(directory, { recursive: true, force: true }); });
  host = launch('fresh'); const first = await host.ready;
  assert.equal(first.workspace_mode, 'fresh');
  let client = new PidaClient({ baseUrl: first.base_url, token: () => first.api_token });
  const coordinator = await client.createAgent({ name: 'coordinator' }), worker = await client.createAgent({ name: 'worker' });
  await client.pauseAgent(coordinator.id); await client.pauseAgent(worker.id);
  const org = await client.createOrganization({ requestId: 'resume-org', goal: 'coordinate', agentId: coordinator.id, participants: [coordinator.id, worker.id], criterionIds: [] });
  const e = { ...golden, request_id: 'lost-ack', recipient: { ...golden.recipient, org_session_id: org.id, agent_id: worker.id } }; e.payload_digest = collaborationDigest(e);
  await server.command({ grant: grantFor(e) });
  const response = await fetch(first.base_url + '/v1/collaboration/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + first.api_token, 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
  assert.equal(response.status, 202); await response.body.cancel(); // Deliberately discard ACK bytes after committed admission.
  const originalJobs = (await client.listAgentJobs(worker.id)).jobs; assert.equal(originalJobs.length, 1);
  const immutable = async () => Promise.all(['.env', '.pida-host.json', 'pida.config.json'].map(p => readFile(join(directory, p), 'utf8')));
  const beforeLock = await immutable(), competing = launch();
  await assert.rejects(competing.ready, /HOST_WORKSPACE_LOCKED/); await competing.close(); assert.deepEqual(await immutable(), beforeLock);
  await host.close(); const before = await immutable();
  for (const [wrongHost, wrongToken] of [['foreign-host', token], ['host-1', token + '-rotated']]) {
    const failed = launch('resume', wrongHost, wrongToken); await assert.rejects(failed.ready, /HOST_RESUME_MISMATCH/); await failed.close(); assert.deepEqual(await immutable(), before);
  }
  const manifestPath = join(directory, '.pida-host.json'), manifestText = before[1];
  for (const [field, value] of [['principal_id', 'foreign-owner'], ['source_digest', '0'.repeat(64)], ['schema_version', 'unknown/2']]) {
    await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(manifestText), [field]: value }));
    const bad = await immutable(), failed = launch(); await assert.rejects(failed.ready, /HOST_RESUME_MISMATCH/); await failed.close(); assert.deepEqual(await immutable(), bad);
  }
  await writeFile(manifestPath, manifestText);
  host = launch(); const reopened = await host.ready; assert.equal(reopened.workspace_mode, 'resume');
  assert.notEqual(reopened.api_token, first.api_token); assert.equal(reopened.host_id, first.host_id); assert.equal(reopened.principal_id, first.principal_id);
  client = new PidaClient({ baseUrl: reopened.base_url, token: () => reopened.api_token });
  await assert.rejects(new PidaClient({ baseUrl: reopened.base_url, token: () => first.api_token }).getCollaborationCapabilities());
  const receipt = await client.receiveCollaboration(e); assert.equal(receipt.job_id, originalJobs[0].id);
  assert.deepEqual(await client.receiveCollaboration(e), receipt); assert.equal((await client.listAgentJobs(worker.id)).jobs.length, 1);
  assert.equal((await client.getOrganization(org.id)).organization.id, org.id);
  const changed = { ...e, input: 'changed' }; changed.payload_digest = collaborationDigest(changed);
  await assert.rejects(client.receiveCollaboration(changed), { code: 'COLLABORATION_REQUEST_CONFLICT' });
  await server.command({ grant: null }); await assert.rejects(client.getCollaborationReceipt(receipt.receipt_id), { code: 'COLLABORATION_FORBIDDEN' });
  await client.resumeAgent(worker.id);
  let job; for (let i = 0; i < 100; i++) { job = await client.getAgentJob(worker.id, receipt.job_id); if (job.status !== 'queued' && job.status !== 'running') break; await delay(10); }
  assert.equal(job.code, 'COLLABORATION_FORBIDDEN'); assert.equal(job.runId, undefined);

  // Kill a real process while a second job is awaiting dispatch policy; reopening never replays that attempt.
  await server.command({ grant: grantFor(e) }); await client.pauseAgent(worker.id);
  const crashEnvelope = { ...e, request_id: 'interrupted-dispatch' }; crashEnvelope.payload_digest = collaborationDigest(crashEnvelope);
  const crashReceipt = await client.receiveCollaboration(crashEnvelope); await server.command({ mode: 'delay' }); await client.resumeAgent(worker.id);
  for (let i = 0; i < 100; i++) { job = await client.getAgentJob(worker.id, crashReceipt.job_id); if (job.status === 'running') break; await delay(5); }
  assert.equal(job.status, 'running'); host.child.kill('SIGKILL'); await host.closed;
  await server.command({ mode: 'normal', grant: null }); host = launch(); const recovered = await host.ready;
  client = new PidaClient({ baseUrl: recovered.base_url, token: () => recovered.api_token });
  job = await client.getAgentJob(worker.id, crashReceipt.job_id); assert.equal(job.status, 'interrupted'); assert.equal(job.code, 'AGENT_PROCESS_INTERRUPTED');
  const profile = await client.getAgent(worker.id); assert.equal(profile.paused, true); assert.equal(profile.needsReconciliation, true);
  await delay(350); assert.equal((await client.getAgentJob(worker.id, job.id)).status, 'interrupted');
  await assert.rejects(client.receiveCollaboration(crashEnvelope), { code: 'COLLABORATION_FORBIDDEN' });
  await server.command({ grant: grantFor(e) }); assert.deepEqual(await client.receiveCollaboration(crashEnvelope), crashReceipt);
  assert.equal((await client.listAgentJobs(worker.id)).jobs.length, 2, 'no new job or effect replay on restart or retry');
});

test('admission policy v2 binds full Unicode reservation and rejects fake observed mapping, bad echoes and revoked grants', async t => {
  const server = await policyServer(t), a = JSON.parse(await readFile(join(root, 'fixtures/organization-admission/admission-v1.json'), 'utf8'));
  const policy = createCollaborationPolicyClient({ hostId: 'host-1', authorizationUrl: server.url, token: () => token, timeoutMs: 100 });
  const input = { principal: { id: 'local-user', permissions: [] }, admission: a, phase: 'admit', signal: new AbortController().signal };
  await server.command({ grant: grantFor(a.envelope), reservation_state: 'observed' });
  assert.equal(await policy.authorizeAdmission(input), false, 'existing-looking mapping without reserved provenance is not admission authority');
  await server.command({ reservation: a, reservation_state: 'reserved' });
  for (const phase of ['admit', 'dispatch', 'read']) assert.equal(await policy.authorizeAdmission({ ...input, phase }), true);
  await server.command({ reservation_state: 'observed' }); assert.equal(await policy.authorizeAdmission(input), true);
  assert.equal(await policy.authorizeAdmission({ ...input, principal: { id: 'foreign' } }), false);
  const altered = structuredClone(a); altered.definition.timeout_ms++; altered.definition_digest = organizationDefinitionDigest(altered.definition); altered.admission_digest = organizationAdmissionDigest(altered);
  assert.equal(await policy.authorizeAdmission({ ...input, admission: altered }), false);
  for (const mode of ['nonce', 'phase', 'owner', 'host', 'stale', 'recipient', 'definition', 'reservation', 'reservation-state', 'redirect', 'malformed', 'oversize', 'delay']) {
    await server.command({ mode }); assert.equal(await policy.authorizeAdmission(input), false, mode);
  }
  await server.command({ mode: 'normal', grant: null }); assert.equal(await policy.authorizeAdmission(input), false);
});

for (const personaMode of process.env.PIDA_TEST_VERA_SOURCE ? ['local', 'public-fixture'] : ['local']) test(`actual host admits exactly one root (${personaMode}) while reserved and reconciles observed promotion after ACK loss`, async t => {
  const server = await policyServer(t), directory = await mkdtemp(join(tmpdir(), 'pida-admit-host-'));
  const args = [join(root, 'examples/schumpeter-host.mjs'), '--workspace', directory, '--host-id', 'host-1',
    ...(personaMode === 'public-fixture' ? ['--persona-module', join(root, 'examples/vera-dispatch-persona.mjs')] : [])];
  const env = { ...process.env, PIDA_SCHUMPETER_AUTH_URL: server.url, PIDA_SCHUMPETER_AUTH_TOKEN: token,
    PIDA_VERA_SOURCE: process.env.PIDA_TEST_VERA_SOURCE, PIDA_VERA_PYTHON: process.env.PYTHON ?? 'python' };
  let host = pipe(spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }), 'pida-host-ready');
  t.after(async () => { await host.close(); await rm(directory, { recursive: true, force: true }); });
  let ready = await host.ready, client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  const agent = await client.createAgent({ name: 'sole-root' }), cap = await client.getOrganizationAdmissionCapabilities(); assert.equal(cap.enabled, true); assert.equal(cap.supervisor_state_version, 4);
  const a = JSON.parse(await readFile(join(root, 'fixtures/organization-admission/admission-v1.json'), 'utf8'));
  a.envelope.recipient.agent_id = agent.id;
  a.envelope.payload_digest = collaborationDigest(a.envelope);
  a.definition = { ...a.definition, root_agent_id: agent.id, participants: [agent.id], criterion_ids: cap.acceptance.criterion_ids,
    criteria_digest: cap.acceptance.criteria_digest, environment_revision: cap.acceptance.environment_revision };
  a.definition_digest = organizationDefinitionDigest(a.definition); a.admission_digest = organizationAdmissionDigest(a);
  await assert.rejects(client.admitOrganization(a), { code: 'ORGANIZATION_ADMISSION_FORBIDDEN' });
  assert.equal((await client.listAgentJobs(agent.id)).jobs.length, 0);
  await server.command({ grant: grantFor(a.envelope), reservation: a, reservation_state: 'reserved' });
  const response = await fetch(ready.base_url + '/v1/collaboration/organization-admissions', { method: 'POST', headers: { Authorization: 'Bearer ' + ready.api_token, 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
  assert.equal(response.status, 202); await response.body.cancel();
  let job; for (let i = 0; i < 200; i++) { job = (await client.listAgentJobs(agent.id)).jobs[0]; if (job && !['queued', 'running'].includes(job.status)) break; await delay(10); }
  assert.equal(job.status, 'completed', JSON.stringify({ status: job.status, code: job.code }));
  const receipt = await client.admitOrganization(a); assert.equal(receipt.job_id, job.id); assert.equal(receipt.root_task_id, job.organizationTaskId); assert.equal(receipt.root_attempt_id, job.attemptId);
  const view = await client.getOrganization(a.envelope.recipient.org_session_id); assert.equal(view.tasks.length, 1); assert.equal(view.attempts.length, 1); assert.equal(view.joins.length, 0);
  if (personaMode === 'public-fixture') {
    const bundle = await client.exportAgentJob(agent.id, job.id), included = bundle.events.find(e => e.activity === 'context_input_included'); assert.ok(included);
    const binding = JSON.parse(included.payload.descriptor).personaBinding.externalContext;
    assert.equal(binding.attemptId, receipt.root_attempt_id); assert.equal(binding.taskId, receipt.job_id); assert.equal(binding.organizationSessionId, a.envelope.recipient.org_session_id);
  }
  await host.close(); host = pipe(spawn(process.execPath, [...args, '--workspace-mode', 'resume'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }), 'pida-host-ready');
  ready = await host.ready; client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  assert.deepEqual(await client.admitOrganization(a), receipt, 'promotion can reconcile from same immutable receipt after restart');
  await server.command({ reservation_state: 'observed' }); assert.deepEqual(await client.getOrganizationAdmissionReceipt(receipt.receipt_id), receipt);
  assert.equal((await client.listAgentJobs(agent.id)).jobs.length, 1);
  if (personaMode === 'local') {
    const next = structuredClone(a); next.envelope.request_id += '-crash'; next.envelope.recipient.org_session_id = randomUUID(); next.reservation_id += '-crash';
    next.envelope.payload_digest = collaborationDigest(next.envelope); next.admission_digest = organizationAdmissionDigest(next);
    await server.command({ grant: grantFor(next.envelope), reservation: next, reservation_state: 'reserved', mode: 'delay' });
    const interruptedReceipt = await client.admitOrganization(next);
    for (let i = 0; i < 100; i++) { job = await client.getAgentJob(agent.id, interruptedReceipt.job_id); if (job.status === 'running') break; await delay(5); }
    assert.equal(job.status, 'running'); host.child.kill('SIGKILL'); await host.closed; await server.command({ mode: 'normal' });
    host = pipe(spawn(process.execPath, [...args, '--workspace-mode', 'resume'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }), 'pida-host-ready');
    ready = await host.ready; client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
    assert.deepEqual(await client.admitOrganization(next), interruptedReceipt);
    job = await client.getAgentJob(agent.id, interruptedReceipt.job_id); assert.equal(job.status, 'interrupted'); assert.equal(job.runId, undefined);
    assert.equal((await client.getAgent(agent.id)).needsReconciliation, true); assert.equal((await client.listAgentJobs(agent.id)).jobs.length, 2);
  }
  await server.command({ grant: null }); await assert.rejects(client.getOrganizationAdmissionReceipt(receipt.receipt_id), { code: 'ORGANIZATION_ADMISSION_FORBIDDEN' });
});
