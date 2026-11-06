# Inbound CR implementation — Pida 0.8.5

Date: 2026-11-03 KST. Scope: Pida only. No other application source, canonical data, credentials or deployed service was changed. Git delivery updates the existing draft PR; no merge, release or deployment.

## Baseline and patch plan

- Local branch `fix/runtime-stabilization`, clean HEAD `72af4e48f013fe3dcc04731f2afcad2c8bab0e4c`, package 0.8.4.
- Remote development branch `fix/runtime-stabilization-00-02`, draft PR1, HEAD `bbc28a39495b0c5d1b5f471ba11927e9ad64b46f`.
- Linux x64, Node24.22.1 / npm11.9.0 / Python3.12.14, official Pi1.2.0 unchanged. No new dependency.
- Incoming Persona `CR-PIDA-001`: local source based on `7378040533b0333c3a24b01fbe8614c1de7b52f1`, with continuity working-tree changes. Exact code bytes, not that baseline alone, identify the tested implementation.
- Incoming Schumpeter `CR-PIDA-20261103-01`: actual PR6/source `01d616d0dc32961dc0fc9ab76ca25e08d0f66fc0`.

| Step | Existing implementation reused | Work / completion gate | Disposition |
| --- | --- | --- | --- |
| CR-01 intake | Existing CR documents and 0.8.4 requirement ledger | Read incoming originals; map existing vs missing; preserve original request snapshots | Complete; [index](change-requests/README.md) |
| CR-02 exact context | PersonaProvider port, Pi custom messages and external workspace factory | Adapt observed Vera wire/renderer, exact lineage/digests/expiry, no second memory authority | Implemented |
| CR-03 actual input | Pi stream hook, runtime cancellation and observation journal | Recheck current authority before each converted call; input fingerprint and required receipt; guard summary calls separately | Implemented/tested |
| CR-04 external evidence | Existing Persona provider + Schumpeter Hub API | Run actual pinned consumer sources in disposable synthetic profile; preserve real incompatibility | Executed: Persona local PASS, Schumpeter BLOCKED |
| CR-05 response/delivery | Existing branch/draft PR | Owner responses, exact evidence, current fixture/schema, versioned commit | Prepared on the evidence below; final commit identified by Git history |

## Changes and boundaries

`createVeraPersonaProvider` is an opt-in SDK adapter. Its host-injected transport returns a bound `VeraContext` and revalidates it on each actual request. It reuses the producer's two closed schema definitions and PS-C14N-1 domain, without importing its database/service into Pida. Identity/instance/project/organization-session/run/task/scope are host-selected and checked. Both observed renderers, full snapshot/text digests, expiry/omissions and external IDs are preserved.

The generic `PersonaProvider.authorizeInput` hook is additive. Legacy providers keep working and external snapshot-only providers are explicitly labelled. The new Vera adapter requires this hook. Pida's existing workspace factory already applies selected providers to main and persistent-agent runtimes and disables conflicting local memory writers; it was not rebuilt.

Authorization happens after Pi conversion and exact reference-slot inclusion, before dispatch, and is repeated for tool follow-ups/retries. Pida clones the converted input across the asynchronous check. A source-keyed HMAC binds model identity and logical transcript; no raw prompt or fingerprint key is in observations. This is admission into Pida's provider-facing logical boundary, not confirmation of provider receipt, model understanding or success. Required journal loss blocks dispatch; ordinary external sink delivery remains best effort.

Compaction is a model call and now also rechecks selected authority. Its `context_summary_authorized` record has its own request ID/input digest/descriptor; it is not an execution inclusion receipt. Manual compaction obtains a fresh operation binding. Prior `pida-run-context` custom snapshots are removed from the next request projection. Stored histories and generated summaries are not retrospectively erased; cross-scope history isolation remains the host's responsibility.

The native envelope versions remain unchanged; semantic-validator capability advances to `pida.export-validation/0.3`. It checks the bounded external provenance, same task/run, preceding request, same loaded descriptor and fingerprint scope. Old fixtures remain readable. Local check evidence still means `agent-supplied-check`; overall verification remains UNKNOWN. No independent task acceptance or OrgSession/federation implementation is introduced by this patch.

