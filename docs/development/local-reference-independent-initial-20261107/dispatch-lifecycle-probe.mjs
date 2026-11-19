import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHostPersona} from '../pida-reference-host-review-20261107/examples/vera-local-reference-persona.mjs';
import {PidaRuntime} from '../pida-reference-host-review-20261107/dist/runtime.js';

const require=createRequire(new URL('../pida-reference-host-review-20261107/package.json',import.meta.url));
const {Type}=await import(pathToFileURL(require.resolve('typebox')).href);
const {fauxProvider,fauxAssistantMessage:answer,fauxToolCall:call}=await import('../pida-reference-host-review-20261107/node_modules/@earendil-works/pi-ai/dist/providers/faux.js');
const root=await mkdtemp('D:/ChantaResearchGroup/pida-reference-host-review-evidence-20261107/lifecycle-');
const executable='C:/Users/migeo/AppData/Local/Programs/Python/Python311/python.exe';
const source='D:/ChantaResearchGroup/Vera-reference-review-runtime-r3-20261107';
const entry=join(source,'scripts/local_persona_bridge.py');
const principal={id:'owner:review',permissions:['fixture:read']},results=[];
const host={hostId:'host:review',taskScope:async jobId=>({jobId,attemptId:'attempt:review',organizationTaskId:'orgtask:review',organizationSessionId:'org:review'})};
for(const scenario of ['revoke','expire','missing-store','malformed-child']){
 const configPath=join(root,scenario+'.json'),store=join(root,scenario+'-store');
 const expires=Math.floor(Date.now()/1000)+(scenario==='expire'?3:600);
 const config={schema_version:'vera-local-reference/0.1.0',principal:'principal:review',host_id:host.hostId,project_id:'review',memory_scope:['project:review'],persona:{persona_id:'persona:review',name:'한글 🍇',description:'Review-only configured reference 🍇',source_refs:['document:review']},grant_expires_at:expires};
 await writeFile(configPath,JSON.stringify(config));
 Object.assign(process.env,{PIDA_PERSONA_BRIDGE_EXECUTABLE:executable,PIDA_PERSONA_BRIDGE_PREFIX_ARGS:JSON.stringify(['-I','-B',entry]),PIDA_PERSONA_BRIDGE_CONFIG:configPath,PIDA_PERSONA_BRIDGE_STORE:store});
 if(scenario!=='missing-store')execFileSync(executable,['-I','-B',entry,'init','--config',configPath,'--store',store]);
 if(scenario==='malformed-child'){
  const script=join(root,'malformed-child.mjs');await writeFile(script,"process.stdin.resume();process.stdout.write('not-json\\n');setInterval(()=>{},1000);\n");
  process.env.PIDA_PERSONA_BRIDGE_EXECUTABLE=process.execPath;process.env.PIDA_PERSONA_BRIDGE_PREFIX_ARGS=JSON.stringify([script]);
 }
 let bridge,runtime;const started=Date.now();
 try{
  bridge=await createHostPersona(host);
  assert.ok(!['missing-store','malformed-child'].includes(scenario),'bad startup accepted');
  const provider=await bridge.personaProvider({principal,agentId:'main',role:'review'}),f=fauxProvider({tokensPerSecond:100000});
  f.setResponses([answer(call('inspect',{}),{stopReason:'toolUse'}),answer('Must not reach this response.')]);
  runtime=new PidaRuntime({personaProvider:provider,provider:()=>({provider:f.provider,modelId:f.getModel().id}),autoCompaction:false,
   tools:[{name:'inspect',description:'Review-only negative boundary',parameters:Type.Object({}),permission:'fixture:read',effect:'read',execute:async()=>{
    if(scenario==='revoke')execFileSync(executable,['-I','-B','-c',"import sys;sys.path.insert(0,sys.argv[1]);from persona_substrate.provider import PolicyAdmin;PolicyAdmin(sys.argv[2]).revoke('grant:local-reference')",source,join(store,'reference.sqlite3')]);
    else await new Promise(r=>setTimeout(r,Math.max(0,expires*1000-Date.now()+50)));
    return {reviewed:true};}}]});
  const {sessionId}=await runtime.createSession(principal),result=await runtime.run(sessionId,principal,'Inspect the reference.');
  const bundle=runtime.exportRun(sessionId,result.runId,principal),included=bundle.events.filter(e=>e.activity==='context_input_included');
  assert.equal(result.code,'PERSONA_INPUT_NOT_AUTHORIZED');assert.equal(f.state.callCount,1);assert.equal(included.length,1);
  results.push({scenario,status:'PASS',modelCalls:f.state.callCount,inputReceipts:included.length,code:result.code,scope:'real producer and Pi; synthetic negative-test organization/attempt scope'});
 }catch(error){
  if(!['missing-store','malformed-child'].includes(scenario))throw error;
  assert.match(error.message,/HOST_PERSONA_PROCESS_CLOSED|HOST_PERSONA_RESPONSE_INVALID/);
  results.push({scenario,status:'PASS',code:error.message,elapsedMs:Date.now()-started});
 }finally{await runtime?.close();await bridge?.close();}
}
console.log(JSON.stringify(results,null,2));
