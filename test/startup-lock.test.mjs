import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SessionStore, inspectRuntimeLock } from '../dist/storage.js';

test('lock diagnosis separates stopped, live and unverifiable owners without removing state', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'pida-start-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(inspectRuntimeLock(dir).state, 'absent');
  const store = new SessionStore(dir);
  assert.deepEqual(inspectRuntimeLock(dir), { state: 'live', nonce: store.instanceId });
  assert.throws(() => new SessionStore(dir), /WORKSPACE_ALREADY_RUNNING/);
  store.close();
  const dead = spawnSync(process.execPath, ['-e', '']); assert.equal(dead.status, 0);
  const path = join(dir, 'runtime.lock');
  fs.writeFileSync(path, JSON.stringify({ host: hostname(), pid: dead.pid }));
  assert.equal(inspectRuntimeLock(dir).state, 'stale');
  assert.throws(() => new SessionStore(dir), /WORKSPACE_STALE_LOCK/);
  for (const value of ['broken', JSON.stringify({ host: 'remote', pid: dead.pid }), JSON.stringify({ host: hostname(), pid: 0 })]) {
    fs.writeFileSync(path, value);
    assert.equal(inspectRuntimeLock(dir).state, 'unverified');
    assert.throws(() => new SessionStore(dir), /WORKSPACE_LOCK_UNVERIFIED/);
    assert.equal(fs.readFileSync(path, 'utf8'), value);
  }
});

test('permission and disk errors are not reported as an occupied workspace', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'pida-io-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = fs.writeFileSync;
  try {
    for (const code of ['EACCES', 'ENOSPC']) {
      fs.writeFileSync = (path, ...args) => {
        if (path === join(dir, 'runtime.lock')) throw Object.assign(new Error('fixture'), { code });
        return write(path, ...args);
      };
      syncBuiltinESMExports();
      assert.throws(() => new SessionStore(dir), new RegExp('WORKSPACE_LOCK_IO.*' + code));
    }
  } finally { fs.writeFileSync = write; syncBuiltinESMExports(); }
});
