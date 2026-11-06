import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime, PidaError } from '../dist/runtime.js';
import { PidaWorkbench, workbenchPermissions } from '../dist/workbench.js';
import { AgentSupervisor } from '../dist/agent-supervisor.js';
import { createAgentTools } from '../dist/agent-tools.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { PidaClient } from '../dist/client.js';

const owner={id:'owner',permissions:['pida:agents','agent:delegate','agent:read','fixture:read',...workbenchPermissions]}, other={id:'other',permissions:owner.permissions};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){for(let i=0;i<600;i++){const r=await fn();if(r)return r;await delay(10);}assert.fail('organization did not settle');}
const terminal=(s,id)=>until(()=>{const j=s.getJob(id,owner);return !['queued','running'].includes(j.status)&&j;});
const orgDone=(s,id)=>until(async()=>{const value=await s.getOrganization(id,owner);return value.organization.status!=='active'&&value;});
function directory(t){const path=mkdtempSync(join(tmpdir(),'pida-org-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function runtimeFactory(path,responses,extra={}){return profile=>{
  const f=fauxProvider({tokensPerSecond:100000});f.setResponses(responses(profile));
  return new PidaRuntime({storageDir:join(path,'agents',profile.id,'runtime'),provider:()=>({provider:f.provider,modelId:f.getModel().id}),maxRunMs:5000,...extra});
};}

test('real Pi delegates, joins at maxConcurrent=1, continues once in the parent session and survives restart',async t=>{
  const path=directory(t);let s,parent,a,b,requests=0;
  const createRuntime=profile=>{
    const f=fauxProvider({tokensPerSecond:100000});
    if(profile.id===parent.id)f.setResponses([
      ()=>{requests++;return answer(call('agent_delegate',{agentId:a.id,input:'child A'}),{stopReason:'toolUse'});},
      ()=>{requests++;return answer(call('agent_delegate',{agentId:b.id,input:'child B'}),{stopReason:'toolUse'});},
      ()=>{requests++;return answer(call('agent_join',{required:[s.jobs(a.id,owner)[0].id,s.jobs(b.id,owner)[0].id]}),{stopReason:'toolUse'});},
      ()=>{requests++;return answer('Batch registered; ending the initial run.');},
      context=>{requests++;assert.match(JSON.stringify(context),/Child result references/);assert.match(JSON.stringify(context),/untrusted reported data/);return answer('Combined result. Model PASS is not independent acceptance.');}
    ]);else f.setResponses([()=>{requests++;return answer(profile.id===a.id?'A result':'B result');}]);
    return new PidaRuntime({storageDir:join(path,'agents',profile.id,'runtime'),provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools:createAgentTools(s,profile.id),maxRunMs:5000});
  };
  s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime});t.after(()=>s.close());
  parent=s.register(owner,{name:'parent'});a=s.register(owner,{name:'A'});b=s.register(owner,{name:'B'});
  const org=s.createOrganization(owner,{requestId:'org1',goal:'Delegate two checks and combine them',agentId:parent.id,participants:[parent.id,a.id,b.id],criterionIds:[]});s.start();
  const done=await orgDone(s,org.id);assert.equal(done.organization.status,'unknown');assert.equal(done.currentAcceptance,'UNKNOWN');
  assert.equal(done.joins.length,1);assert.equal(done.joins[0].status,'ready');assert.equal(done.joins[0].results.length,2);
  const parentJobs=s.jobs(parent.id,owner);assert.equal(parentJobs.length,2);assert.equal(parentJobs[0].sessionId,parentJobs[1].sessionId);assert.equal(requests,7);
  const membership={requestId:done.joins[0].requestId,required:done.joins[0].required};
  assert.equal(s.registerJoin(parentJobs[0].id,owner,membership).id,done.joins[0].id);
  assert.throws(()=>s.registerJoin(parentJobs[0].id,owner,{...membership,required:[...membership.required].reverse()}),{code:'JOIN_REQUEST_CONFLICT'});
  await assert.rejects(s.getOrganization(org.id,other),{code:'ORG_NOT_FOUND'});assert.deepEqual(s.listOrganizations(other),[]);
  await s.close();
  s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime:()=>{throw Error('must not replay');}});s.start();
  await delay(60);const restored=await s.getOrganization(org.id,owner);assert.equal(restored.joins[0].continuationJobId,parentJobs[1].id);assert.equal(s.jobs(parent.id,owner).length,2);
  await s.close();
  const statePath=join(path,'supervisor.json'), original=readFileSync(statePath,'utf8');
  for(const change of [j=>{delete j.results;},j=>{j.results=[];},j=>{j.results[0].resultDigest='0'.repeat(64);},j=>{j.results[0].attemptId=j.results[1].attemptId;}]) {
    const state=JSON.parse(original);change(state.organization.joins[0]);const damaged=JSON.stringify(state);writeFileSync(statePath,damaged);
    await assert.rejects(AgentSupervisor.open({directory:path,createRuntime:()=>{throw Error('must not start damaged state');}}),{code:'ORG_STATE_INVALID'});
    assert.equal(readFileSync(statePath,'utf8'),damaged,'failed validation must preserve evidence');
  }
  writeFileSync(statePath,original);
});

