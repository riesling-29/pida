import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../dist/storage.js';
import { ObservationArchive } from '../dist/observation.js';
import { resultManifest } from '../dist/evidence.js';
import { formatTuiTimestamp, formatClockKst } from '../dist/display.js';
import { renderNavBar, chooseNavBarStage } from '../dist/tui-nav-bar.js';
import { visibleWidth, stripTerminalSequences } from '@earendil-works/pi-tui';

function directory(t) { const path = fs.mkdtempSync(join(tmpdir(), 'pida-audit-')); t.after(() => fs.rmSync(path, { recursive: true, force: true })); return path; }
function patchFs(changes, work) {
  const original = Object.fromEntries(Object.keys(changes).map(key => [key, fs[key]]));
  Object.assign(fs, changes); syncBuiltinESMExports();
  try { return work(); } finally { Object.assign(fs, original); syncBuiltinESMExports(); }
}
const ioError = () => Object.assign(new Error('private device details must not escape'), { code: 'ENOSPC' });
function archiveFixture(t, limit) {
  const directoryPath = directory(t), context = { sessionId: randomUUID(), runId: randomUUID(), taskId: 'audit' };
  const archive = new ObservationArchive(directoryPath, undefined, undefined, limit);
  const root = join(directoryPath, 'observations', context.sessionId);
  const manifest = resultManifest({ ...context, agentId: archive.agentId, status: 'completed', version: 'test', verification: [] });
  return { directoryPath, context, archive, root, manifest, reopen: () => new ObservationArchive(directoryPath).bundle(context.sessionId, context.runId) };
}

test('session metadata fsync failure preserves disk and memory; successful replacement is flushed first', t => {
  const dir = directory(t), store = new SessionStore(dir); t.after(() => store.close());
  const record = { version: 1, sessionId: randomUUID(), owner: 'owner', piFile: 'pi.jsonl', title: 'before', runs: 0, nextSequence: 1, traces: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), running: false };
  store.save(record);
  const path = join(dir, 'index', record.sessionId + '.json'), before = fs.readFileSync(path, 'utf8');
  patchFs({ fsyncSync() { throw ioError(); } }, () => assert.throws(() => store.save({ ...record, title: 'must not publish' }), { code: 'ENOSPC' }));
  assert.equal(fs.readFileSync(path, 'utf8'), before); assert.equal(store.get(record.sessionId).title, 'before');
  assert.deepEqual(fs.readdirSync(join(dir, 'index')), [record.sessionId + '.json']);
  const calls = [], sync = fs.fsyncSync, rename = fs.renameSync;
  patchFs({ fsyncSync(fd) { calls.push('sync'); return sync(fd); }, renameSync(a, b) { calls.push('rename'); return rename(a, b); } }, () => store.save({ ...record, title: 'after' }));
  assert.deepEqual(calls, ['sync', 'rename']); assert.equal(store.get(record.sessionId).title, 'after');
});

test('each observation append is flushed; a clean completed bundle survives reopening', t => {
  const f = archiveFixture(t), descriptors = new Map(), synced = [], open = fs.openSync, sync = fs.fsyncSync;
  patchFs({ openSync(path, ...args) { const fd = open(path, ...args); descriptors.set(fd, String(path)); return fd; }, fsyncSync(fd) { synced.push(descriptors.get(fd)); return sync(fd); } }, () => {
    assert.equal(f.archive.record(f.context, 'run_started'), true);
    assert.equal(f.archive.record(f.context, 'run_finished'), true);
    f.archive.finish(f.context, f.manifest);
  });
  assert.equal(synced.filter(path => path?.endsWith('.jsonl')).length, 2);
  assert.equal(f.reopen().complete, true); assert.deepEqual(f.reopen().known_limits, []);
});

test('event capacity remains a distinct incomplete reason after restart', t => {
  const f = archiveFixture(t, 1);
  f.archive.record(f.context, 'run_started'); assert.equal(f.archive.record(f.context, 'run_finished'), false); f.archive.finish(f.context, f.manifest);
  for (const bundle of [f.archive.bundle(f.context.sessionId, f.context.runId), f.reopen()]) {
    assert.equal(bundle.complete, false); assert.ok(bundle.known_limits.includes('OBSERVATION_ARCHIVE_LIMIT')); assert.ok(bundle.known_limits.includes('OBSERVATION_INCOMPLETE'));
    assert.ok(!bundle.known_limits.includes('OBSERVATION_ARCHIVE_IO'));
  }
});

test('corrupt and oversized archives are diagnosable even with no readable events and remain intact', t => {
  const f = archiveFixture(t), path = join(f.root, f.context.runId + '.jsonl'); fs.mkdirSync(f.root, { recursive: true });
  fs.writeFileSync(path, '{broken');
  assert.ok(f.reopen().known_limits.includes('OBSERVATION_ARCHIVE_CORRUPT'));
  assert.equal(fs.readFileSync(path, 'utf8'), '{broken');
  fs.truncateSync(path, 16_777_217);
  assert.ok(f.reopen().known_limits.includes('OBSERVATION_ARCHIVE_LIMIT'));
  assert.equal(fs.statSync(path).size, 16_777_217);
  assert.throws(() => new ObservationArchive(f.directoryPath).bundle(f.context.sessionId, randomUUID()), /RUN_NOT_FOUND/);
});

