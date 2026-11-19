import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fauxProvider,fauxAssistantMessage as answer,fauxToolCall as call} from '@earendil-works/pi-ai/providers/faux';
import {providerRejectionCode} from '../dist/provider-diagnostic.js';
import {PidaRuntime} from '../dist/runtime.js';
import {lotStatusTool} from '../dist/tools.js';
import {AgentSupervisor} from '../dist/agent-supervisor.js';
import {validateObservationBundle} from '../dist/integration-contract.js';
const quota='The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.';
const owner={id:'diagnostic-owner',permissions:['pida:agents','lots:read']};
const pause=()=>new Promise(r=>setTimeout(r,10));
function provider(steps){const f=fauxProvider({provider:'openai',api:'openai-responses',tokensPerSecond:100000});f.setResponses(steps);return f;}
function factory(f){return ()=>({provider:f.provider,modelId:f.getModel().id});}

test('classification is fixed, provider-reported, exact family only and never abort/success',()=>{
  const error={provider:'openai',api:'openai-responses',stopReason:'error',errorMessage:quota};
  assert.equal(providerRejectionCode(error),'PROVIDER_SUBSCRIPTION_SHARING_LIMIT');
  for(const value of [{...error,provider:'other'},{...error,api:'other'},{...error,errorMessage:quota+' SECRET-private'},
    {...error,errorMessage:{quota:true}},{...error,errorMessage:'Bearer SECRET-private'},{...error,errorMessage:'x'.repeat(5000)}])
    assert.equal(providerRejectionCode(value),'PROVIDER_REJECTED');
  for(const stopReason of ['stop','toolUse','aborted',undefined]) assert.equal(providerRejectionCode({...error,stopReason}),undefined);
});

test('actual native persisted error retains guard, zero unknowns and one safe terminal trace across reopen',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'pida-diag-')),f=provider([()=>{throw Error(quota);},()=>answer(call('get_lot_status',{lotId:'unexpected'}),{stopReason:'toolUse'})]);
  let toolCalls=0;
  let s=await AgentSupervisor.open({directory,resolvePrincipal:()=>owner,createRuntime:p=>new PidaRuntime({agentId:p.id,storageDir:join(directory,p.id),provider:factory(f),maxProviderRetries:0,maxOutputRetries:0,maxTotalTokens:16384,tools:[{...lotStatusTool,execute:async()=>{toolCalls++;return {};}}]})});
  t.after(()=>s.close());const agent=s.register(owner,{name:'root'});const org=s.createOrganization(owner,{requestId:'diagnostic-quota',goal:'Synthetic task',agentId:agent.id,participants:[agent.id],criterionIds:[]});s.start();
  let job;for(let n=0;n<300;n++){job=s.jobs(agent.id,owner)[0];if(job&& !['queued','running'].includes(job.status))break;await pause();}
  assert.equal(job.status,'limited');assert.equal(job.code,'USAGE_UNAVAILABLE');assert.equal(job.result.text,'');assert.equal(f.state.callCount,1);assert.equal(toolCalls,0);
  const trace=job.activity.filter(e=>e.type==='provider_rejected');assert.equal(trace.length,1);
  assert.deepEqual(Object.keys(trace[0]).sort(),['code','runId','sequence','sessionId','timestamp','type']);
  assert.equal(trace[0].runId,job.runId);assert.equal(trace[0].sessionId,job.sessionId);assert.equal(trace[0].code,'PROVIDER_SUBSCRIPTION_SHARING_LIMIT');
  const runtime=await s.getRuntime(agent.id,owner),bundle=runtime.exportRun(job.sessionId,job.runId,owner);
  assert.equal(validateObservationBundle(bundle).valid,true);
  const response=bundle.events.find(e=>e.activity==='model_response'),terminal=bundle.events.find(e=>e.activity==='provider_rejected');
  assert.equal(response.payload.code,trace[0].code);assert.equal(response.payload.usage_status,'unknown');assert.equal(response.payload.tokens,null);
  assert.equal(terminal.payload.request_id,response.payload.request_id);assert.equal(terminal.payload.attempt,response.payload.attempt);
  assert.ok(!JSON.stringify([job,bundle]).includes(quota));
  assert.equal((await s.getOrganization(org.id,owner)).organization.status,'unknown');
  await s.close();s=await AgentSupervisor.open({directory,resolvePrincipal:()=>owner,createRuntime:()=>{throw Error('NO_REEXECUTION');}});
  assert.deepEqual(s.getJob(job.id,owner).activity.filter(e=>e.type==='provider_rejected'),trace);assert.equal(f.state.callCount,1);
});

test('unrecognized secret error never enters result, trace or bundle and remains generic',async t=>{
  const secret='Bearer SECRET-private-token path=C:/private response_body={sensitive:true}',f=provider([()=>{throw Error(secret);}]);
  const r=new PidaRuntime({provider:factory(f),maxProviderRetries:0,maxOutputRetries:0,maxTotalTokens:100});t.after(()=>r.close());
  const {sessionId}=await r.createSession(owner),result=await r.run(sessionId,owner,'Synthetic'),bundle=r.exportRun(sessionId,result.runId,owner);
  assert.equal(result.code,'USAGE_UNAVAILABLE');assert.equal(result.text,'');assert.equal(f.state.callCount,1);
  assert.equal(bundle.events.find(e=>e.activity==='provider_rejected').payload.code,'PROVIDER_REJECTED');
  assert.ok(!JSON.stringify([result,r.getTrace(sessionId,owner),bundle]).includes('SECRET-private'));
});

test('recovered provider retry leaves only historical response diagnosis, no terminal rejection',async t=>{
  const f=provider([()=>{throw Error('429 rate limit exceeded');},()=>answer('Recovered')]);
  const r=new PidaRuntime({provider:factory(f),maxProviderRetries:1,retryBaseDelayMs:0,retryMaxDelayMs:0,maxOutputRetries:0});t.after(()=>r.close());
  const {sessionId}=await r.createSession(owner),result=await r.run(sessionId,owner,'Synthetic'),bundle=r.exportRun(sessionId,result.runId,owner);
  assert.equal(result.status,'completed');assert.equal(result.text,'Recovered');assert.equal(f.state.callCount,2);
  assert.ok(bundle.events.some(e=>e.activity==='model_response'&&e.payload.code==='PROVIDER_REJECTED'));
  assert.equal(bundle.events.filter(e=>e.activity==='provider_rejected').length,0);
});
