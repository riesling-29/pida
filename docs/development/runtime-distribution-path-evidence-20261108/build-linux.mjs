import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
const repo='/mnt/d/ChantaResearchGroup/pida',out='/var/tmp/pida-b7f7d52-20261108',delivery=repo+'/.pida-test-runtime-distribution-path-20261108/linux';
const source='b7f7d523c6fede56d508575a6bb78afa343e5566',old=repo+'/.pida-test-runtime-distribution-20261107';
function run(exe,args,env=process.env){const r=spawnSync(exe,args,{env,encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error('FAILED:'+exe+':'+r.status+':'+r.stderr);return r.stdout;}
run(process.execPath,[repo+'/scripts/package-runtime.mjs','--output',out,'--source',source,'--package-tar',repo+'/.pida-test-runtime-distribution-path-20261108/windows/pida-core-0.8.18.tgz','--node-archive',old+'/cache/node-v24.18.0-linux-x64.tar.xz','--git-directory',old+'/git-linux']);
const result=JSON.parse(readFileSync(out+'/result.json'));
mkdirSync(out+'/extracted');run('tar',['-xzf',result.archive,'-C',out+'/extracted']);
writeFileSync(out+'/verify-result.json',run(process.execPath,[repo+'/scripts/verify-runtime-distribution.mjs',out+'/extracted/runtime',result.manifest_sha256]));
run(process.execPath,[repo+'/scripts/probe-runtime-distribution.mjs',out+'/extracted/runtime',out+'/clean-probe.json']);
const config=out+'/reference-config.json',store=out+'/reference-store',entry=repo+'/.pida-test-local-reference-f6edd02/scripts/local_persona_bridge.py';
writeFileSync(config,JSON.stringify({schema_version:'vera-local-reference/0.1.0',principal:'principal:packaging',host_id:'packaged-probe',project_id:'schumpeter',memory_scope:['project:schumpeter','organization:packaging'],persona:{persona_id:'persona:packaging',name:'Packaging reference',description:'Synthetic packaging reference.',source_refs:['document:packaging-probe']},grant_expires_at:Math.floor(Date.now()/1000)+3600}));
run('/usr/bin/python3',['-I','-B',entry,'init','--config',config,'--store',store]);
run(process.execPath,[repo+'/scripts/probe-runtime-distribution.mjs',out+'/extracted/runtime',out+'/reference-probe.json','--reference'],{...process.env,PIDA_PERSONA_BRIDGE_EXECUTABLE:'/usr/bin/python3',PIDA_PERSONA_BRIDGE_PREFIX_ARGS:JSON.stringify(['-I','-B',entry]),PIDA_PERSONA_BRIDGE_CONFIG:config,PIDA_PERSONA_BRIDGE_STORE:store});
mkdirSync(delivery);
for(const file of ['result.json','verify-result.json','clean-probe.json','reference-probe.json'])cpSync(out+'/'+file,delivery+'/'+file);
cpSync(out+'/runtime/manifest.json',delivery+'/manifest.json');cpSync(result.archive,delivery+'/'+result.archive.split('/').at(-1));
console.log(JSON.stringify({status:'PASS',source,delivery,archive_sha256:result.archive_sha256,manifest_sha256:result.manifest_sha256}));
