import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPersonaSubstrateOcel, personaSubstrateOcelInput } from '../dist/persona-substrate-input.js';

const fixture = fileURLToPath(new URL('./fixtures/persona-substrate/ps-v2-demo.ocel.json', import.meta.url));
const digest = 'cd6d29d0eb5002ddeb908a15e574df766f3250135674a517e412774fbd0433ab';

test('reads persona substrate demo ocel and reports digest and counts', async () => {
  const result = readPersonaSubstrateOcel(fixture);
  assert.equal(result.schemaVersion, personaSubstrateOcelInput);
  assert.equal(result.digest, digest);
  assert.deepEqual(result.counts, { events: 3, objects: 2, e2o: 6, o2o: 0 });
  assert.equal(result.document.events.length, 3);
  assert.deepEqual(result.document.eventTypes.map(type => type.name).sort(), [
    '단계완료', '범위변경', '새지시', '승인', '승인거절', '승인요청', '승격', '오류', '위임요청', '위임회신', '재개', '취소',
  ].sort());
});

test('rejects symlink and non-regular input file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-input-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'demo.json');
  await writeFile(target, '{}');
  const link = join(root, 'link.json');
  await symlink(target, link);
  assert.throws(() => readPersonaSubstrateOcel(link), /PERSONA_SUBSTRATE_OCEL_INPUT_INVALID/);
  const directory = join(root, 'dir');
  await mkdir(directory);
  assert.throws(() => readPersonaSubstrateOcel(directory), /PERSONA_SUBSTRATE_OCEL_INPUT_INVALID/);
});

test('rejects input over 2097152 bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'large.json');
  await writeFile(path, Buffer.alloc(2_097_153, 0x20));
  assert.throws(() => readPersonaSubstrateOcel(path), /PERSONA_SUBSTRATE_OCEL_INPUT_LIMIT/);
});

test('rejects extra top-level keys', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-extra-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'extra.json');
  const parsed = structuredClone(readPersonaSubstrateOcel(fixture));
  const extra = { ...parsed.document, extra: [] };
  await writeFile(path, JSON.stringify(extra));
  assert.throws(() => readPersonaSubstrateOcel(path), /PERSONA_SUBSTRATE_OCEL_TOP_LEVEL_INVALID/);
});

test('rejects event without exactly one work_item case relationship', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-case-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'case.json');
  const document = structuredClone(readPersonaSubstrateOcel(fixture).document);
  document.events[0].relationships = document.events[0].relationships.filter(relation => relation.qualifier !== 'case');
  await writeFile(path, JSON.stringify(document));
  assert.throws(() => readPersonaSubstrateOcel(path), /PERSONA_SUBSTRATE_OCEL_CASE_RELATION_INVALID/);
});

test('rejects non-increasing log_seq', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-log-seq-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'log-seq.json');
  const document = structuredClone(readPersonaSubstrateOcel(fixture).document);
  document.events[2].attributes.find(attribute => attribute.name === 'log_seq').value = 2;
  await writeFile(path, JSON.stringify(document));
  assert.throws(() => readPersonaSubstrateOcel(path), /PERSONA_SUBSTRATE_OCEL_LOG_SEQ_INVALID/);
});

test('rejects forbidden body attribute names', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-forbidden-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'forbidden.json');
  const document = structuredClone(readPersonaSubstrateOcel(fixture).document);
  document.events[0].attributes.push({ name: 'body', value: 'hidden' });
  await writeFile(path, JSON.stringify(document));
  assert.throws(() => readPersonaSubstrateOcel(path), /PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE/);
});

test('does not spawn pix worker or write process intelligence storage', async t => {
  const storage = await mkdtemp(join(tmpdir(), 'pida-ps-ocel-pi-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const before = await readdir(storage);
  readPersonaSubstrateOcel(fixture);
  const after = await readdir(storage);
  assert.deepEqual(after, before);
  const compiled = await readFile(fileURLToPath(new URL('../dist/persona-substrate-input.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(compiled, /pix-worker|child_process|ProcessIntelligence|createPixOcelPort/);
});