test('children completed before registration reconcile in reverse order; ready continuation persists and cancellation uses revision CAS',async t=>{
  const path=directory(t);let s;const seen=[];
  const createRuntime=runtimeFactory(path,p=>[()=>{seen.push(p.name);return answer(p.name+' result');},()=>{seen.push('continuation');return answer('continued');}]);
  const options={directory:path,workspaceKey:p=>p.id,resolvePrincipal:()=>owner,createRuntime};
  s=await AgentSupervisor.open(options);t.after(()=>s.close());
  const p=s.register(owner,{name:'P'}),a=s.register(owner,{name:'A'}),b=s.register(owner,{name:'B'});
  const pj=s.enqueue(p.id,owner,{input:'parent',requestId:'p'}),bj=s.enqueue(b.id,owner,{input:'B',requestId:'b',parentJobId:pj.id}),aj=s.enqueue(a.id,owner,{input:'A',requestId:'a',parentJobId:pj.id});s.start();
  await Promise.all([pj,bj,aj].map(j=>terminal(s,j.id)));s.pause(p.id,owner);
  const registered=s.registerJoin(pj.id,owner,{requestId:'late',required:[aj.id,bj.id]});
  const ready=await until(async()=>{const v=await s.getOrganization(registered.orgId,owner);return v.joins[0].status==='ready'&&v;});
  assert.deepEqual(ready.joins[0].results.map(j=>j.assignmentJobId),[aj.id,bj.id]);
  const continuation=ready.joins[0].continuationJobId;assert.equal(s.getJob(continuation,owner).status,'queued');
  await s.close();s=await AgentSupervisor.open(options);s.start();await delay(50);
  assert.equal(s.jobs(p.id,owner).length,2);assert.equal((await s.getOrganization(registered.orgId,owner)).joins[0].continuationJobId,continuation);
  await assert.rejects(s.cancelJoin(registered.id,owner,0),{code:'JOIN_REVISION_CONFLICT'});
  await s.cancelJoin(registered.id,owner,1);await s.resume(p.id,owner);await delay(50);
  assert.equal(s.getJob(continuation,owner).status,'cancelled');assert.equal(seen.filter(n=>n==='continuation').length,0);
});

test('required cancellation blocks; optional cancellation remains visible in successful join',async t=>{
  for(const optional of [false,true]){
    const path=directory(t);let s;
    const createRuntime=runtimeFactory(path,()=>[answer('initial'),answer('continued')]);
    s=await AgentSupervisor.open({directory:path,resolvePrincipal:()=>owner,createRuntime});t.after(()=>s.close());
    const p=s.register(owner,{name:'P'}),a=s.register(owner,{name:'A'}),b=s.register(owner,{name:'B'});
    const pj=s.enqueue(p.id,owner,{input:'parent',requestId:'p'}),aj=s.enqueue(a.id,owner,{input:'good',requestId:'a',parentJobId:pj.id}),bj=s.enqueue(b.id,owner,{input:'cancel',requestId:'b',parentJobId:pj.id});
    await s.cancel(bj.id,owner);s.start();await terminal(s,pj.id);await terminal(s,aj.id);
    const joined=s.registerJoin(pj.id,owner,{requestId:'join',required:optional?[aj.id]:[aj.id,bj.id],optional:optional?[bj.id]:[]});
    const done=await orgDone(s,joined.orgId);assert.equal(done.joins[0].status,optional?'ready':'blocked');
    assert.equal(s.jobs(p.id,owner).length,optional?2:1);
    if(optional)assert.equal(done.joins[0].results.find(r=>r.assignmentJobId===bj.id).status,'cancelled');
    await s.close();
  }
});

