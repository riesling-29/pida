# Atomic organization root admission validation

This unit implements the owner-agreed [organization admission contract](../ORGANIZATION-ADMISSION-1.md), recorded before runtime edits at `fd07eb2`, with canonical helper/golden fixtures first frozen at `836eff8`. The runtime changes are local and have not been pushed. Independent runtime review and the production Schumpeter join are separate next steps.

## Behavior and boundary

`admitOrganization` and its HTTP/SDK route authorize the full versioned admission, then persist one proposed native OrgSession and its sole root task/attempt/job with an immutable receipt before scheduling. The complete definition includes goal, participants, repair/time budget and host-advertised exact acceptance profile. It rejects colliding native IDs/reservations/scoped requests, altered definitions, foreign participants and stale profiles. Admission and ordinary delivery cannot silently reuse the same scoped carrier key.

Supervisor v4 adds a separate admission collection. Versions 1–3 migrate without invented receipts. Persisted validation verifies exact native membership, root identity, receipt fields and source definition, while bounded capacity admission rolls back all five tentative collections before a failed ACK. Original root authority is derived from native ancestry for delegated children, joins/continuations and repair attempts. Current policy /2 is checked before actual dispatch; observed promotion cannot replace reservation provenance or create an ACK/promotion race. Ordinary native create and delivery /1 APIs retain their semantics. Absent `authorizeAdmission` disables the new boundary.

The current fixed-endpoint client handles a separate six-field request /2 and fourteen-field ACK /2 while preserving /1. Exact nonce, phase, owner/host, all three digests, reservation, recipient and revisions must match. A successful response must identify an actual reserved or observed reservation; unknown/fake observed mappings deny in the independent authoritative fixture. The test fixture's trusted control pipe now explicitly uses UTF-8: its former Windows default decoding corrupted non-ASCII reservation text while the HTTP body decoded correctly. This was detected by real cross-language tests; no canonical rules were relaxed.

## Developer evidence

Build passed with `node scripts/task.mjs build`. The broad command was:

```text
PIDA_TEST_VERA_SOURCE=<source-only c1e3617>
node --test --test-timeout=30000 test/organization-admission-contract.test.mjs test/organization-admission.test.mjs test/collaboration-policy-client.test.mjs test/collaboration.test.mjs test/collaboration-regressions.test.mjs test/organization.test.mjs test/agent-tools.test.mjs test/workspace-persona-pi.test.mjs
```

[Final broad output](pida-organization-admission-output.txt): **66 tests, 65 pass, 1 fail**. All 15 added canonical/native/HTTP scenarios pass, including:

- One durable initial root, lost ACK and restart with identical org/job/task/attempt/receipt and no replay; current grant revocation and default disabled behavior.
- Changed definitions, reservations and native ID collisions; stale host criteria/environment, foreign participant and cancelled reply rejection; prior own-task correlation into a new native goal session.
- Actual scripted Pi root delegation and durable join/continuation across two executing agents without a parked coordinator; revoked child dispatch, persisted descendant after restart and native repair authorization.
- Corrupted root/receipt state preservation, v3 migration preserving old jobs/organizations/delivery receipts, and actual near-32-MiB admission rejection preserving old bytes and receipt after reopen. The large valid historical state is explicitly seeded synthetic data, not a claim of hundreds of earlier real executions.
- Actual separate Node host/Python policy with a sole root executing while the authoritative reservation is still reserved; discarded ACK body, stop/reopen and observed promotion reconciliation; public Persona receipt's exact native job/OrgAttempt/session IDs.

The sole broad failure is the existing `agent-tools.test.mjs` depth-chain expectation: it expects `failed` but receives `limited`. An isolated rerun reproduces the same failure on both frozen resume baseline `bbb8e565282b676307c9ed92a8423a19b6c1f12e` and current code: [baseline](pida-admission-delegation-baseline.txt), [current](pida-admission-delegation-current.txt). This establishes attribution only; it does not establish correctness of that unresolved behavior. The original broad run also caught one old state-version assertion; that assertion was updated to v4 and the [initial output](pida-organization-admission-initial-output.txt) is retained. No runtime deadline was increased. The synthetic large-state fixture was made linear in preparation cost instead of repeatedly serializing the growing state.

After adding an actual SIGKILL boundary to the HTTP scenario, [three final policy/host delta tests](pida-organization-admission-http-delta.txt) pass. A newly admitted root is observed running while awaiting policy, then the actual process is killed. Reopen returns the same receipt and job as interrupted, without a model run ID, with reconciliation required; it does not generate a replacement attempt. This does not claim exactly-once arbitrary external effects.

## Limits and next action

All models in this unit are scripted Pi or native mock; there are no additional paid model calls. Persona is the reviewed source-only synthetic producer `c1e3617`, not private/canonical memory. Default empty host criteria yield UNKNOWN acceptance; neither completion nor admission receipt implies artifact/enterprise PASS. Exact criterion/revision behavior remains governed by the existing native acceptance tests, which passed in the broad run.

The source manifest records changed and relevant dependency paths. Host source-consistency manifests intentionally reject opening a workspace created by older compiled source; migration is not added here. Windows symlink fixture coverage, the baseline depth-chain status failure, arbitrary deep Git paths, Linux deployment, production Schumpeter authority/UI and final multi-organization real-provider task remain distinct open gates. Preserve receipts and their actual job/attempt/task mapping alongside OCEL; do not manufacture cross-run sequence or infer native attempt IDs from prefixes.

Next: freeze this unit, independently audit the atomic boundary/state migration/authority lineage, then join the Schumpeter reservation adapter against the exact commit. Withdraw this unit if admission duplicates root work, definition changes evade grants, new session collisions adopt old work, capacity/corruption publishes partial state, promotion timing causes unauthorized work, or revoked authority reaches a model. Validity is bounded to the recorded source, producer and environment.
