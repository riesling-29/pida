import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentSupervisor } from './dist/agent-supervisor.js';
import { collaborationDigest } from './dist/collaboration.js';
const owner={id:'review-owner',permissions:['pida:agents','pida:collaborate']};
const path=mkdtempSync(join(tmpdir(),'pida-review-size-')),file=join(path,'supervisor.json');
const opts={directory:path,resolvePrincipal:()=>owner,createRuntime:()=>{throw Error('must not run');},collaboration:{hostId:'host-1',authorize:()=>true}};
let s=await AgentSupervisor.open(opts);
try {
  const agent=s.register(owner,{name:'worker'}), org=s.createOrganization(owner,{requestId:'org',goal:'root',agentId:agent.id,participants:[agent.id],criterionIds:[]});
  const body={schema_version:'pida.collaboration.envelope/1',producer_id:'schumpeter',request_id:'initial',room_id:'room-1',room_revision:1,contract_id:'contract-1',contract_revision:1,sender_binding_id:'sender-1',recipient:{organization_id:'org-external',host_id:'host-1',org_session_id:org.id,agent_id:agent.id},input:'normal'};
  const receipt=await s.receiveCollaboration(owner,{...body,payload_digest:collaborationDigest(body)}); await s.close();
  const state=JSON.parse(readFileSync(file,'utf8'));
  const template={record:structuredClone(state.collaboration[0]),job:structuredClone(state.jobs.find(j=>j.id===receipt.job_id)),task:structuredClone(state.organization.tasks.find(t=>t.id===state.jobs.find(j=>j.id===receipt.job_id).organizationTaskId)),attempt:structuredClone(state.organization.attempts.find(a=>a.jobId===receipt.job_id))};
  const input='검'.repeat(12000), inputDigest=createHash('sha256').update(input).digest('hex');
  function add(i) {
    const {record,job,task,attempt}=structuredClone(template),rid=randomUUID(),jid=randomUUID(),tid=randomUUID(),aid=randomUUID();
    record.envelope.request_id='seed-'+i;record.envelope.input=input;record.envelope.payload_digest=collaborationDigest(record.envelope);
    Object.assign(record.receipt,{receipt_id:rid,job_id:jid,payload_digest:record.envelope.payload_digest,request_id:record.envelope.request_id});
    Object.assign(job,{id:jid,requestId:'collab-'+rid,input,collaborationReceiptId:rid,organizationTaskId:tid,attemptId:aid});
    Object.assign(task,{id:tid,inputDigest,attempts:[aid]});Object.assign(attempt,{id:aid,taskId:tid,jobId:jid});
    state.collaboration.push(record);state.jobs.push(job);state.organization.tasks.push(task);state.organization.attempts.push(attempt);
  }
  const size=()=>Buffer.byteLength(JSON.stringify(state));const first=size();add(0);const perRecord=size()-first;
  const count=Math.floor((32*1024*1024-first-500)/perRecord);
  for(let i=1;i<count;i++)add(i);
  let encoded=JSON.stringify(state);
  while(Buffer.byteLength(encoded)+perRecord<32*1024*1024){add(state.collaboration.length);encoded=JSON.stringify(state);}
  // Valid synthetic state set exactly250bytes below the reader cap. Public pump must reserve recovery growth.
  const limit=32*1024*1024;
  let remaining=limit-250-Buffer.byteLength(encoded);
  for(const job of state.jobs){if(remaining<=0)break;const n=Math.min(16000,remaining);job.latestText='x'.repeat(n);remaining-=n;}
  assert.equal(remaining,0);encoded=JSON.stringify(state);assert.equal(Buffer.byteLength(encoded),limit-250);writeFileSync(file,encoded);
  const beforeBytes=statSync(file).size;
  const child=spawnSync(process.execPath,['review-crash-capacity-child.mjs',path],{encoding:'utf8',timeout:10000});assert.equal(child.status,78,child.stderr);
  const crashed=JSON.parse(readFileSync(file,'utf8')),runningBytes=statSync(file).size;
  assert.equal(crashed.jobs[0].status,'running');
  s=await AgentSupervisor.open(opts);
  const recovered=s.getJob(crashed.jobs[0].id,owner), recoveredBytes=statSync(file).size;
  assert.equal(recovered.status,'interrupted');assert.equal(recovered.code,'AGENT_PROCESS_INTERRUPTED');assert.equal(s.get(agent.id,owner).needsReconciliation,true);assert.ok(recoveredBytes<=limit);
  await s.close();s=await AgentSupervisor.open(opts);assert.equal(s.getJob(crashed.jobs[0].id,owner).status,'interrupted');
  console.log(JSON.stringify({case:'near-capacity-running-crash-recovery',beforeBytes,runningBytes,recoveredBytes,limit,remainingBytes:limit-recoveredBytes,exitCode:child.status,recoveredStatus:recovered.status}));
} finally {await s.close();rmSync(path,{recursive:true,force:true});}
