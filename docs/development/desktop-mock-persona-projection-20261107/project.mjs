// Explicit stopped synthetic host only. No runtime construction, HTTP, credentials or Pi chat reads.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Value} from 'typebox/value';
const pkg='D:/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107/windows-accepted/runtime/pida';
const {observationJsonSchema}=await import(pathToFileURL(pkg+'/dist/integration-contract.js'));
const {validContextDescriptor}=await import(pathToFileURL(pkg+'/dist/run-context.js'));
const {canonical}=await import(pathToFileURL(pkg+'/dist/private-state.js'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const host='C:/Users/migeo/AppData/Local/Schumpeter/hosts/3fb183a05c828015';
const expected={host:'desktop-c4a7ae6beb24434e',job:'b1373792-5586-4c15-894d-43380572eef8',agent:'d604c465-59a3-498d-a7ad-4889b83c8a59',org:'9e127e5a-27b1-444b-ac2b-5a6d6ad97a66'};
const files=[host+'/.pida/agents-service/supervisor.json',host+'/.pida/agents-service/agents/'+expected.agent+'/runtime/observations/01a1b642-16e4-7555-8af2-e8791e3e9a81/6f198690-ccdb-4fc9-935a-903164c3e552.jsonl'];
const original=files.map(path=>readFileSync(path));
const state=JSON.parse(original[0]),job=state.jobs.find(j=>j.id===expected.job);
if(!job||job.agentId!==expected.agent||job.status!=='completed')throw Error('NATIVE_JOB_MISMATCH');
const events=original[1].toString('utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
const rows=events.filter(e=>e.activity==='context_input_included').map(e=>{
  const d=JSON.parse(e.payload.descriptor),x=d.personaBinding?.externalContext;
  const checks={observation_schema:Value.Check(observationJsonSchema,e),descriptor_schema:validContextDescriptor(d,true),
    payload_digest:hash(canonical(e.payload))===e.payload_digest,event_job:e.task_id===job.id,event_agent:e.agent_id===job.agentId,event_run:e.run_id===job.runId,event_session:e.session_id===job.sessionId,
    binding_job:x?.taskId===job.id,binding_attempt:x?.attemptId===job.attemptId,binding_run:x?.runId===job.runId,binding_agent:x?.agentInstanceId===job.agentId,
    binding_org:x?.organizationSessionId===expected.org,binding_host:x?.hostId===expected.host,
    current_authorization:e.payload.authorization==='current-provider-check',logical_scope:e.payload.inclusion_scope==='pi-logical-context',digest_scheme:e.payload.input_digest_scheme==='source-hmac-sha256'};
  if(!Object.values(checks).every(Boolean))throw Error('LOGICAL_INCLUSION_JOIN_FAILED');
  return {source_id:e.source_id,source_event_id:e.source_event_id,sequence_number:e.sequence_number,request_id:e.payload.request_id,request_attempt:e.payload.attempt,
    input_digest:e.payload.input_digest,authorization:e.payload.authorization,inclusion_scope:e.payload.inclusion_scope,checks};
});
if(!rows.length)throw Error('NO_LOGICAL_INPUT_RECEIPT');
const source_files=files.map((path,i)=>{if(!original[i].equals(readFileSync(path)))throw Error('SOURCE_CHANGED');return {path,sha256:hash(original[i])};});
const result={schema_version:'pida.desktop-mock-persona-projection/1',scope:'Offline metadata projection of explicitly named stopped synthetic mock host; no real provider or semantic Persona proof.',
  source_files,validator_files:['integration-contract.js','run-context.js','private-state.js'].map(name=>({path:pkg+'/dist/'+name,sha256:hash(readFileSync(pkg+'/dist/'+name))})),
  native_ids:{host_id:expected.host,org_session_id:expected.org,agent_id:job.agentId,job_id:job.id,org_task_id:job.organizationTaskId,attempt_id:job.attemptId,run_id:job.runId,session_id:job.sessionId},
  logical_input_receipts:rows,source_files_unchanged:true,
  excluded:['context body','descriptor body','Persona seed','credentials','Pi conversation','raw provider input'],limits:['Logical input authorization/inclusion only, not serialized provider-wire capture.','Not a whole-bundle or complete organization validation.','Offline comparison does not reopen runtime or change existing analysis permission.']};
writeFileSync(new URL('./result.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({receipts:rows.length,all_checks:true,source_files_unchanged:true,result_sha256:hash(JSON.stringify(result,null,2)+'\n')}));
