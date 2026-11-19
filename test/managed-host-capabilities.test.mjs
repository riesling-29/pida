import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManagedCapabilities, validateManagedCapabilities, validateManagedCapabilityFiles } from '../scripts/managed-host-capabilities.mjs';
const source='a'.repeat(40);
test('release capability is exact closed eight-key metadata and source-bound policy tuples',()=>{
  for(const mode of ['policy/1','catalogue/1']){
    const value=createManagedCapabilities(source,mode);assert.equal(Object.keys(value).length,8);assert.deepEqual(validateManagedCapabilities(value,source),value);
    assert.equal(Object.keys(value.execution_policy.profiles[0]).length,13);
    for(const change of [v=>v.extra=true,v=>delete v.entrypoint,v=>v.source_commit='b'.repeat(40),v=>v.ready_protocol='pida.local-host/99',v=>v.execution_policy.profiles.reverse(),v=>v.execution_policy.profiles[0].run_timeout_ms++,v=>v.execution_policy.profiles[0].digest='f'.repeat(64),v=>v.execution_policy.extra=true]){
      const bad=structuredClone(value);change(bad);assert.throws(()=>validateManagedCapabilities(bad,source),/MANAGED_CAPABILITIES_INVALID/);
    }
  }
  for(const [s,m] of [[['a'.repeat(40)],'policy/1'],[source,'future/1'],[source+'\n','policy/1']])assert.throws(()=>createManagedCapabilities(s,m));
  const value=createManagedCapabilities(source,'catalogue/1');value.persona_catalogue.extra=true;assert.throws(()=>validateManagedCapabilities(value,source));
});
test('release declaration requires shipped exact golden and declared regular modules',()=>{
  const root=mkdtempSync(join(tmpdir(),'pd-cap-')),value=createManagedCapabilities(source,'catalogue/1');
  const paths=[value.entrypoint,'pida/dist/execution-policy.js',value.persona_catalogue.module,'pida/examples/vera-local-reference-persona.mjs','pida/fixtures/vera-dispatch/local-reference-source-lock.json'];
  for(const name of paths){mkdirSync(join(root,name,'..'),{recursive:true});writeFileSync(join(root,name),'synthetic-file');}
  const path=join(root,'pida/fixtures/execution-policy/profiles-v1.json');mkdirSync(join(path,'..'),{recursive:true});
  assert.throws(()=>validateManagedCapabilityFiles(root,value,source));
  cpSync(new URL('../fixtures/execution-policy/profiles-v1.json',import.meta.url),path);assert.deepEqual(validateManagedCapabilityFiles(root,value,source),value);
  const sidecar=join(root,'managed-host-capabilities.json');writeFileSync(sidecar,JSON.stringify(value));
  const required=['managed-host-capabilities.json',...paths,'pida/fixtures/execution-policy/profiles-v1.json'];
  const manifest={source_commit:source,source:{source_commit:source},files:required.map(name=>({path:name,sha256:createHash('sha256').update(readFileSync(join(root,name))).digest('hex')}))};
  assert.deepEqual(validateManagedCapabilityFiles(root,value,source,manifest),value);
  for(const mutate of [m=>m.source.source_commit='b'.repeat(40),m=>m.files.splice(1,1),m=>m.files[1].symlink='module-target',m=>m.files.push(m.files[1])]){
    const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>validateManagedCapabilityFiles(root,value,source,bad),/MANAGED_CAPABILITIES_INVALID/);
  }
  const golden=JSON.parse(readFileSync(path));golden.profiles[1].max_turns=25;writeFileSync(path,JSON.stringify(golden));assert.throws(()=>validateManagedCapabilityFiles(root,value,source),/MANAGED_CAPABILITIES_INVALID/);
});

test('repository sidecar2 preserves mode2 defaults and rejects incomplete or downgraded mode3 declarations',()=>{
 const value=createManagedCapabilities(source,'repository/1');assert.equal(Object.keys(value).length,9);assert.equal(Object.keys(value.repository_profile).length,7);assert.equal(value.ready_protocol,'pida.local-host/2');assert.equal(value.repository_profile.ready_protocol,'pida.local-host/3');assert.ok(value.persona_catalogue);assert.deepEqual(validateManagedCapabilities(value,source),value);
 for(const edit of [v=>delete v.repository_profile,v=>v.repository_profile=null,v=>v.repository_profile.extra=1,v=>v.repository_profile.module='pida/examples/other.mjs',v=>v.repository_profile.environment_key='MODEL_PATH',v=>v.repository_profile.ready_protocol='pida.local-host/2',v=>v.ready_protocol='pida.local-host/3',v=>v.persona_catalogue=null,v=>v.schema_version='pida.managed-host.capabilities/1']){const bad=structuredClone(value);edit(bad);assert.throws(()=>validateManagedCapabilities(bad,source));}
 const legacy=createManagedCapabilities(source,'catalogue/1');legacy.repository_profile=value.repository_profile;assert.throws(()=>validateManagedCapabilities(legacy,source));
});

test('repository descriptor and public shape golden plus actual regular inventory paths are required',()=>{
 const root=mkdtempSync(join(tmpdir(),'pd-repocap-')),value=createManagedCapabilities(source,'repository/1');
 const files=[value.entrypoint,'pida/dist/execution-policy.js',value.persona_catalogue.module,'pida/examples/vera-local-reference-persona.mjs','pida/fixtures/vera-dispatch/local-reference-source-lock.json',value.repository_profile.module,'pida/dist/repository-profile.js'];
 for(const name of files){mkdirSync(join(root,name,'..'),{recursive:true});writeFileSync(join(root,name),'synthetic-module');}
 for(const name of ['execution-policy/profiles-v1.json','repository-profile/managed-descriptor-v1.json','repository-profile/capability-v1.json']){const dest=join(root,'pida/fixtures',name);mkdirSync(join(dest,'..'),{recursive:true});cpSync(new URL('../fixtures/'+name,import.meta.url),dest);files.push('pida/fixtures/'+name);}
 writeFileSync(join(root,'managed-host-capabilities.json'),JSON.stringify(value));files.push('managed-host-capabilities.json');const manifest={source_commit:source,source:{source_commit:source},files:files.map(name=>({path:name,sha256:createHash('sha256').update(readFileSync(join(root,name))).digest('hex')}))};assert.deepEqual(validateManagedCapabilityFiles(root,value,source,manifest),value);
 for(const path of [value.repository_profile.module,'pida/dist/repository-profile.js','pida/fixtures/repository-profile/managed-descriptor-v1.json','pida/fixtures/repository-profile/capability-v1.json']){const bad=structuredClone(manifest);bad.files=bad.files.filter(f=>f.path!==path);assert.throws(()=>validateManagedCapabilityFiles(root,value,source,bad));}
 const descriptor=join(root,'pida/fixtures/repository-profile/managed-descriptor-v1.json');writeFileSync(descriptor,JSON.stringify({...value.repository_profile,ready_protocol:'pida.local-host/2'}));assert.throws(()=>validateManagedCapabilityFiles(root,value,source,manifest));
});
