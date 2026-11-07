import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [cwd, label, ...args] = process.argv.slice(2);
const started = new Date().toISOString();
const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
child.on('error', error => { stderr += String(error); });
child.on('close', (code, signal) => {
  const record = { cwd, label, node: process.version, args, started, finished: new Date().toISOString(), code, signal };
  writeFileSync(new URL(`${label}.log`, import.meta.url), stdout + '\nSTDERR\n' + stderr, 'utf8');
  writeFileSync(new URL(`${label}.json`, import.meta.url), JSON.stringify(record, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(record));
  console.log(stdout.slice(-5500));
  console.error(stderr.slice(-2000));
  process.exitCode = code ?? 1;
});