test('independent exact workbench check repairs once, invalidates changed bytes/criteria/environment and never trusts model PASS',async t=>{
  const path=directory(t),bench=new PidaWorkbench(join(path,'bench'));let calls=0;
  const checks=[{id:'answer',kind:'json-equals',path:'answer.json',expected:'{"answer":42}',required:true}];
  const options={directory:path,resolvePrincipal:()=>owner,acceptance:{criteria:checks,environmentRevision:'checker-v1',capture:()=>bench.captureFiles(owner)},
    createRuntime:runtimeFactory(path,()=>[()=>{calls++;return answer(call('workspace_write',{path:'answer.json',content:'{"answer":0}'}),{stopReason:'toolUse'});},answer('PASS'),()=>{calls++;return answer(call('workspace_write',{path:'answer.json',content:'{"answer":42}'}),{stopReason:'toolUse'});},answer('PASS')],{tools:bench.tools()})};
  let s=await AgentSupervisor.open(options);t.after(()=>s.close());const p=s.register(owner,{name:'writer'});
  const input={requestId:'checked',goal:'Write the answer JSON',agentId:p.id,participants:[p.id],criterionIds:['answer'],maxRepairAttempts:1};
  const org=s.createOrganization(owner,input);assert.equal(s.createOrganization(owner,input).id,org.id);
  assert.throws(()=>s.createOrganization(owner,{...input,goal:'changed'}),{code:'ORG_REQUEST_CONFLICT'});
  assert.throws(()=>s.createOrganization(owner,{...input,requestId:'forged',receipt:{status:'PASS'}}),{code:'ORG_ARGUMENT_INVALID'});
  s.start();const done=await orgDone(s,org.id);assert.equal(done.currentAcceptance,'PASS');assert.equal(calls,2);
  const receipts=done.tasks[0].receipts;assert.deepEqual(receipts.map(r=>r.status),['FAIL','PASS']);assert.notEqual(receipts[0].artifactSnapshotDigest,receipts[1].artifactSnapshotDigest);assert.equal(done.attempts[1].kind,'repair');
  await bench.write(owner,'answer.json','{"answer":43}');assert.equal((await s.getOrganization(org.id,owner)).currentAcceptance,'UNKNOWN');
  await bench.write(owner,'answer.json','{"answer":42}');await s.close();
  s=await AgentSupervisor.open({...options,acceptance:{...options.acceptance,environmentRevision:'checker-v2'}});s.start();
  assert.equal((await s.getOrganization(org.id,owner)).currentAcceptance,'UNKNOWN');assert.equal(s.jobs(p.id,owner).length,2);await s.close();
  s=await AgentSupervisor.open({...options,acceptance:{...options.acceptance,criteria:[{...checks[0],expected:'{"answer":43}'}]}});s.start();
  assert.equal((await s.getOrganization(org.id,owner)).currentAcceptance,'UNKNOWN');assert.equal(calls,2);
});

test('unavailable checker is UNKNOWN, repair budget is finite, unrelated organizations still settle',async t=>{
  const path=directory(t);let captures=0;
  const s=await AgentSupervisor.open({directory:path,resolvePrincipal:()=>owner,acceptance:{criteria:[{id:'value',kind:'file-contains',path:'value.txt',expected:'correct',required:true}],capture:profile=>{captures++;if(profile.name==='missing')throw Error('unavailable');return {'value.txt':'wrong'};}},createRuntime:runtimeFactory(path,()=>Array.from({length:5},()=>answer('VERIFIED PASS')))});t.after(()=>s.close());
  const missing=s.register(owner,{name:'missing'}),failed=s.register(owner,{name:'failed'});
  const a=s.createOrganization(owner,{requestId:'missing',goal:'work',agentId:missing.id,participants:[missing.id],criterionIds:['value'],maxRepairAttempts:3});
  const b=s.createOrganization(owner,{requestId:'failed',goal:'work',agentId:failed.id,participants:[failed.id],criterionIds:['value'],maxRepairAttempts:1});s.start();
  const [va,vb]=await Promise.all([orgDone(s,a.id),orgDone(s,b.id)]);assert.equal(va.currentAcceptance,'UNKNOWN');assert.equal(va.attempts.length,1);assert.equal(vb.organization.status,'failed');assert.equal(vb.currentAcceptance,'FAIL');assert.equal(vb.attempts.length,2);assert.ok(captures>=3);
});

