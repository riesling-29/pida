import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Type} from 'typebox';
import {fauxProvider,fauxAssistantMessage as answer,fauxToolCall as call} from '@earendil-works/pi-ai/providers/faux';
import {PidaRuntime} from '../dist/runtime.js';
import {AgentSupervisor} from '../dist/agent-supervisor.js';
import {createAgentTools} from '../dist/agent-tools.js';
import {validateObservationBundle} from '../dist/integration-contract.js';
const owner={id:'owner',permissions:['pida:agents','agent:delegate','agent:read','fixture:read']};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){for(let i=0;i<600;i++){const v=await fn();if(v)return v;await delay(10);}assert.fail('did not settle');}
const terminal=(s,id)=>until(()=>{const j=s.getJob(id,owner);return !['queued','running'].includes(j.status)&&j;});
const orgDone=(s,id)=>until(async()=>{const v=await s.getOrganization(id,owner);return v.organization.status!=='active'&&v;});
function directory(t){const p=mkdtempSync(join(tmpdir(),'pida-yield-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}

for(const mode of ['waiting','child-first','required-failure','nonempty']) test(`native applied join ${mode}: exact result and continuation remain durable`,async t=>{
  const path=directory(t);let s,parent,child,rootCalls=0,childCalls=0;
  const createRuntime=profile=>{
    const f=fauxProvider({tokensPerSecond:100000});
    if(profile.id===parent.id)f.setResponses([
      ()=>{rootCalls++;return answer(call('agent_delegate',{agentId:child.id,input:'child task'}),{stopReason:'toolUse'});},
      ()=>{rootCalls++;return answer(call('agent_join',{required:[s.jobs(child.id,owner)[0].id]}),{stopReason:'toolUse'});},
      async()=>{rootCalls++;if(mode==='child-first')await terminal(s,s.jobs(child.id,owner)[0].id);return answer(mode==='nonempty'?'Waiting for child.':'');},
      context=>{rootCalls++;assert.match(JSON.stringify(context),/Child result references/);return answer('Final combined result');}
    ]);else f.setResponses([()=>{childCalls++;if(mode==='required-failure')throw Error('synthetic child failure');return answer('child result');}]);
    return new PidaRuntime({agentId:profile.id,storageDir:join(path,'runtime',profile.id),provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools:createAgentTools(s,profile.id),maxRunMs:5000,maxProviderRetries:0});
  };
  const options={directory:path,workspaceKey:p=>p.id,maxConcurrent:mode==='child-first'?2:1,resolvePrincipal:()=>owner,createRuntime};
  s=await AgentSupervisor.open(options);t.after(()=>s.close());parent=s.register(owner,{name:'root'});child=s.register(owner,{name:'child'});
  const org=s.createOrganization(owner,{requestId:'yield',goal:'delegate and join',agentId:parent.id,participants:[parent.id,child.id],criterionIds:[],maxRepairAttempts:0});s.start();
  const done=await orgDone(s,org.id),jobs=s.jobs(parent.id,owner),initial=jobs[0];
  assert.equal(initial.status,'completed');assert.equal(initial.result.status,'completed');
  assert.equal(initial.result.text,mode==='nonempty'?'Waiting for child.':'');
  assert.equal(initial.code,mode==='nonempty'?undefined:'AGENT_JOIN_YIELDED');
  assert.equal(initial.result.code,initial.code);assert.equal(childCalls,1);
  assert.equal(done.currentAcceptance,'UNKNOWN');
  const runtime=await s.getRuntime(parent.id,owner),bundle=runtime.exportRun(initial.sessionId,initial.runId,owner);
  assert.equal(validateObservationBundle(bundle).valid,true);
  assert.equal(bundle.events.find(e=>e.activity==='run_finished').payload.status,'completed');
  if(mode==='required-failure'){
    assert.equal(done.joins[0].status,'blocked');assert.equal(jobs.length,1);assert.equal(rootCalls,3);
  }else{
    assert.equal(jobs.length,2);assert.equal(rootCalls,4);assert.equal(done.joins[0].status,'ready');
    assert.equal(jobs[1].result.text,'Final combined result');assert.equal(jobs[1].sessionId,initial.sessionId);
    assert.equal(done.joins[0].continuationJobId,jobs[1].id);
    const root=done.tasks.find(t=>t.id===org.rootTaskId);assert.equal(root.attempts.length,2);
    assert.equal(root.receipts.length,1,'yield itself receives no acceptance receipt');
  }
  const before=JSON.parse(JSON.stringify(jobs));await s.close();
  s=await AgentSupervisor.open({...options,createRuntime:()=>{throw Error('no replay');}});s.start();await delay(80);
  assert.deepEqual(s.jobs(parent.id,owner),before);assert.equal((await s.getOrganization(org.id,owner)).joins[0].continuationJobId,done.joins[0].continuationJobId);
});

test('yield waiting for paused child survives restart and creates exactly one continuation',async t=>{
  const path=directory(t);let s,parent,child,reopened=false,continuations=0;
  const createRuntime=profile=>{
    const f=fauxProvider({tokensPerSecond:100000});
    f.setResponses(profile.id===parent.id?(reopened?[()=>{continuations++;return answer('final');}]:[
      answer(call('agent_delegate',{agentId:child.id,input:'child'}),{stopReason:'toolUse'}),
      ()=>answer(call('agent_join',{required:[s.jobs(child.id,owner)[0].id]}),{stopReason:'toolUse'}),answer('')]):[answer('child')]);
    return new PidaRuntime({storageDir:join(path,'runtime',profile.id),provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools:createAgentTools(s,profile.id),maxRunMs:5000});
  };
  const options={directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime};
  s=await AgentSupervisor.open(options);t.after(()=>s.close());parent=s.register(owner,{name:'root'});child=s.register(owner,{name:'child'});s.pause(child.id,owner);
  const org=s.createOrganization(owner,{requestId:'restart',goal:'join',agentId:parent.id,participants:[parent.id,child.id],criterionIds:[]});s.start();
  const initial=await until(()=>s.jobs(parent.id,owner)[0]);assert.equal((await terminal(s,initial.id)).code,'AGENT_JOIN_YIELDED');
  const waiting=await s.getOrganization(org.id,owner);assert.equal(waiting.joins[0].status,'waiting');assert.equal(waiting.tasks.find(t=>t.id===org.rootTaskId).receipts.length,0);
  await s.close();reopened=true;s=await AgentSupervisor.open(options);s.start();await s.resume(child.id,owner);
  const done=await orgDone(s,org.id);assert.equal(continuations,1);assert.equal(s.jobs(parent.id,owner).length,2);
  assert.equal(s.getJob(initial.id,owner).result.text,'');assert.equal(done.joins[0].status,'ready');
  for(let i=0;i<4;i++)await s.getOrganization(org.id,owner);assert.equal(continuations,1);
});

async function standalone(t,{confirm,extra={},effect='idempotent',state='applied',outcome='completed',last=answer('')}={}){
  const f=fauxProvider({tokensPerSecond:100000});f.setResponses([answer(call('agent_join',{}),{stopReason:'toolUse'}),last]);
  const tool={name:'agent_join',description:'synthetic host capability',parameters:Type.Object({}),permission:'fixture:read',effect,
    execute:async()=>({ok:true,marker:'AGENT_JOIN_YIELDED'}),effectResult:()=>state,classifyResult:()=>({status:outcome}),...(confirm?{confirmRunYield:confirm}:{})};
  const r=new PidaRuntime({provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools:[tool],maxRunMs:5000,maxProviderRetries:0,...extra});t.after(()=>r.close());
  const {sessionId}=await r.createSession(owner);return {r,sessionId,run:(signal)=>r.run(sessionId,owner,'synthetic',()=>{},signal)};
}
for(const [name,options] of [
  ['tool name and marker only',{}],['false',{confirm:()=>false}],['throw',{confirm:()=>{throw Error('stale');}}],
  ['thenable',{confirm:()=>Promise.resolve(true)}],['truthy object',{confirm:()=>({ok:true})}],
  ['read effect',{confirm:()=>true,effect:'read'}],['not applied',{confirm:()=>true,state:'not_applied'}],
  ['unknown effect',{confirm:()=>true,state:'unknown'}],['failed outcome',{confirm:()=>true,outcome:'failed'}]
])test(`empty response cannot yield from ${name}`,async t=>{
  const {run}=await standalone(t,options),result=await run();assert.notEqual(result.code,'AGENT_JOIN_YIELDED');assert.notEqual(result.status,'completed');assert.equal(result.text,'');
});

for(const mode of ['cancel','stale','deadline'])test(`handoff rechecked after asynchronous work review: ${mode}`,async t=>{
  const entered=deferred(),release=deferred(),controller=new AbortController();let current=true,finished,settled;
  const {run}=await standalone(t,{confirm:()=>current,extra:{maxRunMs:mode==='deadline'?300:5000,workSurface:{
    prepare:async()=>'',replay:()=>undefined,finish:async(_p,result)=>{finished=structuredClone(result);entered.resolve();await release.promise;},settle:result=>{settled=structuredClone(result);}
  }}});
  const pending=run(controller.signal);await entered.promise;
  assert.notEqual(finished.code,'AGENT_JOIN_YIELDED');assert.notEqual(finished.status,'completed');
  if(mode==='cancel')controller.abort();else if(mode==='stale')current=false;else await delay(350);
  release.resolve();const result=await pending;assert.equal(result.code,{cancel:'CANCELLED',stale:'AGENT_JOIN_YIELD_OBSOLETE',deadline:'RUN_TIMEOUT'}[mode]);
  assert.notEqual(result.status,'completed');assert.deepEqual(settled,result);
});

for(const mode of ['foreign','stale','cancelled-join'])test(`native proof rejects ${mode} membership`,async t=>{
  const path=directory(t);let s,parent,child,checks=0;
  const createRuntime=profile=>{
    const f=fauxProvider({tokensPerSecond:100000});
    f.setResponses(profile.id===parent.id?[
      answer(call('agent_delegate',{agentId:child.id,input:'child'}),{stopReason:'toolUse'}),
      ()=>answer(call('agent_join',{required:[s.jobs(child.id,owner)[0].id]}),{stopReason:'toolUse'}),
      async()=>{if(mode==='cancelled-join'){const j=(await s.getOrganization(s.listOrganizations(owner)[0].id,owner)).joins[0];await s.cancelJoin(j.id,owner,j.revision);}return answer('');}
    ]:[answer('child')]);
    const tools=createAgentTools(s,profile.id);
    if(profile.id===parent.id && mode!=='cancelled-join'){
      const tool=tools.find(t=>t.name==='agent_join'),original=tool.confirmRunYield;
      tool.confirmRunYield=(value,context)=>{checks++;return original(mode==='stale'?{...value,join:{...value.join,revision:value.join.revision+1}}:value,
        mode==='foreign'?{...context,runId:'00000000-0000-4000-8000-000000000000'}:context);};
    }
    return new PidaRuntime({storageDir:join(path,profile.id),provider:()=>({provider:f.provider,modelId:f.getModel().id}),tools,maxRunMs:5000});
  };
  s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime});t.after(()=>s.close());parent=s.register(owner,{name:'root'});child=s.register(owner,{name:'child'});
  const org=s.createOrganization(owner,{requestId:'deny',goal:'join',agentId:parent.id,participants:[parent.id,child.id],criterionIds:[]});s.start();
  const initial=await until(()=>s.jobs(parent.id,owner)[0]),result=await terminal(s,initial.id);
  assert.notEqual(result.code,'AGENT_JOIN_YIELDED');assert.notEqual(result.status,'completed');
  if(mode!=='cancelled-join'){assert.equal(result.code,'EMPTY_RESPONSE');assert.ok(checks>0);}
  await orgDone(s,org.id);assert.equal(s.jobs(parent.id,owner).length,1);
});

for(const [name,last,extra,code] of [
  ['provider failure',()=>{throw Error('synthetic provider error');},{},'PROVIDER_FAILED'],
  ['unknown usage',()=>{throw Error('synthetic provider error');},{maxTotalTokens:16384},'USAGE_UNAVAILABLE'],
  ['token guard',answer(''),{maxTotalTokens:1},'TOKEN_BUDGET']
])test(`host yield never overrides ${name}`,async t=>{
  const {run}=await standalone(t,{confirm:()=>true,last,extra}),result=await run();
  assert.equal(result.code,code);assert.notEqual(result.status,'completed');
});
