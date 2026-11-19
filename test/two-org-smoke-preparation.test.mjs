import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTwoOrgSmoke,prepareAnswerGoal,prepareAnswerGoalFromResult,auditSyntheticPiToolCalls,captureLinkedOrganization,readCapturedRunArtifact } from './helpers/two-org-smoke.mjs';
import { AgentSupervisor } from '../dist/agent-supervisor.js';
import { PidaRuntime } from '../dist/runtime.js';
import { createAgentTools } from '../dist/agent-tools.js';
import { collaborationDigest } from '../dist/collaboration.js';
import { organizationDefinitionDigest,organizationAdmissionDigest } from '../dist/organization-admission.js';
import { fauxProvider,fauxAssistantMessage as answer,fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
test('preparation keeps oracle out of goals and distinguishes delegated leakage from legitimate model output',()=>{
  const {plan,privateOracle}=prepareTwoOrgSmoke({rootAgentId:randomUUID(),childAgentId:randomUUID(),answerAgentId:randomUUID(),caseId:'synthetic-unit',seed:654321});
  assert.ok(!JSON.stringify(plan).includes('654321')); assert.ok(!JSON.stringify(plan).includes(String(privateOracle.expected_derived)));
  assert.equal(plan.native_goals,2); assert.equal(plan.runtime_bounds.maxTurns,24); assert.equal(plan.monitor.hard_total_request_cap,false);
  assert.equal(plan.organization_a.timeout_ms,60000);assert.equal(plan.organization_b.timeout_ms,60000);
  assert.equal(plan.organization_a.max_repair_attempts,0);assert.equal(plan.organization_b.max_repair_attempts,0);
  assert.match(plan.organization_budget_source,/not hidden API overrides/);assert.match(plan.join_timeout_scope,/remaining native organization deadline/);
  const goal=prepareAnswerGoal(plan,{case_id:plan.case_id,derived:privateOracle.expected_derived,sha256:'a'.repeat(64),revision:'a'.repeat(64)});
  assert.ok(goal.includes(String(privateOracle.expected_derived)),'B legitimately consumes the observed derived A data');
  assert.match(plan.organization_a.goal,/final reply must contain the complete same JSON data/);assert.match(goal,/final reply must contain the complete same JSON data/);
  const content=JSON.stringify({case_id:plan.case_id,derived:privateOracle.expected_derived}),result={content,sha256:createHash('sha256').update(content).digest('hex'),publicationRevision:'publication:revision-1',jobId:randomUUID()};
  const resultGoal=prepareAnswerGoalFromResult(plan,result);
  assert.match(resultGoal,/source_result_sha256/);assert.match(resultGoal,/source_publication_revision/);assert.ok(!resultGoal.includes('source_file_revision'));
  assert.match(resultGoal,/final reply must contain the complete same JSON data/);
  assert.throws(()=>prepareAnswerGoalFromResult(plan,{...result,content:content+' '}),/OBSERVED_FINAL_RESULT_REQUIRED/);
  const pathOnly='artifacts/organization-a-result.json';
  assert.throws(()=>prepareAnswerGoalFromResult(plan,{...result,content:pathOnly,sha256:createHash('sha256').update(pathOnly).digest('hex')}),/FINAL_RESULT_JSON_REQUIRED/);
  const log=calls=>JSON.stringify({type:'message',message:{role:'assistant',content:calls}})+'\n';
  const good=auditSyntheticPiToolCalls(log([{type:'toolCall',id:'delegate',name:'agent_delegate',arguments:{input:'Read own reference'}},{type:'toolCall',id:'write',name:'workspace_write',arguments:{content:String(privateOracle.seed)}}]),privateOracle);
  assert.equal(good.child_assignment_check,'NO_VALUE_IN_OBSERVED_ASSIGNMENT'); assert.ok(!JSON.stringify(good).includes(String(privateOracle.seed)));
  const bad=auditSyntheticPiToolCalls(log([{type:'toolCall',id:'delegate',name:'agent_delegate',arguments:{input:'The seed is '+privateOracle.seed}}]),privateOracle);
  assert.equal(bad.child_assignment_check,'WEAKENED'); assert.equal(auditSyntheticPiToolCalls('',privateOracle).child_assignment_check,'UNKNOWN');
});
test('operator artifact read selects only captured paths and rejects changed bytes without fabricating revision',async()=>{
  const content='{"derived":42}\n',digest=createHash('sha256').update(content).digest('hex'),job={id:randomUUID(),agentId:randomUUID(),runId:randomUUID(),sessionId:randomUUID(),status:'completed'};
  const record={job,task_id:randomUUID(),attempt_id:randomUUID(),bundle_validation:{valid:true},bundle:{manifest:{artifact_refs:[{id:'artifact:unit',path:'artifacts/organization-a-result.json',sha256:digest,bytes:Buffer.byteLength(content)}]}}};
  let reads=0;const client={readAgentFile:async(agent,path)=>{reads++;assert.equal(agent,job.agentId);return {path,content,revision:digest,bytes:Buffer.byteLength(content)};}};
  const args={record,path:'artifacts/organization-a-result.json',orgId:randomUUID(),admissionRootJobId:randomUUID()};
  const capture=await readCapturedRunArtifact(client,args);assert.equal(capture.content,content);assert.equal(capture.provenance.revision,digest);assert.equal(capture.provenance.agent_sent_message,false);
  await assert.rejects(readCapturedRunArtifact(client,{...args,path:'private-file.txt'}),/RUN_CAPTURED_ARTIFACT_REQUIRED/);assert.equal(reads,1);
  await assert.rejects(readCapturedRunArtifact({readAgentFile:async()=>({path:args.path,content:'changed',revision:digest,bytes:7})},args),/ARTIFACT_VERSION_CHANGED_OR_UNAVAILABLE/);
});
test('actual scripted Pi chain exports root, child and continuation separately; missing child export stays an explicit gap',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'pida-smoke-prep-')), owner={id:'owner',permissions:['pida:agents','pida:collaborate','agent:delegate','agent:read']};
  let supervisor,root,child;
  supervisor=await AgentSupervisor.open({directory,resolvePrincipal:()=>owner,collaboration:{hostId:'host-1',authorize:()=>true,authorizeAdmission:()=>true},
    createRuntime:profile=>{const f=fauxProvider({tokensPerSecond:100000});f.setResponses(profile.id===root.id?[
      ()=>answer(call('agent_delegate',{agentId:child.id,input:'Synthetic child.'}),{stopReason:'toolUse'}),
      ()=>answer(call('agent_join',{required:[supervisor.jobs(child.id,owner)[0].id]}),{stopReason:'toolUse'}),
      ()=>answer('Initial root released.'),()=>answer('Combined synthetic result.')]:[()=>answer('Synthetic child result.')]);
      return new PidaRuntime({agentId:profile.id,storageDir:join(directory,profile.id),tools:createAgentTools(supervisor,profile.id),provider:()=>({provider:f.provider,modelId:f.getModel().id}),maxRunMs:5000});}});
  t.after(()=>supervisor.close()); root=supervisor.register(owner,{name:'root'}); child=supervisor.register(owner,{name:'child'});
  const a=JSON.parse(readFileSync(new URL('../fixtures/organization-admission/admission-v1.json',import.meta.url))),cap=supervisor.organizationAdmissionCapabilities(owner).acceptance;
  a.envelope.recipient.agent_id=root.id; a.definition={...a.definition,root_agent_id:root.id,participants:[root.id,child.id],criterion_ids:cap.criterion_ids,criteria_digest:cap.criteria_digest,environment_revision:cap.environment_revision,max_repair_attempts:0};
  a.envelope.payload_digest=collaborationDigest(a.envelope);a.definition_digest=organizationDefinitionDigest(a.definition);a.admission_digest=organizationAdmissionDigest(a);
  const receipt=await supervisor.admitOrganization(owner,a);supervisor.start();let view;
  for(let i=0;i<500;i++){view=await supervisor.getOrganization(a.envelope.recipient.org_session_id,owner);if(view.organization.status!=='active')break;await new Promise(r=>setTimeout(r,10));}
  assert.notEqual(view.organization.status,'active'); assert.equal(view.attempts.length,3);
  const client={getOrganization:id=>supervisor.getOrganization(id,owner),getAgentJob:(_agent,id)=>supervisor.getJob(id,owner),
    exportAgentJob:async(agent,id)=>{const j=supervisor.getJob(id,owner);return (await supervisor.getRuntime(agent,owner)).exportRun(j.sessionId,j.runId,owner);},
    exportAgentJobOcel:async(agent,id)=>{const j=supervisor.getJob(id,owner);return (await supervisor.getRuntime(agent,owner)).exportRunOcel(j.sessionId,j.runId,owner);}};
  const capture=await captureLinkedOrganization(client,{orgId:view.organization.id,admissionReceipt:receipt});
  assert.equal(capture.records.length,3);assert.equal(capture.gaps.length,0,JSON.stringify(capture.gaps));assert.ok(capture.records.every(r=>r.bundle_validation.valid&&r.bundle.complete&&r.ocel.complete));
  assert.equal(capture.immutable_admission_root_job_id,receipt.job_id);assert.equal(capture.records.filter(r=>r.attempt_kind==='continuation').length,1);
  assert.equal(new Set(capture.records.map(r=>r.job.agentId)).size,2);assert.equal(capture.cut.atomic,false);assert.equal(capture.cut.whole_organization_completeness,'UNAVAILABLE');assert.equal(capture.observed_model_requests,5);
  const partial=await captureLinkedOrganization({...client,exportAgentJob:async(agent,id)=>{if(agent===child.id)throw Error('synthetic missing export');return client.exportAgentJob(agent,id);}}, {orgId:view.organization.id,admissionReceipt:receipt});
  assert.ok(partial.gaps.some(g=>g.job_id===supervisor.jobs(child.id,owner)[0].id&&g.reason==='BUNDLE_EXPORT_UNAVAILABLE'));
  const output=process.env.PIDA_SMOKE_PREPARATION_CAPTURE_DIRECTORY;
  if(output) {
    assert.ok(isAbsolute(output),'capture destination must be explicit and absolute');
    mkdirSync(output); // Exclusive new directory: never overwrite an existing evidence set.
    const bytes=JSON.stringify({schema_version:'pida.scripted-linked-fixture/1',admission:a,capture},null,2)+'\n';
    writeFileSync(join(output,'capture.json'),bytes,{flag:'wx'});
    const repo=fileURLToPath(new URL('../',import.meta.url)), files=[];
    const inventory=relative=>{for(const entry of readdirSync(join(repo,relative),{withFileTypes:true})) {
      const path=relative+'/'+entry.name;
      if(entry.isDirectory()) inventory(path); else if(entry.isFile()) files.push(path);
      else throw Error('Unexpected runtime source entry');
    }};
    inventory('dist');
    files.push('test/two-org-smoke-preparation.test.mjs','test/helpers/two-org-smoke.mjs','npm-shrinkwrap.json');
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(output,'provenance.json'),JSON.stringify({schema_version:'pida.scripted-linked-fixture.provenance/1',
      execution:'Actual public SDK native supervisor/runtime execution with scripted Pi; not HTTP or a real provider.',
      privacy:'Synthetic raw job text. Apply the approved closed metadata projection before PIX input; do not publish raw capture as metadata.',
      fixture_sha256:sha(bytes),node_version:process.version,source_files:files.sort().map(path=>({path,sha256:sha(readFileSync(join(repo,path)))})),
      counts:{executing_agents:2,tasks:2,attempts:3,model_requests:5},
      limits:['No artifact was generated by this scripted chain.','No atomic organization snapshot or cross-run total sequence.','No managed HTTP, Persona, paid provider or desktop acceptance.']},null,2)+'\n',{flag:'wx'});
  }
});
