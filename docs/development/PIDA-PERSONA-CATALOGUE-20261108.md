# Pida Persona catalogue source unit - 2026-11-08

Implementation is isolated on feat/persona-catalogue-20261108 from policy9cbecfd plus documentation archive8e65475. D/b7 distributions and all actual-case states are untouched. The producer f6/r4 schema/source is unchanged; Sch consumer integration is not part of this commit.

Changed behavior: trusted catalogue module creates fixed per-profile bridge factories; the existing native personaSourceId selects one. The reference helper now accepts explicit settings without changing process environment. The launcher accepts exactly one global provider or catalogue factory family. Existing local default remains explicitly advertised. Exact contract: [PERSONA-CATALOGUE-1.md](../PERSONA-CATALOGUE-1.md).

## Owner validation

On Windows with Node24.18.0, actual public source-locked f6 Python producer, disposable synthetic stores and offline faux Pi input sinks:

`PIDA_TEST_LOCAL_REFERENCE=D:/ChantaResearchGroup/pida/.pida-test-local-reference-f6edd02 node --test --test-timeout=30000 test/vera-local-reference-catalogue.test.mjs test/vera-local-reference-host.test.mjs test/workspace-persona-pi.test.mjs test/execution-policy.test.mjs test/vera-dispatch-provider.test.mjs`

34 tests passed, zero failed/skipped/cancelled, observed9.482s. Four new composite scenarios verify concurrent actual native A/B input marker and current-provider-check receipt isolation; immutable native selection on restart; revoked B with no dispatch/fallback while A continues; expired B with no dispatch; exact closed shape/unique identities; cross-source snapshot refusal; revocation after resolution; actual child host ready2/fresh/resume; semantic reorder stability; config/store/profile/visibility/membership substitutions refusing with the entire managed workspace tree byte-preserved. The stock mock host legitimately emits two input receipts; the direct faux sink one per run. Neither is a paid model call or proof of learning.

Source lock checks verify every f6 runtime file before the optional producer tests run. These tests are skipped without the explicit source fixture variable; this recorded run had no skips. Earlier author fixture failures (missing tools.directory, default sample tool import from a temp path, wrong observation field name, policy-token minimum, stock mock receipt count and manifest filename) were corrected in the new test fixture; they were not runtime failures and did not justify loosening assertions. The final assertions use actual existing contracts.

No TypeScript/core file changed, so the already built accepted policy dist is reused; all three changed MJS modules passed node --check. No new package build, model/provider request, auth refresh, account action, GUI operation or canonical memory access occurred.

Evidence: [validation.json](persona-catalogue-evidence-20261108/validation.json) pins source hashes, the accepted producer and this command/result. Independent review is pending; owner tests alone do not approve packaging or parent integration. Linux runtime/package acceptance is not claimed. Cost is not applicable to offline fixture calls; actual future provider cost is unknown.

## Next action and withdrawal conditions

Freeze this source and request independent two-profile authority/resume/lifecycle review. Sch owner implements separate trusted registry linkage, catalogue creation and create-agent source intent. A future remap requires a new workspace/explicit migration. Withdraw this bounded claim if exact reviewed source or producer pins change, cross-profile data/receipts appear, B authorization denial falls back, source choice mutates, or resume rejection changes managed state. Existing D global-profile behavior remains a valid no-change option.