## Actual validation

| Command / profile | Result | Scope |
| --- | --- | --- |
| `npm test` | **340/340 PASS**, 0 failed/skipped, 22.7s; includes build | Entire existing suite + 11 new adapter/runtime cases |
| `node scripts/cr-integration-check.mjs --persona SOURCE --schumpeter SOURCE --output EMPTY_DIR` | **37/37 checks PASS** | Actual Pi, actual pinned Persona local code and actual Schumpeter import attempt; scripted decisions/synthetic data |
| `node scripts/generate-current-export-fixture.mjs` | 21-event actual producer bundle validates | Actual Pi/MCP/retry/context, 0.8.5 metadata vocabulary |
| `npm pack --dry-run --ignore-scripts --json` | PASS | New adapter/schema compiled files included; test state/SQLite/source checkouts not bundled; no publication |
| `git diff --check` | PASS | Patch integrity |

New cases exercise scope/run/task/identity mismatch, unsupported wire/renderer, tampering, byte budget, expiry before and after authority check, exact input binding, per-request revalidation, grant rejection between tool turns, cancellation, required journal loss, restart identity, manual summary authorization/rejection, request ordering/fingerprint substitution, removal of a previous context projection, and fresh authorization on provider retry.

Integration cases bind persistent, worker, subagent and verifier **Persona types** to real Pida runs. These are binding tests, not evidence of a new organization scheduler or verifier controller. Actual provider grant revocation, active-model withdrawal and expiry after a tool call each prevent the next model invocation; previous valid admission remains historical evidence. The provider's RecordingConsumer is not used, and no provider use receipt is fabricated.

The Python probe copies hash-verified external package files into a temporary import directory, uses `-I -B`, and creates disposable synthetic SQLite state. Persona's pinned private `_session` / `_checked_context` are reused only by the **test shim** to check current authority. Their public equivalent is pending owner contract work; this is not a ready production server/HTTP transport. No source file in the external checkout is edited or imported through a deployed app entry point.

Schumpeter's actual `execute_hub(HubRequest(... format='pida-native'))` accepts the old supported control but rejects current producer bytes with **PIDA_FORBIDDEN_PAYLOAD_FIELD**. The 37 passing checks include accurately detecting that blocker. They do not mean latest-producer import succeeded. No field was dropped or payload digest rewritten to make it pass. The consumer owns the next compatibility patch.

## Review and evidence

One integrated self-review of the assembled source found that summary authorization also needed an explicit checked-descriptor link. That was corrected and selected summary/receipt tests were added before the final full gate. The initial manual-summary tests were too small to trigger real Pi compaction; they were changed to a realistic small-model window and then exercised the actual summary boundary. Existing assertions were not relaxed. This was self-review, not an independent agent/external certification.

- [Exact source lock](../fixtures/cr-integration/consumer-lock.json): full filenames and SHA-256 values for both imported consumers; no other-app code vendored.
- [Exact integration report](../fixtures/cr-integration/evidence/report.json): source/executed-build hashes captured before and checked unchanged after execution, check names, evidence-file hashes, profiles and limitations.
- [Current producer fixture](../fixtures/current-producer/index.json): package/validator revision, exact bytes and negative cases.
- [Persona response](change-requests/responses/PERSONA-CR-PIDA-001.md): public revalidation/remote receipt-readback requested; local integration demonstrated.
- [Schumpeter response](change-requests/responses/SCHUMPETER-CR-PIDA-20261103-01.md): exact rejection, current schemas/receipts, required consumer retest and unchanged acceptance limits.

## Completion accounting

**Plan:** complete for these CRs' input/export slice. **Implementation:** complete within the stated Pida SDK/runtime scope. **Tests:** passed as listed. **Actual integration:** local source-level Persona/Pi integration confirmed with synthetic data; current Schumpeter import attempted and blocked by its older contract. Public remote Persona integration, external receipt delivery/crash readback, canonical data, live LLM quality, Windows, independent local acceptance and federation remain NOT_RUN or separately planned. No claim of full CR closure or enterprise acceptance is made.