test('journal fsync failure records IO loss without exposing device errors; marker survives restart', t => {
  const f = archiveFixture(t), descriptors = new Map(), open = fs.openSync, sync = fs.fsyncSync;
  patchFs({ openSync(path, ...args) { const fd = open(path, ...args); descriptors.set(fd, String(path)); return fd; }, fsyncSync(fd) { if (descriptors.get(fd)?.endsWith('.jsonl')) throw ioError(); return sync(fd); } }, () => assert.equal(f.archive.record(f.context, 'run_started'), false));
  f.archive.record(f.context, 'run_finished'); f.archive.finish(f.context, f.manifest);
  const bundle = f.reopen(); assert.equal(bundle.complete, false); assert.ok(bundle.known_limits.includes('OBSERVATION_ARCHIVE_IO'));
  assert.doesNotMatch(JSON.stringify(bundle), /private device/);
});

test('manifest write failure and malformed manifest are distinguished from a damaged event journal', t => {
  const f = archiveFixture(t), rename = fs.renameSync;
  f.archive.record(f.context, 'run_started'); f.archive.record(f.context, 'run_finished');
  patchFs({ renameSync(a, b) { if (String(b).endsWith('.manifest.json')) throw ioError(); return rename(a, b); } }, () => f.archive.finish(f.context, f.manifest));
  const bundle = f.reopen(); assert.equal(bundle.complete, false); assert.ok(bundle.known_limits.includes('OBSERVATION_MANIFEST_FAILED'));
  assert.ok(!bundle.known_limits.includes('OBSERVATION_ARCHIVE_CORRUPT'));
  fs.writeFileSync(join(f.root, f.context.runId + '.manifest.json'), '{broken');
  assert.ok(f.reopen().known_limits.includes('OBSERVATION_MANIFEST_FAILED'));
  fs.writeFileSync(join(f.root, f.context.runId + '.manifest.json'), JSON.stringify({ ...f.manifest, verification_results: 'invalid collection' }));
  assert.equal(f.reopen().manifest, undefined, 'valid JSON with an invalid manifest schema is not published');
});

test('a transient disk outage cannot erase loss diagnostics once finish can persist them', t => {
  const f = archiveFixture(t);
  patchFs({ fsyncSync() { throw ioError(); } }, () => assert.equal(f.archive.record(f.context, 'run_started'), false));
  assert.equal(fs.existsSync(join(f.root, f.context.runId + '.health.json')), false);
  f.archive.record(f.context, 'run_finished'); f.archive.finish(f.context, f.manifest);
  const bundle = f.reopen(); assert.equal(bundle.complete, false); assert.ok(bundle.known_limits.includes('OBSERVATION_ARCHIVE_IO'));
});

test('KST clocks compare full dates, preserve prior years and accept numeric command deadlines', () => {
  const now = new Date('2026-11-05T07:00:00Z');
  assert.equal(formatTuiTimestamp('2026-11-05T06:00:00Z', 'time', now), '15:00:00');
  assert.equal(formatTuiTimestamp('2026-10-05T06:00:00Z', 'time', now), '10-05 15:00:00');
  assert.equal(formatTuiTimestamp('2025-11-05T06:00:00Z', 'time', now), '2025-11-05 15:00:00');
  assert.equal(formatTuiTimestamp('2026-11-04T15:05:00Z', 'time', now), '00:05:00');
  assert.equal(formatClockKst(Date.parse('2026-10-05T06:00:00Z'), { reference: now }), '10-05 15:00:00');
  assert.equal(formatClockKst('invalid'), '시간 미기록');
});

test('truncated navigation and Korean tabs click the displayed overflow menu, never a hidden action', () => {
  for (const tabs of [false, true]) {
    const selected = [], width = tabs ? 64 : 20, label = tabs ? 'F2' : 'F1';
    const items = tabs ? ['개발 작업 긴 이름 '.repeat(4), '검토', '운영'].map((label, index) => ({ label, action: () => selected.push(index) }))
      : Array.from({ length: 9 }, (_, index) => ({ label: `F${index + 1} 메뉴`, action: () => selected.push(index) }));
    const paint = text => `\x1b[32m${text}\x1b[0m`;
    const { line, regions } = renderNavBar(items, width, chooseNavBarStage(items, width), paint, { label, action: () => selected.push('menu') });
    assert.equal(visibleWidth(line), width); assert.ok(stripTerminalSequences(line).endsWith('…' + label));
    regions.find(r => width - 1 >= r.from && width - 1 < r.to).action(); assert.deepEqual(selected, ['menu']);
    for (const region of regions) assert.ok(region.from >= 0 && region.from < region.to && region.to <= width);
  }
  assert.deepEqual(renderNavBar([{ label: '긴 메뉴', action() {} }], 0, 3, s => s).regions, []);
});
