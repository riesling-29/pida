import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentSupervisor } from './dist/agent-supervisor.js';
import { collaborationDigest } from './dist/collaboration.js';
import { PidaRuntime } from './dist/runtime.js';
import { fauxProvider, fauxAssistantMessage as answer } from '@earendil-works/pi-ai/providers/faux';

const owner = { id: 'review-owner', permissions: ['pida:agents', 'pida:collaborate', 'agent:delegate'] };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function until(fn) { for (let i = 0; i < 500; i++) { const v = await fn(); if (v) return v; await delay(10); } throw Error('review timeout'); }
const done = (s,id) => until(() => { const j=s.getJob(id,owner); return !['queued','running'].includes(j.status)&&j; });
function envelope(agent,org,request='review-request') {
  const e = {schema_version:'pida.collaboration.envelope/1', producer_id:'schumpeter', request_id:request, room_id:'room-1',room_revision:1,contract_id:'contract-1',contract_revision:1,sender_binding_id:'sender-1',recipient:{organization_id:'org-external',host_id:'host-1',org_session_id:org.id,agent_id:agent.id},input:'external task'};
  return {...e,payload_digest:collaborationDigest(e)};
}
function runtimeFactory(path,calls) { return profile => { const f=fauxProvider({tokensPerSecond:100000}); f.setResponses(Array.from({length:6},()=>()=>{calls.push(profile.name);return answer('done');})); return new PidaRuntime({storageDir:join(path,profile.id), provider:()=>({provider:f.provider,modelId:f.getModel().id})}); }; }

async function continuationBypass() {
  const path=mkdtempSync(join(tmpdir(),'pida-review-lineage-')), calls=[], phases=[];
  let allowed=true;
  const s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime:runtimeFactory(path,calls),collaboration:{hostId:'host-1',authorize:({phase})=>{phases.push({phase,allowed});return allowed;}}});
  try {
    const root=s.register(owner,{name:'root'}), external=s.register(owner,{name:'external'}), child=s.register(owner,{name:'child'});
    s.pause(root.id,owner);
    const org=s.createOrganization(owner,{requestId:'org',goal:'waiting root',agentId:root.id,participants:[root.id,external.id,child.id],criterionIds:[]});
    const receipt=await s.receiveCollaboration(owner,envelope(external,org));
    const childJob=s.enqueue(child.id,owner,{requestId:'child',input:'child work',parentJobId:receipt.job_id});
    s.start(); await done(s,receipt.job_id); s.pause(external.id,owner); await done(s,childJob.id);
    const joined=s.registerJoin(receipt.job_id,owner,{requestId:'join',required:[childJob.id]});
    const ready=await until(async()=>{const v=await s.getOrganization(org.id,owner);const j=v.joins.find(j=>j.id===joined.id);return j.status==='ready'&&j;});
    allowed=false; await s.resume(external.id,owner); const final=await done(s,ready.continuationJobId);
    const observed={case:'revoked-continuation',receiptJobId:receipt.job_id,continuationJobId:final.id,continuationStatus:final.status,phases,calls};
    console.log(JSON.stringify(observed));
    assert.equal(final.status,'completed'); assert.equal(calls.filter(c=>c==='external').length,2); assert.equal(phases.filter(p=>p.phase==='dispatch').length,1);
  } finally {await s.close();rmSync(path,{recursive:true,force:true});}
}

async function acceptanceRace() {
  const path=mkdtempSync(join(tmpdir(),'pida-review-acceptance-')), calls=[], entered=deferred(), release=deferred();
  const s=await AgentSupervisor.open({directory:path,maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime:runtimeFactory(path,calls),collaboration:{hostId:'host-1',authorize:()=>true},acceptance:{criteria:[{id:'check',kind:'file-contains',path:'out.txt',expected:'ok',required:true}],capture:async()=>{entered.resolve();return release.promise;}}});
  try {
    const agent=s.register(owner,{name:'worker'}),org=s.createOrganization(owner,{requestId:'org',goal:'original goal',agentId:agent.id,participants:[agent.id],criterionIds:['check']});
    s.start();await entered.promise;
    const receipt=await s.receiveCollaboration(owner,envelope(agent,org));
    release.resolve({'out.txt':'ok'});
    const job=await done(s,receipt.job_id), view=await s.getOrganization(org.id,owner);
    console.log(JSON.stringify({case:'acceptance-race',organizationStatus:view.organization.status,currentAcceptance:view.currentAcceptance,receipt,jobStatus:job.status,jobCode:job.code,calls}));
    assert.equal(view.organization.status,'accepted');assert.equal(job.code,'ORG_ATTEMPT_OBSOLETE');assert.equal(calls.length,1);
  } finally {release.resolve({'out.txt':'ok'});await s.close();rmSync(path,{recursive:true,force:true});}
}
await continuationBypass();
await acceptanceRace();
