import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {stripTerminalSequences,visibleWidth} from '@earendil-works/pi-tui';
import {AgentWorkspaceController} from '../dist/agent-workspace-controller.js';
import {createAgentTui,terminalDefaultLayout} from '../dist/agent-tui.js';

export class TerminalFixture {
  columns=180;rows=52;output='';kittyProtocolActive=false;
  start(input,resize){this.input=input;this.resize=resize;}stop(){}async drainInput(){}
  write(s){this.output+=s;}moveBy(){}hideCursor(){}showCursor(){}clearLine(){}clearFromCursor(){}clearScreen(){}setTitle(){}setProgress(){}setProgramStatus(){}
}
const until=async(fn)=>{for(let i=0;i<200;i++){if(await fn())return;await delay(10);}assert.fail('condition not reached');};
test('actual Pi multi-pane renderer: keyboard/mouse menus, independent Korean editors, resize, tab restore and precise submission',async t=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),jobs=new Map(),sent=[];
  const client={
    async getAgentOverview(){return {scopeId:'test',maxConcurrent:2,personaSources:{defaultSourceId:'local',sources:[{id:'local',label:'Local'}]},agents:[a,b].map((id,i)=>({profile:{id,name:i?'B 조사':'A 코드',paused:true},admission:'paused',jobs:[...jobs.values()].filter(j=>j.agentId===id)}))};},
    async getAgentJob(agent,id){return jobs.get(id);},
    async enqueueAgentJob(agentId,{input,requestId}){sent.push({agentId,input});const j={id:crypto.randomUUID(),agentId,input,requestId,status:'queued',latestText:'',activity:[]};jobs.set(j.id,j);return j;},
  };
  const c=new AgentWorkspaceController(client,{pollMs:0});await c.start();
  const first=c.layout.panes[0].id;c.bind(first,{agentId:a,view:'chat'});await c.refresh();
  const terminal=new TerminalFixture(),v=createAgentTui(c,{terminal,workspace:'fixture workspace',color:true,colorMode:'truecolor'});
  t.after(()=>{v.stop();c.close();});v.start();await delay(40);
  const screen=()=>v.getScreenLines().map(stripTerminalSequences).join('\n');
  assert.match(screen(),/MULTI TUI/);assert.match(screen(),/F6 분할/);assert.match(screen(),/╭─/);assert.match(screen(),/╰─/);assert.doesNotMatch(screen(),/\[F1 메뉴\]/);
  terminal.input('\x1b[200~A 미전송 한글 지시\x1b[201~');await delay(20);
  assert.equal(c.draft(first),'A 미전송 한글 지시');assert.equal(sent.length,0);
  terminal.input('\x1b[17~');await delay(20);assert.match(screen(),/분할과 배치/);
  terminal.input('\r');await delay(20);assert.equal(c.layout.panes.length,2);
  const second=c.layout.active.focus;
  terminal.input('\x1bOR');await delay(15);terminal.input('\x1b[B');terminal.input('\x1b[B');terminal.input('\r');await delay(20);
  assert.equal(c.layout.find(second).binding.agentId,b);
  terminal.input('\x1b[200~B request\x1b[201~');terminal.input('\r');await until(()=>sent.length===1&&!c.isBusy(second));
  assert.deepEqual(sent,[{agentId:b,input:'B request'}]);assert.equal(c.draft(first),'A 미전송 한글 지시');
  assert.match(screen(),/A 코드/);assert.match(screen(),/B 조사/);
  // Click the first pane's retained editor, not just its title; focus must follow.
  terminal.input('\x1b[<0;5;49M');terminal.input('\x1b[<0;5;49m');await delay(20);
  assert.equal(c.layout.active.focus,first);
  c.layout.split(first,'vertical');c.layout.split(second,'vertical');await delay(25);
  assert.equal(c.layout.panes.length,4);assert.match(screen(),/4\/4 panels/);
  assert.equal((screen().match(/A 코드/g)||[]).length,2);assert.equal((screen().match(/B 조사/g)||[]).length,2);
  for(const row of v.getScreenLines()){assert.equal(visibleWidth(row),terminal.columns);assert.ok(row.includes('\x1b[48;2;1;2;1m'));}
  terminal.columns=64;terminal.rows=24;terminal.resize();await delay(25);
  assert.equal(c.layout.panes.length,4);assert.equal((screen().match(/(?:A 코드|B 조사) \/ 대화/g)||[]).length,1);
  assert.match(screen(),/초점 패널만 표시/);
  terminal.columns=180;terminal.rows=52;terminal.resize();await delay(25);
  assert.equal((screen().match(/(?:A 코드|B 조사) \/ 대화/g)||[]).length,4);
  const oldEditor=v.editor(first),oldTab=c.layout.active.id;
  terminal.input('\x1bOQ');await delay(15);terminal.input('\x1b[B');terminal.input('\r');await delay(20);
  assert.equal(c.layout.data.tabs.length,2);
  terminal.input('\x1b[<0;5;3M');terminal.input('\x1b[<0;5;3m');await delay(20);
  assert.equal(c.layout.active.id,oldTab);assert.equal(v.editor(first),oldEditor);assert.equal(oldEditor.getExpandedText(),'A 미전송 한글 지시');
  assert.doesNotMatch(terminal.output,/\x1b\](?:4|10|11|50|52);/);
});

test('fresh terminal starts with two framed views',async t=>{
  const client={async getAgentOverview(){return {scopeId:'empty',maxConcurrent:1,agents:[],personaSources:{defaultSourceId:'local',sources:[]}};}};
  const c=new AgentWorkspaceController(client,{pollMs:0,loadLayout:()=>terminalDefaultLayout()});await c.start();
  const terminal=new TerminalFixture(),v=createAgentTui(c,{terminal,workspace:'fresh fixture',color:false});
  t.after(()=>{v.stop();c.close();});v.start();await delay(40);
  assert.equal(c.layout.panes.length,2);
  assert.deepEqual(c.layout.panes.map(p=>p.binding.view),['chat','activity']);
  assert.equal(v.getScreenLines().map(stripTerminalSequences).join('\n').match(/╭/g).length,2);
});
