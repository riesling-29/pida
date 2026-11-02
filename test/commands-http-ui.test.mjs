// Real HTTP/SDK + CommandManager + owned Pi sessions. Process timing is deterministic; no live LLM/browser is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { CommandManager } from '../dist/commands.js';
import { PidaRuntime, PidaError } from '../dist/runtime.js';
import { PidaClient } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';

const owner = { id: 'command-owner', permissions: ['project:read', 'project:execute', 'pida:recover', 'pida:agents'] };
const tokens = { owner: 'a'.repeat(32), reader: 'r'.repeat(32), executor: 'e'.repeat(32), recovery: 'v'.repeat(32), none: 'n'.repeat(32), other: 'b'.repeat(32) };
const principals = {
  owner,
  reader: { id: owner.id, permissions: ['project:read', 'pida:agents'] },
  executor: { id: owner.id, permissions: ['project:execute', 'pida:agents'] },
  recovery: { id: owner.id, permissions: ['project:read', 'pida:recover', 'pida:agents'] },
  none: { id: owner.id, permissions: ['pida:agents'] },
  other: { ...owner, id: 'other-owner' },
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const error = (code, status) => value => value.code === code && value.status === status;

async function fixture(t, { providerUnavailableAfterRestart = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pida-command-http-')), root = join(directory, 'project');
  await mkdir(root);
  const executions = new Map();
  const manager = new CommandManager({ root, stateDirectory: join(directory, 'commands'), maxConcurrent: 8, defaultDeadlineMs: 10000, executor: {
    capabilities: { backend: 'deterministic-test', platform: process.platform, pty: false, stdin: false, sandboxModes: ['none'], containment: 'test-controlled', rangeExitVerification: false, outputStreams: 'combined' },
    execute(request) {
      const result = Promise.withResolvers();
      executions.set(request.command, { request, finish: (exitCode=0) => result.resolve({ exitCode, directExited: true, rangeExited: 'unknown' }) });
      request.onData(Buffer.from('FIRST 가😀\n'));
      request.signal.addEventListener('abort', () => result.resolve({ exitCode: null, error: 'COMMAND_CANCELLED', directExited: true, rangeExited: 'unknown' }), { once: true });
      return result.promise;
    },
  } });
  const model = fauxProvider();
  let providerCalls = 0, agentRuntimeCalls = 0;
  const persistence = providerUnavailableAfterRestart ? { storageDir: join(directory, 'sessions') } : {};
  let runtime = new PidaRuntime({ ...persistence, provider: () => ({ provider: model.provider, modelId: model.getModel().id }) });
  const sessionId = (await runtime.createSession(owner)).sessionId;
  const secondSessionId = (await runtime.createSession(owner)).sessionId;
  let beforeRestartCommand;
  if (providerUnavailableAfterRestart) {
    beforeRestartCommand = manager.start(owner, { sessionId, runId: randomUUID(), command: 'before-runtime-restart' });
    await runtime.close();
    runtime = new PidaRuntime({ ...persistence, provider: () => { providerCalls++; throw new Error('provider unavailable after restart'); } });
  }
  const agentId = randomUUID(), otherAgentId = randomUUID();
  const jobs = [0,1].map(() => ({ id: randomUUID(), agentId, owner: owner.id, sessionId, runId: randomUUID(), status: 'completed' }));
  const unrelatedJob = { id: randomUUID(), agentId: otherAgentId, owner: owner.id, sessionId: secondSessionId, runId: randomUUID(), status: 'completed' };
  const allJobs = [...jobs, unrelatedJob];
  const agents = {
    get(id, principal) { if (principal.id !== owner.id || ![agentId, otherAgentId].includes(id)) throw new PidaError('AGENT_NOT_FOUND', 404); return { id, owner: owner.id }; },
    getJob(id, principal) { const job=allJobs.find(j=>j.id===id && j.owner===principal.id); if(!job) throw new PidaError('AGENT_JOB_NOT_FOUND',404); return job; },
    async getRuntime() { agentRuntimeCalls++; throw new Error('command access must not construct an agent model runtime'); },
  };
  const server = createPidaServer({ runtime, commands: manager, agents, authenticate: staticTokenAuth(Object.entries(tokens).map(([name,token])=>({ token, principal: principals[name] }))) });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clients = Object.fromEntries(Object.entries(tokens).map(([name,token])=>[name,new PidaClient({baseUrl,token:()=>token})]));
  const request = (path, options={}, identity='owner') => fetch(baseUrl+path,{...options,headers:{Authorization:`Bearer ${tokens[identity]}`,...(options.body?{'Content-Type':'application/json'}:{})}});
  const start = (command, targetSession=sessionId, runId=jobs[0].runId) => manager.start(owner,{sessionId:targetSession,runId,command});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await manager.close();await runtime.close();await rm(directory,{recursive:true,force:true});});
  return {manager,runtime,sessionId,secondSessionId,agentId,otherAgentId,jobs,unrelatedJob,executions,clients,request,start,beforeRestartCommand,providerCalls:()=>providerCalls,agentRuntimeCalls:()=>agentRuntimeCalls};
}

