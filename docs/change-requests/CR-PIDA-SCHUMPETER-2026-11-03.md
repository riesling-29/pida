# Cross-App ChangeRequest — current pida exports and future local acceptance

This file is a request to the Schumpeter owner. It does not authorize changes to Schumpeter, PIX, PersonaSubstrate or any deployed service. No external message or request submission is implied by creating this document.

## Request identification

- **request_id:** `CR-PIDA-SCHUMPETER-2026-11-03-01`
- **Date:** 2026-11-03 KST
- **requester_app / owner:** pida-core / pida development thread
- **owner_app / owner:** Schumpeter / Schumpeter development thread
- **Requirements:** `INT-PD-06`, `INT-PD-11`, `INT-PD-16`; consumer-side `INT-SC-16`
- **Purpose:** verify current producer compatibility without weakening closed validation or silently dropping metadata; agree how future pida local acceptance and federation receipts will be consumed. Schumpeter owns its importer, mapping and enterprise acceptance policy. pida owns its export and internal execution/task state.

## Currently confirmed state

| Item | Evidence and boundary |
| --- | --- |
| Consumer revision | The supplied report identifies Schumpeter PR #6 head `fa48029870f5` as its research snapshot. This pida task has not executed or modified that checkout; the owner must provide its current full HEAD/build and mapping version. |
| Producer baseline | `riesling-29/pida`, PR #1 head `e08edcfc98b0ca7e3450714865eaae294b1c1c3f`, package 0.8.3. Local source assessment began at corresponding `0b454cb` on `fix/runtime-stabilization`. The final implementation/validation document identifies the subsequent producer patch. |
| Producer interfaces | `PidaClient.exportRun` and `exportAgentJob`; owned HTTP `GET /v1/sessions/:session/runs/:run/export` and agent-job export; CLI `pida export SESSION RUN [directory] [--jsonl]`. JSONL contains events; JSON bundle additionally carries completeness/limits and the ResultManifest. |
| Existing contracts | `pida.bundle/0.1-draft`, `pida.observation/0.1-draft`, `pida.result/0.1-draft`; the corrected closed vocabulary is identified separately as `pida.export-validation/0.2`. These are pida-native drafts, not an assertion of conformance to an independently named Schumpeter ObservationEnvelope. |
| Observation semantics | Source and source-event IDs, per-run sequence, task/session/run/agent IDs, observed timestamps, metadata-only payload digest, object/artifact/evidence references, terminal/coverage indicators. An incomplete archive remains incomplete. No global exactly-once, causal-total-order or external-delivery guarantee is implied. |
| Context semantics | The producer records a versioned, bounded context descriptor; actual input-included/omitted receipts are host-observed logical-context facts. Loading/generating a descriptor alone does not prove model consumption. The native transport may further transform input; a logical-context receipt is not wire-level or model-understanding proof. |
| Current verification | Scoped host-collected workbench checks bind check-definition and artifact-snapshot digests. The ResultManifest explicitly remains `verification_status: UNKNOWN`, with `agent-supplied-check` independence and `NO_INDEPENDENT_TASK_ACCEPTANCE`. |
| Current federation | No OrgSession federation or local acceptance endpoint is implemented in this slice. Existing agent job admission, completion and recovery endpoints must not be interpreted as those contracts. |

The current producer fixture is `fixtures/current-producer/context-mcp-retry.json`, with provenance in `index.json`, generator `scripts/generate-current-export-fixture.mjs` and regressions in `test/export-current-producer.test.mjs`. It uses actual Pi and a synthetic local MCP server/retry sequence. Its provenance distinguishes scripted model decisions from actual pida/Pi/tool execution. It is a newly generated producer fixture, not production user data relabelled as synthetic. The older `fixtures/schumpeter-readiness/` remains historical coverage rather than proof of current consumer compatibility.

The same directory publishes `observation.schema.json`, `manifest.schema.json` and `bundle.schema.json`. **JSON Schema validation alone does not parse the embedded descriptor JSON:** the consumer also needs the documented descriptor semantic validation, digest/reference checks and completeness checks. Broader source-generation, causal-reference and coverage semantics remain partial; this compatibility repair does not fully satisfy INT-PD-06.

## Minimal reproduction and expectation

