import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { once } from 'node:events';
import { WorkspaceLayout, fitsLayout, splitList } from '../dist/workspace-layout.js';
import { AgentWorkspaceController } from '../dist/agent-workspace-controller.js';
import { PidaClient } from '../dist/client.js';
import { createWorkspace, initWorkspace, workspaceEnvironment } from '../dist/workspace.js';

test('layout supports nested four panes, swap/zoom/tab restoration, narrow fallback and whitelisted persistence', () => {
  const w = new WorkspaceLayout(), a = w.panes[0];
  const b = w.split(a.id, 'horizontal');
  const c = w.split(b.id, 'vertical');
  w.split(a.id, 'vertical');
  assert.throws(() => w.split(c.id, 'vertical'), /PANE_LIMIT/);
  const split = splitList(w.active.root)[0]; w.resize(split.id, .62);
  w.swap(a.id, c.id); w.focus(b.id); w.zoom();
  const original = w.serialize();
  const restored = new WorkspaceLayout(original);
  assert.equal(restored.serialize(), original);
  assert.equal(fitsLayout(w.active.root, 160, 60), true);
  assert.equal(fitsLayout(w.active.root, 60, 20), false);
  w.addTab('second'); w.swap(w.panes[0].id, b.id);
  assert.equal(new WorkspaceLayout(w.serialize()).data.tabs.length, 2);
  w.closePane(b.id); assert.equal(w.panes.length, 1);
  const dirty = JSON.parse(original); dirty.token = 'secret'; dirty.tabs[0].root.draft = 'private';
  assert.equal(new WorkspaceLayout(dirty).serialize().includes('secret'), false);
  dirty.tabs[0].root.ratio = Infinity;
  assert.equal(new WorkspaceLayout(dirty).panes.length, 1);
});

async function fixture(t) {
  const directory = await mkdtemp(join(fileURLToPath(new URL('../', import.meta.url)), '.pida-test-multi-'));
  initWorkspace(directory);
  const app = await createWorkspace(directory);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const token = () => workspaceEnvironment(directory).PIDA_API_TOKEN;
  const client = new PidaClient({ baseUrl, token });
  t.after(async () => { await app.close(); app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); await rm(directory, {recursive:true,force:true}); });
  return { client, baseUrl, token, app };
}
test('real HTTP: independent panel drafts/targets, exact cancellation, pause, detach/reconnect without execution replay', async t => {
  const {client,app} = await fixture(t);
  const a = await client.createAgent({name:'A',role:'private role',persona:'private persona'}), b = await client.createAgent({name:'B'});
  await client.pauseAgent(a.id); await client.pauseAgent(b.id);
  let saved;
  const c = new AgentWorkspaceController(client, {pollMs:0, saveLayout:(_,json)=>{saved=json;}});
  t.after(()=>c.close()); await c.start();
  const first = c.layout.panes[0].id;
  c.bind(first,{agentId:a.id,view:'chat'});
  const second = c.layout.split(first,'horizontal').id;
  c.bind(second,{agentId:b.id,view:'chat'});
  c.setDraft(first,'LOT-001'); c.setDraft(second,'LOT-002');
  await Promise.all([c.submit(first),c.submit(second)]);
  await c.refresh();
  assert.equal(c.job(first).input,'LOT-001'); assert.equal(c.job(second).input,'LOT-002');
  assert.equal(c.entry(first).admission,'paused');
  assert.equal(c.draft(first),''); assert.equal(c.draft(second),'');
  assert.equal(JSON.stringify(c.overview).includes('LOT-001'),false);
  assert.equal(JSON.stringify(c.overview).includes('private role'),false);
  assert.equal(JSON.stringify(c.overview).includes('private persona'),false);
  await c.cancel(first);
  assert.equal(c.job(first).status,'cancelled'); assert.equal(c.job(second).status,'queued');
  c.setDraft(second,'private unsent text'); c.layout.zoom(); await Promise.resolve();
  const layout = saved; assert.ok(layout); assert.equal(layout.includes('private'),false);
  c.layout.closePane(second); c.close();
  const restored = new AgentWorkspaceController(client,{pollMs:0,loadLayout:()=>layout}); t.after(()=>restored.close());
  await restored.start();
  assert.equal(restored.job(second).status,'queued'); assert.equal(restored.draft(second),'');
  assert.equal((await client.listAgentJobs(b.id)).jobs.length,1);
  assert.deepEqual((await client.listSessions()).sessions,[]);
  const foreign = {id:'someone-else',permissions:['pida:agents']};
  assert.equal(app.agents.overview(foreign).agents.length,0);
  assert.match(c.overview.scopeId,/^[0-9a-f]{64}$/);
  assert.notEqual(app.agents.overview(foreign).scopeId,c.overview.scopeId);
});

test('lost enqueue response is reconciled read-only with stable id; late binding cannot redirect a submitted request', async t => {
  const {client,baseUrl,token} = await fixture(t);
  const a = await client.createAgent({name:'A'}), b = await client.createAgent({name:'B'});
  await client.pauseAgent(a.id); await client.pauseAgent(b.id);
  let lost = false, resolveStarted, release;
  const started = new Promise(r=>{resolveStarted=r;});
  const gate = new Promise(r=>{release=r;});
  const unreliable = new PidaClient({baseUrl,token,fetch:async(url,options)=>{
    const response = await fetch(url,options);
    if (!lost && options.method==='POST' && url.endsWith('/jobs')) {
      lost=true; resolveStarted(); await gate; throw Error('ACK_LOST');
    }
    return response;
  }});
  const c = new AgentWorkspaceController(unreliable,{pollMs:0}); t.after(()=>c.close()); await c.start();
  const p = c.layout.panes[0].id; c.bind(p,{agentId:a.id,view:'chat'}); c.setDraft(p,'LOT-001');
  const sending = c.submit(p); await started;
  c.bind(p,{agentId:b.id,view:'chat'}); c.setDraft(p,'B draft'); release(); await sending;
  assert.equal(c.draft(p),'B draft'); assert.equal(c.job(p),undefined);
  c.bind(p,{agentId:a.id,view:'chat'});
  assert.equal(c.isUncertain(p),true); await c.submit(p); // no automatic second POST
  await c.checkDelivery(p);
  assert.equal(c.isUncertain(p),false); assert.equal(c.job(p).input,'LOT-001');
  assert.equal((await client.listAgentJobs(a.id)).jobs.length,1);
  assert.equal((await client.listAgentJobs(b.id)).jobs.length,0);
});
