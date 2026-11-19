import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PidaRuntime } from '../dist/runtime.js';
import { workbenchPermissions } from '../dist/workbench.js';
import { AgentSupervisor } from '../dist/agent-supervisor.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';

const owner={id:'owner',permissions:['pida:agents','agent:delegate','agent:read',...workbenchPermissions]};
const colA='col_01ARZ3NDEKTSV4RRFFQ69G5FAV', colB='col_01BX5ZZKBKACTAV9WEVGEMMVRZ', orgX='org_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const token='owner-token'.repeat(4);
function directory(t){const path=mkdtempSync(join(tmpdir(),'pida-ws-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
const noRuntime=()=>{throw Error('runtime must not start in this test');};
const open=(path,extra={})=>AgentSupervisor.open({directory:path,resolvePrincipal:()=>owner,createRuntime:noRuntime,...extra});
/** Structural shape: sorted keys and value types. Ids, times and digests vary per run; the key set is the wire/storage contract. */
function shape(v){
  if(Array.isArray(v))return v.length?[shape(v[0])]:[];
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,shape(v[k])]));
  return v===null?'null':typeof v;
}
async function serve(t,s){
  const runtime=new PidaRuntime({}),server=createPidaServer({runtime,agents:s,authenticate:staticTokenAuth([{token,principal:owner}])});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await s.close();await runtime.close();});
  const base='http://127.0.0.1:'+server.address().port;
  return async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
}

const sessionShape={createdAt:'string',criteriaDigest:'string',criterionIds:[],deadlineAt:'number',definitionDigest:'string',environmentRevision:'string',goal:'string',id:'string',maxRepairAttempts:'number',owner:'string',participants:['string'],requestId:'string',rootTaskId:'string',status:'string'};
const taskShape={agentId:'string',assignmentRevision:'number',attempts:['string'],id:'string',inputDigest:'string',orgId:'string',receipts:[],status:'string'};
const attemptShape={id:'string',jobId:'string',kind:'string',number:'number',taskId:'string'};
const profileShape={createdAt:'string',id:'string',name:'string',owner:'string',paused:'boolean',personaSourceId:'string',role:'string',updatedAt:'string'};

test('wire and stored formats of work sessions are unchanged without a host collective',async t=>{
  const path=directory(t),s=await open(path),call=await serve(t,s);
  const agent=await call('/v1/agents','POST',{name:'worker'});assert.equal(agent.status,201);assert.deepEqual(shape(agent.body),profileShape);
  const input={requestId:'wire',goal:'work',agentId:agent.body.id,participants:[agent.body.id],criterionIds:[]};
  const created=await call('/v1/organizations','POST',input);assert.equal(created.status,202);assert.deepEqual(shape(created.body),sessionShape);
  const listed=await call('/v1/organizations');assert.deepEqual(shape(listed.body),{criteria:[],organizations:[sessionShape]});
  const got=await call('/v1/organizations/'+created.body.id);
  assert.deepEqual(shape(got.body),{attempts:[attemptShape],currentAcceptance:'string',joins:[],organization:sessionShape,tasks:[taskShape]});
  assert.equal(got.body.tasks[0].orgId,created.body.id,'task.orgId keeps pointing at the work session');
  const again=await call('/v1/organizations','POST',input);assert.deepEqual(again.body,created.body,'idempotent create returns identical bytes');
  const cancelled=await call('/v1/organizations/'+created.body.id+'/cancel','POST',{});assert.deepEqual(shape(cancelled.body),sessionShape);
  const stored=JSON.parse(readFileSync(join(path,'supervisor.json'),'utf8'));
  assert.deepEqual(Object.keys(stored).sort(),['collaboration','jobs','organization','organizationAdmissions','profiles','version']);assert.equal(stored.version,4);
  assert.deepEqual(Object.keys(stored.organization).sort(),['attempts','joins','sessions','tasks']);
  assert.deepEqual(shape(stored.organization.sessions[0]),sessionShape);assert.deepEqual(shape(stored.organization.tasks[0]),taskShape);
  assert.deepEqual(shape(stored.profiles[0]),profileShape);assert.equal(typeof stored.jobs[0].organizationTaskId,'string');
});

