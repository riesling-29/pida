// Offline release probe. Explicit external source-locked Python is used only for reference scenarios.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [runtimeArg,evidenceArg,manifestHash,referenceArg,pythonArg]=process.argv.slice(2);
const python=resolve(pythonArg);
const runtime=resolve(runtimeArg),evidence=resolve(evidenceArg),reference=resolve(referenceArg),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(readFileSync(join(runtime,'manifest.json'))),manifestHash);
const manifest=JSON.parse(readFileSync(join(runtime,'manifest.json'))),sidecarBytes=readFileSync(join(runtime,'managed-host-capabilities.json')),sidecar=JSON.parse(sidecarBytes);
assert.equal(sidecar.source_commit,manifest.source_commit);assert.equal(Object.keys(sidecar).length,sidecar.schema_version==='pida.managed-host.capabilities/2'?9:8);
const declared=manifest.files.find(f=>f.path==='managed-host-capabilities.json');assert.equal(declared.sha256,sha(sidecarBytes));
const lock=JSON.parse(readFileSync(join(runtime,'pida/fixtures/vera-dispatch/local-reference-source-lock.json')));
for(const [name,hash]of Object.entries(lock.runtime_files))assert.equal(sha(readFileSync(join(reference,name))),hash);
const node=join(runtime,'node',process.platform==='win32'?'node.exe':'node'),pida=join(runtime,'pida'),entry=join(reference,'scripts/local_persona_bridge.py');
const {PidaClient}=await import(pathToFileURL(join(pida,'dist/client.js')));
const {referenceHostSettings}=await import(pathToFileURL(join(pida,'examples/vera-local-reference-persona.mjs')));
const directory=mkdtempSync(join(tmpdir(),'pdmcap-')),home=join(directory,'home');mkdirSync(home);
const envBase={PATH:join(runtime,'git',process.platform==='win32'?'cmd':'bin')+(process.platform==='win32'?';'+join(process.env.SystemRoot,'System32'):':/usr/bin:/bin'),HOME:home,USERPROFILE:home,TEMP:tmpdir(),TMP:tmpdir(),LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(home,'absent.gitconfig'),
 ...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot}:{}),PIDA_SCHUMPETER_AUTH_URL:'http://127.0.0.1:1/v1/pida-authorization',PIDA_SCHUMPETER_AUTH_TOKEN:'synthetic-private-policy-token-for-packaged-probe'};
