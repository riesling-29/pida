import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { nativeProvider, nativeProviderCatalog, PidaRuntime } from '../dist/index.js';
import { initWorkspace, createWorkspace, readConfig } from '../dist/workspace.js';
import { ProviderSettings, providerEnvironment } from '../dist/provider-settings.js';

const catalog = nativeProviderCatalog();
function config(id) {
  const p = catalog.find(p => p.id === id);
  return { kind: 'native', providerId: id, modelId: p.models.find(m => !m.id.includes('pro'))?.id ?? p.models[0].id, apiKeyEnv: p.apiKeyEnv };
}
const principal = { id: 'local-user', permissions: [] };
async function fixture(t) {
  const dir = await mkdtemp(fileURLToPath(new URL('../.pida-test-native-', import.meta.url)));
  initWorkspace(dir);
  const app = await createWorkspace(dir);
  t.after(async () => { await app.runtime.close(); await rm(dir, {recursive:true,force:true}); });
  return { dir, app, settings: new ProviderSettings(dir, app.runtime) };
}
function sse(events, named = false) {
  return new Response(events.map(e => `${named ? `event: ${e.type}\n` : ''}data: ${JSON.stringify(e)}\n\n`).join(''), { headers: {'content-type':'text/event-stream'} });
}
function fakeResponse(id, model) {
  if (id === 'google') return sse([{ candidates:[{content:{role:'model',parts:[{text:'OK'}]},finishReason:'STOP',index:0}], usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2} }]);
  if (id === 'anthropic') return sse([
    {type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',content:[],model,stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'OK'}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}},
    {type:'message_stop'},
  ],true);
  if (id === 'openai') {
    const item={id:'msg_test',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]};
    const response={id:'resp_test',object:'response',created_at:1,model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
    return sse([
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
      {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
      {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'OK'},
      {type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:'OK'},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response},
    ],true);
  }
  return sse([
    {id:'test',object:'chat.completion.chunk',created:1,model,choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]},
    {id:'test',object:'chat.completion.chunk',created:1,model,choices:[{index:0,delta:{},finish_reason:'stop'}]},
  ]);
}
function intercept(t, id, calls) {
  t.mock.method(globalThis,'fetch',async (input, init) => {
    const req = new Request(input,init);
    const url = new URL(req.url);
    const expected = {openai:'api.openai.com',anthropic:'api.anthropic.com',google:'generativelanguage.googleapis.com',deepseek:'api.deepseek.com'}[id];
    assert.equal(url.hostname,expected,'never send test credentials to a real service');
    calls.push({url,headers:req.headers,body:JSON.parse(await req.text())});
    return fakeResponse(id,calls.at(-1).body.model ?? config(id).modelId);
  });
}
test('eight upstream catalogs preserve native API, limits, reasoning and scoped auth', async () => {
  assert.equal(catalog.length,8);
  for (const entry of catalog) {
    assert.ok(entry.models.length);
    const c=config(entry.id);
    const binding=nativeProvider(c,{[c.apiKeyEnv]:'synthetic-'+entry.id})();
    assert.equal(binding.provider.id,entry.id);
    assert.equal(binding.provider.auth.oauth,undefined);
    const model=binding.provider.getModels().find(m=>m.id===c.modelId);
    assert.ok(model.contextWindow>0);
    assert.equal(model.api,entry.models.find(m=>m.id===c.modelId).api);
    const auth=await binding.provider.auth.apiKey.resolve({signal:new AbortController().signal,ctx:{env:async()=> 'wrong-ambient-key',fileExists:async()=>true}});
    assert.equal(auth.auth.apiKey,'synthetic-'+entry.id);
  }
  assert.throws(()=>nativeProvider({...config('openai'),providerId:'__proto__'}));
  assert.throws(()=>nativeProvider({...config('google'),modelId:'invented-model'}));
  assert.throws(()=>nativeProvider(config('openai'),{})(),/Missing provider credential/);
});
test('native model discovery requires no key, rejects custom URLs and keeps model ownership',async t=>{
  const {settings}=await fixture(t);
  const c=config('google');
  const draft={kind:'native',providerId:c.providerId};
  const listed=await settings.models(draft);
  assert.ok(listed.models.includes(c.modelId));
  assert.equal(listed.source,'bundled-pi-catalog');
  await assert.rejects(settings.test({...draft,modelId:c.modelId}),/PROVIDER_KEY_REQUIRED/);
  await assert.rejects(settings.models({...draft,baseUrl:'https://example.com'}),/UNKNOWN_FIELD/);
  await assert.rejects(settings.models({...draft,modelId:'invented'}),/INVALID_PROVIDER/);
  assert.equal(settings.get().catalog.length,8);
});
for (const id of ['openai','anthropic','google','deepseek']) {
  test(`${id}: real Pi adapter consumes protocol stream, applies config and restores saved auth`,async t=>{
    const {dir,app,settings}=await fixture(t);
    const c=config(id),calls=[];
    intercept(t,id,calls);
    const result=await settings.apply({kind:'native',providerId:id,modelId:c.modelId,apiKey:'synthetic-native-key'});
    assert.equal(result.applied,true);
    assert.equal(readConfig(dir).provider.providerId,id);
    assert.equal(settings.get().keyConfigured,true);
    assert.ok(!JSON.stringify(settings.get()).includes('synthetic-native-key'));
    const path=join(dir,'.pida',`provider-key-${id}.json`);
    assert.equal((await stat(path)).mode & 0o777,0o600);
    assert.ok(!(await readFile(join(dir,'pida.config.json'),'utf8')).includes('synthetic-native-key'));
    const {sessionId}=await app.runtime.createSession(principal);
    const run=await app.runtime.run(sessionId,principal,'hello');
    assert.equal(run.status,'completed');
    assert.equal(run.text,'OK');
    assert.ok(calls.length>=2);
    const sent=calls.at(-1);
    if(id==='google') assert.equal(sent.headers.get('x-goog-api-key'),'synthetic-native-key');
    else if(id==='anthropic') assert.equal(sent.headers.get('x-api-key'),'synthetic-native-key');
    else assert.equal(sent.headers.get('authorization'),'Bearer synthetic-native-key');
    await app.runtime.close();
    const restored=await createWorkspace(dir);
    try {
      assert.equal((await restored.runtime.run(sessionId,principal,'again')).text,'OK');
    } finally {await restored.runtime.close();}
  });
}
test('native saved credentials are provider-specific and failed probes preserve previous config',async t=>{
  const {dir,settings}=await fixture(t);
  const c=config('deepseek'),calls=[];
  intercept(t,'deepseek',calls);
  await settings.apply({kind:'native',providerId:'deepseek',modelId:c.modelId,apiKey:'synthetic-deepseek'});
  const before=await readFile(join(dir,'pida.config.json'),'utf8');
  await assert.rejects(settings.apply({kind:'native',providerId:'anthropic',modelId:config('anthropic').modelId}),/PROVIDER_KEY_REQUIRED/);
  assert.equal(await readFile(join(dir,'pida.config.json'),'utf8'),before);
  t.mock.method(globalThis,'fetch',async()=>new Response('synthetic-private-error',{status:401}));
  await assert.rejects(settings.apply({kind:'native',providerId:'deepseek',modelId:c.modelId,apiKey:'wrong-key'}),/PROVIDER_TEST_FAILED/);
  assert.equal(providerEnvironment(dir,readConfig(dir)).DEEPSEEK_API_KEY,'synthetic-deepseek');
  await settings.apply({kind:'mock'});
  assert.equal(settings.get().catalog.find(p=>p.id==='deepseek').keyConfigured,true);
  assert.equal(settings.get().catalog.find(p=>p.id==='anthropic').keyConfigured,false);
});
test('native DeepSeek tool definitions, streamed calls and tool results run through Pi', async t => {
  const { lotStatusTool } = await import('../dist/index.js');
  const c=config('deepseek');
  const requests=[];
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const req=new Request(input,init);
    assert.equal(new URL(req.url).hostname,'api.deepseek.com');
    const body=JSON.parse(await req.text()); requests.push(body);
    if(body.messages.some(m=>m.role==='tool')) return fakeResponse('deepseek',body.model);
    return sse([
      {id:'call',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_lot',type:'function',function:{name:'get_lot_status',arguments:'{"lotId":"LOT-001"}'}}]},finish_reason:null}]},
      {id:'call',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'tool_calls'}]},
    ]);
  });
  const runtime=new PidaRuntime({provider:nativeProvider(c,{[c.apiKeyEnv]:'synthetic-tool-key'}),tools:[lotStatusTool]});
  try {
    const owner={id:'tool-test',permissions:['lots:read']};
    const {sessionId}=await runtime.createSession(owner);
    const result=await runtime.run(sessionId,owner,'LOT-001');
    assert.equal(result.status,'completed');
    assert.ok(requests[0].tools.some(t=>t.function.name==='get_lot_status'));
    const reply=requests[1].messages.find(m=>m.role==='tool');
    assert.match(reply.content,/inspection/);
    assert.match(reply.content,/synthetic/);
  } finally {await runtime.close();}
});