test('HTTP command list/read/wait preserve session ownership and independent output cursors without starting work', {timeout:15000}, async t=>{
  const f=await fixture(t), command=f.start('read-observers');
  const listing=await f.clients.owner.listCommands(f.sessionId);
  assert.deepEqual(listing.commands.map(c=>c.id),[command.id]);assert.equal(listing.capabilities.restartExecution,false);assert.equal(listing.capabilities.pty,false);
  assert.deepEqual(listing.permissions,{cancel:true,recover:true});
  const [a,b]=await Promise.all([f.clients.owner.readCommand(f.sessionId,command.id,{offset:0,maxBytes:64}),f.clients.reader.readCommand(f.sessionId,command.id,{offset:0,maxBytes:64})]);
  assert.equal(a.output.text,'FIRST 가😀\n');assert.deepEqual(a.output,b.output);
  assert.equal((await f.clients.owner.listCommands(f.secondSessionId)).commands.length,0);
  await assert.rejects(f.clients.owner.readCommand(f.secondSessionId,command.id),error('COMMAND_NOT_FOUND',404));
  await assert.rejects(f.clients.other.listCommands(f.sessionId),error('SESSION_NOT_FOUND',404));
  await assert.rejects(f.clients.other.readCommand(f.sessionId,command.id),error('SESSION_NOT_FOUND',404));
  const expired=await f.clients.reader.waitCommand(f.sessionId,command.id,{waitTimeoutMs:5});assert.equal(expired.waitExpired,true);assert.equal(expired.command.status,'running');
  const abort=new AbortController(), waiting=f.clients.owner.waitCommand(f.sessionId,command.id,{waitTimeoutMs:5000,signal:abort.signal});await pause(10);abort.abort();await assert.rejects(waiting,{name:'AbortError'});
  assert.equal(f.manager.read(owner,f.sessionId,command.id).command.status,'running','closing an observer never cancels the command');
  const before=f.executions.size;
  for(const path of [`/v1/sessions/${f.sessionId}/commands`,`/v1/sessions/${f.sessionId}/commands/start`]) { const response=await f.request(path,{method:'POST',body:JSON.stringify({command:'never execute'})});assert.ok([404,405].includes(response.status)); }
  assert.equal(f.executions.size,before);assert.equal('startCommand' in f.clients.owner,false);
  f.executions.get('read-observers').request.onData(Buffer.from('LAST\n'));f.executions.get('read-observers').finish();
  const done=await f.clients.owner.waitCommand(f.sessionId,command.id,{waitTimeoutMs:1000});assert.equal(done.command.status,'completed');assert.equal(done.waitExpired,false);assert.equal(done.command.exitCode,0);
  const tail=await f.clients.reader.readCommand(f.sessionId,command.id,{offset:a.output.nextOffset,maxBytes:64});assert.equal(tail.output.text,'LAST\n');assert.equal(tail.output.eof,true);
  assert.equal((await f.clients.owner.readCommand(f.sessionId,command.id,{offset:0,maxBytes:64})).output.text,'FIRST 가😀\nLAST\n');
});

