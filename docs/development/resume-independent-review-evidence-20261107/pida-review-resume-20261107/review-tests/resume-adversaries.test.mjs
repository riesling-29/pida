import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createCollaborationPolicyClient } from '../dist/collaboration-policy-client.js';
import { collaborationDigest } from '../dist/collaboration.js';
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

import {readdir,writeFile as write,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {spawnSync} from 'node:child_process';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function tree(directory){const out={};async function walk(dir,prefix=''){for(const f of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=prefix+f.name;if(f.isDirectory())await walk(join(dir,f.name),rel+'/');else out[rel]=hash(await readFile(join(dir,f.name)));}}await walk(directory);return out;}
async function fixture(t){const server=await policyServer(t),directory=await mkdtemp(join(tmpdir(),'pida-review-resume-'));const children=[];
 const launch=(mode='resume')=>{const p=pipe(spawn(process.execPath,[join(root,'examples/schumpeter-host.mjs'),'--workspace',directory,'--host-id','host-1','--workspace-mode',mode],{env:{...process.env,PIDA_SCHUMPETER_AUTH_URL:server.url,PIDA_SCHUMPETER_AUTH_TOKEN:token},stdio:['pipe','pipe','pipe'],windowsHide:true}),'pida-host-ready');children.push(p);return p;};
 t.after(async()=>{for(const p of children)await p.close();await rm(directory,{recursive:true,force:true});});return{server,directory,launch};}

test('review: completed native session and exported receipt survive actual launcher resume',async t=>{
 const f=await fixture(t);let host=f.launch('fresh');const ready=await host.ready;let client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});
 const parent=await client.createAgent({name:'root'}),worker=await client.createAgent({name:'worker'});await client.pauseAgent(parent.id);
 const org=await client.createOrganization({requestId:'review-session',goal:'wait',agentId:parent.id,participants:[parent.id,worker.id],criterionIds:[]});
 const e={...golden,request_id:'review-completed',recipient:{...golden.recipient,org_session_id:org.id,agent_id:worker.id}};e.payload_digest=collaborationDigest(e);await f.server.command({grant:grantFor(e)});
 const receipt=await client.receiveCollaboration(e);let job;for(let i=0;i<200;i++){job=await client.getAgentJob(worker.id,receipt.job_id);if(job.status==='completed')break;await delay(10);}assert.equal(job.status,'completed');assert.ok(job.sessionId);assert.ok(job.runId);assert.ok(job.attemptId);
 const bundle=await client.exportAgentJob(worker.id,job.id);assert.ok(bundle.events.length);await host.close();
 host=f.launch();const resumed=await host.ready;client=new PidaClient({baseUrl:resumed.base_url,token:()=>resumed.api_token});
 assert.notEqual(resumed.api_token,ready.api_token);assert.deepEqual(await client.receiveCollaboration(e),receipt);assert.deepEqual(await client.getAgentJob(worker.id,job.id),job);assert.deepEqual(await client.exportAgentJob(worker.id,job.id),bundle);assert.equal((await client.listAgentJobs(worker.id)).jobs.length,1);
 const view=await client.getOrganization(org.id);assert.ok(view.attempts.some(a=>a.id===job.attemptId&&a.jobId===job.id&&a.taskId===job.organizationTaskId));
 console.log(JSON.stringify({case:'completed-session-resume',sameJob:true,sameSession:true,sameRun:true,sameAttempt:true,sameExport:true,rotatedToken:true}));
});

test('review: profile and unknown/live lock rejection preserve complete persisted tree',async t=>{
 const f=await fixture(t),host=f.launch('fresh');await host.ready;await host.close();
 const manifestPath=join(f.directory,'.pida-host.json'),manifestText=await readFile(manifestPath,'utf8'),manifest=JSON.parse(manifestText);
 const refuse=async pattern=>{const before=await tree(f.directory),p=f.launch();await assert.rejects(p.ready,pattern);await p.close();assert.deepEqual(await tree(f.directory),before);};
 const fields={host_id:'other-host',principal_id:'other-owner',node_version:'0.0.0',workspace_directory:'foreign-path',source_digest:'0'.repeat(64),config_digest:'0'.repeat(64),policy_credential_digest:'0'.repeat(64),provider_workspace:'different-provider',provider_source_digest:'1'.repeat(64),persona_module:'foreign-module',persona_module_digest:'2'.repeat(64),schema_version:'unknown/2'};
 for(const [field,value]of Object.entries(fields)){await write(manifestPath,JSON.stringify({...manifest,[field]:value}));await refuse(/HOST_RESUME_MISMATCH/);}await write(manifestPath,manifestText);
 const configPath=join(f.directory,'pida.config.json'),config=await readFile(configPath,'utf8');await write(configPath,config+'\n');await refuse(/HOST_RESUME_MISMATCH/);await write(configPath,config);
 const dead=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(dead.status,0);assert.throws(()=>process.kill(dead.pid,0),{code:'ESRCH'});
 const badLocks=[{host:hostname(),pid:process.pid},{host:'remote-host',pid:dead.pid},{host:hostname(),pid:'unknown'},'invalid-json','x'.repeat(5000)];
 for(const lockName of ['.pida-host.lock','.pida/runtime.lock','.pida/agents-service/supervisor.lock'])for(const owner of badLocks){const p=join(f.directory,lockName);await write(p,typeof owner==='string'?owner:JSON.stringify(owner));await refuse(/HOST_WORKSPACE_LOCKED|HOST_RUNTIME_LOCK_UNVERIFIED/);await unlink(p);}
 console.log(JSON.stringify({case:'rejected-launch-immutability',manifestFields:12,changedConfig:1,unknownOrLiveLockCases:15,entireTreeUnchanged:true}));
});

test('review: two actual launchers cannot both recover same dead host',async t=>{
 const f=await fixture(t),old=f.launch('fresh');await old.ready;old.child.kill('SIGKILL');await old.closed;
 const a=f.launch(),b=f.launch(),results=await Promise.allSettled([a.ready,b.ready]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);const failure=results.find(r=>r.status==='rejected');assert.match(failure.reason.message,/HOST_WORKSPACE_LOCKED/);
 const ready=results.find(r=>r.status==='fulfilled').value;const client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});assert.equal((await client.getCollaborationCapabilities()).host_id,'host-1');
 console.log(JSON.stringify({case:'simultaneous-dead-owner-resume',successfulHosts:1,lockedHosts:1}));
});