test('HTTP organization API enforces authorization and the SDK reuses host-selected checks',async t=>{
  const path=directory(t),s=await AgentSupervisor.open({directory:path,resolvePrincipal:()=>owner,createRuntime:runtimeFactory(path,()=>[answer('done')])}),runtime=new PidaRuntime({});
  const server=createPidaServer({runtime,agents:s,authenticate:staticTokenAuth([{token:'owner-token'.repeat(4),principal:owner},{token:'other-token'.repeat(4),principal:other},{token:'denied-token'.repeat(4),principal:{id:'owner',permissions:[]}}])});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await s.close();await runtime.close();});
  const baseUrl='http://127.0.0.1:'+server.address().port,client=new PidaClient({baseUrl,token:()=> 'owner-token'.repeat(4)}),outsider=new PidaClient({baseUrl,token:()=> 'other-token'.repeat(4)}),denied=new PidaClient({baseUrl,token:()=> 'denied-token'.repeat(4)});
  await assert.rejects(denied.listOrganizations(),{code:'FORBIDDEN'});assert.deepEqual((await client.listOrganizations()).criteria,[]);
  const p=s.register(owner,{name:'worker'}),org=await client.createOrganization({requestId:'api',goal:'work',agentId:p.id,participants:[p.id],criterionIds:[]});
  await assert.rejects(outsider.getOrganization(org.id),{code:'ORG_NOT_FOUND'});s.start();await orgDone(s,org.id);assert.equal((await client.getOrganization(org.id)).currentAcceptance,'UNKNOWN');
});

test('v1 migrates without inventing organizations; future formats fail closed',async t=>{
  const path=directory(t),options={directory:path,resolvePrincipal:()=>owner,createRuntime:()=>{throw Error('no replay');}};
  let s=await AgentSupervisor.open(options);s.register(owner,{name:'legacy'});await s.close();
  const file=join(path,'supervisor.json'),state=JSON.parse(readFileSync(file,'utf8'));state.version=1;delete state.organization;writeFileSync(file,JSON.stringify(state));
  s=await AgentSupervisor.open(options);assert.deepEqual(s.listOrganizations(owner),[]);assert.equal(JSON.parse(readFileSync(file,'utf8')).version,2);await s.close();
  const next=JSON.parse(readFileSync(file,'utf8'));next.version=99;writeFileSync(file,JSON.stringify(next));await assert.rejects(AgentSupervisor.open(options),{code:'AGENT_STATE_INVALID'});
});

test('revoked delegation prevents an already queued continuation from invoking the model',async t=>{
  const path=directory(t);let principal=owner,models=0;
  const s=await AgentSupervisor.open({directory:path,resolvePrincipal:()=>principal,createRuntime:runtimeFactory(path,()=>[()=>{models++;return answer('done');},()=>{models++;return answer('must not run');}])});t.after(()=>s.close());
  const p=s.register(owner,{name:'P'}),a=s.register(owner,{name:'A'}),pj=s.enqueue(p.id,owner,{input:'parent',requestId:'p'}),aj=s.enqueue(a.id,owner,{input:'child',requestId:'a',parentJobId:pj.id});s.start();
  await terminal(s,pj.id);await terminal(s,aj.id);s.pause(p.id,owner);
  const joined=s.registerJoin(pj.id,owner,{requestId:'join',required:[aj.id]});
  const ready=await until(async()=>{const v=await s.getOrganization(joined.orgId,owner);return v.joins[0].status==='ready'&&v;});
  principal={...owner,permissions:owner.permissions.filter(p=>p!=='agent:delegate')};await s.resume(p.id,owner);
  assert.equal((await terminal(s,ready.joins[0].continuationJobId)).code,'JOIN_CONTINUATION_OBSOLETE');assert.equal(models,2);assert.equal((await orgDone(s,joined.orgId)).currentAcceptance,'UNKNOWN');
});

