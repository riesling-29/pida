import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fauxProvider, fauxAssistantMessage as answer } from '@earendil-works/pi-ai/providers/faux';
import { initWorkspace, readConfig, createWorkspace, workspaceEnvironment } from '../dist/workspace.js';
import { resolveExecutionPolicy } from '../dist/execution-policy.js';
import { PidaClient } from '../dist/client.js';
import { referenceHostSettings } from '../examples/vera-local-reference-persona.mjs';
import { hostPersonaIdentity, createHostPersona } from '../examples/vera-local-reference-catalogue.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), source = process.env.PIDA_TEST_LOCAL_REFERENCE;
const sha = x => createHash('sha256').update(x).digest('hex');
const principal = { id: 'local-user', permissions: ['pida:collaborate'] };
async function until(fn) { for(let n=0;n<500;n++){const v=await fn();if(v)return v;await delay(20);}assert.fail('TEST_TIMEOUT'); }
function python(executable, args) { const r=spawnSync(executable,args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout; }
async function fixture(t, expiredB=false) {
  const lock=JSON.parse(readFileSync(join(root,'fixtures/vera-dispatch/local-reference-source-lock.json')));
  for(const [p,h] of Object.entries(lock.runtime_files)) assert.equal(sha(readFileSync(join(source,p))),h);
  const dir=mkdtempSync(join(tmpdir(),'pdcat-')), hostId='catalogue-host', path=join(dir,'catalogue.json');
  const executable=python(process.env.PYTHON??'python',['-c','import sys;print(sys.executable)']).trim();
  const entry=join(resolve(source),'scripts/local_persona_bridge.py'), sources=[];
  for(const id of ['a','b']) {
    const config=join(dir,id+'.json'), store=join(dir,id+'-store');
    const value={schema_version:'vera-local-reference/0.1.0',principal:'provider:'+id,host_id:hostId,project_id:'schumpeter',memory_scope:['project:schumpeter'],
      persona:{persona_id:'persona:'+id,name:'Reference '+id,description:'SYNTHETIC_'+id.toUpperCase()+'_ONLY',source_refs:['document:catalogue-test']},grant_expires_at:expiredB&&id==='b'?100:Math.floor(Date.now()/1000)+3600};
    writeFileSync(config,JSON.stringify(value));
    if(expiredB&&id==='b') python(executable,['-I','-B','-c',`import sys;sys.path.insert(0,sys.argv[1]);from persona_substrate.local_bridge import initialize_store;initialize_store(sys.argv[2],sys.argv[3],clock=lambda:1)`,resolve(source),config,store]);
    else python(executable,['-I','-B',entry,'init','--config',config,'--store',store]);
    const bridge={executable,prefix_args:['-I','-B',entry],config,store}, selected=await referenceHostSettings({hostId},bridge);
    sources.push({id:'profile-'+id,label:'Reference '+id,profile_id:randomUUID(),persona_id:value.persona.persona_id,principal_ids:['local-user'],bridge,config_sha256:sha(readFileSync(config)),store_instance_id:selected.storeIdentity.store_instance_id,bridge_identity:selected.identity});
  }
  const catalogue={schema_version:'pida.persona-catalogue/1',host_id:hostId,sources};
  const save=()=>writeFileSync(path,JSON.stringify(catalogue));save();
  const previous=process.env.PIDA_PERSONA_CATALOGUE;process.env.PIDA_PERSONA_CATALOGUE=path;
  t.after(()=>{if(previous===undefined)delete process.env.PIDA_PERSONA_CATALOGUE;else process.env.PIDA_PERSONA_CATALOGUE=previous;});
  return {dir,path,hostId,executable,entry,catalogue,save};
}
async function embedded(t,f) {
  const workspace=join(f.dir,'workspace');initWorkspace(workspace);
  writeFileSync(join(workspace,'pida.config.json'),JSON.stringify({...readConfig(workspace),preset:'personal',tools:{directory:'tools',enabled:[]},workbench:{enabled:false},codingPacks:[],permissions:principal.permissions}));
  let app,bridge;
  const close=async()=>{if(app){await app.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app=undefined;}await bridge?.close();bridge=undefined;};
  const open=async()=>{
    bridge=await createHostPersona({hostId:f.hostId,personaIdentity:await hostPersonaIdentity({hostId:f.hostId}),async taskScope(taskId,agentId){
      const job=app.agents.getJob(taskId,principal);assert.equal(job.agentId,agentId);
      for(const org of app.agents.listOrganizations(principal)){const view=await app.agents.getOrganization(org.id,principal);
        if(view.tasks.some(t=>t.id===job.organizationTaskId&&t.agentId===agentId)&&view.attempts.some(a=>a.id===job.attemptId&&a.jobId===job.id))return {jobId:job.id,attemptId:job.attemptId,organizationTaskId:job.organizationTaskId,organizationSessionId:org.id};}
      throw Error('HOST_PERSONA_ORGANIZATION_REQUIRED');
    }});
    app=await createWorkspace(workspace,{personaSources:bridge.personaSources,executionPolicy:resolveExecutionPolicy('smoke/1')});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    return new PidaClient({baseUrl:'http://127.0.0.1:'+app.server.address().port,token:()=>workspaceEnvironment(workspace).PIDA_API_TOKEN});
  };
  t.after(close);let client=await open();
  return {get app(){return app;},get client(){return client;},bridge,async restart(){await close();client=await open();},workspace};
}
async function run(f,agent,id,calls) {
  const runtime=await f.app.agents.getRuntime(agent.id,principal), faux=fauxProvider({tokensPerSecond:100000});
  faux.setResponses([context=>{calls.push({agent:agent.id,text:JSON.stringify(context)});return answer('Synthetic completion');}]);
  runtime.configureProvider(()=>({provider:faux.provider,modelId:faux.getModel().id}),{mode:'offline-catalogue-fixture',model:'faux'});
  const org=await f.client.createOrganization({requestId:id,goal:'Check the configured reference.',agentId:agent.id,participants:[agent.id],criterionIds:[]});
  const job=await until(async()=>{const list=await f.client.listAgentJobs(agent.id);return list.jobs.find(j=>j.organizationTaskId===org.rootTaskId&&!['queued','running'].includes(j.status));});
  return {job,org,bundle:await f.client.exportAgentJob(agent.id,job.id)};
}
function included(value,agent,persona,count=1){
  assert.equal(value.job.status,'completed',JSON.stringify(value.job));
  const events=value.bundle.events.filter(e=>e.activity==='context_input_included');assert.equal(events.length,count);
  for (const event of events) {
  const binding=JSON.parse(event.payload.descriptor).personaBinding;
  assert.equal(binding.personaId,persona);assert.equal(binding.agentId,agent.id);
  assert.equal(binding.externalContext.taskId,value.job.id);assert.equal(binding.externalContext.attemptId,value.job.attemptId);
  assert.equal(binding.externalContext.organizationSessionId,value.org.id);assert.equal(event.payload.authorization,'current-provider-check');
  }
}

test('catalogue: actual two-profile input/receipt isolation, persisted selection, revocation has no fallback', {skip:!source}, async t=>{
  const fixtureValue=await fixture(t), f=await embedded(t,fixtureValue), calls=[];
  const overview=(await f.client.listAgents()).personaSources;
  assert.deepEqual(overview.sources.map(s=>s.id),['local','profile-a','profile-b']);assert.equal(overview.defaultSourceId,'local');
  assert.equal(JSON.stringify(overview).includes('provider:'),false);assert.equal(JSON.stringify(overview).includes(fixtureValue.dir),false);
  const a=await f.client.createAgent({name:'a',personaSourceId:'profile-a'}),b=await f.client.createAgent({name:'b',personaSourceId:'profile-b'});
  const [av,bv]=await Promise.all([run(f,a,'a1',calls),run(f,b,'b1',calls)]);included(av,a,'persona:a');included(bv,b,'persona:b');
  for(const [agent,marker,other] of [[a,'SYNTHETIC_A_ONLY','SYNTHETIC_B_ONLY'],[b,'SYNTHETIC_B_ONLY','SYNTHETIC_A_ONLY']]){
    const input=calls.find(c=>c.agent===agent.id).text;assert.ok(input.includes(marker));assert.ok(!input.includes(other));
  }
  await assert.rejects(f.client.createAgent({name:'missing',personaSourceId:'absent'}),{code:'AGENT_PERSONA_SOURCE_UNAVAILABLE'});
  await assert.rejects(f.bridge.personaSources[0].create({agentId:a.id,principal:{id:'foreign'}}),/HOST_PERSONA_SOURCE_FORBIDDEN/);
  await f.restart();assert.equal((await f.client.getAgent(a.id)).personaSourceId,'profile-a');assert.equal((await f.client.getAgent(b.id)).personaSourceId,'profile-b');
  const store=fixtureValue.catalogue.sources[1].bridge.store;
  python(fixtureValue.executable,['-I','-B','-c','import sys;sys.path.insert(0,sys.argv[1]);from persona_substrate.provider import PolicyAdmin;PolicyAdmin(sys.argv[2]).revoke("grant:local-reference")',resolve(source),join(store,'reference.sqlite3')]);
  const count=calls.length,bad=await run(f,b,'b-revoked',calls);assert.notEqual(bad.job.status,'completed');assert.equal(calls.length,count);assert.equal(bad.bundle.events.filter(e=>e.activity==='context_input_included').length,0);
  included(await run(f,a,'a-after-revoke',calls),a,'persona:a');assert.equal(calls.length,count+1);
});

test('catalogue: already-expired B grant denies without selecting A', {skip:!source}, async t=>{
  const fixtureValue=await fixture(t,true),f=await embedded(t,fixtureValue),calls=[];
  const a=await f.client.createAgent({name:'a',personaSourceId:'profile-a'}),b=await f.client.createAgent({name:'b',personaSourceId:'profile-b'});
  const bad=await run(f,b,'expired',calls);assert.notEqual(bad.job.status,'completed');assert.equal(calls.length,0);
  included(await run(f,a,'unexpired',calls),a,'persona:a');assert.equal(calls.length,1);
});

test('catalogue: closed shape, unique identities, semantic order, pins and snapshot substitution', {skip:!source}, async t=>{
  const f=await fixture(t), original=structuredClone(f.catalogue), host={hostId:f.hostId};
  const initial=await hostPersonaIdentity(host);
  f.catalogue.sources.reverse();f.save();assert.equal(await hostPersonaIdentity(host),initial);
  for(const mutate of [v=>v.extra=true,v=>v.host_id='other',v=>v.sources[0].extra=true,v=>v.sources[0].principal_ids.push('local-user'),
    v=>v.sources[0].profile_id=v.sources[1].profile_id,v=>v.sources[0].persona_id=v.sources[1].persona_id,v=>v.sources[0].store_instance_id=v.sources[1].store_instance_id,
    v=>v.sources[0].id='local',v=>v.sources[0].bridge.config=v.sources[1].bridge.config,v=>v.sources[0].bridge.store=v.sources[1].bridge.store,
    v=>v.sources[0].bridge_identity='a'.repeat(64),v=>v.sources[0].config_sha256='a'.repeat(64),v=>v.sources[0].principal_ids=[]]){
    const bad=structuredClone(original);mutate(bad);writeFileSync(f.path,JSON.stringify(bad));await assert.rejects(hostPersonaIdentity(host),/HOST_PERSONA_CATALOGUE_INVALID/);
  }
  writeFileSync(f.path,JSON.stringify(original));
  const bridge=await createHostPersona({...host,personaIdentity:initial,taskScope:async taskId=>({jobId:taskId,attemptId:'attempt:synthetic',organizationTaskId:'orgtask:synthetic',organizationSessionId:'org:synthetic'})});t.after(()=>bridge.close());
  const context={principal,agentId:'agent:synthetic',role:'synthetic'},a=await bridge.personaSources[0].create(context),b=await bridge.personaSources[1].create(context);
  const request={...context,sessionId:'session:synthetic',taskId:'job:synthetic',runId:'run:synthetic',signal:AbortSignal.timeout(4000)};
  const snapshot=await a.resolveContext(request);
  await assert.rejects(b.authorizeInput({...request,snapshot,requestId:'request:synthetic',attempt:1,inputDigest:'a'.repeat(64),fingerprintScope:'pi-logical-context/1',modelId:'faux',api:'faux'}),/HOST_PERSONA_SNAPSHOT_UNKNOWN/);
  const ownB=await b.resolveContext(request), authorization={...request,requestId:'request:current',attempt:1,inputDigest:'a'.repeat(64),fingerprintScope:'pi-logical-context/1',modelId:'faux',api:'faux'};
  python(f.executable,['-I','-B','-c','import sys;sys.path.insert(0,sys.argv[1]);from persona_substrate.provider import PolicyAdmin;PolicyAdmin(sys.argv[2]).revoke("grant:local-reference")',resolve(source),join(original.sources[1].bridge.store,'reference.sqlite3')]);
  await assert.rejects(b.authorizeInput({...authorization,snapshot:ownB}));
  await a.authorizeInput({...authorization,snapshot});

});

function tree(directory) {
  const result={};function walk(path,rel=''){for(const e of readdirSync(path,{withFileTypes:true})){const key=rel+e.name;if(e.isDirectory())walk(join(path,e.name),key+'/');else result[key]=sha(readFileSync(join(path,e.name)));}}walk(directory);return result;
}
test('catalogue launcher: closed ready2, actual fresh/resume, reorder stability and immutable substitution denial', {skip:!source}, async t=>{
  const f=await fixture(t),workspace=join(f.dir,'managed');
  const policy=createServer((_q,r)=>{r.writeHead(403);r.end();});policy.listen(0,'127.0.0.1');await once(policy,'listening');t.after(()=>new Promise(r=>policy.close(r)));
  const env={...process.env,PIDA_PERSONA_CATALOGUE:f.path,PIDA_SCHUMPETER_AUTH_URL:'http://127.0.0.1:'+policy.address().port+'/v1/pida-authorization',PIDA_SCHUMPETER_AUTH_TOKEN:'synthetic-policy-token-for-local-tests-only'};
  let active;
  async function launch(mode){
    const child=spawn(process.execPath,[join(root,'examples/schumpeter-host.mjs'),'--workspace',workspace,'--host-id',f.hostId,'--workspace-mode',mode,'--persona-module',join(root,'examples/vera-local-reference-catalogue.mjs')],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stderr='';child.stderr.on('data',b=>stderr+=b);const closed=new Promise(r=>child.once('close',r));
    const ready=new Promise((res,rej)=>{const timer=setTimeout(()=>{child.kill();rej(Error('READY_TIMEOUT'));},10000);child.once('error',rej);child.once('close',()=>{clearTimeout(timer);rej(Error(stderr.trim()));});
      createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);if(r.type==='pida-host-ready'){clearTimeout(timer);res(r);}});});
    active={ready,async close(){child.stdin.end();const timer=setTimeout(()=>child.kill(),6000);try{return await closed;}finally{clearTimeout(timer);}}};return active;
  }
  t.after(async()=>{await active?.close();});
  let h=await launch('fresh'),ready=await h.ready;
  assert.equal(Object.keys(ready).length,11);assert.equal(ready.protocol,'pida.local-host/2');assert.equal(ready.persona_mode,'vera-local-reference-catalogue/1');assert.equal(ready.execution_policy.id,'smoke/1');
  let client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});
  const a=await client.createAgent({name:'profile A',personaSourceId:'profile-a'}),b=await client.createAgent({name:'profile B',personaSourceId:'profile-b'});
  const org=await client.createOrganization({requestId:'catalogue-launcher',goal:'Synthetic reference check',agentId:b.id,participants:[b.id],criterionIds:[]});
  const job=await until(async()=>{const {jobs}=await client.listAgentJobs(b.id);return jobs.find(j=>!['queued','running'].includes(j.status));});assert.equal(job.status,'completed');
  included({job,org,bundle:await client.exportAgentJob(b.id,job.id)},b,'persona:b',2);
  assert.equal(await h.close(),0);active=null;
  const manifest=JSON.parse(readFileSync(join(workspace,'.pida-host.json')));
  assert.equal(manifest.execution_policy_id,'smoke/1');
  f.catalogue.sources.reverse();f.save();
  h=await launch('resume');ready=await h.ready;client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});
  assert.equal((await client.getAgent(a.id)).personaSourceId,'profile-a');assert.equal((await client.getAgent(b.id)).personaSourceId,'profile-b');assert.equal((await client.getAgentJob(b.id,job.id)).id,job.id);
  assert.equal(await h.close(),0);active=null;
  const before=tree(workspace),original=structuredClone(f.catalogue);
  for(const mutate of [v=>v.sources.pop(),v=>v.sources[0].label='new label',v=>v.sources[0].principal_ids=['foreign'],v=>v.sources[0].profile_id=randomUUID()]){
    const bad=structuredClone(original);mutate(bad);writeFileSync(f.path,JSON.stringify(bad));h=await launch('resume');await assert.rejects(h.ready,/HOST_RESUME_MISMATCH/);assert.equal(await h.close(),1);active=null;assert.deepEqual(tree(workspace),before);
  }
  writeFileSync(f.path,JSON.stringify(original));
  const target=original.sources[0],configBytes=readFileSync(target.bridge.config),config=JSON.parse(configBytes);config.persona.description='Changed reference';writeFileSync(target.bridge.config,JSON.stringify(config));
  h=await launch('resume');await assert.rejects(h.ready,/HOST_PERSONA_CATALOGUE_INVALID/);assert.equal(await h.close(),1);active=null;assert.deepEqual(tree(workspace),before);writeFileSync(target.bridge.config,configBytes);
  renameSync(target.bridge.store,target.bridge.store+'-original');python(f.executable,['-I','-B',f.entry,'init','--config',target.bridge.config,'--store',target.bridge.store]);
  h=await launch('resume');await assert.rejects(h.ready,/HOST_PERSONA_CATALOGUE_INVALID/);assert.equal(await h.close(),1);active=null;assert.deepEqual(tree(workspace),before);
  renameSync(target.bridge.store,target.bridge.store+'-replacement');renameSync(target.bridge.store+'-original',target.bridge.store);
  h=await launch('resume');ready=await h.ready;client=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});assert.equal((await client.getAgentJob(b.id,job.id)).id,job.id);assert.equal(await h.close(),0);active=null;
});
