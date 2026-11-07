// No provider credentials, Python or source checkout are used by this smoke.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
const source = resolve(process.argv[2]), evidence = resolve(process.argv[3]);
const reference = process.argv[4] === '--reference';
if (process.argv.length > 4 && !reference) throw Error('UNKNOWN_PROBE_OPTION');
const directory = mkdtempSync(join(tmpdir(), 'pdr-')), runtime = join(directory, 'runtime');
cpSync(source, runtime, { recursive: true });
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const gitPath = join(runtime, 'git', process.platform === 'win32' ? 'cmd' : 'bin');
const home = join(directory, 'home'); mkdirSync(home);
const policy = createServer((_request, response) => { response.writeHead(403); response.end(); });
await new Promise(resolve => policy.listen(0, '127.0.0.1', resolve));
const env = { PATH: gitPath + (process.platform === 'win32' ? ';' + join(process.env.SystemRoot, 'System32') : ':/usr/bin:/bin'),
  HOME: home, USERPROFILE: home, TEMP: tmpdir(), TMP: tmpdir(), LANG: 'C.UTF-8',
  ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {}),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'absent.gitconfig'),
  PIDA_SCHUMPETER_AUTH_URL: 'http://127.0.0.1:' + policy.address().port + '/v1/pida-authorization', PIDA_SCHUMPETER_AUTH_TOKEN: randomBytes(32).toString('hex') };
if (reference) for (const key of ['PIDA_PERSONA_BRIDGE_EXECUTABLE','PIDA_PERSONA_BRIDGE_PREFIX_ARGS','PIDA_PERSONA_BRIDGE_CONFIG','PIDA_PERSONA_BRIDGE_STORE']) {
  if (!process.env[key]) throw Error('REFERENCE_BRIDGE_CONFIG_REQUIRED'); env[key] = process.env[key];
}
const git = spawnSync(join(gitPath, process.platform === 'win32' ? 'git.exe' : 'git'), ['--version'], { env, encoding: 'utf8' });
assert.equal(git.status, 0, git.stderr);
const { PidaClient } = await import(pathToFileURL(join(runtime, 'pida/dist/client.js')));
const workspace = join(directory, 'work'); let current;
async function launch(mode) {
  const child = spawn(node, [join(runtime, 'pida/examples/schumpeter-host.mjs'), '--workspace', workspace, '--host-id', 'packaged-probe', '--workspace-mode', mode,
    ...(reference ? ['--persona-module', join(runtime,'pida/examples/vera-local-reference-persona.mjs')] : [])],
    { cwd: directory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const closed = new Promise(resolve => child.on('close', resolve));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('HOST_READY_TIMEOUT')); }, 20000);
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); reject(Error('HOST_EXIT_' + code + ':' + stderr)); });
    createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line); if (r.type === 'pida-host-ready') { clearTimeout(timer); resolve(r); } });
  });
  current = { ready, client: new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token }),
    async close() { child.stdin.end(); const timer = setTimeout(() => child.kill(), 8000); try { assert.equal(await closed, 0, stderr); } finally { clearTimeout(timer); } } };
  return current;
}
try {
  const first = await launch('fresh');
  assert.equal(first.ready.provider_mode, 'mock'); assert.equal(first.ready.persona_mode, reference ? 'vera-local-reference/0.1.0' : 'pida-local');
  assert.equal((await first.client.getOrganizationAdmissionCapabilities()).enabled, true);
  const agent = await first.client.createAgent({ name: 'packaged root' });
  const org = await first.client.createOrganization({ requestId: 'package-probe', goal: 'Return a synthetic packaging check.', agentId: agent.id, participants: [agent.id], criterionIds: [] });
  let job;
  for (let i = 0; i < 400; i++) { job = (await first.client.listAgentJobs(agent.id)).jobs[0]; if (job && !['queued', 'running'].includes(job.status)) break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const bundle = await first.client.exportAgentJob(agent.id, job.id);
  assert.ok(bundle.events.some(e => e.activity === 'run_finished'));
  if (reference) {
    const included = bundle.events.find(e => e.activity === 'context_input_included'); assert.ok(included);
    const binding = JSON.parse(included.payload.descriptor).personaBinding.externalContext;
    assert.equal(binding.taskId,job.id); assert.equal(binding.attemptId,job.attemptId); assert.equal(binding.organizationSessionId,org.id); assert.equal(binding.agentInstanceId,agent.id);
  }
  const token = first.ready.api_token; await first.close(); current = null;
  const second = await launch('resume'); assert.notEqual(second.ready.api_token, token);
  assert.equal((await second.client.getOrganization(org.id)).organization.id, org.id);
  const restored = (await second.client.listAgentJobs(agent.id)).jobs; assert.equal(restored.length, 1); assert.equal(restored[0].id, job.id); assert.equal(restored[0].attemptId, job.attemptId);
  await second.close(); current = null;
  const result = { status: 'PASS', platform: process.platform, node: spawnSync(node, ['--version'], { env, encoding: 'utf8' }).stdout.trim(), git: git.stdout.trim(),
    isolated_runtime: runtime, source_checkout_required: false, developer_node_modules_required: false, credentials_used: false, provider: 'mock', persona: first.ready.persona_mode,
    organization_id: org.id, job_id: job.id, attempt_id: job.attemptId, events: bundle.events.length, terminal_event: true, resume_same_job: true, transport_token_rotated: true,
    limits: ['No live model, desktop UI, remote Git or general Linux ABI acceptance.', reference ? 'Explicit external Python reference export; parent frozen Python assembly not tested.' : 'No external Persona producer enabled.'] };
  writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally { if (current) await current.close(); await new Promise(resolve => policy.close(resolve)); }
