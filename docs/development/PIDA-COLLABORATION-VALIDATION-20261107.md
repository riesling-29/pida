# Pida collaboration implementation evidence

Baseline `30fef192b478b1697bb95a22ad7340cf1c485b03`; branch `feat/pida-durable-collaboration-20261107`; writable checkout `D:/ChantaResearchGroup/pida`. Existing `D:/pida` remains untouched. Source commit/diff will be recorded after owner verification; working files are not a published release.

## Completed developer checks

- `bun install --frozen-lockfile`: installed pinned local dependencies; no global plugin installation.
- `node scripts/task.mjs build`: passed.
- Initial organization/collaboration check: 22 passed, 0 failed. Final `node --test --test-timeout=20000 test/collaboration.test.mjs test/organization.test.mjs test/agent-supervisor.test.mjs`: **30 passed, 0 failed**, including added restart-policy revocation and cancellation during asynchronous dispatch authorization. [Focused output](pida-collaboration-focused-output.txt). Tests use actual file persistence, separate crash processes, actual native Pi loop with scripted model output, and local HTTP+SDK.
- `node scripts/task.mjs test`: **414 tests; 384 passed, 21 failed, 1 cancelled, 8 skipped**. [Full output](pida-collaboration-test-output.txt). Failures include Windows symlink EPERM, timeouts, provider mock assertions, OCEL and workspace-path assertions. A baseline comparison was not performed: attribution to pre-existing issues versus this change is **unresolved**, and full-suite acceptance is not claimed. The focused native supervisor/organization suite passed separately.
- Corrected a syntax error in an added cancellation test before the final focused rerun; no failing intermediate run is presented as passing.
- [Source manifest](pida-collaboration-source-manifest.json) pins the bounded runtime, test, contract and fixture files for independent review. `git diff --check` passed before the focused commit.

## Contract coordination

Pida proposed exact v1 envelope/receipt fields to Schumpeter; Schumpeter explicitly accepted on 2026-11-07 including authorization at receive and dispatch, immutable duplicate history and fresh-task-only reply correlation. [Contract](../COLLABORATION-1.md) documents the actual fields, endpoint, digest helper, golden fixture, native state migration and coverage limits. PIX was notified of the carrier identity and absence of source send/response sequence evidence.

Persona owner implemented an explicit `vera-dispatch/0.1.0` producer subset rather than claiming recovery of the unavailable old extension source. Consumer negotiation and actual public authorize-input integration are a separate subsequent commit so this collaboration diff can be reviewed without a moving target; existing `.2` fixtures and consumer lock remain unchanged.

## Scope and pending evidence

No push, remote publication or deployment. No claim of live external authorization service, end-user desktop acceptance, remote real LLM execution, complete question/answer continuation, canonical Persona receipt append, power-loss transaction durability or independent/cross-family review. Independent reviewer should inspect the exact final diff and run the bounded tests before accepting the implementation.
