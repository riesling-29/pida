import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const artifact = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    assert.equal(entry.isSymbolicLink(), false);
    return entry.isDirectory() ? inventory(root, relative) : [{ path: relative, bytes: fs.statSync(path.join(root, relative)).size, sha256: hash(fs.readFileSync(path.join(root, relative))) }];
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const before = inventory(artifact);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pida-mingit-'));
const files = path.join(root, 'files'), home = path.join(root, 'isolated-home');
fs.mkdirSync(files); fs.mkdirSync(home);
const sentinel = '# Synthetic global configuration must remain unchanged\n[probe]\nvalue = untouched\n';
fs.writeFileSync(path.join(home, '.gitconfig'), sentinel);
const env = { PATH: path.join(artifact, 'cmd'), SystemRoot: process.env.SystemRoot, HOME: home,
  USERPROFILE: home, TEMP: root, TMP: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const commandResults = [];
function git(args) {
  const output = execFileSync('git.exe', ['--git-dir', '../history.git', '--work-tree', '.', '-c', 'core.longpaths=true', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Pida', '-c', 'user.email=pida@localhost', ...args], { cwd: files, env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  commandResults.push({ args, status: 0, output: output.trimEnd() });
  return output.trimEnd();
}
try {
  const resolved = execFileSync(path.join(process.env.SystemRoot, 'System32', 'where.exe'), ['git.exe'], { cwd: files, env, encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.deepEqual(resolved.map(value => path.resolve(value).toLowerCase()), [path.join(artifact, 'cmd/git.exe').toLowerCase()]);
  const version = git(['--version']); assert.equal(version, 'git version 2.56.0.windows.4');
  git(['init', '--quiet']); git(['commit', '--allow-empty', '-qm', 'Initial workspace']);
  const first = git(['rev-parse', 'HEAD']);
  const content = 'Synthetic portable Git artifact: 리슬링\n'; fs.writeFileSync(path.join(files, 'result.txt'), content);
  git(['add', '--all']); git(['commit', '-qm', 'Synthetic artifact']);
  const second = git(['rev-parse', 'HEAD']); assert.notEqual(first, second);
  assert.equal(git(['status', '--porcelain']), '');
  assert.equal(git(['log', '--format=%s', '-1']), 'Synthetic artifact');
  git(['merge-base', '--is-ancestor', first, second]);
  assert.equal(git(['diff', '--name-only', first, second]), 'result.txt');
  assert.match(git(['ls-tree', '-r', '--name-only', 'HEAD']), /^result\.txt$/);
  assert.equal(git(['show', 'HEAD:result.txt']), content.trimEnd());
  assert.equal(fs.readFileSync(path.join(home, '.gitconfig'), 'utf8'), sentinel);
  assert.deepEqual(inventory(artifact), before, 'MinGit package files changed during invocation');
  const licenseFiles = before.filter(file => /(^|\/)(licenses\/|LICENSE|COPYING)/i.test(file.path));
  fs.writeFileSync(output, JSON.stringify({ platform: process.platform, release: os.release(), architecture: process.arch,
    artifact, version, cleanPath: env.PATH, resolvedExecutables: resolved, syntheticHomeUnchanged: true,
    actualUserConfigAccess: 'disabled by isolated environment and GIT_CONFIG_GLOBAL=/dev/null; not read',
    packageUnchanged: true, files: before.length, unpackedBytes: before.reduce((sum, file) => sum + file.bytes, 0),
    fileInventoryDigest: hash(JSON.stringify(before)), inventory: before, licenseFiles, commands: commandResults,
    scope: 'Real local noninteractive Git operations only; no network remotes, hooks, GUI, or clean VM assertion' }, null, 2) + '\n');
  console.log(JSON.stringify({ version, commands: commandResults.length, files: before.length, licenseFiles: licenseFiles.length, packageUnchanged: true, result: output }));
} finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
}
