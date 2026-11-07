# Independent pida / Persona dispatch join review

Reviewer `/root/persona_dispatch_review`, separate context, same Codex family. Date: 2026-11-07. Product source was read only; review ran in detached `D:/ChantaResearchGroup/pida-persona-review-20261107`. No canonical database, live credentials, deployed service or author checkout was changed.

## Exact source and scope

- Consumer: `039d8ef3f153e1d8499566223fad876c8f2105b8`, compared with parent `f01ad77`.
- Producer: `c1e3617aa88e6013ea34f76c3f4c41504618f863`, independently reviewed earlier; source digest `7dd9aa5ea22afaab033b62d54864d6849ac038e414ea7cc93fd341828cd731cb`.
- Inspected new `src/vera-dispatch-provider.ts`, inherited `src/vera-persona-provider.ts` checks, public runner `scripts/vera-dispatch-check.mjs`, focused tests, source lock and `docs/VERA-DISPATCH-0.1.md`. Delivery corrections are a separate review and were not duplicated or waived here.

The consumer requires explicit protocol and capability opt-in, checks the exact advertised capabilities/renderers/stale policy before context resolution and each authorization, and rejects unsupported branches/reference arrays and missing producer-profile markers. Its inherited adapter validates exact binding scope, stored context digests, expiry, request/snapshot identity and matching ACK fields. The producer remains a restricted core-linear-state profile; wire shape does not substitute for unavailable graph/behavior semantics.

The test runner starts the actual pinned public Python probe and enters the actual Pi loop using scripted responses. It does not use the historical private authorization shim. All 11 producer source hashes are checked before and after the run. The host-injected source directory and transport remain trusted configuration; the runner is not a sandbox for an arbitrary source tree.

## Independently executed checks

Environment: Windows, Node `v24.18.0`, Python `3.11.9`.

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node --test --test-timeout=20000 test/vera-dispatch-provider.test.mjs test/vera-persona-provider.test.mjs
node scripts/vera-dispatch-check.mjs --source D:/ChantaResearchGroup/Vera-dispatch-review-20261107 --python C:/Users/migeo/AppData/Local/Programs/Python/Python311/python.exe --output D:/ChantaResearchGroup/pida-persona-review-evidence-20261107
git diff f01ad77..HEAD --check
git status --short
```

Build succeeded. All 16 focused tests passed, including negotiation failures, altered producer description, strict historical adapter validation, retry/compaction checks and actual Pi authorization/input boundary tests. The seven public-producer integration scenarios passed:

| Scenario | Actual scripted model calls | Input-included receipts | Result |
| --- | ---: | ---: | --- |
| JSON renderer | 2 | 2 | Completed |
| Reference renderer | 2 | 2 | Completed |
| Grant revocation | 1 | 1 | Next dispatch rejected |
| Context expiry | 1 | 1 | Next dispatch rejected |
| Identity revision | 1 | 1 | Next dispatch rejected |
| Memory append | 1 | 1 | Next dispatch rejected |
| Linear working-state advance | 1 | 1 | Next dispatch rejected |

Negative scenarios returned `PERSONA_INPUT_NOT_AUTHORIZED` after their public producer mutation. Two authorization requests occurred in each scenario; the failed second authorization did not create another model call or inclusion receipt. Observation bundles validated, their input fingerprints matched the actual authorization requests, and their descriptors retained `pida.vera-dispatch/0.1.0` rather than the historical provider identity.

`result.json` in this directory records exact consumer source/build hashes and hashes of the seven bundles. Its SHA-256 is `6e1c0733938cce73e26d75987bcaf98e8a3256811f60b2a90c835a0ccb80363a`. The reviewed consumer worktree remained clean; baseline-to-head whitespace checks passed.

## Findings, limitations and validity

No material defect was identified in this bounded consumer/join review. This establishes local public-producer interoperability with scripted Pi dispatch only. It does not establish actual configured LLM behavior, remote authentication/transport, canonical writeback, producer-use receipts, graph/behavior capabilities, desktop acceptance, or the separate delivery/full-suite gates. Actual model costs and deployment performance are unknown.

Evidence is limited to these exact source bytes and environment. Recheck after producer/consumer/schema/capability/stale-policy/transport changes. Withdraw this result if unsupported requirements are accepted, a rejected authorization permits a next dispatch, source pins do not match the invoked producer, or inclusion receipts cease to correspond to actual Pi input calls. The producer's documented check-to-dispatch window remains.

**Verdict: PASS for the pinned restricted local producer/consumer interoperability scope.**
