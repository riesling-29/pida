import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [runtimeArg,metadataArg]=process.argv.slice(2);
const {canonical}=await import(pathToFileURL(join(resolve(runtimeArg),'pida/dist/private-state.js')).href);
const root=resolve(metadataArg),hash=b=>createHash('sha256').update(b).digest('hex');
const handoff=JSON.parse(readFileSync(join(root,'handoff.json')));
const checks=[];
for(const r of handoff.records){
  for(const [name,digest]of Object.entries(r.files)) assert.equal(hash(readFileSync(join(root,name))),digest);
  const prefix=Object.keys(r.files).find(n=>n.endsWith('.ocel.json')).slice(0,-10);
  const doc=JSON.parse(readFileSync(join(root,prefix+'.ocel.json')));
  const meta=JSON.parse(readFileSync(join(root,prefix+'.ocel.meta.json')));
  const manifest=JSON.parse(readFileSync(join(root,prefix+'.manifest.json')));
  assert.equal(hash(canonical(doc)),meta.digest);
  assert.equal(manifest.run_id,r.run_id);
  assert.equal(manifest.task_id,r.job_id);
  assert.ok(manifest.known_limits.includes('HOST_PROJECT_ARTIFACTS_NOT_CAPTURED'));
  assert.equal(manifest.artifact_refs.length,0);
  assert.ok(doc.events.some(e=>e.type==='run_finished'));
  checks.push({job_id:r.job_id,run_id:r.run_id,canonical_document_sha256:meta.digest,source_bundle_digest:meta.sourceDigest,events:doc.events.length,objects:doc.objects.length,terminal:manifest.reported_status,limits:manifest.known_limits});
}
console.log(JSON.stringify({status:'PASS',scope:'Existing saved metadata only; no export or execution',checks},null,2));
