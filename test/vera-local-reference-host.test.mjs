import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { PidaClient } from '../dist/client.js';
import { createHostPersona } from '../examples/vera-local-reference-persona.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.PIDA_TEST_LOCAL_REFERENCE;
const python = process.env.PYTHON ?? 'python';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('production reference host: actual native IDs, Unicode context, read-only input authorization and profile-bound resume', { skip: !source }, async t => {
  const lock = JSON.parse(readFileSync(join(root, 'fixtures/vera-dispatch/local-reference-source-lock.json')));
  for (const [path, expected] of Object.entries(lock.runtime_files)) assert.equal(hash(readFileSync(join(source, path))), expected);
  const directory = mkdtempSync(join(tmpdir(), 'pdlr-')), configPath = join(directory, 'persona.json'), store = join(directory, 'persona'), workspace = join(directory, 'work');
  const config = { schema_version: 'vera-local-reference/0.1.0', principal: 'principal:local-reference', host_id: 'reference-host', project_id: 'schumpeter',
    memory_scope: ['project:schumpeter', 'organization:reference'], persona: { persona_id: 'persona:reference', name: '참조 🌱', description: '사용자 지정 참조. 증거 값은 73 🌱.', source_refs: ['document:synthetic-reference'] }, grant_expires_at: Math.floor(Date.now() / 1000) + 3600 };
  writeFileSync(configPath, JSON.stringify(config));
  const executable = spawnSync(python, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
  const entry = join(resolve(source), 'scripts/local_persona_bridge.py');
  const init = spawnSync(executable, ['-I', '-B', entry, 'init', '--config', configPath, '--store', store], { encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  const policy = createServer((_q, r) => { r.writeHead(403); r.end(); }); await new Promise(r => policy.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => policy.close(r)));
  const env = { ...process.env, PIDA_SCHUMPETER_AUTH_URL: 'http://127.0.0.1:' + policy.address().port + '/v1/pida-authorization', PIDA_SCHUMPETER_AUTH_TOKEN: randomBytes(32).toString('hex'),
    PIDA_PERSONA_BRIDGE_EXECUTABLE: executable, PIDA_PERSONA_BRIDGE_PREFIX_ARGS: JSON.stringify(['-I', '-B', entry]), PIDA_PERSONA_BRIDGE_CONFIG: configPath, PIDA_PERSONA_BRIDGE_STORE: store };
  // A separate public-port probe checks exact Unicode bytes; its IDs are synthetic,
  // while the later child-host scenario checks actual native identities.
  const keys = Object.keys(env).filter(k => k.startsWith('PIDA_PERSONA_BRIDGE_')), previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const key of keys) process.env[key] = env[key];
  let direct;
  try {
    direct = await createHostPersona({ hostId: config.host_id, taskScope: async () => ({ jobId: 'job:synthetic', attemptId: 'attempt:synthetic', organizationTaskId: 'orgtask:synthetic', organizationSessionId: 'org:synthetic' }) });
    const principal = { id: 'local-user', permissions: [] }, provider = await direct.personaProvider({ principal, agentId: 'agent:synthetic' });
    const request = { principal, agentId: 'agent:synthetic', sessionId: 'session:synthetic', taskId: 'job:synthetic', runId: 'run:synthetic', signal: AbortSignal.timeout(4000) };
    const snapshot = await provider.resolveContext(request); assert.ok(snapshot.text.includes('사용자 지정 참조')); assert.ok(snapshot.text.includes('🌱'));
    await provider.authorizeInput({ ...request, snapshot, requestId: 'input:synthetic', attempt: 1, inputDigest: 'a'.repeat(64), fingerprintScope: 'pi-logical-context/1', modelId: 'mock', api: 'mock' });
    await assert.rejects(provider.resolveContext({ ...request, taskId: 'different-job' }), /HOST_PERSONA_ORGANIZATION_REQUIRED/);
  } finally { await direct?.close(); for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  let active;
  async function launch(mode) {
    const child = spawn(process.execPath, [join(root, 'examples/schumpeter-host.mjs'), '--workspace', workspace, '--host-id', config.host_id, '--workspace-mode', mode,
      '--persona-module', join(root, 'examples/vera-local-reference-persona.mjs')], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', b => stderr += b); const closed = new Promise(r => child.once('close', r));
    const ready = new Promise((res, rej) => { const timer = setTimeout(() => { child.kill(); rej(Error('READY_TIMEOUT')); }, 10000);
      child.once('error', rej); child.once('close', () => { clearTimeout(timer); rej(Error(stderr.trim())); });
      createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line); if (r.type === 'pida-host-ready') { clearTimeout(timer); res(r); } }); });
    active = { ready, async close() { child.stdin.end(); const timer = setTimeout(() => child.kill(), 6000); try { return await closed; } finally { clearTimeout(timer); } } }; return active;
  }
  t.after(async () => { if (active) await active.close(); });
  let host = await launch('fresh'), ready = await host.ready; assert.equal(ready.persona_mode, 'vera-local-reference/0.1.0');
  let client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  const agent = await client.createAgent({ name: 'reference root' });
  const org = await client.createOrganization({ requestId: 'reference-native', goal: 'Return a synthetic reference check.', agentId: agent.id, participants: [agent.id], criterionIds: [] });
  let job;
  for (let i = 0; i < 400; i++) { job = (await client.listAgentJobs(agent.id)).jobs[0]; if (job && !['queued','running'].includes(job.status)) break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const bundle = await client.exportAgentJob(agent.id, job.id), inclusion = bundle.events.find(e => e.activity === 'context_input_included'); assert.ok(inclusion);
  const binding = JSON.parse(inclusion.payload.descriptor).personaBinding.externalContext;
  assert.equal(binding.attemptId, job.attemptId); assert.equal(binding.taskId, job.id); assert.equal(binding.organizationSessionId, org.id); assert.equal(binding.agentInstanceId, agent.id);
  assert.equal(await host.close(), 0); active = null;
  host = await launch('resume'); ready = await host.ready; client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  assert.equal((await client.listAgentJobs(agent.id)).jobs[0].id, job.id); assert.equal(await host.close(), 0); active = null;
  const before = readFileSync(join(workspace, '.pida/agents-service/supervisor.json'));
  writeFileSync(configPath, JSON.stringify({ ...config, persona: { ...config.persona, description: 'changed' } }));
  host = await launch('resume'); await assert.rejects(host.ready, /HOST_RESUME_MISMATCH/); assert.equal(await host.close(), 1); active = null;
  assert.deepEqual(readFileSync(join(workspace, '.pida/agents-service/supervisor.json')), before);
  writeFileSync(configPath, JSON.stringify(config));
  const originalStore = store + '-original'; renameSync(store, originalStore);
  const replacement = spawnSync(executable, ['-I', '-B', entry, 'init', '--config', configPath, '--store', store], { encoding: 'utf8' }); assert.equal(replacement.status, 0, replacement.stderr);
  assert.notEqual(JSON.parse(readFileSync(join(store, 'reference-store.json'))).store_instance_id, JSON.parse(readFileSync(join(originalStore, 'reference-store.json'))).store_instance_id);
  host = await launch('resume'); await assert.rejects(host.ready, /HOST_RESUME_MISMATCH/); assert.equal(await host.close(), 1); active = null;
  assert.deepEqual(readFileSync(join(workspace, '.pida/agents-service/supervisor.json')), before);
  renameSync(store, store + '-replacement'); renameSync(originalStore, store);
  host = await launch('resume'); ready = await host.ready; client = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  assert.equal((await client.listAgentJobs(agent.id)).jobs[0].id, job.id); assert.equal(await host.close(), 0); active = null;
});
