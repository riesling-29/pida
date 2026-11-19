import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const directory=await mkdtemp(join(tmpdir(),'pida-review-close-'));
const child=spawn(process.execPath,['--import',pathToFileURL(resolve('review-inject-close.mjs')).href,resolve('examples/schumpeter-host.mjs'),'--workspace',directory,'--host-id','review-host'],{env:{...process.env,PIDA_SCHUMPETER_AUTH_URL:'http://127.0.0.1:9/v1/pida-authorization',PIDA_SCHUMPETER_AUTH_TOKEN:'review-unused-synthetic-token-'.repeat(2)},stdio:['pipe','pipe','pipe'],windowsHide:true});
let exited=false;const closed=new Promise(r=>child.once('close',code=>{exited=true;r(code)}));child.stderr.resume();
try{
  const ready=await new Promise((r,j)=>{child.once('error',j);child.once('close',code=>j(Error('startup exited '+code)));createInterface({input:child.stdout}).on('line',l=>{const v=JSON.parse(l);if(v.type==='pida-host-ready')r(v);});});
  child.stdin.end();await delay(700);let status;
  try{status=(await fetch(ready.base_url+'/health',{signal:AbortSignal.timeout(1000)})).status;}catch{status='unreachable';}
  console.log(JSON.stringify({case:'parent-eof-after-runtime-close-error',exited,httpHealthStatus:status}));
  assert.equal(exited,true);assert.equal(status,'unreachable');assert.equal(await closed,1);
}finally{if(!exited)child.kill();await closed;await rm(directory,{recursive:true,force:true});}
