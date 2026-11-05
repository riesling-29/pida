// Real Chromium + HTTP + Pi. Deterministic mock model; no live-provider claim.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createWorkspace, initWorkspace, workspaceEnvironment } from '../dist/workspace.js';
import { PidaClient } from '../dist/client.js';
import { AgentWorkspaceController } from '../dist/agent-workspace-controller.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const output = process.argv[2] ? resolve(process.argv[2]) : undefined;
const directory = await mkdtemp(join(root,'.pida-test-multi-browser-'));
let app, browser, observer;
const checks=[], errors=[];
try {
  initWorkspace(directory); app=await createWorkspace(directory); app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const url=`http://127.0.0.1:${app.server.address().port}`, token=workspaceEnvironment(directory).PIDA_API_TOKEN;
  const client=new PidaClient({baseUrl:url,token:()=>token});
  const a=await client.createAgent({name:'코드 · A'}), b=await client.createAgent({name:'조사 · B'});
  await client.pauseAgent(a.id); await client.pauseAgent(b.id);
  browser=await chromium.launch({...(process.env.PIDA_BROWSER_EXECUTABLE ? {executablePath:process.env.PIDA_BROWSER_EXECUTABLE} : {}),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1720,height:1120}}); page.on('pageerror',e=>errors.push(e.message));
  async function signIn() { await page.locator('#token').fill(token); await page.locator('#connect').click(); await page.locator('[data-mode="fleet"]').waitFor({state:'visible'}); await page.locator('[data-mode="fleet"]').click(); await page.locator('.fleet-pane').waitFor(); }
  await page.goto(url); await signIn();
  const panes=page.locator('.fleet-pane');
  await panes.nth(0).getByLabel('에이전트 선택',{exact:true}).selectOption(a.id);
  await panes.nth(0).getByLabel('이 패널의 작업 지시').fill('LOT-001');
  await page.getByRole('button',{name:'좌우 분할',exact:true}).click();
  assert.equal(await panes.count(),2);
  await panes.nth(1).getByLabel('에이전트 선택',{exact:true}).selectOption(b.id);
  await panes.nth(1).getByLabel('이 패널의 작업 지시').fill('LOT-002');
  assert.equal(await panes.nth(0).getByLabel('이 패널의 작업 지시').inputValue(),'LOT-001');
  await panes.nth(1).getByRole('button',{name:'새 작업 접수',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.fleet-pane')[1]?.querySelector('.fleet-receipt').textContent.includes('접수됨'));
  await panes.nth(0).getByRole('button',{name:'새 작업 접수',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.fleet-pane')[0]?.querySelector('.fleet-receipt').textContent.includes('접수됨'));
  checks.push('independent agent targets, drafts and actual queued jobs');
  const aj=(await client.listAgentJobs(a.id)).jobs[0], bj=(await client.listAgentJobs(b.id)).jobs[0];
  await panes.nth(0).getByRole('button',{name:'이 작업 취소',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.fleet-pane .fleet-status').textContent.includes('요청으로 중단됨'));
  assert.equal((await client.getAgentJob(b.id,bj.id)).status,'queued'); checks.push('exact-job cancellation leaves other agent queued');
  const separator=page.getByRole('separator').first(), rect=await separator.boundingBox();
  await page.mouse.move(rect.x+3,rect.y+30); await page.mouse.down(); await page.mouse.move(rect.x+140,rect.y+30); await page.mouse.up();
  assert.ok(Number(await page.getByRole('separator').first().getAttribute('aria-valuenow'))>50); checks.push('pointer resizing saves ratio');
  await page.getByRole('button',{name:'+ 탭',exact:true}).click(); assert.equal(await panes.count(),1);
  await panes.first().getByLabel('에이전트 선택',{exact:true}).selectOption(a.id);
  await page.getByRole('button',{name:'작업 1',exact:true}).click(); assert.equal(await panes.count(),2); checks.push('tab switch restores bound panels');
  await page.getByRole('button',{name:'상하 분할',exact:true}).click();
  await page.getByLabel('초점 패널',{exact:true}).selectOption({index:2});
  await page.getByRole('button',{name:'상하 분할',exact:true}).click(); assert.equal(await panes.count(),4);
  await page.getByRole('button',{name:'패널 확대',exact:true}).click(); assert.equal(await panes.count(),1);
  await page.getByRole('button',{name:'분할로 복귀',exact:true}).click(); assert.equal(await panes.count(),4); checks.push('nested four-pane layout and reversible focus zoom');
  await page.getByLabel('패널 자리 바꾸기',{exact:true}).selectOption({index:1}); assert.equal(await panes.count(),4); checks.push('panel swap');
  if(output) {await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'web-four-panels.png')});}
  await page.setViewportSize({width:720,height:800}); await page.waitForFunction(()=>document.querySelectorAll('.fleet-pane').length===1); checks.push('narrow view preserves layout with focused-pane fallback');
  await page.setViewportSize({width:1720,height:1120}); await page.waitForFunction(()=>document.querySelectorAll('.fleet-pane').length===4);
  await page.reload(); await signIn(); await page.waitForFunction(()=>document.querySelectorAll('.fleet-pane').length===4);
  assert.equal((await client.listAgentJobs(a.id)).jobs.length,1); assert.equal((await client.listAgentJobs(b.id)).jobs.length,1); checks.push('reload restores metadata only; no job replay');
  // A second client uses the exact shared controller used by the terminal surface.
  observer=new AgentWorkspaceController(client,{pollMs:0}); await observer.start();
  observer.bind(observer.layout.panes[0].id,{agentId:b.id,jobId:bj.id,view:'activity'});
  await client.resumeAgent(b.id);
  await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-pane .fleet-status')].some(n=>n.textContent.includes('조사 · B')&&n.textContent.includes('실행 완료')));
  await observer.refresh(); assert.equal(observer.job(observer.layout.panes[0].id).status,'completed');
  assert.equal((await client.getAgentJob(a.id,aj.id)).status,'cancelled'); checks.push('mock model runs through real Pi; Web and second controller observe same job');
  await page.getByRole('button',{name:'에이전트 생성',exact:true}).click(); await page.getByLabel('에이전트 이름',{exact:true}).fill('운영 · C');
  await page.locator('#fleet-view dialog').getByRole('button',{name:'생성',exact:true}).click(); await page.waitForFunction(()=>!document.querySelector('#fleet-view dialog').open);
  assert.equal((await client.listAgents()).agents.length,3); checks.push('host-source catalogue and agent creation');
  assert.deepEqual(errors,[]); checks.push('no uncaught browser errors');
  const report={version:JSON.parse(await (await import('node:fs/promises')).readFile(join(root,'package.json'),'utf8')).version,environment:`${process.version} Linux, Chromium ${browser.version()}`,model:'deterministic mock; real Pi and HTTP',checks,unverified:['Windows Terminal / PowerShell','live LLM / company gateway']};
  if(output) await writeFile(join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  observer?.close(); await browser?.close(); if(app){await app.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));} await rm(directory,{recursive:true,force:true});
}
