import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizationAdmissionDigest, organizationDefinitionDigest, validOrganizationAdmission } from '../dist/organization-admission.js';
const golden = JSON.parse(readFileSync(new URL('../fixtures/organization-admission/admission-v1.json', import.meta.url), 'utf8'));
test('Unicode admission golden binds full definition and preserves exact canonical digest', () => {
  assert.equal(validOrganizationAdmission(golden), true);
  assert.equal(organizationDefinitionDigest(golden.definition), 'b019e1eb3f96a9fc0a3cd3572231f1a201e3c2e5a4e87064d565af3f4b80ccd4');
  assert.equal(organizationAdmissionDigest(golden), 'a1712127fa0457c6668d766858d7974618410d0dbdf706b5d5ead12aade24e71');
  for (const edit of [a => a.definition.timeout_ms++, a => a.definition.max_repair_attempts++, a => a.reservation_id += '-changed',
    a => a.definition.environment_revision += '-changed', a => a.definition.criteria_digest = '0'.repeat(64)]) {
    const a = structuredClone(golden); edit(a); assert.equal(validOrganizationAdmission(a), false);
  }
});
test('closed admission domain rejects invented authority, mismatched root/input and malformed definition even with recomputed hashes', () => {
  for (const edit of [a => a.authorized = true, a => a.definition.goal = 'different root', a => a.definition.root_agent_id = '11111111-1111-4111-8111-111111111111',
    a => a.definition.participants = [], a => a.definition.participants.push(a.definition.participants[0]), a => a.definition.environment_revision = '\ud800',
    a => a.definition.timeout_ms = 1.5, a => a.definition.criterion_ids = ['bad\n'], a => a.reservation_id += '\n']) {
    const a = structuredClone(golden); edit(a); a.definition_digest = organizationDefinitionDigest(a.definition); a.admission_digest = organizationAdmissionDigest(a);
    assert.equal(validOrganizationAdmission(a), false);
  }
});
