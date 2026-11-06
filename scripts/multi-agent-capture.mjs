// Captures actual Pi frame buffers connected to real local HTTP/Pi mock runs.
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {initWorkspace,createWorkspace,workspaceEnvironment} from '../dist/workspace.js';
import {PidaClient} from '../dist/client.js';
import {AgentWorkspaceController} from '../dist/agent-workspace-controller.js';
import {createAgentTui} from '../dist/agent-tui.js';
const output=resolve(process.argv[2]||'fixtures/workspace/0.8.14');
class Terminal{columns=160;rows=44;kittyProtocolActive=false;start(input,resize){this.input=input;this.resize=resize;}stop(){}async drainInput(){}write(){}moveBy(){}hideCursor(){}showCursor(){}clearLine(){}clearFromCursor(){}clearScreen(){}setTitle(){}setProgress(){}setProgramStatus(){}}
const directory=await mkdtemp(join(process.cwd(),'.pida-test-capture-'));let app,c,view;
try{
  initWorkspace(directory);app=await createWorkspace(directory);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const client=new PidaClient({baseUrl:`http://127.0.0.1:${app.server.address().port}`,token:()=>workspaceEnvironment(directory).PIDA_API_TOKEN});
  const a=await client.createAgent({name:'작업 A'}),b=await client.createAgent({name:'조사 B'});
  for(const [agent,input] of [[a,'LOT-001 상태를 확인해주세요.'],[b,'LOT-002 상태를 확인해주세요.']])await client.enqueueAgentJob(agent.id,{input,requestId:crypto.randomUUID()});
  c=new AgentWorkspaceController(client,{pollMs:0});await c.start();
  const first=c.layout.panes[0].id;c.bind(first,{agentId:a.id,view:'chat'});const right=c.layout.split(first,'horizontal').id;c.bind(right,{agentId:b.id,view:'chat'});
  const leftBottom=c.layout.split(first,'vertical').id;c.bind(leftBottom,{agentId:a.id,view:'verification'});
  const rightBottom=c.layout.split(right,'vertical').id;c.bind(rightBottom,{agentId:b.id,view:'activity'});
  for(let i=0;i<100;i++){await c.refresh();if(c.job(first)?.status==='completed'&&c.job(right)?.status==='completed')break;await delay(30);}
  if(c.job(first)?.status!=='completed'||c.job(right)?.status!=='completed')throw Error('MOCK_RUN_DID_NOT_FINISH');
  await c.inspect(leftBottom);c.setDraft(first,'확인한 결과를 표로 정리해주세요.');c.layout.focus(first);c.layout.renameTab(c.layout.active.id,'작업 · 조사');
  const firstTab=c.layout.active.id;c.layout.addTab('운영');c.layout.selectTab(firstTab);await c.refresh();
  const terminal=new Terminal();view=createAgentTui(c,{terminal,workspace:'my-agent · MOCK 검증 환경',color:true,colorMode:'truecolor'});view.start();await delay(50);
  const captures=[];function capture(name){const ansi=view.getScreenLines();captures.push({name,columns:terminal.columns,rows:terminal.rows,ansi,text:ansi.map(stripTerminalSequences)});}
  capture('multi-agent-tui');terminal.columns=64;terminal.rows=24;terminal.resize();await delay(50);capture('multi-agent-narrow');
  await mkdir(output,{recursive:true});await writeFile(join(output,'screens.json'),JSON.stringify({kind:'actual-pi-renderer/real-http/mock-model',captures},null,2)+'\n');
  console.log(JSON.stringify({captures:captures.length,output:join(output,'screens.json')}));
}finally{view?.stop();c?.close();if(app){await app.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}await rm(directory,{recursive:true,force:true});}
