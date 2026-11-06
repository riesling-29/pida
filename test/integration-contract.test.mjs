import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateObservationBundle } from "../dist/integration-contract.js";
test("Schumpeter readiness fixtures validate the Pida draft without claiming Hub acceptance", async () => {
  const root = new URL("../fixtures/schumpeter-readiness/", import.meta.url);
  const index = JSON.parse(await readFile(new URL("index.json", root), "utf8"));
  assert.equal(index.schumpeter_contract_confirmed, false);
  const invalid = new Set(["sequence-gap.json", "tampered-digest.json", "unsupported-verified-claim.json", "forbidden-payload-field.json"]);
  for (const fixture of index.fixtures) {
    const bundle = JSON.parse(await readFile(new URL(fixture.file, root), "utf8"));
    const result = validateObservationBundle(bundle);
    assert.equal(result.valid, !invalid.has(fixture.file), fixture.file);
    assert.deepEqual(result, { valid: fixture.valid, issues: fixture.issues, duplicateEventIds: fixture.duplicateEventIds }, fixture.file);
  }
  const good = JSON.parse(await readFile(new URL("scoped-verification.json", root), "utf8"));
  assert.equal(good.manifest.verification_status, "UNKNOWN");
  assert.equal(good.manifest.verification_results[0].current_at_run_end, true);
  const stale = JSON.parse(await readFile(new URL("stale-verification.json", root), "utf8"));
  assert.equal(stale.manifest.verification_results[0].current_at_run_end, false);
  stale.manifest.verification_results[0].current_at_run_end = true;
  assert.ok(validateObservationBundle(stale).issues.includes("STALE_VERIFICATION_CLAIM"));
  const changed = structuredClone(good);
  changed.manifest.verification_results[0].artifact_snapshot_digest = "0".repeat(64);
  assert.ok(validateObservationBundle(changed).issues.includes("VERIFICATION_SNAPSHOT_MISMATCH"));
  const missing = structuredClone(good);
  missing.events[0].artifact_refs = ["f".repeat(64)];
  assert.ok(validateObservationBundle(missing).issues.includes("EVENT_ARTIFACT_MISSING"));
});
