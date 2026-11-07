import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
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
  const golden=JSON.parse(readFileSync(path));golden.profiles[1].max_turns=25;writeFileSync(path,JSON.stringify(golden));assert.throws(()=>validateManagedCapabilityFiles(root,value,source),/MANAGED_CAPABILITIES_INVALID/);
});
