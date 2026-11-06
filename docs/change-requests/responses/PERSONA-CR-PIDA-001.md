# Pida owner response — Persona CR-PIDA-001

- Date: 2026-11-03 KST
- Status: **ACCEPTED, implemented within the scope below; remote contract still needs owner evidence**.
- Request: [unaltered source snapshot](../incoming/PERSONA-CR-PIDA-001.md).
- Baseline: Pida 0.8.4, remote `bbc28a39495b0c5d1b5f471ba11927e9ad64b46f`, local `72af4e48f013fe3dcc04731f2afcad2c8bab0e4c`.
- Producer examined: local Persona continuity source based on `7378040533b0333c3a24b01fbe8614c1de7b52f1`. This is a source-hash-pinned working-tree snapshot, not a claimed released Persona build. See the [source lock](../../../fixtures/cr-integration/consumer-lock.json).

## Implemented in Pida 0.8.5

`createVeraPersonaProvider` consumes the observed closed `Binding@1.0.0` and `VeraContext@vera-continuity/0.2.0` schemas, with `vera-json/1` and `vera-reference-text/1`. It validates host-selected principal/persona/instance/project/organization-session/run/task/scope, PS-C14N-1 domain, full context and exact text digests, budget/omissions/expiry and rendered identity/state linkage. It neither creates grants nor selects authority from persona text.

The adapter retains external context/binding IDs, binding digest, memory revision, branch/head/state reference and model/analysis/artifact digests in the host descriptor. Non-UUID external state IDs are not rewritten as Pida memory UUIDs. The unchanged rendered context preserves observed `host_revision`, `phase_revision`, `host_id` and writer provenance. Pida does not fabricate revisions or advance an external WorkingState to match a job status.

The embedding host supplies a `VeraPersonaPort`. Its resolve operation binds the **actual Pida run and task** before the first model request; persistent/worker/subagent/verifier producer binding types were exercised using the actual local provider. Selection is pinned per run. Every converted execution request, tool follow-up, retry and summary call requires current authorization for that snapshot. Pida checks expiry again after awaiting the authority. Revocation/withdrawal cannot silently fall back to local memory or use an unbound call.

Pida writes its own metadata-only logical-input record, with request/attempt, exact descriptor, source-keyed HMAC of the converted input/model identity and fingerprint scope. This is a Pida boundary record, **not** a forged `ContextUseReceipt@1.0.0` or proof of provider acknowledgement/model understanding. Summary authorization has a separate event and never becomes an execution inclusion receipt. An unavailable required journal prevents dispatch. With a storage directory, existing private session journals preserve IDs across restart; memory-only runs explicitly disclose volatile receipts. Power-loss atomicity and remote delivery are not promised.

No natural-language completion claim becomes independent task acceptance. ResultManifest remains UNKNOWN. Canonical state mutation and model activation stay with the provider; this adapter deliberately exposes no external writeback capability until the write contract is supported.

## Actual integration and remaining owner request

The opt-in integration runner imports verified copies of the **actual** local Persona code and uses disposable synthetic SQLite state. It reuses its existing bind, graph, projection and authority/model-validation implementation. The read-only test shim calls pinned `_session` / `_checked_context` methods because the current public `ConsumerAdapter.submit` is a one-accepted-input-per-run consumer and has no standalone revalidate port. Those private methods are **test instrumentation**, not a production transport/API recommendation. The provider's `RecordingConsumer` is not used to manufacture Pida input proof.

Requested producer addition/confirmation: a supported read-only `authorize_input` equivalent, bound to principal + binding + exact context + host request/input fingerprint, that can recheck each model request without writing a use receipt, holding a network transaction open or executing work. The Pida port in this patch is a consumer contract, not an advertised existing Persona endpoint. Owner must specify public schema, errors, source expiry, grant/model revision and concurrency guarantees.

For remote receipt submission, require a separate idempotent receipt-record/readback contract. If host admission succeeded but durable remote receipt is uncertain, return UNKNOWN and inspect by stable request ID; do not rerun work to recreate a receipt. This patch performs no remote receipt submission, so it cannot create that uncertain external write. End-to-end distributed crash recovery, live canonical data, public server transport, external graph mutation and automatic behavior-reference append remain **NOT_RUN / unsupported here**.

Plan/implementation/test/actual-integration details and exact evidence: [0.8.5 validation](../../CR-INTAKE-VALIDATION.md). The sender can consume this response from Pida; the Persona source CR and application were not modified.
