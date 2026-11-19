import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {PidaClient} from './dist/client.js';
import {createWorkspace} from './dist/workspace.js';
import {createCollaborationPolicyClient} from './dist/collaboration-policy-client.js';
import {collaborationDigest} from './dist/collaboration.js';
import {lotStatusTool} from './dist/tools.js';
const token='review-synthetic-policy-token-'.repeat(2);
function pipe(child,type){let resolveReady,rejectReady,n=0,exitCode;const pending=new Map();const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j});child.stderr.resume();child.once('error',rejectReady);const closed=new Promise(r=>child.once('close',code=>{exitCode=code;rejectReady(Error('closed'));r(code)}));createInterface({input:child.stdout}).on('line',l=>{const v=JSON.parse(l);if(v.type===type)resolveReady(v);else{pending.get(v.id)?.(v);pending.delete(v.id);}});return{child,ready,closed,get exited(){return exitCode!==undefined;},command(v){return new Promise(r=>{const id=++n;pending.set(id,r);child.stdin.write(JSON.stringify({id,...v})+'\n');});},async close(){child.stdin.end();const timer=setTimeout(()=>child.kill(),3000);try{return await closed;}finally{clearTimeout(timer);}}};}
const policyServer=pipe(spawn('python',['-I','-B',resolve('test/fixtures/collaboration-policy-server.py')],{env:{...process.env,POLICY_FIXTURE_TOKEN:token},stdio:['pipe','pipe','pipe'],windowsHide:true}),'ready');
const policyReady=await policyServer.ready,url=`http://127.0.0.1:${policyReady.port}/v1/pida-authorization`;
const directory=await mkdtemp(join(tmpdir(),'pida-review-host-'));let host,app;
try{
  host=pipe(spawn(process.execPath,[resolve('examples/schumpeter-host.mjs'),'--workspace',directory,'--host-id','review-host'],{env:{...process.env,PIDA_SCHUMPETER_AUTH_URL:url,PIDA_SCHUMPETER_AUTH_TOKEN:token},stdio:['pipe','pipe','pipe'],windowsHide:true}),'pida-host-ready');
  const ready=await host.ready,client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});
  assert.equal((await fetch(ready.base_url+'/v1/collaboration/capabilities')).status,401);
  const root=await client.createAgent({name:'root'}),worker=await client.createAgent({name:'worker'});await client.pauseAgent(root.id);await client.pauseAgent(worker.id);
  const org=await client.createOrganization({requestId:'review-org',goal:'wait',agentId:root.id,participants:[root.id,worker.id],criterionIds:[]});
  const e={schema_version:'pida.collaboration.envelope/1',producer_id:'schumpeter',request_id:'restart-message',room_id:'review-room',room_revision:1,contract_id:'review-contract',contract_revision:1,sender_binding_id:'review-sender',recipient:{organization_id:'review-external-org',host_id:'review-host',org_session_id:org.id,agent_id:worker.id},input:'LOT-001 검토 🙂'};e.payload_digest=collaborationDigest(e);
  await policyServer.command({grant:{host_id:'review-host',principal_id:'local-user',recipient:e.recipient,sender_binding_id:e.sender_binding_id,room_id:e.room_id,room_revision:1,contract_id:e.contract_id,contract_revision:1}});
  const receipt=await client.receiveCollaboration(e);assert.equal((await client.getAgentJob(worker.id,receipt.job_id)).status,'queued');assert.equal(await host.close(),0);
  await policyServer.command({grant:null});
  app=await createWorkspace(directory,{collaboration:createCollaborationPolicyClient({hostId:'review-host',authorizationUrl:url,token:()=>token}),extensions:[{id:'host-synthetic-lot',scope:'workspace',activate:()=>({tools:[lotStatusTool]})}]});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const next=new PidaClient({baseUrl:`http://127.0.0.1:${app.server.address().port}`,token:()=>ready.api_token});
  assert.equal((await next.getCollaborationCapabilities()).enabled,true);await assert.rejects(next.getCollaborationReceipt(receipt.receipt_id),{code:'COLLABORATION_FORBIDDEN'});await next.resumeAgent(worker.id);
  let job;for(let i=0;i<100;i++){job=await next.getAgentJob(worker.id,receipt.job_id);if(!['queued','running'].includes(job.status))break;await delay(10);}
  assert.equal(job.code,'COLLABORATION_FORBIDDEN');assert.equal(job.runId,undefined);assert.equal((await next.listAgentJobs(worker.id)).jobs.length,1);
  console.log(JSON.stringify({case:'actual-host-to-embedded-restart',capabilitiesAuthStatus:401,receiptMappingPreserved:true,revokedReadback:true,queuedDispatchCode:job.code,modelRunIdPresent:!!job.runId,jobCount:1}));
  await app.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app=undefined;
  // Reopening without host-injected policy never trusts prior enabled configuration.
  app=await createWorkspace(directory,{extensions:[{id:'host-synthetic-lot',scope:'workspace',activate:()=>({tools:[lotStatusTool]})}]});
  const cap=app.agents.collaborationCapabilities({id:'local-user',permissions:['pida:agents']});assert.equal(cap.enabled,false);assert.equal(cap.host_id,null);
  await assert.rejects(app.agents.getCollaborationReceipt(receipt.receipt_id,{id:'local-user',permissions:['pida:agents','pida:collaborate']}),{code:'COLLABORATION_DISABLED'});
  console.log(JSON.stringify({case:'restart-without-policy',enabled:cap.enabled,hostId:cap.host_id,receiptRead:'COLLABORATION_DISABLED'}));
}finally{if(app){await app.close();app.server.closeAllConnections();if(app.server.listening)await new Promise(r=>app.server.close(r));}if(host&&!host.exited)await host.close();await policyServer.close();await rm(directory,{recursive:true,force:true});}
