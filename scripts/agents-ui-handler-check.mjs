// DOM handler fixture only. This does not execute a browser or establish visual/browser correctness.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRunDetails } from '../examples/web/run-details.js';
const root = fileURLToPath(new URL('../', import.meta.url));
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.open=false;this.attrs={};this.classList={add(){}};}
 append(...nodes){for(const n of nodes)this.children.push(n);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=v;}
 querySelectorAll(tag){return this.children.flatMap(c=>[...(c.tagName===tag?[c]:[]),...(c.querySelectorAll?.(tag)??[])]);}
 reset(){}
 focus(){}
}
const nodes=new Map([...readFileSync(root+'/examples/web/index.html','utf8').matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Node()]));
const doc={getElementById:id=>{assert(nodes.has(id),'missing '+id);return nodes.get(id)},createElement:t=>new Node(t),createTextNode:t=>({textContent:t}),createDocumentFragment:()=>new Node('fragment'),hidden:false};
const storage=new Map();const profile={id:'a1',name:'Inspector',role:'review',paused:true,createdAt:new Date().toISOString()};
let profiles=[],jobs=[],memory={agentId:'a1',persona:null,personaHistory:[],experiences:[],head:null,states:[]},personaInput,stateInput,experienceInput,steerInput,reconcileInput,queuedRequests=[];
const clone=x=>structuredClone(x);
const client={
 listAgents:async()=>({agents:clone(profiles)}),getAgent:async()=>clone(profile),listAgentJobs:async()=>({jobs:clone(jobs)}),getAgentMemory:async()=>clone(memory),
 createAgent:async input=>{Object.assign(profile,input);profiles=[profile];return clone(profile)},
 enqueueAgentJob:async(id,input)=>{queuedRequests.push(clone(input));const job={id:'j1',agentId:id,input:input.input,status:'queued',activity:[],createdAt:new Date().toISOString()};jobs=[job];return clone(job)},
 pauseAgent:async()=>{profile.paused=true},resumeAgent:async()=>{profile.paused=false},cancelAgentJob:async()=>{jobs[0].status='cancelled'},
 reviseAgentPersona:async(id,input)=>{personaInput=clone(input);memory.persona={revision:1,text:input.text,sourceRefs:input.sourceRefs,updatedAt:new Date().toISOString()}},
 transitionAgentMemory:async(id,input)=>{stateInput=clone(input)},rememberAgentExperience:async(id,input)=>{experienceInput=clone(input)},
 steerAgentJob:async(...args)=>{steerInput=args},getAgentJobRecovery:async()=>({pendingEffects:[{id:'effect1',toolName:'project_write'}]}),
 reconcileAgent:async(id,input)=>{reconcileInput=clone(input);profile.needsReconciliation=false},getAgentWorkbench:async()=>({files:[]})
};
globalThis.document = doc;
const context={createRunDetails,document:doc,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:webcrypto,Date,setTimeout:()=>1,clearTimeout:()=>{},explainError:x=>x};
let source=readFileSync(root+'/examples/web/agents.js','utf8').replace(/^import .*\n/gm,'').replace('export function createAgents','function createAgents');
runInNewContext(source+'\nthis.createAgents=createAgents;',context);
const app=context.createAgents({client});await app.connect();const $=id=>nodes.get(id);const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};const submit=async id=>{$(id).onsubmit({preventDefault(){}});await flush()};
$('agent-name').value='Inspector';$('agent-role').value='review';await submit('agent-create-form');assert.equal($('agent-title').textContent,'Inspector');
$('agent-job-input').value='Read src and report';await submit('agent-job-form');assert.equal(queuedRequests.length,1);assert.match(queuedRequests[0].requestId,/^[\w-]{36}$/);assert.match($('agent-job-state').textContent,/대기/);
$('agent-persona-text').value='Check evidence';$('agent-persona-text').oninput();await submit('agent-persona-form');assert.equal(personaInput.expectedRevision,null);
$('agent-persona-text').value='Edit baseline';$('agent-persona-text').oninput();memory.persona.revision=2;$('agents-refresh').onclick();await flush();await submit('agent-persona-form');assert.equal(personaInput.expectedRevision,1,'retain edit baseline despite poll');
$('agent-state-goal').value='Goal';$('agent-state-understanding').value='Known';$('agent-state-next').value='Inspect';$('agent-state-form').oninput();memory.head='new-head';$('agents-refresh').onclick();await flush();await submit('agent-state-form');assert.equal(stateInput.expectedHead,null,'retain state edit baseline despite poll');
memory.head='relation-head';memory.states=[{id:'relation-head',revision:1,parentIds:[],sourceRefs:['user:test'],information:{goal:'Goal',understanding:'Known',uncertainties:[],nextAction:'Next',relationships:[{subject:'A',predicate:'uses',object:'B'}]},conflicts:{resolved:[],unresolved:[]}}];$('agents-refresh').onclick();await flush();$('agent-state-form').oninput();memory.head='later-head';$('agents-refresh').onclick();await flush();await submit('agent-state-form');assert.deepEqual(stateInput.information.relationships,[{subject:'A',predicate:'uses',object:'B'}],'preserve selected baseline relationships');
memory.experiences=[{id:'exp1',revision:1,kind:'fact',text:'old',status:'active',sourceRefs:['user:test']}];$('agents-refresh').onclick();await flush();$('agent-experience-kind').value='correction';$('agent-correction-target').value='exp1';$('agent-experience-text').value='corrected';await submit('agent-experience-form');assert.deepEqual(experienceInput.supersedes,['exp1']);
jobs[0].status='running';jobs[0].runId='run1';$('agents-refresh').onclick();await flush();$('agent-steer-text').value='Preserve tests';await submit('agent-steer-form');assert.deepEqual(steerInput,['a1','j1','Preserve tests','run1']);
profile.needsReconciliation=true;jobs[0].status='interrupted';$('agents-refresh').onclick();await flush();$('agent-recovery-load').onclick();await flush();assert.equal($('agent-recovery-save').disabled,true);$('agent-recovery-inspected').checked=true;const effect=$('agent-recovery-effects').querySelectorAll('select')[0];effect.value='not_applied';$('agent-recovery-form').oninput();assert.equal($('agent-recovery-save').disabled,false);await submit('agent-recovery-form');assert.deepEqual(reconcileInput.effects,[{id:'effect1',state:'not_applied'}]);assert.equal(profile.paused,true,'reconcile must not auto resume');
app.reset();assert.equal($('agent-detail').hidden,true);console.log('Agent UI handler smoke passed: create, persistent queue ID, memory CAS, steer, explicit recovery, reset. DOM mock; not browser E2E.');
