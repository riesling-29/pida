// DOM handler/projection regression checks. No browser engine or live model is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { RunState, submitQueuedInput } from '../examples/web/run-state.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const deferred = () => Promise.withResolvers();
const flush = async () => { for (let i=0;i<12;i++) await new Promise(resolve => setImmediate(resolve)); };
class Node {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.dataset={}; this.attrs={}; this.value=''; this.hidden=false; this.disabled=false; this.checked=false; this.open=false; this.style={}; this._text=''; this.clientWidth=1000; this.scrollHeight=0; this.scrollTop=0; this.clientHeight=0; this.classList={add(){},remove(){},toggle(){}}; }
  get textContent() { return this._text + this.children.map(x=>typeof x==='string'?x:x.textContent).join(''); }
  set textContent(text) { this.children=[]; this._text=String(text??''); }
  get options() { return this.children.filter(x=>x.tagName==='option'); }
  get selectedOptions() { return this.options.filter(x=>x.value===this.value); }
  get firstChild() { return this.children[0]; }
  get firstElementChild() { return this.children[0]; }
  append(...nodes) { this.children.push(...nodes); for(const n of nodes) if(typeof n==='object') n.parent=this; }
  replaceChildren(...nodes) { this._text=''; this.children=[]; this.append(...nodes); }
  remove() { if(this.parent) this.parent.children=this.parent.children.filter(x=>x!==this); }
  setAttribute(k,v) { this.attrs[k]=v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k]; }
  querySelectorAll(tag) { return this.children.flatMap(c=>typeof c==='object'?[...(c.tagName===tag?[c]:[]),...(c.querySelectorAll?.(tag)??[])]:[]); }
  querySelector(tag) { return this.querySelectorAll(tag)[0]??null; }
  focus(){} reset(){} close(){this.open=false;} showModal(){this.open=true;} click(){return this.onclick?.({preventDefault(){}});} requestSubmit(){return this.onsubmit?.({preventDefault(){}});}
}
function environment() {
  const nodes=new Map([...read('examples/web/index.html').matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Node()]));
  const $=id=>{assert(nodes.has(id),'Missing DOM element '+id);return nodes.get(id);};
  for(const id of ['workspace-input-mode','studio-input-mode']) { for(const value of ['steer','followUp']) { const o=new Node('option');o.value=value;$(id).append(o); } $(id).value='steer'; }
  const modeTabs=['studio','workspace','service','agents'].map(mode=>{const n=new Node('button');n.dataset.mode=mode;return n;});
  const doc={getElementById:$,createElement:t=>new Node(t),createTextNode:t=>({textContent:t}),body:new Node('body'),hidden:false,addEventListener(){},querySelector:selector=>modeTabs.find(n=>selector.includes(`data-mode="${n.dataset.mode}"`))??new Node(),querySelectorAll:selector=>selector.includes('#mode-tabs')?modeTabs:[]};
  const storage=new Map(), timers=new Map();let timer=0;
  const context={document:doc,RunState,submitQueuedInput,Date,Map,Set,URL,URLSearchParams,TextEncoder,Blob,crypto:webcrypto,console,explainError:x=>x??'',ResizeObserver:class{observe(){}},requestAnimationFrame:()=>{},setInterval:()=>1,clearInterval(){},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),window:{addEventListener(){}},location:{origin:'http://fixture.invalid',hash:'',pathname:'/',search:''},history:{replaceState(){}},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
  for(const [path,name] of [['run-input.js','createRunInput'],['run-details.js','createRunDetails']]) runInNewContext(read('examples/web/'+path).replace(/^import .*\n/gm,'').replace(`export function ${name}`,`function ${name}`)+`\nthis.${name}=${name};`,context);
  return {context,$,storage,timers,doc};
}
const row=(sequence,type,runId='r1')=>({sessionId:'s1',runId,sequence,type,timestamp:new Date().toISOString()});
const info={persistence:true,tools:[],provider:{mode:'endpoint',model:'fixture'},capabilities:{steering:true,followUp:true,queuedInputDurable:false}};
function fixtureClient() {
  const gate=deferred(); let active=false, traces=[]; const queue=[];
  const client={getInfo:async()=>info,getProviderSettings:async()=>{throw Object.assign(new Error('not configured'),{status:404});},getWorkbench:async()=>({files:[],skills:[],history:[],engine:'fixture',canCheckpoint:false}),listSessions:async()=>({sessions:[{sessionId:'s1',title:'fixture',updatedAt:new Date().toISOString(),running:active}]}),getSession:async()=>({sessionId:'s1',messages:[],running:active,activeRunId:active?'r1':undefined,lastStatus:active?undefined:'completed',pendingInput:{steering:0,followUp:0,durable:false}}),getTrace:async()=>({events:[...traces],activeRunId:active?'r1':undefined}),createSession:async()=>({sessionId:'s1'}),exportRun:async()=>({events:[],complete:true,manifest:{reported_status:'completed',verification_results:[]}}),getSessionTools:async()=>({items:[],historyScope:'retained-pi-context',truncated:false}),cancel:async()=>{},
    steer:async(...args)=>{queue.push(['steer',...args]);return {runId:args[2],mode:'steer',disposition:'queued',durable:false};},followUp:async(...args)=>{queue.push(['followUp',...args]);return {runId:args[2],mode:'followUp',disposition:'queued',durable:false};},
    async *stream(){active=true;traces=[row(1,'run_started'),{...row(2,'tool_started'),toolName:'project_shell',toolCallId:'call1'}];for(const trace of traces)yield {type:'trace',trace};await gate.promise;active=false;const end={...row(3,'run_finished'),status:'completed'};traces.push(end);yield {type:'trace',trace:end};yield {type:'result',result:{sessionId:'s1',runId:'r1',status:'completed',text:'actual result'}};}
  }; return {client,gate,queue};
}

