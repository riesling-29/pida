# Current producer contract capture

This fixture uses **synthetic inputs, scripted Pi model responses and an actual local MCP stdio server**. It executes a retry, context injection and MCP tool call, then exports the actual runtime journal. It is a protocol/integrity test, not a live-model task evaluation or actual Schumpeter integration.

`index.json` pins captured bytes, package version and validator capability revision. The actual run/session/event IDs are capture identities, not placeholders. Regenerating creates a new capture; exporting the same run repeatedly or after a persisted-runtime restart preserves those identities.

The index also pins two intentionally invalid derivatives: `invalid-context-descriptor.json` adds a forbidden field inside the encoded descriptor, and `conflicting-event-id.json` reuses a source/event identity with different content. Their expected rejection results are recorded independently from the positive capture. They are negative fixtures, never silently repaired input.

## Closed contract revision

`pida.export-validation/0.2` adds the explicit metadata vocabulary already emitted by pida 0.8.1–0.8.3: model request generation/digests, measured usage and latency, retries, parent tool calls, and context descriptors. It also admits the new host context-input inclusion/omission receipts. No raw prompt or arbitrary tool input/output field is permitted.

The persisted wire envelopes remain `pida.observation/0.1-draft`, `pida.bundle/0.1-draft` and `pida.result/0.1-draft`. This corrects a validator that had fallen behind its own producer; it does not rewrite archived event bytes or silently downgrade exports for old consumers. A consumer with the older closed field set must upgrade or explicitly reject the new vocabulary. Old readiness fixtures remain accepted. The schema snapshots in this directory are current; `fixtures/schumpeter-readiness/` preserves historical captures and their original shape snapshots.

The JSON schemas enforce bounded fields and `additionalProperties:false`. The companion `validateObservationBundle` additionally parses the JSON-encoded descriptor and validates its complete `LoadedRunContext` structure with the host's descriptor validator. It rejects invalid JSON, unknown descriptor properties and descriptor placement on unrelated activities. Each context-input receipt must link to a model request with the same request ID and attempt and the declared logical-context scope. There is one final inclusion or omission claim per request; exact duplicate delivery of the same event remains deduplicated. Shape validation alone is insufficient. Context inclusion receipts describe the host's logical Pi input projection, not proof that a model used or understood the context.

## Reproduction and boundaries

```sh
npm run build
node scripts/generate-current-export-fixture.mjs
node --test test/integration-contract.test.mjs test/export-current-producer.test.mjs
```

The regression test also exercises 32 context references (larger than the obsolete 512-character generic string limit), private-text exclusion, owner access, duplicate delivery, conflicting duplicate IDs, sequence gaps, invalid descriptors and negative usage. Existing artifact tests reject stale verification claims and snapshot mismatches.

The starting 0.8.3 producer produced a completed Pi run whose own validator returned `SCHEMA_INVALID`. Its context descriptor and request/response/retry keys were missing from the closed field list. After the correction, the unchanged event payload semantics validate locally. The producer does not claim received-at time, globally causal order, unobserved source coverage, business acceptance, or validation by another app. Broader observation generation/causal/coverage contracts remain separate work.