test('an abort-ignoring parent callback retains the lease and cannot enable children or continuation',async t=>{
  const path=directory(t),entered=deferred(),release=deferred();let lease,childCalls=0;
  const acquireRunLease=({runId})=>{if(lease)throw new PidaError('WORKSPACE_BUSY',409);lease=runId;return()=>{assert.equal(lease,runId);lease=undefined;};};
  const s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime:profile=>{
    const f=fauxProvider({tokensPerSecond:100000});f.setResponses(profile.name==='P'?[answer(call('hold',{}),{stopReason:'toolUse'}),answer('unused')]:[()=>{childCalls++;return answer('child');}]);
    return new PidaRuntime({storageDir:join(path,profile.id),acquireRunLease,provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools:[{name:'hold',description:'fixture',parameters:Type.Object({}),permission:'fixture:read',effect:'read',execute:async()=>{entered.resolve();await release.promise;return {ok:true};}}]});
  }});t.after(async()=>{release.resolve();await s.close();});
  const p=s.register(owner,{name:'P'}),a=s.register(owner,{name:'A'}),pj=s.enqueue(p.id,owner,{input:'parent',requestId:'p'}),aj=s.enqueue(a.id,owner,{input:'child',requestId:'a',parentJobId:pj.id});s.start();await entered.promise;
  const joined=s.registerJoin(pj.id,owner,{requestId:'held',required:[aj.id]});await s.cancel(pj.id,owner);await delay(130);
  assert.ok(lease);assert.equal(childCalls,0);assert.equal((await s.getOrganization(joined.orgId,owner)).joins[0].status,'waiting');
  release.resolve();await until(()=>!lease);const done=await orgDone(s,joined.orgId);assert.equal(done.joins[0].status,'blocked');assert.equal(s.jobs(p.id,owner).length,1);
});

test('nested batch uses the child final attempt, not its initial delegating run',async t=>{
  const path=directory(t);let s,p,a,b;
  const createRuntime=profile=>{
    const f=fauxProvider({tokensPerSecond:100000});
    if(profile.name==='P')f.setResponses([answer(call('agent_delegate',{agentId:a.id,input:'A nested task'}),{stopReason:'toolUse'}),()=>answer(call('agent_join',{required:[s.jobs(a.id,owner)[0].id]}),{stopReason:'toolUse'}),answer('P waiting'),context=>{assert.match(JSON.stringify(context),/A final/);return answer('P final');}]);
    else if(profile.name==='A')f.setResponses([answer(call('agent_delegate',{agentId:b.id,input:'B leaf'}),{stopReason:'toolUse'}),()=>answer(call('agent_join',{required:[s.jobs(b.id,owner)[0].id]}),{stopReason:'toolUse'}),answer('A waiting'),answer('A final')]);
    else f.setResponses([answer('B final')]);
    return new PidaRuntime({storageDir:join(path,profile.id),provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools:createAgentTools(s,profile.id)});
  };
  s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime});t.after(()=>s.close());p=s.register(owner,{name:'P'});a=s.register(owner,{name:'A'});b=s.register(owner,{name:'B'});
  const org=s.createOrganization(owner,{requestId:'nested',goal:'nested task',agentId:p.id,participants:[p.id,a.id,b.id],criterionIds:[]});s.start();const done=await orgDone(s,org.id);
  assert.equal(done.joins.length,2);assert.ok(done.joins.every(j=>j.status==='ready'));
  const root=done.joins.find(j=>j.taskId===org.rootTaskId),aJobs=s.jobs(a.id,owner);assert.equal(root.results[0].assignmentJobId,aJobs[0].id);assert.equal(root.results[0].jobId,aJobs[1].id);
});

