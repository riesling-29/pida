import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { PidaClient } from '../dist/client.js';
import { AgentWorkspaceController } from '../dist/agent-workspace-controller.js';
import { connectObservationTui, observationLayoutStore } from '../examples/schumpeter-observation-tui.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function tree(root) {
  const rows = [];
  function walk(directory, prefix = '') { for (const name of readdirSync(directory).sort()) {
    const path = join(directory,name), relative = prefix + name, stat = lstatSync(path);
    if (stat.isDirectory()) { rows.push([relative,'directory']); walk(path,relative+'/'); }
    else rows.push([relative,stat.size,hash(path)]);
  } }
  walk(root); return rows;
}
test('actual host observation client is host-wide, emits no writes, detaches without cancelling queued work', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pdt-')), workspace = join(directory, 'work');
  const policy = createServer((_q, r) => { r.writeHead(403); r.end(); }); await new Promise(r => policy.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => policy.close(r)));
  const child = spawn(process.execPath, [join(root, 'examples/schumpeter-host.mjs'), '--workspace', workspace, '--host-id', 'observed-host'],
    { env: { ...process.env, PIDA_SCHUMPETER_AUTH_URL: 'http://127.0.0.1:' + policy.address().port + '/v1/pida-authorization', PIDA_SCHUMPETER_AUTH_TOKEN: randomBytes(32).toString('hex') }, stdio: ['pipe','pipe','pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', b => stderr += b); const closed = new Promise(r => child.once('close', r));
  t.after(async () => { child.stdin.end(); const timer = setTimeout(() => child.kill(), 6000); try { await closed; } finally { clearTimeout(timer); } });
  const ready = await new Promise((res, rej) => { const timer = setTimeout(() => rej(Error('READY_TIMEOUT')), 10000);
    child.once('close', () => { clearTimeout(timer); rej(Error(stderr)); }); createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line); if (r.type === 'pida-host-ready') { clearTimeout(timer); res(r); } }); });
  const owner = new PidaClient({ baseUrl: ready.base_url, token: () => ready.api_token });
  const agent = await owner.createAgent({ name: 'native observed root' }); await owner.pauseAgent(agent.id);
  const unused = await owner.createAgent({ name: 'never initialized' }); await owner.pauseAgent(unused.id);
  const org = await owner.createOrganization({ requestId: 'observed-org', goal: 'Synthetic later execution.', agentId: agent.id, participants: [agent.id], criterionIds: [] });
  const queued = (await owner.listAgentJobs(agent.id)).jobs[0]; assert.equal(queued.status, 'queued');
  const protectedFiles = ['pida.config.json','.pida-host.json','.env','.pida/agents-service/supervisor.json'].map(p => join(workspace,p));
  const before = protectedFiles.map(hash), beforeTree = tree(workspace), calls = [];
  const env = { PIDA_TUI_BASE_URL: ready.base_url, PIDA_TUI_TOKEN: ready.api_token, PIDA_TUI_HOST_ID: ready.host_id };
  const connection = await connectObservationTui(env, (url, init) => { calls.push({ path: new URL(url).pathname, method: init.method ?? 'GET' }); return fetch(url, init); });
  assert.equal(connection.profile.scope, 'host-wide'); assert.equal(connection.profile.input, 'disabled');
  const layouts = observationLayoutStore(join(directory,'ui-layout'), ready.host_id);
  const controller = new AgentWorkspaceController(connection.client, { ...layouts, pollMs: 0 }); await controller.start();
  const pane = controller.layout.allPanes()[0]; controller.bind(pane.id, { agentId: agent.id, view: 'activity' }); await controller.refresh();
  assert.equal(controller.overview.agents[0].profile.id, agent.id);
  controller.setDraft(pane.id, 'This must not reach HTTP'); await controller.submit(pane.id);
  assert.match(controller.message(pane.id), /HOST_OBSERVATION_ONLY/); assert.equal(controller.isUncertain(pane.id), false);
  for (const action of [() => connection.client.createAgent({ name:'forbidden' }), () => connection.client.cancelOrganization(org.id), () => connection.client.resumeAgent(agent.id)])
    await assert.rejects(action(), { code:'HOST_OBSERVATION_ONLY_USE_SCHUMPETER_TASK_CONTROLS', status:403 });
  assert.ok(calls.length > 2); assert.ok(calls.every(c => c.method === 'GET'));
  const beforeDetails = calls.length;
  for (const action of [() => connection.client.getAgentWorkbench(unused.id), () => connection.client.readAgentFile(unused.id,'README.md'),
    () => connection.client.getAgentMemory(unused.id), () => connection.client.getAgentJobTools(agent.id,queued.id),
    () => connection.client.exportAgentJob(agent.id,queued.id), () => connection.client.getAgentJobRecovery(agent.id,queued.id)])
    await assert.rejects(action(), {code:'HOST_OBSERVATION_DETAIL_UNAVAILABLE_USE_SCHUMPETER',status:403});
  assert.equal(calls.length,beforeDetails);
  controller.bind(pane.id,{agentId:unused.id,view:'files'}); await controller.refresh(); await controller.inspect(pane.id);
  assert.match(controller.message(pane.id),/HOST_OBSERVATION_DETAIL_UNAVAILABLE/);
  controller.close(); connection.close(); await new Promise(r => setTimeout(r,30));
  assert.deepEqual(tree(workspace),beforeTree,'full tree includes unused-agent lazy initialization paths');
  assert.deepEqual(protectedFiles.map(hash), before); assert.equal((await owner.listAgentJobs(agent.id)).jobs[0].status, 'queued');
  assert.equal((await fetch(ready.base_url + '/health')).status,200);
  await assert.rejects(connectObservationTui({ ...env, PIDA_TUI_HOST_ID: 'wrong-host' }), /TUI_HOST_MISMATCH/);
  await assert.rejects(connectObservationTui({ ...env, PIDA_TUI_TOKEN: 'z'.repeat(64) }));
  await assert.rejects(connectObservationTui({ ...env, PIDA_TUI_BASE_URL:'http://example.com:1234' }), /TUI_ENDPOINT_INVALID/);
  await owner.resumeAgent(agent.id);
  let job; for(let i=0;i<200;i++){ job=(await owner.listAgentJobs(agent.id)).jobs[0]; if(!['queued','running'].includes(job.status))break; await new Promise(r=>setTimeout(r,20)); }
  assert.equal(job.id,queued.id); assert.equal(job.status,'completed');
  const scope = 'a'.repeat(64); layouts.saveLayout(scope,'{}'); assert.equal(layouts.loadLayout(scope),'{}'); assert.ok(readdirSync(join(directory,'ui-layout')).length);
  assert.throws(()=>layouts.saveLayout('../escape','{}'),/TUI_LAYOUT_SCOPE_INVALID/);
});
