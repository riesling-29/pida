import cp from 'node:child_process';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const exec=cp.execFileSync;
cp.execFileSync=(file,args,options)=>{if(file==='git'){args=['-c','core.longpaths=true','-C',options.cwd,...args];options={...options,cwd:path.parse(options.cwd).root};}try{return exec(file,args,options);}catch(e){process.stderr.write(JSON.stringify({code:e.code,status:e.status,stderr:String(e.stderr)})+'\n');throw e;}};
syncBuiltinESMExports();
await import('../../../test/windows-runtime.test.mjs');