test('HTTP command operations enforce read, execute and explicit inspected recovery separately', {timeout:15000}, async t=>{
  const f=await fixture(t), command=f.start('permission-cancel'), base=`/v1/sessions/${f.sessionId}/commands/${command.id}`;
  assert.deepEqual((await f.clients.reader.listCommands(f.sessionId)).permissions,{cancel:false,recover:false});
  await assert.rejects(f.clients.none.listCommands(f.sessionId),error('FORBIDDEN',403));
  await assert.rejects(f.clients.executor.readCommand(f.sessionId,command.id),error('FORBIDDEN',403));
  await assert.rejects(f.clients.reader.cancelCommand(f.sessionId,command.id),error('FORBIDDEN',403));
  await assert.rejects(f.clients.owner.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true}),error('COMMAND_STILL_RUNNING',409));
  for(const body of [{},{inspected:false},{inspected:'true'}]) {const response=await f.request(base+'/recovery',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,400);assert.equal((await response.json()).error,'COMMAND_INSPECTION_REQUIRED');}
  const cancel=await f.clients.executor.cancelCommand(f.sessionId,command.id);assert.equal(cancel.disposition,'requested');assert.equal(cancel.command.status,'stopping');
  const settled=await f.clients.owner.waitCommand(f.sessionId,command.id,{waitTimeoutMs:1000});assert.equal(settled.command.status,'cancelled');assert.equal(settled.command.requiresRecovery,true);assert.equal(settled.command.rangeExited,'unknown');
  await assert.rejects(f.clients.reader.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true}),error('FORBIDDEN',403));
  await assert.rejects(f.clients.executor.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true}),error('FORBIDDEN',403));
  await assert.rejects(f.clients.recovery.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true}),error('FORBIDDEN',403));
  const recovered=await f.clients.owner.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true});assert.equal(recovered.command.requiresRecovery,false);assert.equal(recovered.command.recoveryAcknowledged,true);assert.equal(recovered.command.status,'cancelled');
  assert.equal((await f.clients.owner.cancelCommand(f.sessionId,command.id)).disposition,'already_finished');assert.equal(f.executions.size,1);
});

test('command HTTP query parsing rejects fractional, repeated, unsafe and unknown integer inputs', {timeout:15000}, async t=>{
  const f=await fixture(t), command=f.start('queries'), base=`/v1/sessions/${f.sessionId}/commands/${command.id}`;
  const paths=[base+'?offset=-1',base+'?offset=1.5',base+'?offset=1e3',base+'?offset=',base+'?offset=0&offset=1',base+'?offset=9007199254740992',base+'?maxBytes=3',base+'?maxBytes=16385',base+'?unknown=1',base+'/wait?waitTimeoutMs=0',base+'/wait?waitTimeoutMs=30001',base+'/wait?waitTimeoutMs=1&waitTimeoutMs=2',base+'/wait?offset=0',`/v1/sessions/${f.sessionId}/commands?offset=0`];
  for(const path of paths) {const response=await f.request(path);assert.equal(response.status,400,path);assert.equal((await response.json()).error,'COMMAND_ARGUMENT_INVALID',path);}
  assert.equal(f.executions.size,1);assert.equal(f.manager.read(owner,f.sessionId,command.id).command.status,'running');
  f.executions.get('queries').finish();
});

