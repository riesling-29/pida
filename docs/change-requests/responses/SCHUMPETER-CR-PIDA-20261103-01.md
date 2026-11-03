# Pida owner response — Schumpeter CR-PIDA-20261103-01

- Date: 2026-11-03 KST
- Status: **ACCEPTED; producer evidence implemented and supplied; consumer compatibility blocked**.
- Request: [unaltered source snapshot](../incoming/SCHUMPETER-CR-PIDA-20261103-01.md).
- Pida baseline: 0.8.4, remote `bbc28a39495b0c5d1b5f471ba11927e9ad64b46f`.
- Actual consumer: Schumpeter `01d616d0dc32961dc0fc9ab76ca25e08d0f66fc0`, `HubRequest` / `execute_hub`, `pida-native-adapter/0.1.0`, synthetic-test scope, disposable SQLite store. Source lock and executed script are included in this repository.

## Producer response

0.8.4 reproduced and fixed the real closed-export mismatch described by the request. 0.8.5 additionally binds converted logical input hashes, fresh authority checks and external context provenance. The existing wire envelope IDs remain `pida.bundle/0.1-draft`, `pida.observation/0.1-draft`, `pida.result/0.1-draft`; corrected semantic-validator capability is **pida.export-validation/0.3**. This explicit capability does not silently make an older consumer compatible.

- Current actual Pi + stdio MCP + retry fixture and closed schemas: [current producer](../../../fixtures/current-producer/README.md).
- Actual Pi + local Persona context/binding and per-request host evidence: [CR integration evidence](../../../fixtures/cr-integration/README.md).
- No raw prompt/context/credential appears in default events. Input fingerprints use a source-keyed HMAC, not a guessable unsalted prompt hash. Full synthetic context is included only as explicitly labelled integration evidence.
- Loading, inclusion, omission, authorization rejection and internal summary authorization stay distinct. An input receipt references a preceding request and unchanged run-pinned descriptor. IDs, digest rules and old fixtures are preserved.
- Scoped verification still identifies `actor=host-tool`, `independence=agent-supplied-check`, exact definition/artifact-snapshot hashes and `current_at_run_end`. Overall `verification_status=UNKNOWN` and `NO_INDEPENDENT_TASK_ACCEPTANCE` are unchanged. There is no independent local acceptance issuer to approve or delegate in this release.

## Reproduced consumer result

The actual pinned consumer **accepts** the older supported `claim-without-evidence.json` control and **rejects** the unchanged current producer bundle with `PIDA_FORBIDDEN_PAYLOAD_FIELD`. That result is a genuine integration blocker, not a passed product acceptance check. The regression runner expects and records the incompatibility; no metadata was stripped, digest rewritten or event relabelled to manufacture acceptance.

The consumer still lists the older scalar vocabulary. Current metadata includes `descriptor`, API/request-attempt/configuration/usage/retry fields, tool ancestry and the new `input_digest`, `input_digest_scheme`, `authorization`. Merely adding keys is insufficient: descriptor JSON needs bounded semantic validation, external lineage checks, preceding-request linkage and completeness/scope preservation.

Owner action: support an explicitly pinned `pida.export-validation/0.3` producer profile or return a typed unsupported-profile result; rerun the supplied byte-identical positive/negative fixtures. Preserve source/native IDs and metadata loss disclosures. Do not infer task PASS from runtime completion or model claims. Report actual imported bytes, adapter/source revision, scope, duplicate/conflict behavior and remaining loss.

## Disposition and scope

Producer generation, schema, normal/negative examples and actual import reproduction are **implemented/tested**. Successful latest-producer import is **BLOCKED in the consumer**. Independent local acceptance, federation, enterprise issuer policy and live-model acceptance remain separate planned requirements; this response supplies the current limits instead of inventing those APIs. Pida remains usable without Schumpeter.

See [0.8.5 validation](../../CR-INTAKE-VALIDATION.md). No Schumpeter file, store or service was modified; test stores were disposable and owned by the Pida runner.