1. Build this pida revision and run `node --test test/export-current-producer.test.mjs`. Generate fixtures using `node scripts/generate-current-export-fixture.mjs` when an intentionally refreshed fixture is needed.
2. A runtime using a real host context callback produces `context_snapshot_loaded` with a serialized bounded `descriptor`. The original closed validator omitted this supported payload key, so a current native export failed with `SCHEMA_INVALID` even though export creation succeeded. A valid descriptor with 32 refs can also exceed the generic 512-character string bound. The original validator additionally omitted emitted API/attempt/provider-generation/digest/usage/retry metadata. The correction explicitly types those keys and validates parsed descriptor structure; it does not permit arbitrary payload keys, delete the descriptor or regenerate IDs.
3. Import the new fixture in Schumpeter under an explicitly supported, pinned pida mapping. Keep native IDs, ordering limitations, partial coverage and verification scope. Return a typed unsupported-schema/profile result if the new metadata is not yet supported; do not silently erase it to manufacture success.
4. Return importer/mapping revision, checks actually executed, accepted and rejected cases, preserved native lineage, and any evidence gap. A successful parse/digest check is an integrity result, not task acceptance.

### Owner acceptance cases

| Case | Expected consumer behavior |
| --- | --- |
| Current valid context/MCP/tool run export | Accept the declared supported schema/profile; preserve descriptor, tool ancestry and native source identities. Do not infer missing private context content. |
| Duplicate event with the same identity and bytes | Deduplicate without creating another activity or completed task. |
| Same identity with different bytes | Reject/quarantine the conflict with an explicit reason. |
| Sequence gap, incomplete archive or missing terminal | Retain coverage loss; do not present a complete execution. |
| Unknown descriptor field, malformed revision/digest or unsupported contract | Reject or mark unsupported. Do not open the entire payload schema to bypass the incompatibility. |
| Artifact/check revision mismatch | Preserve historical evidence; do not apply its PASS to another artifact revision. |
| Model says done or run status is completed | No enterprise PASS follows solely from that claim. |
| Input loaded but omitted from actual logical input | Keep the distinction; do not label it consumed. |
| A foreign organization/task/artifact or denied principal | Enforce the consumer scope boundary; no cross-organization memory/artifact fetch. |

The producer regression command passed **3/3** focused tests, covering current export, old-fixture compatibility, repeated export/restart identities, owner isolation and tampered/conflicting/gapped cases. The final integrated validation report records later combined-suite results separately. **Current Schumpeter importer execution is NOT_RUN in this task.** Its prior fixture results are not upgraded to new producer integration evidence.

## Proposed local acceptance and federation semantics

The following are **proposals**, not deployed APIs. The next organization slice is described in `../PI-NATIVE-ORG-GAPS.md`.

- A local acceptance receipt should bind organization/task/attempt, exact artifact snapshot revision/digest, required criterion-set revision, each verifier definition/environment, issuer scope, outcome (`PASS` / `FAIL` / `UNKNOWN`), evidence references and limits. A newer artifact or changed criterion requires a new applicable receipt. Historical receipts remain immutable.
- Schumpeter should consume a local PASS only for its declared subject and criterion scope. Additional enterprise criteria remain Schumpeter's responsibility. pida internal tasks, join state and Persona canonical records remain outside Schumpeter's direct write authority.
- Federation admission should distinguish received, accepted/rejected, started, local-result-ready and enterprise-accepted. A stable request key plus payload digest distinguishes replay from conflict. Delivery and admission must not imply execution or success.
- Cancellation should distinguish requested, received, execution stopped and external-effects unknown. Network interruption must not cause unverified automatic resubmission of side-effecting work.
- Clarification messages and task-dependency edges need separate identities. A reply is not a child-task completion, and a message being received is not evidence that it was included in the next model input.

## Compatibility, fallback and continuing work

- **Compatibility:** the native envelope version and current producer field profile must be pinned by the consumer. A producer-side validator correction does not automatically update an older closed importer. Future acceptance/federation records require an agreed versioned contract rather than changing the meaning of existing ResultManifest `UNKNOWN`.
- **Migration:** no operational data migration is requested here. If persisted consumer records require migration, the Schumpeter owner proposes and obtains authorization separately.
- **Current fallback:** keep current native JSON bundles as immutable evidence; retain unsupported status and native metadata until mapping support exists. pida basic execution, recovery, local analysis and its own fixture tests remain usable without Schumpeter.
- **Blocked path:** claiming current producer-to-Schumpeter integration, federation acceptance or enterprise PASS for a local task.
- **Unblocked pida work:** direct PIX batch Reflection/Awareness, Persona consumer contract tests, producer self-validation, existing runtime/tool control, and the later bounded local join/acceptance slice.
- **Requested owner artifacts:** current full consumer HEAD/build, supported producer schema/profile and mapping pin, replay/conflict/error fixtures, reproducible importer test command/results, and a response to the proposed acceptance/federation semantics.

## Owner response — not yet supplied

- accepted / needs-evidence / alternative / rejected: **PENDING**
- Decision and responsibility boundary: pending
- Consumer contract/mapping revision and fixture results: pending
- Producer/consumer re-test scope: pending

Until the owner responds and actual cross-application tests run, this file remains an unsent development request and the integration remains unverified.
