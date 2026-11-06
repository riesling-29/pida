# Schumpeter response — current pida export compatibility

- Origin: `riesling-29/pida`, `CR-PIDA-SCHUMPETER-2026-11-03-01`.
- Decision: **accepted** for the current importer repair; **accepted as design
  direction, implementation pending** for local acceptance and federation.
- Date: 2026-11-03. This response is published in Schumpeter only. It does not
  edit the producer CR, notify its owner or establish joint operational acceptance.
- Request snapshot: [original bytes](../incoming/PIDA-CR-PIDA-SCHUMPETER-2026-11-03.md).
  The later [producer response](../incoming/PIDA-RESPONSE-CR-PIDA-20261103-01.md)
  and pinned source establish validator revision **0.3**, superseding the request's 0.2 reference.

## Implemented and tested scope

Baseline consumer `01d616d0dc32961dc0fc9ab76ca25e08d0f66fc0` reproducibly rejects
the unchanged current capture with `PIDA_FORBIDDEN_PAYLOAD_FIELD`.
The revised consumer uses the explicit host profile
`pida-native/export-validation-0.3` and adapter `pida-native-adapter/0.2.0`.
The old native default/profile remains unchanged; new fields are not silently
accepted under the old profile. Unknown profiles and mixed revisions fail.

The approved typed metadata is preserved in SQLite `source_payload` and PIX
`source_payload_json`, including descriptor, request/attempt, usage/retry,
input fingerprint and tool ancestry. Native IDs, source digests and descriptor
string bytes are retained. Context semantic checks include bounded closed
structure, external run/task binding, prior request and attempt, duplicate
receipt detection, and fingerprint/source linkage. Direct mapped-bundle ingest
cannot bypass the metadata/profile/history checks.

The mapping is `schumpeter-observation-v0.2-closed-native-metadata`, digest
`f8da815865fc524de07d5cf358029f85feb7e9e760d1a963b86e4d0de3539eea`.
Consumer source build (including Python identity) is
`sha256:7f42ed047d088459d37051e3d91d4b677ff5a5003520fe300ec740acc823f8b7`.
Module hashes and exact captured results are in the
[consumer report](../../development/evidence/2026-11-03-cr-intake/consumer-report.json).
The containing PR/commit binds these changes; no uncommitted build is represented
as the baseline HEAD.

| Requested behavior | Result and limit |
| --- | --- |
| Current native exports | 8 unchanged producer captures, 122 events accepted; exact metadata retained |
| Replay / conflict | 122 duplicate receipts on replay; original conflict input and changed redelivery rejected/conflicted without overwrite |
| Descriptor / unsupported / lineage | Original malformed input plus consumer mutation regressions pass; unknown fields/types/revisions and foreign run/task rejected |
| Coverage | Gap/false completeness rejected; incomplete archive retained as incomplete |
| Loaded / included / omitted / rejected / summary | Distinct activities and linkage preserved; no claim of model comprehension or wire-level input |
| Artifact and task acceptance | Existing stale-artifact checks retained; all eight captures remain `task_outcome=UNKNOWN`, decision `REQUEST_EVIDENCE` |
| Private scope / authority | CLI remains synthetic-only; no organization credential enforcement, private fetch or live HMAC/authorization validation claimed |

Full local suite: **242 passed, zero skipped**, Python 3.12.14, fixed PIX source
`3205d832d5dcdc6901f916b35496a0c60b657e7a`. This slice adds 46 cases.
The dependency was reconstructed from verified source blobs; the local result
is not evidence of installing an official PIX wheel. Independent review of this
new slice and producer/runtime/model re-execution are **NOT_RUN**.

Reproduce after installing the dependencies specified in the root README:

```sh
python -m pytest -q
python examples/evidence/check_current_pida.py /tmp/current-pida-consumer-report.json
schumpeter hub run tests/fixtures/pida_current/current-producer/context-mcp-retry.json \
  --format pida-native --source-profile pida-native/export-validation-0.3 \
  --store /tmp/schumpeter-current-pida
```

## Accepted direction and remaining contract work

Local acceptance must bind organization/task/attempt, exact artifact snapshot,
criterion revision, verifier/environment, issuer authority, outcome and evidence.
Schumpeter may reuse only matching local criteria and retains responsibility for
additional enterprise criteria. pida remains owner of internal plans, join state
and local task acceptance. The current profile deliberately does not inherit the
old synthetic acceptance-signature allowlist. A producer's UNKNOWN is not upgraded.

Federation needs separate received, admitted/rejected, started, local-result-ready
and enterprise-accepted states; a stable request key and payload digest distinguish
replay from conflict. Cancellation separates request/receipt/stopped/external-effects
unknown. Clarification delivery is separate from task dependency completion and
actual model-input inclusion. These are agreed consumer requirements, **not endpoints**.

Next owner artifacts are a versioned local acceptance/federation contract and
synthetic fixtures with matching/mismatched subject, criterion, artifact, replay,
cancel and unknown-effect cases. Schumpeter will add a scoped consumer after that
contract is fixed. Live Persona authorization/context verification also remains
separate from retaining the producer's observations.

No migration was performed. Reimporting a previously stored native identity with
the richer mapping can correctly report a conflict against old mapped bytes;
use a separate test store. Operational ledger migration requires its own design.
