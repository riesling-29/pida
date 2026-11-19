import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {AgentSupervisor} from './dist/agent-supervisor.js';
import {collaborationDigest} from './dist/collaboration.js';
import {PidaRuntime} from './dist/runtime.js';
import {fauxProvider,fauxAssistantMessage as answer} from '@earendil-works/pi-ai/providers/faux';
const owner={id:'review-owner',permissions:['pida:agents','pida:collaborate','agent:delegate']};
async function until(fn){for(let i=0;i<600;i++){const v=await fn();if(v)return v;await delay(10);}throw Error('timeout');}
const done=(s,id)=>until(()=>{const j=s.getJob(id,owner);return !['queued','running'].includes(j.status)&&j;});
for(const mode of ['grandchild-restart','second-continuation','cancelled-origin']){
  const path=mkdtempSync(join(tmpdir(),'pida-review-deep-')),calls=[],phases=[];let allowed=true;
  const options={directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,collaboration:{hostId:'host-1',authorize:({phase})=>{phases.push({phase,allowed});return allowed;}},createRuntime:p=>{const f=fauxProvider({tokensPerSecond:100000});f.setResponses(Array.from({length:8},()=>()=>{calls.push(p.name);return answer('done');}));return new PidaRuntime({storageDir:join(path,p.id),provider:()=>({provider:f.provider,modelId:f.getModel().id})});}};
  let s=await AgentSupervisor.open(options);
  try{
    const root=s.register(owner,{name:'root'}),a=s.register(owner,{name:'A'}),b=s.register(owner,{name:'B'}),c=s.register(owner,{name:'C'});s.pause(root.id,owner);
    const org=s.createOrganization(owner,{requestId:'org',goal:'root',agentId:root.id,participants:[root.id,a.id,b.id,c.id],criterionIds:[]});
    const e={schema_version:'pida.collaboration.envelope/1',producer_id:'source',request_id:'request',room_id:'room',room_revision:1,contract_id:'contract',contract_revision:1,sender_binding_id:'sender',recipient:{organization_id:'org-external',host_id:'host-1',org_session_id:org.id,agent_id:a.id},input:'external'};
    const receipt=await s.receiveCollaboration(owner,{...e,payload_digest:collaborationDigest(e)}),child=s.enqueue(b.id,owner,{requestId:'child',input:'child',parentJobId:receipt.job_id});
    let target;
    if(mode==='grandchild-restart'){
      s.pause(c.id,owner);target=s.enqueue(c.id,owner,{requestId:'grandchild',input:'grandchild',parentJobId:child.id}).id;s.start();await done(s,receipt.job_id);await done(s,child.id);await s.close();allowed=false;s=await AgentSupervisor.open(options);s.start();await s.resume(c.id,owner);
    }else if(mode==='second-continuation'){
      s.start();await done(s,receipt.job_id);s.pause(a.id,owner);await done(s,child.id);
      const j1=s.registerJoin(receipt.job_id,owner,{requestId:'join1',required:[child.id]});
      const first=await until(async()=>{const v=await s.getOrganization(org.id,owner);return v.joins.find(j=>j.id===j1.id)?.continuationJobId;});
      await s.resume(a.id,owner);await done(s,first);s.pause(a.id,owner);
      const child2=s.enqueue(b.id,owner,{requestId:'child2',input:'child2',parentJobId:first});await done(s,child2.id);
      const j2=s.registerJoin(first,owner,{requestId:'join2',required:[child2.id]});target=await until(async()=>{const v=await s.getOrganization(org.id,owner);return v.joins.find(j=>j.id===j2.id)?.continuationJobId;});
      allowed=false;await s.resume(a.id,owner);
    }else{target=child.id;await s.cancel(receipt.job_id,owner);s.start();}
    const result=await done(s,target),expected=mode==='cancelled-origin'?'COLLABORATION_ORIGIN_INACTIVE':'COLLABORATION_FORBIDDEN';
    assert.equal(result.code,expected);assert.equal(result.status,'failed');assert.equal(calls.includes('C'),false);
    if(mode==='second-continuation')assert.deepEqual(calls,['A','B','A','B']);
    if(mode==='cancelled-origin')assert.deepEqual(calls,[]);
    console.log(JSON.stringify({case:mode,status:result.status,code:result.code,calls,phases}));
  }finally{await s.close();rmSync(path,{recursive:true,force:true});}
}