test('agent job command routes isolate run IDs even when two jobs share one owned session', {timeout:15000}, async t=>{
  const f=await fixture(t), [job,otherJob]=f.jobs;
  const first=f.start('job-one',f.sessionId,job.runId),second=f.start('job-two',f.sessionId,otherJob.runId);
  const outside=f.start('other-session',f.secondSessionId,f.unrelatedJob.runId);
  const list=await f.clients.owner.listAgentJobCommands(f.agentId,job.id);assert.deepEqual(list.commands.map(c=>c.id),[first.id]);
  assert.deepEqual((await f.clients.owner.listAgentJobCommands(f.agentId,otherJob.id)).commands.map(c=>c.id),[second.id]);
  assert.equal((await f.clients.reader.readAgentJobCommand(f.agentId,job.id,first.id,{offset:0,maxBytes:32})).command.runId,job.runId);
  assert.equal((await f.clients.owner.waitAgentJobCommand(f.agentId,job.id,first.id,{waitTimeoutMs:5})).waitExpired,true);
  for(const call of [()=>f.clients.owner.readAgentJobCommand(f.agentId,job.id,second.id),()=>f.clients.owner.waitAgentJobCommand(f.agentId,job.id,second.id,{waitTimeoutMs:5}),()=>f.clients.owner.cancelAgentJobCommand(f.agentId,job.id,second.id),()=>f.clients.owner.acknowledgeAgentJobCommandRecovery(f.agentId,job.id,second.id,{inspected:true}),()=>f.clients.owner.readAgentJobCommand(f.agentId,job.id,outside.id)]) await assert.rejects(call,error('COMMAND_NOT_FOUND',404));
  await assert.rejects(f.clients.other.listAgentJobCommands(f.agentId,job.id),error('AGENT_NOT_FOUND',404));
  await assert.rejects(f.clients.owner.listAgentJobCommands(f.otherAgentId,job.id),value=>value.status===404);
  await assert.rejects(f.clients.executor.cancelAgentJobCommand(f.agentId,job.id,first.id),error('FORBIDDEN',403));
  assert.equal((await f.clients.owner.cancelAgentJobCommand(f.agentId,job.id,first.id)).disposition,'requested');
  const done=await f.clients.owner.waitAgentJobCommand(f.agentId,job.id,first.id,{waitTimeoutMs:1000});assert.equal(done.command.status,'cancelled');
  await assert.rejects(f.clients.reader.acknowledgeAgentJobCommandRecovery(f.agentId,job.id,first.id,{inspected:true}),error('FORBIDDEN',403));
  assert.equal((await f.clients.owner.acknowledgeAgentJobCommandRecovery(f.agentId,job.id,first.id,{inspected:true})).command.requiresRecovery,false);
  assert.equal(f.manager.read(owner,f.sessionId,second.id).command.status,'running');
  assert.equal(f.manager.read(owner,f.secondSessionId,outside.id).command.status,'running');assert.equal(f.executions.size,3);
  assert.equal(f.agentRuntimeCalls(),0,'agent command operations never construct a model runtime');
  f.executions.get('job-two').finish();f.executions.get('other-session').finish();
});

test('persisted session commands remain readable, cancellable and recoverable after restart with an unavailable provider', {timeout:15000}, async t=>{
  const f=await fixture(t,{providerUnavailableAfterRestart:true}), command=f.beforeRestartCommand;
  assert.equal(f.providerCalls(),0);
  assert.deepEqual((await f.clients.owner.listCommands(f.sessionId)).commands.map(c=>c.id),[command.id]);
  assert.equal((await f.clients.owner.readCommand(f.sessionId,command.id)).output.text,'FIRST 가😀\n');
  assert.equal((await f.clients.owner.waitCommand(f.sessionId,command.id,{waitTimeoutMs:5})).waitExpired,true);
  await assert.rejects(f.clients.other.listCommands(f.sessionId),error('SESSION_NOT_FOUND',404));
  await assert.rejects(f.clients.other.cancelCommand(f.sessionId,command.id),error('SESSION_NOT_FOUND',404));
  await assert.rejects(f.clients.other.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true}),error('SESSION_NOT_FOUND',404));
  await assert.rejects(f.clients.owner.readCommand(f.secondSessionId,command.id),error('COMMAND_NOT_FOUND',404));
  assert.equal((await f.clients.owner.cancelCommand(f.sessionId,command.id)).disposition,'requested');
  assert.equal((await f.clients.owner.waitCommand(f.sessionId,command.id,{waitTimeoutMs:1000})).command.status,'cancelled');
  assert.equal((await f.clients.owner.acknowledgeCommandRecovery(f.sessionId,command.id,{inspected:true})).command.requiresRecovery,false);
  const job=f.jobs[0], agentCommand=f.start('agent-without-provider',f.sessionId,job.runId);
  assert.deepEqual((await f.clients.owner.listAgentJobCommands(f.agentId,job.id)).commands.map(c=>c.id),[agentCommand.id]);
  assert.equal((await f.clients.owner.readAgentJobCommand(f.agentId,job.id,agentCommand.id)).output.text,'FIRST 가😀\n');
  await assert.rejects(f.clients.other.listAgentJobCommands(f.agentId,job.id),error('AGENT_NOT_FOUND',404));
  await assert.rejects(f.clients.owner.cancelAgentJobCommand(f.agentId,f.jobs[1].id,agentCommand.id),error('COMMAND_NOT_FOUND',404));
  assert.equal((await f.clients.owner.cancelAgentJobCommand(f.agentId,job.id,agentCommand.id)).disposition,'requested');
  assert.equal((await f.clients.owner.waitAgentJobCommand(f.agentId,job.id,agentCommand.id,{waitTimeoutMs:1000})).command.status,'cancelled');
  assert.equal((await f.clients.owner.acknowledgeAgentJobCommandRecovery(f.agentId,job.id,agentCommand.id,{inspected:true})).command.requiresRecovery,false);
  assert.equal(f.providerCalls(),0,'owned archive checks never instantiate the failed provider');
  assert.equal(f.agentRuntimeCalls(),0,'owned job checks never instantiate the failed agent runtime');
});

