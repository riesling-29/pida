# Explicit Vera dispatch subset consumer

This is a separate opt-in producer profile, `vera-dispatch/0.1.0`. It is not recovery of the unavailable historical continuity implementation and does not claim equivalent behavior merely because it uses the `vera-continuity/0.2.0` context wire shape. The historical [consumer lock](../fixtures/cr-integration/consumer-lock.json) remains unchanged.

## Host opt-in and capabilities

[`createVeraDispatchPersonaProvider`](../src/vera-dispatch-provider.ts) accepts the usual Vera binding configuration plus explicit `protocol`, nonempty `requiredCapabilities`, and a host-installed `VeraDispatchPort` with `describe`, `resolve` and read-only `authorizeInput`. Credentials/endpoints are never selected from model input. The standalone workspace CLI does not enable this external provider by default.

The exact negotiated profile supplies identity, memory context, linear working state and dispatch authorization with `strict-current/1` freshness. It excludes working graphs, behavior models, analysis references, artifact references and producer use receipts. Unsupported requirements, changed profile/stale policy, wrong wrapper protocol, non-main branch or nonempty unsupported references fail closed. Rendered text retains `producer_profile`. No local fallback occurs on rejection.

Negotiation runs before context resolution and every input authorization. The wrapper reuses existing strict binding/context/digest/expiry/ACK checks and the actual Pi input boundary. Observation descriptors carry distinct provider ID **`pida.vera-dispatch/0.1.0`**. The wrapper does not relabel the limited producer as generic historical continuity. Identity/memory/state changes between tool turns are handled by the producer's public strict-current check. Authorization is not a context-use receipt, model invocation or task acceptance.

`resolve` receives explicit protocol and required capabilities and returns `{protocol,binding,context}`. `authorizeInput` receives the existing pinned request plus protocol. A host transport maps it to public producer request `{protocol,requestId,inputDigest,runId,taskId,hostId,binding,context}`. ACK remains `{authorized:true,requestId,bindingId,contextDigest,inputDigest}`. Authenticated principal selection is the host's responsibility, separate from these body fields.

## Source pin and developer evidence

Producer commit: `c1e3617aa88e6013ea34f76c3f4c41504618f863`. [Separate source lock](../fixtures/vera-dispatch/producer-source-lock.json), digest `7dd9aa5ea22afaab033b62d54864d6849ac038e414ea7cc93fd341828cd731cb`. All 11 source files were extracted from that exact Git commit into an isolated Pida test directory and checked before/after the probe. [Public fixture](../fixtures/vera-dispatch/public-fixture.json) is synthetic evidence, not canonical persona data.

Build and **16 focused tests passed**, five new negotiation tests plus eleven existing Vera adapter tests. [Focused output](development/pida-vera-dispatch-focused-output.txt). The [public integration runner](../scripts/vera-dispatch-check.mjs) uses public Python producer methods through its disposable JSONL probe and the actual Pi loop with scripted responses. **Seven scenarios passed**: JSON renderer, reference renderer, revocation, expiry, identity revision, memory append and linear-state advance. Each mutation prevents the next model dispatch; inclusion receipt count equals actual scripted model calls and records the distinct provider identity. [Current result, source hashes and bundles](development/vera-dispatch-evidence-20261107-r3/result.json).

```text
node --test --test-timeout=20000 test/vera-dispatch-provider.test.mjs test/vera-persona-provider.test.mjs
node scripts/vera-dispatch-check.mjs --source <exact-pinned-source> --python <python-executable> --output <empty-evidence-directory>
```

The first working-tree probe correctly rejected a source-lock mismatch. A subsequent exact `dd35ba0` snapshot passed these seven scenarios but was superseded by producer review fixes for grants expiring inside authorization and trailing-newline tokens. [Earlier result](development/vera-dispatch-evidence-20261107/result.json) is historical, not current acceptance. Only the r3 source pin above is the intended producer baseline.

## Remaining gates

Independent consumer review is pending. Public local-method compatibility and scripted Pi dispatch do not establish remote transport, actual configured model behavior, desktop acceptance, unsupported graph semantics or canonical writeback. Delivery corrections and full-suite Windows failures remain separate records; these passes do not waive them.

Withdraw compatibility if the pinned producer cannot satisfy the explicit subset or any rejected authorization permits the next dispatch. Recheck after source, schema, capability, freshness or transport changes. Actual model costs and deployment performance are unknown until measured.
