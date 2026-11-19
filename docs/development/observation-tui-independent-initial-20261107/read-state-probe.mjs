import { mkdtempSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]);
const { PidaClient } = await import(pathToFileURL(join(root,'dist/client.js')));
const { connectObservationTui } = await import(pathToFileURL(join(root,'examples/schumpeter-observation-tui.mjs')));
const directory=mkdtempSync(join(tmpdir(),'pdt-review-')), workspace=join(directory,'host');
const policy=createServer((_q,r)=>{r.writeHead(403);r.end();}); await new Promise(r=>policy.listen(0,'127.0.0.1',r));
const child=spawn(process.execPath,[join(root,'examples/schumpeter-host.mjs'),'--workspace',workspace,'--host-id','review-host'],{env:{...process.env,PIDA_SCHUMPETER_AUTH_URL:`http://127.0.0.1:${policy.address().port}/v1/pida-authorization`,PIDA_SCHUMPETER_AUTH_TOKEN:randomBytes(32).toString('hex')},stdio:['pipe','pipe','pipe'],windowsHide:true});
const closed=new Promise(r=>child.once('close',r)); let connection;
let stderr=''; child.stderr.on('data',b=>stderr+=b);
function snapshot(base){const result={};const visit=(path,rel='')=>{for(const name of readdirSync(path)){const full=join(path,name),key=rel?rel+'/'+name:name; const st=lstatSync(full);if(st.isDirectory()){result[key+'/']='directory';visit(full,key);}else result[key]=createHash('sha256').update(readFileSync(full)).digest('hex');}};visit(base);return result;}
function changes(before,after){return Object.keys(after).filter(key=>before[key]!==after[key]);}
try {
 const ready=await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('READY_TIMEOUT')),10000); child.once('close',()=>{clearTimeout(timer);rej(Error('HOST_EARLY_EXIT'));});createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line);if(message.type==='pida-host-ready'){clearTimeout(timer);res(message);}});});
 const owner=new PidaClient({baseUrl:ready.base_url,token:()=>ready.api_token});
 const agent=await owner.createAgent({name:'untouched observed agent'});await owner.pauseAgent(agent.id);
 const before=snapshot(workspace), calls=[];
 connection=await connectObservationTui({PIDA_TUI_BASE_URL:ready.base_url,PIDA_TUI_TOKEN:ready.api_token,PIDA_TUI_HOST_ID:ready.host_id},(url,init)=>{calls.push({path:new URL(url).pathname,method:init.method??'GET'});return fetch(url,init);});
 const afterConnect=snapshot(workspace);
 const read=await connection.client.getAgentWorkbench(agent.id);
 const afterInspect=snapshot(workspace);
 assert.ok(calls.every(call=>call.method==='GET'));
 const result={source:'495f6f6877aa5836ebd9f839462984d8bb806a7b',workspace,connectChanges:changes(before,afterConnect),inspectChanges:changes(afterConnect,afterInspect),calls,files:read.files.length,historyEntries:read.history.length};
 writeFileSync(new URL('read-state-probe-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {connection?.close();child.stdin.end();const timer=setTimeout(()=>child.kill(),6000);await closed;clearTimeout(timer);await new Promise(r=>policy.close(r));}
