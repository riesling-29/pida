# Independent local reference host join review — initial finding

Reviewer `/root/persona_dispatch_review`, separate context, same Codex family; 2026-11-07. Frozen consumer `7997d5101709b18115912c20f687daf979c3a54a`; producer `0d9714c1ac84c36082491ee2c264706a16fd14b5`, exported runtime digest `6b6800faa1fab3b5f288afeef39e37392e9cf714455e7f00e12b2d3dade605ac`. Author source and canonical data were not modified. Tests use the detached `pida-reference-host-review-20261107` checkout and disposable stores.

## Material finding

**P2: same-path producer-store replacement does not change the host resume fingerprint.** `examples/vera-local-reference-persona.mjs` computes `hostPersonaIdentity` from executable/entry bytes, argv, config bytes and the store path only. `examples/schumpeter-host.mjs` binds that identity into the workspace manifest. A separately initialized same-config store at the same path therefore passes the same fingerprint even though the same native run/task/attempt now receives a new producer binding ID.

The independent `store-identity-probe.mjs` initialized a disposable store, resolved one binding, preserved the old store by renaming it, explicitly initialized a fresh store at the original path, and repeated the same native binding request. `store-identity-7997d51.json` records identical before/after host identity digests and different binding IDs. No existing user store was deleted or replaced.

This is a recovery/lineage gap, not a claim that an unauthenticated actor can modify local files. A resumed pida workspace cannot distinguish its original producer binding history from a newly initialized store at that location. The owner accepted this finding as blocking for the stated recovery claim and is coordinating a producer-owned immutable store-instance identity. The correction should bind a persisted initialization identity, not mutable SQLite file bytes. New producer/consumer pins require a delta review; the prior producer approval does not automatically cover the new marker behavior.

## Independently verified behavior

Windows Node v24.18.0 / Python 3.11.9. Build passed. The exact nine-file producer lock matched the exported runtime. The focused production-host test passed actual Unicode context, public authorization, native OrgSession/OrgAttempt/job/agent binding, completed mock-job inclusion receipt, same-job pida host resume and config-change denial preserving supervisor state.

Selected host/policy/admission regression command passed 19 tests:

```text
node --test --test-concurrency=1 --test-timeout=30000 test/collaboration-policy-client.test.mjs test/organization-admission.test.mjs test/vera-local-reference-host.test.mjs
```

`PIDA_TEST_LOCAL_REFERENCE` pointed to the exact exported runtime and `PYTHON` to the explicit Python 3.11 executable. This is not a full-suite waiver or a new independent review of every admission change.

Independent `dispatch-lifecycle-probe.mjs` adds:

- Actual public Python producer + Node helper + actual Pi loop with scripted responses: revocation and expiry each permit exactly one model call and one inclusion receipt, then reject the next dispatch with `PERSONA_INPUT_NOT_AUTHORIZED`. These negative probes use explicitly synthetic organization/attempt scope; real native IDs are established separately by the production host test.
- Missing actual producer store: startup fails with `HOST_PERSONA_PROCESS_CLOSED` in the observed 65 ms run.
- Injected malformed child response: startup rejects and closes with `HOST_PERSONA_RESPONSE_INVALID` in the observed 109 ms run.

Measured times describe only those runs, not a performance guarantee. Probe outputs are in `dispatch-lifecycle-7997d51.json`. No real model service or paid API call was made.

## Scope and next check

This module uses explicit trusted parent configuration and never auto-initializes a store or loads the historical fixture at runtime. The production host supplies native IDs; standalone org-less use remains unsupported. Complete producer dependency pin validation remains the parent assembly's responsibility; this helper fingerprints the configured executable and absolute entry files. Static configuration/grant renewal, graph/model capabilities, canonical writeback, Linux cleanup, packaged Python service and final desktop acceptance remain outside this review.

Recheck after the immutable store-instance correction against the new exact producer export and consumer commit. Withdraw other local compatibility observations if source hashes move, rejected authorization reaches a next model call, actual native IDs are substituted, or failed-startup cleanup becomes unbounded in the tested Windows scope.

**Verdict: ISSUES for the frozen join's recovery claim; one material store-lineage finding remains open.**