function py(args){const r=spawnSync(python,args,{env:envBase,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;}
function tree(dir){const result={};function walk(path,prefix=''){for(const e of readdirSync(path,{withFileTypes:true})){if(e.isDirectory())walk(join(path,e.name),prefix+e.name+'/');else result[prefix+e.name]=sha(readFileSync(join(path,e.name)));}}walk(dir);return result;}
async function until(fn){for(let i=0;i<600;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('PROBE_TIMEOUT');}
const results=[];
for(const [name,policyId,personaMode]of [['base-smoke','smoke/1','local'],['base-work','work/1','local'],['reference-work','work/1','reference'],['catalogue-work','work/1','catalogue']]){
 const hostId='packaged-'+name,workspace=join(directory,name),env={...envBase},profiles=[],cataloguePath=join(directory,name+'-catalogue.json');let module;
 if(personaMode!=='local'){
  for(const id of personaMode==='catalogue'?['a','b']:['a']){
   const config=join(directory,name+'-'+id+'.json'),store=join(directory,name+'-'+id+'-store');
   const value={schema_version:'vera-local-reference/0.1.0',principal:'provider:'+id,host_id:hostId,project_id:'schumpeter',memory_scope:['project:schumpeter'],persona:{persona_id:'persona:'+id,name:'Release '+id,description:'Synthetic release reference '+id,source_refs:['document:offline-release']},grant_expires_at:Math.floor(Date.now()/1000)+3600};writeFileSync(config,JSON.stringify(value));
   py(['-I','-B',entry,'init','--config',config,'--store',store]);
   const bridge={executable:python,prefix_args:['-I','-B',entry],config,store},settings=await referenceHostSettings({hostId},bridge);
   profiles.push({id:'profile-'+id,label:'Release '+id,profile_id:randomUUID(),persona_id:value.persona.persona_id,principal_ids:['local-user'],bridge,config_sha256:sha(readFileSync(config)),store_instance_id:settings.storeIdentity.store_instance_id,bridge_identity:settings.identity});
  }
  if(personaMode==='reference'){
   module=join(pida,'examples/vera-local-reference-persona.mjs');const b=profiles[0].bridge;Object.assign(env,{PIDA_PERSONA_BRIDGE_EXECUTABLE:b.executable,PIDA_PERSONA_BRIDGE_PREFIX_ARGS:JSON.stringify(b.prefix_args),PIDA_PERSONA_BRIDGE_CONFIG:b.config,PIDA_PERSONA_BRIDGE_STORE:b.store});
  }else{module=join(pida,'examples/vera-local-reference-catalogue.mjs');env.PIDA_PERSONA_CATALOGUE=cataloguePath;writeFileSync(cataloguePath,JSON.stringify({schema_version:'pida.persona-catalogue/1',host_id:hostId,sources:profiles}));}
 }
 let current;
 async function launch(mode,selector){
  const child=spawn(node,[join(pida,'examples/schumpeter-host.mjs'),'--workspace',workspace,'--host-id',hostId,'--workspace-mode',mode,...(module?['--persona-module',module]:[]),...(selector?['--execution-policy',selector]:[])],{cwd:directory,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stderr='';child.stderr.on('data',b=>stderr+=b);const closed=new Promise(r=>child.once('close',r));
  const ready=new Promise((res,rej)=>{const timer=setTimeout(()=>{child.kill();rej(Error('HOST_READY_TIMEOUT'));},20000);child.once('error',rej);child.once('close',()=>{clearTimeout(timer);rej(Error(stderr.trim()));});createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);if(r.type==='pida-host-ready'){clearTimeout(timer);res(r);}});});
  current={ready,async close(expected=0){child.stdin.end();const timer=setTimeout(()=>child.kill(),8000);try{assert.equal(await closed,expected,stderr);}finally{clearTimeout(timer);}}};return current;
 }
 const records=[];
 try{
  let h=await launch('fresh',policyId==='smoke/1'?undefined:policyId),ready=await h.ready;
  const expectedPolicy=sidecar.execution_policy.profiles.find(p=>p.id===policyId);assert.deepEqual(ready.execution_policy,expectedPolicy);assert.equal(ready.protocol,sidecar.ready_protocol);assert.equal(Object.keys(ready).length,11);assert.equal(ready.provider_mode,'mock');
  assert.equal(ready.persona_mode,personaMode==='local'?'pida-local':personaMode==='reference'?'vera-local-reference/0.1.0':sidecar.persona_catalogue.mode);
  let client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});const caps=await client.getOrganizationAdmissionCapabilities();assert.equal(caps.schema_version,sidecar.admission_capabilities);assert.deepEqual(caps.execution_policy,expectedPolicy);
  const overview=(await client.listAgents()).personaSources;if(personaMode==='catalogue')assert.deepEqual(overview.sources.map(s=>s.id),['local','profile-a','profile-b']);
  for(const id of personaMode==='catalogue'?['a','b']:['a']){
   const agent=await client.createAgent({name:'Release '+id,...(personaMode==='catalogue'?{personaSourceId:'profile-'+id}:{})});
   const org=await client.createOrganization({requestId:'release-'+id,goal:'Return a synthetic release check.',agentId:agent.id,participants:[agent.id],criterionIds:[]});
   assert.equal(org.deadlineAt-Date.parse(org.createdAt),expectedPolicy.organization_timeout_ms);assert.equal(org.maxRepairAttempts,0);
   const job=await until(async()=>{const {jobs}=await client.listAgentJobs(agent.id);return jobs.find(j=>!['running','queued'].includes(j.status));});assert.equal(job.status,'completed');
   const bundle=await client.exportAgentJob(agent.id,job.id),inclusions=bundle.events.filter(e=>e.activity==='context_input_included');assert.ok(bundle.events.some(e=>e.activity==='run_finished'));
   if(personaMode!=='local')for(const event of inclusions){const b=JSON.parse(event.payload.descriptor).personaBinding;assert.equal(b.personaId,'persona:'+id);assert.equal(b.externalContext.taskId,job.id);assert.equal(b.externalContext.attemptId,job.attemptId);assert.equal(b.externalContext.organizationSessionId,org.id);assert.equal(event.payload.authorization,'current-provider-check');}
   records.push({agent_id:agent.id,source_id:agent.personaSourceId,org_id:org.id,job_id:job.id,attempt_id:job.attemptId,run_id:job.runId,inclusion_events:inclusions.length});
  }
  const token=ready.api_token;await h.close();current=null;
  h=await launch('resume');ready=await h.ready;assert.notEqual(ready.api_token,token);assert.deepEqual(ready.execution_policy,expectedPolicy);client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});
  for(const record of records){const job=await client.getAgentJob(record.agent_id,record.job_id);assert.equal(job.attemptId,record.attempt_id);assert.equal((await client.getAgent(record.agent_id)).personaSourceId,record.source_id);}
  await h.close();current=null;
  const before=tree(workspace);h=await launch('resume',policyId==='smoke/1'?'work/1':'smoke/1');await assert.rejects(h.ready,/HOST_RESUME_MISMATCH/);await h.close(1);current=null;assert.deepEqual(tree(workspace),before);
  if(personaMode==='catalogue'){const cat=JSON.parse(readFileSync(cataloguePath));cat.sources[0].label='Changed';writeFileSync(cataloguePath,JSON.stringify(cat));h=await launch('resume');await assert.rejects(h.ready,/HOST_RESUME_MISMATCH/);await h.close(1);current=null;assert.deepEqual(tree(workspace),before);}
  results.push({name,status:'PASS',policy_id:policyId,persona:personaMode,records,resume_same_ids:true,token_rotated:true,policy_mismatch_no_mutation:true,catalogue_mismatch_no_mutation:personaMode==='catalogue'?true:null});
 }finally{await current?.close().catch(()=>{});}
}
writeFileSync(evidence,JSON.stringify({status:'PASS',source_commit:manifest.source_commit,manifest_sha256:manifestHash,sidecar_sha256:sha(sidecarBytes),platform:process.platform,scenarios:results,provider_network_calls:0,credentials_used:false,external_python_reference:true,limitations:['No GUI, packaged parent Python, canonical memory, real provider or general Linux ABI acceptance.','Native criteria remain empty; completion is not native artifact acceptance.']},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',platform:process.platform,scenarios:results.length,source_commit:manifest.source_commit,provider_network_calls:0}));
