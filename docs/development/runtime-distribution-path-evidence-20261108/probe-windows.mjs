import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const repo=process.cwd(),out=resolve('.pida-test-runtime-distribution-path-20261108/windows'),result=JSON.parse(readFileSync(out+'/result.json'));
function run(exe,args,env=process.env){const r=spawnSync(exe,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(r.status!==0)throw Error('FAILED:'+exe+':'+r.status+':'+r.stderr);return r.stdout;}
mkdirSync(out+'/extracted');run('tar',['-xzf',result.archive,'-C',out+'/extracted']);
writeFileSync(out+'/verify-result.json',run(process.execPath,[repo+'/scripts/verify-runtime-distribution.mjs',out+'/extracted/runtime',result.manifest_sha256]));
run(process.execPath,[repo+'/scripts/probe-runtime-distribution.mjs',out+'/extracted/runtime',out+'/clean-probe.json']);
const config=out+'/reference-config.json',store=out+'/reference-store',entry=repo+'/.pida-test-local-reference-f6edd02/scripts/local_persona_bridge.py',python='C:/Users/migeo/AppData/Local/Programs/Python/Python311/python.exe';
writeFileSync(config,JSON.stringify({schema_version:'vera-local-reference/0.1.0',principal:'principal:packaging',host_id:'packaged-probe',project_id:'schumpeter',memory_scope:['project:schumpeter','organization:packaging'],persona:{persona_id:'persona:packaging',name:'Packaging reference',description:'Synthetic packaging reference.',source_refs:['document:packaging-probe']},grant_expires_at:Math.floor(Date.now()/1000)+3600}));
run(python,['-I','-B',entry,'init','--config',config,'--store',store]);
run(process.execPath,[repo+'/scripts/probe-runtime-distribution.mjs',out+'/extracted/runtime',out+'/reference-probe.json','--reference'],{...process.env,PIDA_PERSONA_BRIDGE_EXECUTABLE:python,PIDA_PERSONA_BRIDGE_PREFIX_ARGS:JSON.stringify(['-I','-B',entry]),PIDA_PERSONA_BRIDGE_CONFIG:config,PIDA_PERSONA_BRIDGE_STORE:store});
console.log(JSON.stringify({status:'PASS',source:result.source_commit,archive_sha256:result.archive_sha256,manifest_sha256:result.manifest_sha256}));
