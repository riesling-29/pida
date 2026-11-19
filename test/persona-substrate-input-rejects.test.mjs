// HC-20261119-10 (M8): reproduction tests for HC-20261119-05 H1, H2, the RangeError case and the nine probe inputs.
// Every bad input must be rejected with a PERSONA_SUBSTRATE_OCEL_* code, never accepted and never a RangeError.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as input from '../dist/persona-substrate-input.js';

const { readPersonaSubstrateOcel } = input;

const fixture = fileURLToPath(new URL('./fixtures/persona-substrate/ps-v2-demo.ocel.json', import.meta.url));
const PS_EVENT_TYPES = ['새지시', '단계완료', '오류', '승인', '승인거절', '취소', '범위변경', '재개', '위임요청', '위임회신', '승인요청', '승격'];

const base = () => structuredClone(readPersonaSubstrateOcel(fixture).document);

async function writeCase(t, name, content) {
  const root = await mkdtemp(join(tmpdir(), `pida-ps-ocel-${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, `${name}.json`);
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

function rejectsWith(path, code) {
  assert.throws(() => readPersonaSubstrateOcel(path), error => {
    assert.ok(!(error instanceof RangeError), `RangeError instead of code: ${error.message}`);
    assert.equal(error.message, code);
    return true;
  });
}

// H1: the allowed event types are the 12 PS contract kinds, fixed in the module.

test('H1 exports exactly the 12 PS contract event types', () => {
  assert.ok(input.personaSubstrateEventTypes, 'personaSubstrateEventTypes is not exported');
  assert.deepEqual([...input.personaSubstrateEventTypes].sort(), [...PS_EVENT_TYPES].sort());
});

test('H1 probe foreign_event_type: a type the document declares itself is still rejected', async t => {
  const document = base();
  document.eventTypes.push({ name: '임의유형', attributes: [] });
  document.events[0].type = '임의유형';
  rejectsWith(await writeCase(t, 'foreign-event-type', document), 'PERSONA_SUBSTRATE_OCEL_EVENT_TYPE_INVALID');
});

test('H1 eventTypes must be a subset of the contract even when no event uses the extra type', async t => {
  const document = base();
  document.eventTypes.push({ name: '임의유형', attributes: [] });
  rejectsWith(await writeCase(t, 'extra-declared-type', document), 'PERSONA_SUBSTRATE_OCEL_EVENT_TYPE_INVALID');
});

// H2: event and object ids are unique and every relation resolves.

test('H2 probe dup_event_id is rejected', async t => {
  const document = base();
  document.events[1].id = document.events[0].id;
  rejectsWith(await writeCase(t, 'dup-event-id', document), 'PERSONA_SUBSTRATE_OCEL_ID_DUPLICATE');
});

test('H2 probe dup_object_id is rejected', async t => {
  const document = base();
  document.objects.push(structuredClone(document.objects[1]));
  rejectsWith(await writeCase(t, 'dup-object-id', document), 'PERSONA_SUBSTRATE_OCEL_ID_DUPLICATE');
});

test('H2 probe dangling_rel: E2O to a missing object is rejected', async t => {
  const document = base();
  document.events[0].relationships.push({ objectId: 'agent:Nobody', qualifier: 'actor' });
  rejectsWith(await writeCase(t, 'dangling-e2o', document), 'PERSONA_SUBSTRATE_OCEL_RELATION_DANGLING');
});

test('H2 O2O to a missing object is rejected', async t => {
  const document = base();
  document.objects[0].relationships.push({ objectId: 'tsk_missing', qualifier: 'parent' });
  rejectsWith(await writeCase(t, 'dangling-o2o', document), 'PERSONA_SUBSTRATE_OCEL_RELATION_DANGLING');
});

// RangeError: deep nesting must come back as a JSON code.

test('RangeError probe deep_nesting returns PERSONA_SUBSTRATE_OCEL_JSON_INVALID', async t => {
  rejectsWith(await writeCase(t, 'deep-nesting', '['.repeat(200_000)), 'PERSONA_SUBSTRATE_OCEL_JSON_INVALID');
});

test('nesting just past the depth limit is rejected, normal depth still reads', async t => {
  rejectsWith(await writeCase(t, 'depth-65', `${'['.repeat(65)}${']'.repeat(65)}`), 'PERSONA_SUBSTRATE_OCEL_JSON_INVALID');
  assert.equal(readPersonaSubstrateOcel(fixture).counts.events, 3);
});

// Remaining probe inputs from HC-20261119-05 (M1, M2, M3, L3).

test('probe proto_key: a top-level __proto__ key is kept as a key and rejected', async t => {
  const text = JSON.stringify(base()).replace(/^\{/, '{"__proto__":{"polluted":true},');
  rejectsWith(await writeCase(t, 'proto-key', text), 'PERSONA_SUBSTRATE_OCEL_TOP_LEVEL_INVALID');
  assert.equal({}.polluted, undefined);
});

test('probe proto_key: duplicate __proto__ keys are caught by the duplicate check', async t => {
  const text = JSON.stringify(base()).replace(/^\{/, '{"__proto__":1,"__proto__":2,');
  rejectsWith(await writeCase(t, 'proto-dup', text), 'PERSONA_SUBSTRATE_OCEL_JSON_DUPLICATE_KEY');
});

test('probe bad_time: event time that is not RFC 3339 UTC is rejected', async t => {
  const document = base();
  document.events[0].time = 'not-a-time';
  rejectsWith(await writeCase(t, 'bad-time', document), 'PERSONA_SUBSTRATE_OCEL_TIME_INVALID');
});

test('bad object attribute time is rejected', async t => {
  const document = base();
  document.objects[0].attributes[0].time = '2026-13-40T99:00:00Z';
  rejectsWith(await writeCase(t, 'bad-object-time', document), 'PERSONA_SUBSTRATE_OCEL_TIME_INVALID');
});

test('probe Body_upper: forbidden attribute names are matched case-insensitively', async t => {
  const document = base();
  document.events[0].attributes.push({ name: 'Body', value: 'hidden' });
  rejectsWith(await writeCase(t, 'body-upper', document), 'PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE');
  const objectCase = base();
  objectCase.objects[0].attributes.push({ name: 'SUMMARY', value: 'hidden', time: '2026-11-11T13:00:00.123Z' });
  rejectsWith(await writeCase(t, 'summary-upper', objectCase), 'PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE');
});

test('probe number_trailing_dot: "1." is not JSON', async t => {
  const text = JSON.stringify(base()).replace('"name":"precision_us","value":1000', '"name":"precision_us","value":1000.');
  assert.ok(text.includes('1000.'));
  rejectsWith(await writeCase(t, 'trailing-dot', text), 'PERSONA_SUBSTRATE_OCEL_JSON_INVALID');
});

test('exponent without digits is not JSON', async t => {
  const text = JSON.stringify(base()).replace('"name":"precision_us","value":1000', '"name":"precision_us","value":1e');
  rejectsWith(await writeCase(t, 'bare-exponent', text), 'PERSONA_SUBSTRATE_OCEL_JSON_INVALID');
});

// Existing behaviour stays: the demo fixture and a valid number form still read.

test('valid fractional and exponent numbers still read', async t => {
  const text = JSON.stringify(base()).replace('"name":"precision_us","value":1000', '"name":"precision_us","value":1.0e3');
  const result = readPersonaSubstrateOcel(await writeCase(t, 'number-ok', text));
  assert.equal(result.document.events[0].attributes.find(a => a.name === 'precision_us').value, 1000);
  assert.deepEqual(result.counts, { events: 3, objects: 2, e2o: 6, o2o: 0 });
});