// DOM event-handler regression tests execute the shipped module with a small DOM double.
// They do not claim browser rendering or live-model verification.
class Element {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.dataset={}; this.attributes={}; this.hidden=false; this.disabled=false; this.checked=false; this.open=false; this.value=''; this._text=''; this.classList={add(){}}; }
  get textContent() { return this._text + this.children.map(child=>child.textContent).join(''); }
  set textContent(value) { this._text=String(value??''); this.children=[]; }
  append(...children) { this.children.push(...children); for(const child of children) child.parent=this; }
  replaceChildren(...children) { this._text=''; this.children=[]; this.append(...children); }
  setAttribute(key,value) { this.attributes[key]=value; }
  closest(selector) { for(let node=this;node;node=node.parent) if(selector==='[hidden]'&&node.hidden) return node; return null; }
  descendants() { return this.children.flatMap(child=>[child,...child.descendants()]); }
}
const flush = async()=>{for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve));};
const commandView=(id='cmd_a',rest={})=>({id,sessionId:'s1',runId:'r1',commandPreview:'npm test',status:'running',createdAt:'2026-11-02T01:00:00Z',deadlineAt:'2026-11-02T01:01:00Z',exitCode:null,backend:'fixture',directExited:false,rangeExited:'unknown',requiresRecovery:false,recoveryAcknowledged:false,...rest});
const listing=(command,permissions={cancel:true,recover:true})=>({commands:[command],permissions,capabilities:{backend:'fixture',pty:false,stdin:false,restartExecution:false}});
const outputChunk=(command,{text='',offset=0,nextOffset=offset,totalBytes=nextOffset,eof=true,lossy=false}={})=>({command,output:{text,offset,nextOffset,totalBytes,eof,lossy,stream:'combined'}});
async function uiFixture(callbacks={}) {
  const document={hidden:false,createElement:tag=>new Element(tag),addEventListener(){}};
  const timers=new Map();let timerId=0;
  const context={document,Date,Map,Set,console,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
  const source=await readFile(new URL('../examples/web/commands.js',import.meta.url),'utf8');
  runInNewContext(source.replace('export function createCommands','function createCommands')+'\nthis.createCommands=createCommands;',context);
  const container=new Element('details');
  const panel=context.createCommands({container,list:async()=>listing(commandView()),read:async(_identity,id)=>outputChunk(commandView(id)),cancel:async()=>{throw new Error('unexpected cancel');},recover:async()=>{throw new Error('unexpected recovery');},...callbacks});
  const action=name=>{const element=container.descendants().find(node=>node.dataset.commandAction===name);assert.ok(element,'missing action '+name);return element;};
  const output=()=>container.descendants().find(node=>node.attributes['aria-label']==='명령 출력').textContent;
  const open=async()=>{container.open=true;container.ontoggle();await flush();};
  return {panel,container,document,timers,action,output,open};
}

test('command panel loads only when expanded and discards an earlier session response',async()=>{
  const stale=Promise.withResolvers(),calls=[];
  const ui=await uiFixture({list:identity=>{calls.push(['list',identity]);return identity==='old'?stale.promise:Promise.resolve(listing(commandView('new-command',{commandPreview:'new command'})));},read:async(identity,id,options)=>{calls.push(['read',identity,id,options.offset]);return outputChunk(commandView(id,{commandPreview:'new command'}),{text:'CURRENT',nextOffset:7});}});
  ui.panel.select('old');assert.equal(calls.length,0);assert.equal(ui.container.open,false);assert.equal(ui.container.hidden,false);
  ui.container.open=true;ui.container.ontoggle();assert.deepEqual(calls,[['list','old']]);
  ui.panel.select('new');assert.equal(ui.container.open,false);
  stale.resolve(listing(commandView('private-old',{commandPreview:'old private command'})));await flush();assert.doesNotMatch(ui.container.textContent,/old private command/);assert.equal(calls.length,1);
  await ui.open();assert.deepEqual(calls.map(call=>call.slice(0,2)),[['list','old'],['list','new'],['read','new']]);assert.equal(ui.output(),'CURRENT');
  assert.match(ui.container.textContent,/PTY 미지원/);assert.match(ui.container.textContent,/서버 재시작 후 프로세스 재개 미지원/);assert.match(ui.container.textContent,/명령 종료는 작업 검증 완료와 별개/);
  ui.panel.select('new',{enabled:false});assert.equal(ui.container.hidden,true);await ui.open();assert.equal(calls.length,3);assert.equal(ui.timers.size,0);
});

test('command panel reads independent byte ranges, retains text safely, and resets only on explicit restart',async()=>{
  const reads=[],command=commandView('command-output');
  const ui=await uiFixture({list:async()=>listing(command),read:async(_identity,_id,{offset})=>{reads.push(offset);return offset===0?outputChunk(command,{text:'<script>literal</script>',offset:0,nextOffset:24,totalBytes:29,eof:false}):offset===24?outputChunk(command,{text:'TAIL!',offset:24,nextOffset:29,totalBytes:29}):outputChunk(command,{offset:29,nextOffset:29,totalBytes:29});}});
  ui.panel.select('session');await ui.open();assert.equal(ui.output(),'<script>literal</script>');assert.equal(ui.action('more').disabled,false);
  ui.action('more').onclick();await flush();assert.equal(ui.output(),'<script>literal</script>TAIL!');assert.equal(ui.action('more').disabled,true);
  ui.action('refresh').onclick();await flush();assert.equal(ui.output(),'<script>literal</script>TAIL!');assert.deepEqual(reads,[0,24,29]);
  const outputNode=ui.container.descendants().find(node=>node.attributes['aria-label']==='명령 출력');assert.equal(outputNode.children.length,0,'process output stays text, never parsed markup');
  ui.action('restart').onclick();await flush();assert.equal(ui.output(),'<script>literal</script>');assert.deepEqual(reads,[0,24,29,0]);
  ui.container.open=false;ui.container.ontoggle();assert.equal(ui.timers.size,0);
});

test('command panel distinguishes requested cancellation from exit and requires inspected recovery',async()=>{
  let command=commandView('command-cancel'),cancelCalls=0;const recovered=[];
  const ui=await uiFixture({list:async()=>listing(command),read:async()=>outputChunk(command),cancel:async(identity,id)=>{assert.equal(identity,'session');assert.equal(id,command.id);cancelCalls++;command={...command,status:'stopping'};return{command,disposition:'requested'};},recover:async(identity,id,input)=>{recovered.push([identity,id,input.inspected]);command={...command,requiresRecovery:false,recoveryAcknowledged:true};return{command};}});
  ui.panel.select('session');await ui.open();ui.action('cancel').onclick();await flush();
  assert.equal(cancelCalls,1);assert.match(ui.container.textContent,/중단 요청 중/);assert.doesNotMatch(ui.container.textContent,/명령 종료 ·/);assert.equal(ui.action('cancel').disabled,true);assert.match(ui.container.textContent,/파일 변경은 되돌리지/);assert.equal(recovered.length,0);
  command={...command,status:'cancelled',directExited:true,requiresRecovery:true};ui.action('refresh').onclick();await flush();
  assert.equal(ui.action('recover').disabled,true);ui.action('recover').onclick();await flush();assert.equal(recovered.length,0);
  ui.action('inspected').checked=true;ui.action('inspected').onchange();assert.equal(ui.action('recover').disabled,false);
  ui.action('recover').onclick();await flush();assert.deepEqual(recovered,[['session','command-cancel',true]]);assert.equal(ui.action('inspected').checked,false);assert.match(ui.container.textContent,/취소됨/);assert.match(ui.container.textContent,/사용자 상태 확인 기록됨/);assert.match(ui.container.textContent,/명령 결과는 변경하지/);
});

test('command panel honors denied capabilities, stops forbidden polling, and rejects mismatched output',async()=>{
  let requests=0;const command=commandView('command-restricted',{status:'interrupted',requiresRecovery:true});
  const ui=await uiFixture({list:async()=>{requests++;return listing(command,{cancel:false,recover:false});},read:async()=>outputChunk(command)});
  ui.panel.select('session');await ui.open();assert.equal(ui.action('cancel').hidden,true);assert.equal(ui.action('inspected').disabled,true);assert.equal(ui.action('recover').disabled,true);assert.match(ui.container.textContent,/기록할 권한이 없습니다/);
  ui.action('cancel').onclick();ui.action('inspected').checked=true;ui.action('recover').onclick();await flush();assert.equal(requests,1,'unauthorized mutation handlers do not call or refresh');
  const bad=await uiFixture({read:async()=>outputChunk(commandView('other-command'),{text:'must not leak',nextOffset:13})});bad.panel.select('session');await bad.open();assert.match(bad.container.textContent,/COMMAND_RESPONSE_MISMATCH/);assert.doesNotMatch(bad.container.textContent,/must not leak/);
  const forbidden=await uiFixture({list:async()=>{throw Object.assign(new Error('denied'),{code:'FORBIDDEN',status:403});}});forbidden.panel.select('session');await forbidden.open();assert.match(forbidden.container.textContent,/FORBIDDEN/);assert.equal(forbidden.timers.size,0);assert.equal(forbidden.action('select').hidden,true);
});

test('independent command panels start at zero and an in-flight previous-session read cannot replace output',async()=>{
  const oldRead=Promise.withResolvers(),observations=[];
  const callbacks={list:async identity=>listing(commandView(identity)),read:async(identity,_id,{offset})=>{observations.push([identity,offset]);return identity==='old-session'?oldRead.promise:outputChunk(commandView(identity),{text:'NEW OUTPUT',nextOffset:10});}};
  const first=await uiFixture(callbacks),second=await uiFixture(callbacks);
  first.panel.select('old-session');await first.open();assert.deepEqual(observations,[['old-session',0]]);
  first.panel.select('new-session');await first.open();assert.equal(first.output(),'NEW OUTPUT');
  second.panel.select('new-session');await second.open();assert.equal(second.output(),'NEW OUTPUT');assert.deepEqual(observations,[['old-session',0],['new-session',0],['new-session',0]]);
  oldRead.resolve(outputChunk(commandView('old-session'),{text:'PRIVATE OLD OUTPUT',nextOffset:18}));await flush();assert.equal(first.output(),'NEW OUTPUT');assert.doesNotMatch(first.container.textContent,/PRIVATE OLD OUTPUT/);
});

test('revoked read permission clears already-visible command output and halts automatic polling',async()=>{
  let denied=false;const command=commandView();
  const ui=await uiFixture({list:async()=>{if(denied)throw Object.assign(new Error('permission revoked'),{code:'FORBIDDEN',status:403});return listing(command);},read:async()=>outputChunk(command,{text:'PRIVATE OUTPUT',nextOffset:14})});
  ui.panel.select('session');await ui.open();assert.equal(ui.output(),'PRIVATE OUTPUT');assert.equal(ui.timers.size,1);
  denied=true;ui.action('refresh').onclick();await flush();assert.doesNotMatch(ui.container.textContent,/PRIVATE OUTPUT|npm test/);assert.equal(ui.timers.size,0);assert.equal(ui.action('select').hidden,true);assert.match(ui.container.textContent,/FORBIDDEN/);
});
