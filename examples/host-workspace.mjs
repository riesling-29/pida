// Private launcher state, independent of the public collaboration envelope.
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
export const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error(code); };
function regular(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('HOST_STATE_UNSAFE');
  return stat;
}
export function sourceDigest(root) {
  const files = [];
  const walk = directory => { for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) walk(path);
    else if (item.isFile() && item.name.endsWith('.js')) files.push(path);
    else if (item.isSymbolicLink()) fail('HOST_SOURCE_UNSAFE');
  } };
  walk(join(root, 'dist'));
  if (!files.length) fail('HOST_SOURCE_MISSING');
  files.push(...['package.json', 'examples/schumpeter-host.mjs', 'examples/host-workspace.mjs', 'examples/repository-profile.mjs',
    'examples/vera-dispatch-persona.mjs', 'scripts/vera-dispatch-host-probe.py', 'fixtures/vera-dispatch/producer-source-lock.json'].map(p => join(root, p)));
  return digest(JSON.stringify(files.sort().map(path => [relative(root, path).replaceAll('\\', '/'), digest(readFileSync(path))])));
}
export function readHostManifest(directory) {
  const path = join(directory, '.pida-host.json');
  try {
    if (regular(path).size > 8192) fail('HOST_MANIFEST_INVALID');
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) { if (error.message === 'HOST_STATE_UNSAFE') throw error; fail('HOST_MANIFEST_INVALID'); }
}
export function validateHostManifest(directory, expected) {
  const actual = readHostManifest(directory);
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)
    || Object.keys(actual).length !== Object.keys(expected).length
    || Object.keys(expected).some(key => actual[key] !== expected[key])) fail('HOST_RESUME_MISMATCH');
  for (const path of ['pida.config.json', '.env', '.pida/agents-service/supervisor.json']) regular(join(directory, path));
  for (const path of ['.pida', '.pida/agents-service']) if (lstatSync(join(directory, path)).isSymbolicLink()) fail('HOST_STATE_UNSAFE');
}
export function saveHostFile(path, value) {
  if (existsSync(path)) regular(path);
  const temp = path + '.tmp-' + randomUUID();
  try { writeFileSync(temp, value, { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
export function acquireHostLock(directory) {
  const path = join(directory, '.pida-host.lock'), value = JSON.stringify({ pid: process.pid, host: hostname(), nonce: randomUUID() });
  const create = () => writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  try { create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (regular(path).size > 4096) fail('HOST_WORKSPACE_LOCKED');
    const previous = readFileSync(path, 'utf8'); let owner;
    try { owner = JSON.parse(previous); } catch { fail('HOST_WORKSPACE_LOCKED'); }
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) fail('HOST_WORKSPACE_LOCKED');
    let dead = false; try { process.kill(owner.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
    if (!dead) fail('HOST_WORKSPACE_LOCKED');
    const recovery = path + '.recover'; let recoveryOwned = false;
    try {
      writeFileSync(recovery, value, { flag: 'wx', mode: 0o600 }); recoveryOwned = true;
      if (readFileSync(path, 'utf8') !== previous) fail('HOST_WORKSPACE_LOCKED');
      renameSync(path, path + '.stale-' + randomUUID()); create();
    } catch { fail('HOST_WORKSPACE_LOCKED'); }
    finally { if (recoveryOwned) rmSync(recovery, { force: true }); }
  }
  return () => { try { if (readFileSync(path, 'utf8') === value) rmSync(path); } catch { /* never remove another owner's lock */ } };
}
