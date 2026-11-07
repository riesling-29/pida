// Offline packaged SDK + stock launcher probe. It never changes the verified runtime tree.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const [runtimeArg,evidenceArg,expectedManifest]=process.argv.slice(2);
const runtime=resolve(runtimeArg),evidence=resolve(evidenceArg),pida=join(runtime,'pida'),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(join(runtime,'manifest.json'));assert.equal(sha(bytes),expectedManifest);
const manifest=JSON.parse(bytes),sidecarBytes=readFileSync(join(runtime,'managed-host-capabilities.json')),sidecar=JSON.parse(sidecarBytes);
assert.equal(sidecar.schema_version,'pida.managed-host.capabilities/2');assert.equal(sidecar.source_commit,manifest.source_commit);assert.equal(sidecar.repository_profile.ready_protocol,'pida.local-host/3');
assert.equal(manifest.files.find(f=>f.path==='managed-host-capabilities.json').sha256,sha(sidecarBytes));
const sourcePath=fileURLToPath(new URL('../test/repository-profile.test.mjs',import.meta.url));let source=readFileSync(sourcePath,'utf8');const sourceHash=sha(Buffer.from(source));
source=source.replace(/from '(\.\.\/(?:dist|examples)\/[^']+)'/g,(_,name)=>'from '+JSON.stringify(pathToFileURL(resolve(pida,name.slice(3))).href))
 .replace(/from '(@earendil-works\/pi-ai(?:\/providers\/faux)?)'/g,(_,name)=>'from '+JSON.stringify(pathToFileURL(createRequire(join(pida,'package.json')).resolve(name)).href))
 .replace("const sourceRoot=fileURLToPath(new URL('../',import.meta.url));",'const sourceRoot='+JSON.stringify(pida)+';');
assert.ok(!source.includes("from '../dist/"));
const privateDir=mkdtempSync(join(tmpdir(),'pdrepo-release-')),testPath=join(privateDir,'repository.test.mjs'),home=join(privateDir,'home');mkdirSync(home);writeFileSync(testPath,source);
const node=join(runtime,'node',process.platform==='win32'?'node.exe':'node');
const env={PATH:join(runtime,'git',process.platform==='win32'?'cmd':'bin')+(process.platform==='win32'?';'+join(process.env.SystemRoot,'System32'):':/usr/bin:/bin'),HOME:home,USERPROFILE:home,TEMP:tmpdir(),TMP:tmpdir(),LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(home,'absent.gitconfig'),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot}:{} )};
const result=spawnSync(node,['--test',testPath],{cwd:privateDir,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'repository-probe.log'),result.stdout+(result.stderr??''));
const record={schema_version:'pida.repository.packaged-probe/1',source_commit:manifest.source_commit,platform:process.platform,manifest_sha256:expectedManifest,sidecar_sha256:sha(sidecarBytes),test_source_sha256:sourceHash,adapted_test_sha256:sha(Buffer.from(source)),status:result.status===0?'PASS':'FAIL',exit_code:result.status,error_code:result.error?.code??null,log_sha256:sha(readFileSync(join(evidence,'repository-probe.log'))),scope:'12 offline cases: actual packaged public SDK with explicitly simulated provider usage, stock mock launcher fresh/resume/cap3, fixed Node program and project tool effects. No production model invocation; no real-user project. Full-tree verifier is a separate before/after gate.'};
writeFileSync(join(evidence,'repository-probe.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));assert.equal(result.status,0,result.stdout+result.stderr);