test('host collective fills work session collectiveId/orgId and agent collectiveId',async t=>{
  const path=directory(t),s=await open(path,{collective:{collectiveId:colA,orgId:orgX}});t.after(()=>s.close());
  const p=s.register(owner,{name:'a'}),q=s.register(owner,{name:'b'});assert.equal(p.collectiveId,colA);
  const ws=s.createWorkSession(owner,{requestId:'same',goal:'work',agentId:p.id,participants:[p.id,q.id],criterionIds:[]});
  assert.equal(ws.collectiveId,colA);assert.equal(ws.orgId,orgX);
  assert.deepEqual(Object.keys(ws).sort(),[...Object.keys(sessionShape),'collectiveId','orgId'].sort());
  await s.close();
  const reopened=await open(path,{collective:{collectiveId:colA,orgId:orgX}});t.after(()=>reopened.close());
  assert.equal((await reopened.getWorkSession(ws.id,owner)).organization.collectiveId,colA);
});

test('work session rejects participants from a different collective',async t=>{
  const path=directory(t);
  let s=await open(path,{collective:{collectiveId:colA,orgId:orgX}});const a=s.register(owner,{name:'a'});await s.close();
  s=await open(path,{collective:{collectiveId:colB,orgId:orgX}});const b=s.register(owner,{name:'b'});assert.equal(b.collectiveId,colB);
  const call=await serve(t,s);
  assert.throws(()=>s.createWorkSession(owner,{requestId:'mixed',goal:'work',agentId:b.id,participants:[a.id,b.id],criterionIds:[]}),{code:'ORG_COLLECTIVE_MISMATCH'});
  assert.throws(()=>s.createWorkSession(owner,{requestId:'foreign',goal:'work',agentId:a.id,participants:[a.id],criterionIds:[]}),{code:'ORG_COLLECTIVE_MISMATCH'});
  const http=await call('/v1/organizations','POST',{requestId:'mixed-http',goal:'work',agentId:b.id,participants:[a.id,b.id],criterionIds:[]});
  assert.equal(http.status,409);assert.deepEqual(http.body,{error:'ORG_COLLECTIVE_MISMATCH'});
  assert.deepEqual(s.listWorkSessions(owner),[],'nothing persisted on rejection');
  assert.equal(s.createWorkSession(owner,{requestId:'ok',goal:'work',agentId:b.id,participants:[b.id],criterionIds:[]}).collectiveId,colB);
});

test('stored work session with a mixed-collective participant fails closed on load',async t=>{
  const path=directory(t);
  let s=await open(path,{collective:{collectiveId:colA,orgId:orgX}});
  const a=s.register(owner,{name:'a'}),b=s.register(owner,{name:'b'});
  s.createWorkSession(owner,{requestId:'x',goal:'work',agentId:a.id,participants:[a.id,b.id],criterionIds:[]});await s.close();
  const statePath=join(path,'supervisor.json'),original=readFileSync(statePath,'utf8');
  for(const change of [st=>{st.profiles[1].collectiveId=colB;},st=>{delete st.profiles[1].collectiveId;},st=>{st.organization.sessions[0].collectiveId='col_bad';},st=>{delete st.organization.sessions[0].orgId;}]){
    const state=JSON.parse(original);change(state);const damaged=JSON.stringify(state);writeFileSync(statePath,damaged);
    await assert.rejects(open(path,{collective:{collectiveId:colA,orgId:orgX}}),{code:/^(ORG|AGENT)_STATE_INVALID$/});
    assert.equal(readFileSync(statePath,'utf8'),damaged,'failed validation must preserve evidence');
  }
});

test('host collective config accepts only contract ULID ids',async t=>{
  for(const collective of [{collectiveId:'col_01arz3ndektsv4rrffq69g5fav',orgId:orgX},{collectiveId:colA,orgId:'org_8ZZZZZZZZZZZZZZZZZZZZZZZZZ'},{collectiveId:orgX,orgId:colA},{collectiveId:colA},{collectiveId:colA,orgId:orgX,extra:1}]){
    const path=directory(t);
    await assert.rejects(open(path,{collective}),{code:'COLLECTIVE_CONFIG_INVALID'});
  }
});
