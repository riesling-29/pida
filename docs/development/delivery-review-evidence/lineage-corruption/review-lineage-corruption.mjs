import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AgentSupervisor} from './dist/agent-supervisor.js';
import {collaborationDigest} from './dist/collaboration.js';
import {PidaRuntime} from './dist/runtime.js';
import {fauxProvider,fauxAssistantMessage as answer} from '@earendil-works/pi-ai/providers/faux';
const owner={id:'review-owner',permissions:['pida:agents','pida:collaborate','agent:delegate']};
async function until(fn){for(let i=0;i<500;i++){const v=await fn();if(v)return v;await delay(10);}throw Error('timeout');}
const done=(s,id)=>until(()=>{const j=s.getJob(id,owner);return !['queued','running'].includes(j.status)&&j;});
const path=mkdtempSync(join(tmpdir(),'pida-review-corrupt-')),calls=[],phases=[];let allowed=true;
const opts={directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,collaboration:{hostId:'host-1',authorize:({phase})=>{phases.push({phase,allowed});return allowed;}},createRuntime:p=>{const f=fauxProvider({tokensPerSecond:100000});f.setResponses(Array.from({length:4},()=>()=>{calls.push(p.name);return answer('done');}));return new PidaRuntime({storageDir:join(path,p.id),provider:()=>({provider:f.provider,modelId:f.getModel().id})});}};
let s=await AgentSupervisor.open(opts);
try{
  const root=s.register(owner,{name:'root'}),a=s.register(owner,{name:'external'}),b=s.register(owner,{name:'child'});s.pause(root.id,owner);s.pause(b.id,owner);
  const org=s.createOrganization(owner,{requestId:'org',goal:'root',agentId:root.id,participants:[root.id,a.id,b.id],criterionIds:[]});
  const e={schema_version:'pida.collaboration.envelope/1',producer_id:'source',request_id:'request',room_id:'room',room_revision:1,contract_id:'contract',contract_revision:1,sender_binding_id:'sender',recipient:{organization_id:'org-external',host_id:'host-1',org_session_id:org.id,agent_id:a.id},input:'external'};
  const r=await s.receiveCollaboration(owner,{...e,payload_digest:collaborationDigest(e)}),child=s.enqueue(b.id,owner,{requestId:'child',input:'child',parentJobId:r.job_id});
  s.start();await done(s,r.job_id);await s.close();
  const file=join(path,'supervisor.json'),state=JSON.parse(readFileSync(file,'utf8')),record=state.jobs.find(j=>j.id===child.id);
  assert.equal(record.depth,1);delete record.parentJobId;writeFileSync(file,JSON.stringify(state));allowed=false;
  s=await AgentSupervisor.open(opts);s.start();await s.resume(b.id,owner);const result=await done(s,child.id);
  console.log(JSON.stringify({case:'missing-native-parent-link',depth:record.depth,changedFields:['jobs.child.parentJobId deleted'],status:result.status,calls,phases}));
  assert.equal(result.status,'completed');assert.deepEqual(calls,['external','child']);assert.equal(phases.some(p=>!p.allowed),false);
}finally{await s.close();rmSync(path,{recursive:true,force:true});}
