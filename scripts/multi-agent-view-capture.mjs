// Real Pi frame buffers with synthetic presentation data; not a live-model screenshot.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { AgentWorkspaceController } from '../dist/agent-workspace-controller.js';
import { createAgentTui, terminalDefaultLayout } from '../dist/agent-tui.js';
const output=process.argv[2];if(!output)throw Error('Supply output directory');
class ScreenTerminal {
  columns=140;rows=38;kittyProtocolActive=false;
  start(input,resize){this.input=input;this.resize=resize;}stop(){}async drainInput(){}
  write(){}moveBy(){}hideCursor(){}showCursor(){}clearLine(){}clearFromCursor(){}clearScreen(){}setTitle(){}setProgress(){}setProgramStatus(){}
}
const a=crypto.randomUUID(),b=crypto.randomUUID(),ja=crypto.randomUUID(),jb=crypto.randomUUID();
const jobs=[{id:ja,agentId:a,status:'completed',input:'검색 화면에 상태 필터를 추가해 주세요.',latestText:'',result:{text:'상태 필터를 추가했습니다.\n기존 검색과 상태 변경 동작을 유지했습니다.\n\n파일 검사: 통과\n브라우저 검사: 미실행'},activity:[]},
{id:jb,agentId:b,status:'completed',input:'변경 내용을 점검해 주세요.',latestText:'',result:{text:'변경 파일과 검사 기록을 검토했습니다.'},activity:[{timestamp:'2026-11-05T06:00:00Z',type:'run_started'},{timestamp:'2026-11-05T06:00:02Z',type:'tool_completed',toolName:'workspace_read'},{timestamp:'2026-11-05T06:00:05Z',type:'run_finished'}]}];
const client={async getAgentOverview(){return {scopeId:'visual-fixture',maxConcurrent:1,personaSources:{defaultSourceId:'local',sources:[]},agents:[a,b].map((id,i)=>({profile:{id,name:i?'검토 에이전트':'개발 에이전트',personaSourceId:'local'},admission:'ready',jobs:[jobs[i]]}))};},async getAgentJob(_agent,id){return jobs.find(j=>j.id===id);}};
const c=new AgentWorkspaceController(client,{pollMs:0,loadLayout:()=>terminalDefaultLayout()});await c.start();
const [first,second]=c.layout.panes;c.bind(first.id,{agentId:a,view:'chat'});c.bind(second.id,{agentId:b,view:'activity'});await c.refresh();
c.setDraft(first.id,'다음으로 필터 초기화 버튼을 추가해 주세요.');
const terminal=new ScreenTerminal(),view=createAgentTui(c,{terminal,workspace:'D:/pida/my-agent · 레이아웃 검사용 예시 데이터',color:true,colorMode:'truecolor'}),captures=[];
async function capture(name){await delay(40);const ansi=view.getScreenLines(),text=ansi.map(stripTerminalSequences);if(!text.every(s=>visibleWidth(s)<=terminal.columns))throw Error('WIDTH_OVERFLOW');captures.push({name,columns:terminal.columns,rows:terminal.rows,ansi,text});}
try{
  view.start();await capture('two-frames');
  c.layout.split(first.id,'vertical');c.layout.split(second.id,'vertical');terminal.rows=48;terminal.resize();await capture('four-frames');
  terminal.columns=64;terminal.rows=24;terminal.resize();await capture('narrow-frame');
}finally{view.stop();c.close();}
await mkdir(resolve(output),{recursive:true});
await writeFile(resolve(output,'screens.json'),JSON.stringify({kind:'real-pi-renderer/synthetic-presentation-data',captures},null,2)+'\n');
console.log(JSON.stringify({captures:captures.length,output:resolve(output,'screens.json')}));