test('persisted repair intent resumes once after restart and an expired organization cannot start it',async t=>{
  const path=directory(t);let s,calls=0;
  const checks=[{id:'value',kind:'file-contains',path:'value.txt',expected:'yes',required:true}];
  const options={directory:path,resolvePrincipal:()=>owner,acceptance:{criteria:checks,capture:profile=>{if(calls===1)s.pause(profile.id,owner);return {'value.txt':calls>1?'yes':'no'};}},createRuntime:runtimeFactory(path,()=>[()=>{calls++;return answer('done');}])};
  s=await AgentSupervisor.open(options);t.after(()=>s.close());const p=s.register(owner,{name:'writer'}),org=s.createOrganization(owner,{requestId:'repair-restart',goal:'work',agentId:p.id,participants:[p.id],criterionIds:['value'],maxRepairAttempts:1});s.start();
  const pending=await until(async()=>{const v=await s.getOrganization(org.id,owner);return v.attempts.length===2&&v;});const repair=pending.attempts[1].jobId;
  assert.equal(s.getJob(repair,owner).status,'queued');await s.close();
  s=await AgentSupervisor.open(options);s.start();await s.resume(p.id,owner);const done=await orgDone(s,org.id);assert.equal(done.currentAcceptance,'PASS');assert.equal(done.attempts[1].jobId,repair);assert.equal(calls,2);
  await s.close();const disk=JSON.parse(readFileSync(join(path,'supervisor.json'),'utf8'));
  // Restart fixture at the prior durable ready point, with a deadline in the past.
  disk.organization.sessions[0].status='active';disk.organization.sessions[0].deadlineAt=1;disk.organization.tasks[0].status='queued';disk.organization.tasks[0].receipts=disk.organization.tasks[0].receipts.slice(0,1);
  const job=disk.jobs.find(j=>j.id===repair);job.status='queued';delete job.result;writeFileSync(join(path,'supervisor.json'),JSON.stringify(disk));
  s=await AgentSupervisor.open(options);s.start();assert.equal((await orgDone(s,org.id)).organization.status,'expired');assert.equal(s.getJob(repair,owner).status,'cancelled');assert.equal(calls,2);
});

test('stopping during a continuation leaves it interrupted and never creates another continuation on reopen',async t=>{
  const path=directory(t),entered=deferred();let models=0;
  const createRuntime=runtimeFactory(path,p=>p.name==='P'?[answer('initial'),()=>{models++;return answer(call('hold',{}),{stopReason:'toolUse'});}]:[answer('child')],{tools:[{name:'hold',description:'fixture',parameters:Type.Object({}),permission:'fixture:read',effect:'read',execute:async(_args,{signal})=>{entered.resolve();await delay(10000,undefined,{signal});return {};}}]});
  const options={directory:path,resolvePrincipal:()=>owner,createRuntime};let s=await AgentSupervisor.open(options);t.after(()=>s.close());
  const p=s.register(owner,{name:'P'}),a=s.register(owner,{name:'A'}),pj=s.enqueue(p.id,owner,{input:'parent',requestId:'p'}),aj=s.enqueue(a.id,owner,{input:'child',requestId:'a',parentJobId:pj.id});s.start();await terminal(s,pj.id);await terminal(s,aj.id);
  const joined=s.registerJoin(pj.id,owner,{requestId:'join',required:[aj.id]});await entered.promise;await s.close();
  s=await AgentSupervisor.open({...options,createRuntime:()=>{throw Error('must not replay');}});s.start();const done=await orgDone(s,joined.orgId);
  assert.equal(s.getJob(done.joins[0].continuationJobId,owner).status,'interrupted');assert.equal(s.jobs(p.id,owner).length,2);assert.equal(models,1);assert.equal(s.get(p.id,owner).needsReconciliation,true);assert.equal(done.currentAcceptance,'UNKNOWN');
});

test('host cancellation interrupts only its organization and late capture cannot accept cancelled work',async t=>{
  const path=directory(t),entered=deferred(),release=deferred();let s;
  const options={directory:path,resolvePrincipal:()=>owner,acceptance:{criteria:[{id:'ok',kind:'file-contains',path:'ok.txt',expected:'yes',required:true}],capture:async()=>{entered.resolve();await release.promise;return {'ok.txt':'yes'};}},createRuntime:runtimeFactory(path,()=>[answer('done')])};
  s=await AgentSupervisor.open(options);t.after(async()=>{release.resolve();await s.close();});const p=s.register(owner,{name:'P'}),b=s.register(owner,{name:'B'});
  const org=s.createOrganization(owner,{requestId:'cancel',goal:'work',agentId:p.id,participants:[p.id],criterionIds:['ok']});s.start();await entered.promise;
  const unrelated=s.enqueue(b.id,owner,{input:'unrelated',requestId:'other'});
  await assert.rejects(s.cancelOrganization(org.id,other),{code:'ORG_NOT_FOUND'});assert.equal((await s.cancelOrganization(org.id,owner)).status,'cancelled');release.resolve();
  assert.equal((await terminal(s,unrelated.id)).status,'completed');const done=await s.getOrganization(org.id,owner);assert.equal(done.organization.status,'cancelled');assert.equal(done.currentAcceptance,'UNKNOWN');assert.equal(done.tasks[0].receipts.length,0);
});
