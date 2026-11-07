# Persisted lineage validation correction

Independent re-review of `f01ad776612a80980502f63b2bffd945ad0177cc` confirmed the three original corrections and found one narrower malformed-state case: removing a child's `parentJobId` while leaving positive `depth` erased derived collaboration authority on reopen. This required persisted-state corruption, not a public endpoint body. [Original probe](delivery-review-evidence/lineage-corruption/review-lineage-corruption.mjs) and [observed output](delivery-review-evidence/lineage-corruption/review-lineage-corruption.log) are preserved.

The loader now requires `depth === 0` if and only if `parentJobId` is absent, then retains its existing owned-parent and exact depth-increment validation. Public enqueue already establishes this invariant. A malformed file is rejected without overwriting its evidence; no lineage marker or schema version was added. This is structural validation, not authentication against an attacker able to rewrite an entire valid local database.

Build passed. The bounded delta run `node --test --test-timeout=20000 test/collaboration-regressions.test.mjs test/agent-supervisor.test.mjs` passed **12/12**, including the new corrupt-state regression and native supervisor recovery. [Output](pida-collaboration-lineage-delta-output.txt). Previous 35-test correction and broader review evidence remain in their own records. Independent confirmation of this final delta is pending; full-suite/desktop acceptance is not implied.

The live Persona smoke had completed before this source edit and did not use the supervisor; its source hashes and outcome remain separate. Withdraw this correction if a missing required parent link is accepted or rejected malformed state is rewritten. Recheck on loader/native lineage changes.
