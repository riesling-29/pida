import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverPrograms, createManifest, createProgramDiscoveryTool } from '../dist/program-catalog.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pida-program-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  return { root, write };
}
const manifest = { version: 1, id: 'fixture_program', name: 'Fixture program', description: 'Fixture only', command: '$node', args: ['bin/tool.js'], entrypoint: 'bin/tool.js', inputMode: 'none', outputMode: 'text', effect: 'write', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };

test('repository discovery reads metadata without importing main/bin or running lifecycle canaries', t => {
  const { root, write } = fixture(t);
  const canary = join(root, 'executed-canary');
  write('bin/tool.js', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'unexpected');`);
  write('package.json', { name: '@fixture/tool', main: 'bin/tool.js', scripts: { test: 'node bin/tool.js', postinstall: 'CANARY_PRIVATE_SCRIPT_BODY', 'bad\nname': 'ignored' }, bin: { fixture: 'bin/tool.js', missing: 'missing.js', unsafe: '../outside.js' } });
  write('sub/package.json', { name: 'nested', scripts: { build: 'node does-not-exist.js' } });
  write('pyproject.toml', '[project.scripts]\npython-tool = "fixture.cli:main"\n[tool.poetry.scripts]\nadvanced = { callable = "fixture.cli:main" }\n');
  write('pida.program.json', manifest);
  const catalog = discoverPrograms(root);
  assert.equal(catalog.truncated, false); assert.equal(existsSync(canary), false);
  assert.equal(catalog.candidates.filter(c => c.kind === 'npm-script').length, 3);
  assert.equal(catalog.candidates.find(c => c.kind === 'node-bin' && c.entry === 'fixture').status, 'ready');
  assert.equal(catalog.candidates.find(c => c.entry === 'missing').status, 'adapter-required');
  assert.equal(catalog.candidates.find(c => c.entry === 'unsafe').status, 'adapter-required');
  assert.equal(catalog.candidates.find(c => c.kind === 'python-entrypoint').status, 'adapter-required');
  assert.ok(catalog.warnings.some(w => w.code === 'PYTHON_ENTRYPOINT_DECLARATION_UNSUPPORTED'));
  assert.ok(catalog.candidates.every(c => /^[a-f0-9]{64}$/.test(c.sourceDigest)));
  assert.ok(!JSON.stringify(catalog).includes('CANARY_PRIVATE_SCRIPT_BODY'));
  assert.deepEqual(discoverPrograms(root), catalog);
  write('package.json', { name: '@fixture/tool', scripts: { test: 'changed command' } });
  const before = catalog.candidates.find(c => c.kind === 'npm-script' && c.entry === 'test');
  const after = discoverPrograms(root).candidates.find(c => c.kind === 'npm-script' && c.entry === 'test');
  assert.equal(after.id, before.id); assert.notEqual(after.sourceDigest, before.sourceDigest);
});

test('draft generation maps only declared fixed entrypoints and scripts, without enabling tools or inventing protocols', t => {
  const { root, write } = fixture(t);
  write('bin/tool.js', 'console.log("fixture")');
  write('package.json', { name: 'fixture', scripts: { test: 'node bin/tool.js' }, bin: { fixture: 'bin/tool.js' } });
  write('sub/package.json', { scripts: { test: 'node nonexistent.js' } });
  write('pyproject.toml', '[project.scripts]\nfixture-python = "module:main"');
  write('pida.program.json', manifest);
  const catalog = discoverPrograms(root);
  const bin = catalog.candidates.find(c => c.kind === 'node-bin');
  const draft = createManifest(bin, { id: 'approved_later' });
  assert.equal(draft.id, 'approved_later'); assert.equal(draft.command, '$node'); assert.deepEqual(draft.args, ['bin/tool.js']);
  assert.equal(draft.inputMode, 'none'); assert.equal(draft.effect, 'write'); assert.ok(!('enabled' in draft)); assert.ok(!('permission' in draft));
  const npm = catalog.candidates.find(c => c.kind === 'npm-script' && c.path === 'sub/package.json');
  const npmDraft = createManifest(npm);
  assert.equal(npmDraft.command, '$npm'); assert.deepEqual(npmDraft.args, ['--prefix', 'sub', 'run', 'test']);
  const explicit = createManifest(npm, { npmRunner: { command: process.execPath, argsPrefix: ['/host/npm-cli.js'] } });
  assert.equal(explicit.command, process.execPath); assert.deepEqual(explicit.args, ['/host/npm-cli.js', '--prefix', 'sub', 'run', 'test']);
  assert.deepEqual(createManifest(catalog.candidates.find(c => c.kind === 'manifest')), manifest);
  assert.throws(() => createManifest(catalog.candidates.find(c => c.kind === 'python-entrypoint')), /PROGRAM_ADAPTER_REQUIRED/);
  assert.throws(() => createManifest({ ...bin, target: '../outside.js' }), /PROGRAM_ADAPTER_REQUIRED/);
});

test('scan bounds, protected paths, unsafe metadata and links are enforced without leaking file contents', t => {
  const { root, write } = fixture(t);
  write('package.json', { scripts: { safe: 'echo safe' } });
  for (const dir of ['node_modules/hidden', '.git/hidden', '.env.private', 'protected']) write(`${dir}/package.json`, { scripts: { secret: 'echo secret' } });
  write('deep/one/two/package.json', { scripts: { nested: 'echo nested' } });
  write('oversized/package.json', ' '.repeat(131073));
  write('bad/pida.program.json', { ...manifest, permissions: ['grant-me'] });
  write('linked-source.json', { scripts: { linked: 'echo linked' } });
  mkdirSync(join(root, 'symlink')); symlinkSync(join(root, 'linked-source.json'), join(root, 'symlink/package.json'));
  mkdirSync(join(root, 'hardlink')); linkSync(join(root, 'linked-source.json'), join(root, 'hardlink/package.json'));
  const catalog = discoverPrograms(root, { protectedPaths: [join(root, 'protected')] });
  assert.deepEqual(catalog.candidates.map(c => c.entry).sort(), ['nested', 'safe']);
  assert.ok(catalog.warnings.some(w => w.code === 'PROGRAM_MANIFEST_INVALID'));
  assert.ok(catalog.warnings.some(w => w.code === 'PROGRAM_METADATA_INVALID'));
  const shallow = discoverPrograms(root, { maxDepth: 0 });
  assert.equal(shallow.truncated, true); assert.deepEqual(shallow.candidates.map(c => c.entry), ['safe']);
  const bounded = discoverPrograms(root, { maxFiles: 1 }); assert.equal(bounded.truncated, true); assert.ok(bounded.candidates.length <= 1);
  assert.throws(() => discoverPrograms(root, { maxDepth: 99 }), /PROGRAM_SCAN_LIMIT_INVALID/);
});

test('agent discovery enforces read permission and stays below runtime tool output limits', async t => {
  const { root, write } = fixture(t);
  write('package.json', { name: 'fixture', scripts: Object.fromEntries(Array.from({ length: 180 }, (_v, i) => [`script_${i}_${'x'.repeat(90)}`, 'echo fixture'])) });
  write('pida.program.json', manifest);
  const tool = createProgramDiscoveryTool(root), context = { principal: { id: 'alice', permissions: ['project:read'] }, sessionId: 'fixture', runId: 'fixture', signal: new AbortController().signal };
  const result = await tool.execute({}, context);
  assert.equal(result.candidateCount, 181); assert.equal(result.truncated, true);
  assert.ok(result.candidates.length > 0 && result.candidates.length <= 50);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 30000);
  assert.ok(result.candidates.every(c => !('manifest' in c)));
  await assert.rejects(() => tool.execute({}, { ...context, principal: { id: 'alice', permissions: [] } }), { code: 'FORBIDDEN' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => tool.execute({}, { ...context, signal: abort.signal }), { name: 'AbortError' });
});