test('shared input keeps replacement drafts and reports only accepted live queue receipts', async()=>{
  const env=environment(), run=new RunState('s1');run.acceptTrace(row(1,'run_started'));
  const wait=deferred(), calls=[];const client={steer:(...args)=>{calls.push(args);return wait.promise;}};
  const input=env.context.createRunInput({client,run,textarea:env.$('prompt'),selector:env.$('workspace-input-mode'),section:env.$('workspace-live-input'),note:env.$('workspace-input-note'),receipt:env.$('workspace-input-receipt'),changed(){},explain:x=>x});
  input.sync(info.capabilities);env.$('prompt').value='Preserve tests';const pending=input.submit();
  assert.deepEqual(calls,[['s1','Preserve tests','r1']]);env.$('prompt').value='New draft';
  wait.resolve({runId:'r1',mode:'steer',disposition:'queued',durable:false});await pending;
  assert.equal(env.$('prompt').value,'New draft');assert.match(env.$('workspace-input-receipt').textContent,/접수됨.*실행 완료를 뜻하지/);
  assert.match(env.$('workspace-input-note').textContent,/서버 재시작 시 유지되지/);
});

test('refusal and late cancellation preserve drafts; unsupported host capabilities disable sending', async()=>{
  const env=environment(),run=new RunState('s1');run.acceptTrace(row(1,'run_started'));const wait=deferred();
  const input=env.context.createRunInput({client:{steer:()=>wait.promise},run,textarea:env.$('prompt'),selector:env.$('workspace-input-mode'),section:env.$('workspace-live-input'),note:env.$('workspace-input-note'),receipt:env.$('workspace-input-receipt'),changed(){},explain:x=>x});
  input.sync({});assert.equal(input.canSubmit,false);input.sync(info.capabilities);env.$('workspace-input-mode').value='steer';env.$('prompt').value='Keep me';
  const pending=input.submit();run.cancel();wait.resolve({runId:'r1',mode:'steer',disposition:'queued',durable:false});await pending;
  assert.equal(env.$('prompt').value,'Keep me');assert.match(env.$('workspace-input-receipt').textContent,/상태가 바뀌었습니다/);
  run.cancelling=false;const deny=env.context.createRunInput({client:{steer:async()=>{throw {code:'RUN_NOT_ACCEPTING_INPUT'};}},run,textarea:env.$('prompt'),selector:env.$('workspace-input-mode'),section:env.$('workspace-live-input'),note:env.$('workspace-input-note'),receipt:env.$('workspace-input-receipt'),changed(){},explain:x=>x});deny.sync(info.capabilities);await deny.submit();
  assert.equal(env.$('prompt').value,'Keep me');assert.match(env.$('workspace-input-receipt').textContent,/접수하지 못했습니다.*RUN_NOT_ACCEPTING_INPUT/);
});

test('tool details are lazy, use recorded failure/exit code, and discard a late previous-run response', async()=>{
  const env=environment(),container=env.$('workspace-run-details'),wait=deferred();let reads=0;
  const details=env.context.createRunDetails({container,load:()=>{reads++;return wait.promise;},explain:x=>x});details.select('s1','r1');assert.equal(reads,0);
  container.open=true;container.ontoggle();assert.equal(reads,1);details.select('s1','r2');wait.resolve({items:[{runId:'r1',toolName:'old',status:'completed',output:'stale private text'}]});await flush();assert.doesNotMatch(container.textContent,/stale private text/);
  const actual=env.context.createRunDetails({container,load:async()=>({items:[{runId:'r2',toolName:'project_shell',status:'completed',command:'npm test',exitCode:1,output:'<script>not markup</script>',truncated:true},{runId:'other',toolName:'other',status:'completed',output:'unrelated'}],truncated:false}),explain:x=>x});actual.select('s1','r2');container.open=true;container.ontoggle();await flush();
  assert.match(container.textContent,/도구 실패 · 종료 코드 1/);assert.match(container.textContent,/<script>not markup<\/script>/);assert.doesNotMatch(container.textContent,/unrelated/);assert.match(container.textContent,/일부 출력/);assert.match(container.textContent,/검증 완료를 뜻하지/);
});

