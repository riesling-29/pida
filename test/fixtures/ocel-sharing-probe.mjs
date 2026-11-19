// Isolated deterministic filesystem fault boundary, alongside the real concurrent-reader regression.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const mode = process.argv[2], parent = resolve(tmpdir()), root = fs.mkdtempSync(join(parent, 'pida-ocel-sharing-'));
assert.ok(root.startsWith(parent + (process.platform === 'win32' ? '\\' : '/')));
const rename = fs.renameSync; let attempts = 0, readerReleased = false, releaseScheduled = false;
fs.renameSync = (from, to) => {
  if (String(to).endsWith('.ocel.json') && JSON.parse(fs.readFileSync(from, 'utf8')).events.some(e => e.type === 'run_finished')) {
    attempts++;
    if (!releaseScheduled) { releaseScheduled = true; setTimeout(() => { readerReleased = true; }, 1); }
    if (mode !== 'transient' || !readerReleased) { const error = new Error('synthetic checkpoint replacement failure'); error.code = mode === 'permanent' ? 'EIO' : 'EPERM'; throw error; }
  }
  return rename(from, to);
};
syncBuiltinESMExports();
const { PidaRuntime, mockProvider, lotStatusTool } = await import('../../dist/index.js');
const options = { storageDir: root, provider: mockProvider, tools: [lotStatusTool] }, principal = { id: 'owner', permissions: ['lots:read'] };
let runtime = new PidaRuntime(options);
try {
  const { sessionId } = await runtime.createSession(principal), result = await runtime.run(sessionId, principal, 'LOT-001');
  assert.equal(result.status, 'completed', 'execution outcome is separate from optional OCEL materialization');
  const terminal = JSON.parse(fs.readFileSync(join(root, 'observations', sessionId, result.runId + '.ocel.json'), 'utf8')).events.some(e => e.type === 'run_finished');
  const limited = runtime.exportRun(sessionId, result.runId, principal).known_limits.includes('OCEL_CHECKPOINT_UNAVAILABLE');
  await runtime.close(); runtime = new PidaRuntime(options);
  const restoredLimit = runtime.exportRun(sessionId, result.runId, principal).known_limits.includes('OCEL_CHECKPOINT_UNAVAILABLE');
  process.stdout.write(JSON.stringify({ mode, attempts, terminal, limited, restoredLimit, readerReleased }));
} finally { await runtime.close(); fs.renameSync = rename; syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); }
