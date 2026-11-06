import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unlockWorkspaceState } from '../dist/workspace-unlock.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pida-unlock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stopped = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(stopped.status, 0);
  assert.throws(() => process.kill(stopped.pid, 0), { code: 'ESRCH' });
  return { root, dead: { host: hostname(), pid: stopped.pid } };
}
function lock(dir, owner) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'runtime.lock'), JSON.stringify(owner)); }

test('explicit unlock covers root and agent stores only, preserves memory/data and tolerates absent locks', t => {
  const { root, dead } = fixture(t), runtime = join(root, 'agents-service', 'agents', randomUUID(), 'runtime');
  lock(root, dead); lock(runtime, dead);
  const excluded = join(root, 'agents-service', 'agents', 'not-an-agent-id', 'runtime'); lock(excluded, dead);
  const memory = join(root, 'agents-service', 'memory', 'memory.lock'); mkdirSync(join(root, 'agents-service', 'memory'), { recursive: true }); writeFileSync(memory, '');
  writeFileSync(join(runtime, 'preserved.json'), '{"artifact":"untouched"}');
  assert.deepEqual(unlockWorkspaceState(root), { runtimeLocks: 2 });
  assert.equal(existsSync(join(root, 'runtime.lock')), false); assert.equal(existsSync(join(runtime, 'runtime.lock')), false);
  assert.equal(existsSync(join(excluded, 'runtime.lock')), true); assert.equal(existsSync(memory), true);
  assert.equal(readFileSync(join(runtime, 'preserved.json'), 'utf8'), '{"artifact":"untouched"}');
  assert.deepEqual(unlockWorkspaceState(root), { runtimeLocks: 0 });
  assert.deepEqual(unlockWorkspaceState(join(root, 'missing')), { runtimeLocks: 0 });
});

test('preflight rejects live or unverifiable nested owners without partially removing root lock', t => {
  const { root, dead } = fixture(t), runtime = join(root, 'agents-service', 'agents', randomUUID(), 'runtime');
  lock(root, dead); lock(runtime, { host: hostname(), pid: process.pid });
  assert.throws(() => unlockWorkspaceState(root), /still running/); assert.equal(existsSync(join(root, 'runtime.lock')), true);
  lock(runtime, { host: 'a-different-host', pid: dead.pid });
  assert.throws(() => unlockWorkspaceState(root), /Cannot verify/); assert.equal(existsSync(join(root, 'runtime.lock')), true);
  writeFileSync(join(runtime, 'runtime.lock'), 'not-json');
  assert.throws(() => unlockWorkspaceState(root), /Cannot verify/); assert.equal(existsSync(join(root, 'runtime.lock')), true);
});

test('active supervisor and linked directories or lock files are never unlocked', t => {
  const { root, dead } = fixture(t), service = join(root, 'agents-service');
  lock(root, dead); mkdirSync(service);
  const supervisor = join(service, 'supervisor.lock'); writeFileSync(supervisor, JSON.stringify({ host: hostname(), pid: process.pid }));
  assert.throws(() => unlockWorkspaceState(root), /still running/); assert.equal(existsSync(join(root, 'runtime.lock')), true);
  rmSync(supervisor);
  const agents = join(service, 'agents'), outside = join(root, 'outside'); mkdirSync(agents); mkdirSync(outside);
  const linkedAgent = join(agents, randomUUID()); symlinkSync(outside, linkedAgent, 'junction');
  assert.throws(() => unlockWorkspaceState(root), /Unsafe/); assert.equal(existsSync(join(root, 'runtime.lock')), true);
  rmSync(linkedAgent);
  const actual = join(root, 'owner.json'); writeFileSync(actual, JSON.stringify(dead));
  rmSync(join(root, 'runtime.lock')); symlinkSync(actual, join(root, 'runtime.lock'));
  assert.throws(() => unlockWorkspaceState(root), /Unsafe/); assert.equal(existsSync(actual), true);
});