test('workspace actual submit handler steers/follows the active run and preserves a draft at completion', async()=>{
  const env=environment(),f=fixtureClient();
  Object.assign(env.context,{PidaClient:class{constructor(){return f.client;}},createStudio:()=>({busy:false,update(){},async connect(){},async refresh(){},reset(){}}),createAgents:()=>({async connect(){},reset(){}})});
  runInNewContext(read('examples/web/app.js').replace(/^import .*\n/gm,''),env.context);
  env.$('token').value='fixture';env.$('connection-form').requestSubmit();await flush();assert.equal(env.$('send').disabled,false,env.$('error').textContent);
  env.$('prompt').value='Run tests';const execution=env.$('form').requestSubmit();await flush();assert.equal(env.$('prompt').disabled,false);assert.equal(env.$('prompt').value,'');assert.equal(env.$('workspace-live-input').hidden,false);
  env.$('prompt').value='Preserve public API';await env.$('form').requestSubmit();assert.deepEqual(f.queue[0],['steer','s1','Preserve public API','r1']);assert.match(env.$('workspace-input-receipt').textContent,/접수됨/);
  env.$('workspace-input-mode').value='followUp';env.$('prompt').value='Then check docs';await env.$('form').requestSubmit();assert.deepEqual(f.queue[1],['followUp','s1','Then check docs','r1']);
  env.$('prompt').value='Unsent next task';f.gate.resolve();await execution;assert.equal(env.$('prompt').value,'Unsent next task');assert.match(env.$('messages').textContent,/actual result/);
});

test('Studio actual handler allows run-correlated instructions and keeps a newer draft after completion', async()=>{
  const env=environment(),f=fixtureClient();
  runInNewContext(read('examples/web/studio.js').replace(/^import .*\n/gm,'').replace('export function createStudio','function createStudio')+'\nthis.createStudio=createStudio;',env.context);
  const studio=env.context.createStudio({client:f.client,request:async()=>({html:'',revision:'base',templates:[]}),changed(){},disconnected(){}});await studio.connect(info);
  env.$('studio-target-mode').value='files';env.$('studio-target-mode').onchange();await flush();
  env.$('studio-prompt').value='Implement sum';const execution=env.$('studio-form').requestSubmit();await flush();assert.equal(env.$('studio-prompt').disabled,false);assert.equal(env.$('studio-prompt').value,'');
  env.$('studio-prompt').value='Preserve comments';await env.$('studio-form').requestSubmit();assert.deepEqual(f.queue[0],['steer','s1','Preserve comments','r1']);assert.match(env.$('studio-input-receipt').textContent,/접수됨/);
  env.$('studio-prompt').value='Draft while working';f.gate.resolve();await execution;assert.equal(env.$('studio-prompt').value,'Draft while working');assert.match(env.$('studio-messages').textContent,/actual result/);assert.equal(env.$('studio-live-input').hidden,true);
});

test('provider form preserves a native model whose only supported thinking level is high', async()=>{
  const env=environment(),f=fixtureClient();
  f.client.getProviderSettings=async()=>({provider:{kind:'native',providerId:'openai',modelId:'restricted'},catalog:[{id:'openai',name:'OpenAI',apiKeyEnv:'OPENAI_API_KEY',models:[{id:'restricted',name:'restricted',reasoning:true,thinkingLevels:['high']}]}]});
  Object.assign(env.context,{PidaClient:class{constructor(){return f.client;}},createStudio:()=>({busy:false,update(){},async connect(){},async refresh(){},reset(){}}),createAgents:()=>({async connect(){},reset(){}})});
  runInNewContext(read('examples/web/app.js').replace(/^import .*\n/gm,''),env.context);
  env.$('token').value='fixture';await env.$('connection-form').requestSubmit();await flush();
  assert.equal(env.$('provider-thinking').value,'high');
  assert.deepEqual(env.$('provider-thinking').options.map(x=>x.value),['high']);
  assert.equal(runInNewContext('providerDraft().thinkingLevel',env.context),'high');
  env.$('native-model-select').onchange();assert.equal(env.$('provider-thinking').value,'high');
});
