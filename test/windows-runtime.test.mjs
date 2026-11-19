import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPiProcessExecutor, projectCommandEnvironment } from '../dist/process-executor.js';
import { PidaWorkbench, workbenchPermissions } from '../dist/workbench.js';
const repository = fileURLToPath(new URL('../', import.meta.url));
async function directory(t) {
  const parent = resolve(tmpdir()), path = await mkdtemp(join(parent, 'pida-windows-regression-'));
  assert.ok(path.startsWith(parent + (process.platform === 'win32' ? '\\' : '/')));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
const quote = value => "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'";
const nodeCommand = file => (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' ' + quote(file);
test('Pi managed executor preserves native exit codes and PowerShell final statement semantics', async t => {
  const root = await directory(t); await writeFile(join(root, 'fail.mjs'), 'process.exit(7)'); await writeFile(join(root, 'ok.mjs'), 'console.log("ok")');
  const executor = createPiProcessExecutor(process.platform === 'win32' ? 'powershell' : 'bash');
  const cases = [[nodeCommand('fail.mjs'), 7], [nodeCommand('ok.mjs'), 0], ['exit 19', 19]];
  if (process.platform === 'win32') cases.push([nodeCommand('fail.mjs') + '\nWrite-Output "subsequent success"', 0], ['Write-Error "cmdlet failure"', 1], ['throw "terminating failure"', 1]);
  for (const [command, expected] of cases) {
    const result = await executor.execute({ command, cwd: root, env: projectCommandEnvironment(process.env), signal: AbortSignal.timeout(5000), onData: () => {}, pty: false, sandbox: 'none' });
    assert.equal(result.exitCode, expected, command); assert.equal(result.directExited, true); assert.equal(result.rangeExited, 'unknown');
  }
});
test('owned workbench history supports deeply nested workspace paths without global Git configuration', async t => {
  const root = await directory(t), nested = join(root, 'workspace-'.repeat(2), 'private-state-'.repeat(2), 'agents', '00000000-0000-4000-8000-000000000001', 'workbench');
  const bench = new PidaWorkbench(nested), owner = { id: 'owner', permissions: workbenchPermissions };
  assert.ok(nested.length + 64 + '/history.git/hooks/fsmonitor-watchman.sample'.length > 260);
  await bench.write(owner, 'artifacts/result.txt', 'one'); await bench.write(owner, 'artifacts/result.txt', 'two');
  assert.equal((await bench.read(owner, 'artifacts/result.txt')).content, 'two');
  const reopened = new PidaWorkbench(nested);
  assert.equal((await reopened.read(owner, 'artifacts/result.txt')).content, 'two');
});
for (const mode of ['transient', 'persistent', 'permanent']) test(`terminal OCEL ${mode} replacement preserves completion or explicit durable unavailability`, { skip: process.platform !== 'win32' && mode !== 'permanent' }, () => {
  const child = spawnSync(process.execPath, ['test/fixtures/ocel-sharing-probe.mjs', mode], { cwd: repository, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
  if (mode === 'transient') { assert.ok(result.attempts >= 2 && result.attempts <= 6); assert.equal(result.terminal, true); assert.equal(result.limited, false); assert.equal(result.restoredLimit, false); }
  else { assert.equal(result.attempts, mode === 'persistent' ? 6 : 1); assert.equal(result.terminal, false); assert.equal(result.limited, true); assert.equal(result.restoredLimit, true); }
});
