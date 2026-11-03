import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call, fauxText, fauxThinking } from '@earendil-works/pi-ai/providers/faux';
import { visibleWidth, stripTerminalSequences } from '@earendil-works/pi-tui';
import { PidaRuntime } from '../dist/runtime.js';
import { PidaClient, sessionDisplayMessages } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { TuiController } from '../dist/tui-controller.js';
import { createTuiView, terminalText } from '../dist/tui.js';

const until = async predicate => { for(let i=0;i<400;i++){if(await predicate())return;await delay(10);}assert.fail('condition not reached'); };
async function fixture(t, provider) {
  const entered=Promise.withResolvers(), gate=Promise.withResolvers(); let calls=0;
  const principal={id:'alice',permissions:['gate:read']}, token='tui-synthetic-only'.repeat(3);
  const runtime=new PidaRuntime({provider:provider??(()=>{const f=fauxProvider({tokensPerSecond:100000});f.setResponses([answer(call('gate',{}),{stopReason:'toolUse'}),answer('shared result')]);return {provider:f.provider,modelId:f.getModel().id};}),
    singleWriter:true, tools:[{name:'gate',description:'synthetic gated tool',permission:'gate:read',effect:'read',parameters:Type.Object({}),execute:async(_,ctx)=>{calls++;entered.resolve();await Promise.race([gate.promise,new Promise(r=>ctx.signal.addEventListener('abort',r,{once:true}))]);return {ok:true};}}]});
  const server=createPidaServer({runtime,authenticate:staticTokenAuth([{token,principal},{token:'other'.repeat(10),principal:{id:'bob',permissions:[]}}])});
  server.listen(0,'127.0.0.1');await once(server,'listening');const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const client=new PidaClient({baseUrl,token:()=>token}), peer=new PidaClient({baseUrl,token:()=>token});
  t.after(async()=>{gate.resolve();await runtime.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {client,peer,runtime,entered,gate,baseUrl,calls:()=>calls};
}

test('TUI and Web client share actual Pi run, detach without cancel, reattach without replay',async t=>{
  const f=await fixture(t), controller=new TuiController(f.client,{pollMs:20});t.after(()=>controller.close());
  await controller.start({newSession:true});const id=controller.state.session.sessionId;
  assert.equal(await controller.submit('Run the shared task'),true);await f.entered.promise;
  await until(async()=>{await controller.refresh();return controller.state.session.running;});
  const web=await f.peer.getSession(id);assert.equal(web.running,true);assert.ok(web.activeRunId);
  assert.equal(await controller.submit('do not start twice'),false);
  await assert.rejects(f.peer.run(id,'conflicting request'),{code:'SESSION_BUSY'});
  controller.close();await controller.settled();assert.equal((await f.peer.getSession(id)).running,true);
  const attached=new TuiController(f.peer,{pollMs:20});t.after(()=>attached.close());await attached.start({sessionId:id});
  assert.equal(attached.state.session.runs,1);assert.equal(f.calls(),1);
  f.gate.resolve();await until(async()=>{await attached.refresh();return !attached.state.session.running;});
  assert.equal(attached.state.session.lastStatus,'completed');assert.match(sessionDisplayMessages(attached.state.session).at(-1).text,/shared result/);
  assert.equal(f.calls(),1);assert.equal(attached.state.session.runs,1);
  await attached.submit('/activity');assert.match(attached.state.panel.text,/UNKNOWN/);
});

test('guarded TUI cancellation cannot cancel a replacement run; foreign session cannot be observed',async t=>{
  const f=await fixture(t), c=new TuiController(f.client,{pollMs:20});t.after(()=>c.close());await c.start({newSession:true});
  const id=c.state.session.sessionId;await c.submit('wait');await f.entered.promise;await c.refresh();
  const run=c.state.session.activeRunId;
  await assert.rejects(f.peer.cancel(id,'00000000-0000-0000-0000-000000000000'),{code:'RUN_CHANGED'});
  assert.equal((await f.peer.getSession(id)).activeRunId,run);
  const stranger=new PidaClient({baseUrl:f.baseUrl,token:()=> 'other'.repeat(10)});
  await assert.rejects(stranger.getSession(id),{code:'SESSION_NOT_FOUND'});
  await c.submit('/stop');await c.settled();assert.equal(c.state.session.lastStatus,'cancelled');
  await assert.rejects(f.peer.cancel(id,run),{code:'RUN_CHANGED'});
});

test('peer snapshot exposes bounded assistant text, never thinking, and final messages replace preview',async t=>{
  const visible='public 한글 '.repeat(5000);
  const f=await fixture(t,()=>{const p=fauxProvider({tokensPerSecond:10000,tokenSize:{min:128,max:128}});p.setResponses([answer([fauxThinking('private-thinking-marker'),fauxText(visible)])]);return {provider:p.provider,modelId:p.getModel().id};});
  const {sessionId:id}=await f.client.createSession();const execution=f.client.run(id,'respond',{disconnectPolicy:'continue'});
  let seen=false,capped=false;
  await until(async()=>{const s=await f.peer.getSession(id);if(s.activeResponse?.text){seen=true;assert.equal(s.activeResponse.runId,s.activeRunId);assert.ok(s.activeResponse.text.length<=32768);assert.doesNotMatch(JSON.stringify(s),/private-thinking-marker/);capped ||= s.activeResponse.truncated;}return seen&&capped;});
  await execution;const s=await f.peer.getSession(id);assert.equal(s.activeResponse,undefined);assert.equal(sessionDisplayMessages(s).filter(m=>m.role==='assistant').length,1);assert.equal(s.messages.at(-1).text,visible);
});

test('failed selection preserves current session and delayed old reads cannot overwrite new selection',async()=>{
  const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',gate=Promise.withResolvers();let block=false;
  const session=id=>({sessionId:id,title:id,messages:[],running:false,runs:0,tools:[],autoCompaction:true});
  const client={getInfo:async()=>({tools:[]}),listSessions:async()=>({sessions:[session(a)]}),getSession:async id=>{if(id==='cccccccc-cccc-cccc-cccc-cccccccccccc')throw Error('denied');if(block&&id===a)await gate.promise;return session(id);},getTrace:async()=>({events:[],truncated:false})};
  const c=new TuiController(client);await c.start();
  await assert.rejects(c.select('cccccccc-cccc-cccc-cccc-cccccccccccc'));assert.equal(c.state.session.sessionId,a);
  block=true;const read=c.refresh();await c.select(b);gate.resolve();await read;assert.equal(c.state.session.sessionId,b);c.close();
});

class TerminalFixture {
  columns=112;rows=32;output='';kittyProtocolActive=false;
  start(input,resize){this.input=input;this.resize=resize;} stop(){} async drainInput(){}
  write(s){this.output+=s;} moveBy(){} hideCursor(){} showCursor(){} clearLine(){} clearFromCursor(){} clearScreen(){} setTitle(){} setProgress(){} setProgramStatus(){}
}
test('actual Pi renderer/editor handles Korean paste, responsive panels, session selection and control sanitization',async()=>{
  const terminal=new TerminalFixture(), c=new TuiController({}), s=c.state;
  s.connected=true;s.session={sessionId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title:'제조 설비 확인',messages:[{role:'user',text:'요구사항을 보존해 주세요'},{role:'assistant',text:'확인 중\x1b]52;c;ZXZpbA==\x07\x1b[2J입니다'}],running:false,runs:1,tools:[],autoCompaction:true,lastStatus:'completed'};
  const view=createTuiView(c,{terminal,workspace:'D:/pida/my-agent',color:false}), submitted=[];
  c.submit=async text=>{submitted.push(text);return true;};view.start();await delay(50);
  const screen=view.getScreenLines().map(stripTerminalSequences).join('\n');assert.match(screen,/제조 설비 확인/);assert.match(screen,/독립 검증 미확인/);assert.doesNotMatch(screen,/ZXZpbA/);
  terminal.input('\x1b[200~한글 입력\n둘째 줄\x1b[201~');await delay(20);assert.equal(view.editor.getExpandedText(),'한글 입력\n둘째 줄');assert.equal(submitted.length,0);
  terminal.input('\r');await delay(30);assert.deepEqual(submitted,['한글 입력\n둘째 줄']);
  s.panel={title:'변경 내역',text:'diff --git a/a.ts b/a.ts\n+hello 한글'};c.onChange();terminal.columns=64;terminal.rows=24;terminal.resize();await delay(40);
  const narrow=view.getScreenLines();assert.ok(narrow.every(l=>visibleWidth(l)<=64));assert.match(narrow.map(stripTerminalSequences).join('\n'),/변경 내역/);
  c.onSessions([{sessionId:s.session.sessionId,title:'같은 세션',running:false}]);await delay(20);terminal.input('\x1b');await delay(20);
  view.stop();c.close();assert.ok(terminal.output.includes('\x1b[?1049h'));assert.ok(terminal.output.includes('\x1b[?1049l'));
  assert.equal(terminalText('safe\x1b]0;evil\x07\x1b[31mRED\x1b[0m\x00'), 'safeRED');
});
