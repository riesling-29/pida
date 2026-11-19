import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PidaWorkbench,workbenchPermissions} from '../dist/workbench.js';
import {PidaRuntime} from '../dist/runtime.js';
import {fauxProvider,fauxAssistantMessage as answer,fauxToolCall as call} from '@earendil-works/pi-ai/providers/faux';
const owner={id:'path-owner',permissions:workbenchPermissions};
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'pida-pi-path-'));
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('pida-pi-path-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bench=new PidaWorkbench(join(root,'bench')),context={principal:owner,sessionId:randomUUID(),runId:randomUUID(),toolCallId:randomUUID(),signal:new AbortController().signal};
  const invoke=(kind,args)=>bench.tools().find(tool=>tool.name==='workspace_'+kind).execute(args,context);
  return {root,bench,invoke,files:join(root,'bench',sha(owner.id),'files')};
}
async function denied(fn){let value;try{value=await fn();}catch(error){assert.ok(['INVALID_PATH','UNSAFE_FILE','UNSAFE_DIRECTORY'].includes(error.code),error.code);return;}assert.equal(value.ok,false);}

test('Pi nested write/read/edit preserves logical forward-slash paths and exact bytes',async t=>{
  const {bench,invoke}=fixture(t),path='artifacts/organization-a-result.json',before='{"synthetic":true,"value":1}',after='{"synthetic":true,"value":2}';
  assert.equal((await invoke('write',{path,content:before})).ok,true);
  assert.equal((await bench.read(owner,path)).content,before);
  const read=await invoke('read',{path});assert.equal(read.ok,true);assert.match(read.content,/"value":1/);
  assert.equal((await invoke('edit',{path,edits:[{oldText:'"value":1',newText:'"value":2'}]})).ok,true);
  const file=await bench.read(owner,path);assert.equal(file.content,after);assert.equal(file.revision,sha(after));
  assert.match((await invoke('read',{path})).content,/"value":2/);
  const snapshot=await bench.captureFiles(owner);assert.equal(snapshot[path],after);
});

test('flat Pi paths, direct nested API and independent owner remain unchanged',async t=>{
  const {bench,invoke}=fixture(t);
  assert.equal((await invoke('write',{path:'flat.json',content:'{"flat":true}'})).ok,true);
  await bench.write(owner,'artifacts/direct-control.json','{"direct":true}');
  assert.equal((await invoke('read',{path:'artifacts/direct-control.json'})).ok,true);
  assert.equal((await bench.read(owner,'flat.json')).content,'{"flat":true}');
  await assert.rejects(bench.read({id:'other',permissions:workbenchPermissions},'artifacts/direct-control.json'));
});

test('traversal, absolute, drive and backslash inputs remain denied by all Pi file tools',async t=>{
  const {root,invoke}=fixture(t),outside=join(root,'outside.json');writeFileSync(outside,'unchanged');
  for(const path of ['../outside.json','artifacts/../outside.json','/outside.json',outside,'C:/outside.json','C:outside.json','\\\\server\\share\\outside.json','..\\outside.json','artifacts\\file.json','artifacts//file.json','artifacts/.hidden']){
    await denied(()=>invoke('write',{path,content:'modified'}));
    await denied(()=>invoke('read',{path}));
    await denied(()=>invoke('edit',{path,edits:[{oldText:'unchanged',newText:'modified'}]}));
  }
  assert.equal(readFileSync(outside,'utf8'),'unchanged');
});

test('directory symlink or Windows junction cannot redirect Pi read/write/edit outside owned files',async t=>{
  const {root,bench,files,invoke}=fixture(t);await bench.write(owner,'safe.json','safe');
  const outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'secret.json'),'unchanged');
  symlinkSync(outside,join(files,'redirect'),process.platform==='win32'?'junction':'dir');
  await denied(()=>invoke('read',{path:'redirect/secret.json'}));
  await denied(()=>invoke('write',{path:'redirect/secret.json',content:'modified'}));
  await denied(()=>invoke('edit',{path:'redirect/secret.json',edits:[{oldText:'unchanged',newText:'modified'}]}));
  assert.equal(readFileSync(join(outside,'secret.json'),'utf8'),'unchanged');
});

test('hardlinked files remain denied before Pi writes or edits',async t=>{
  const {root,bench,files,invoke}=fixture(t);await bench.write(owner,'safe.json','safe');
  const outside=join(root,'outside.json');writeFileSync(outside,'unchanged');linkSync(outside,join(files,'linked.json'));
  await denied(()=>invoke('read',{path:'linked.json'}));await denied(()=>invoke('write',{path:'linked.json',content:'modified'}));
  await denied(()=>invoke('edit',{path:'linked.json',edits:[{oldText:'unchanged',newText:'modified'}]}));
  assert.equal(readFileSync(outside,'utf8'),'unchanged');
});

test('actual local Pi runtime nested file flow completes with run-captured artifact',async t=>{
  const {bench}=fixture(t),f=fauxProvider({tokensPerSecond:100000}),path='artifacts/result.json';
  f.setResponses([answer(call('workspace_write',{path,content:'{"value":1}'}),{stopReason:'toolUse'}),answer(call('workspace_read',{path}),{stopReason:'toolUse'}),answer(call('workspace_edit',{path,edits:[{oldText:'"value":1',newText:'"value":2'}]}),{stopReason:'toolUse'}),answer('{"value":2}')]);
  const runtime=new PidaRuntime({tools:bench.tools(),provider:()=>({provider:f.provider,modelId:f.getModel().id}),maxRunMs:5000,maxProviderRetries:0,inspectArtifacts:()=>bench.captureArtifacts(owner)});t.after(()=>runtime.close());
  const {sessionId}=await runtime.createSession(owner),result=await runtime.run(sessionId,owner,'Synthetic nested file task');
  assert.equal(result.status,'completed');assert.equal(result.text,'{"value":2}');assert.equal(f.state.callCount,4);
  const file=await bench.read(owner,path);assert.equal(file.content,result.text);
  // A run retains observed prior versions too; select the exact final bytes.
  const bundle=runtime.exportRun(sessionId,result.runId,owner),ref=bundle.manifest.artifact_refs.find(r=>r.path===path&&r.sha256===sha(file.content));
  assert.ok(ref);
  assert.equal(ref.sha256,sha(file.content));assert.equal(ref.bytes,Buffer.byteLength(file.content));
  assert.equal(bundle.events.filter(e=>e.activity==='tool_failed').length,0);
});
