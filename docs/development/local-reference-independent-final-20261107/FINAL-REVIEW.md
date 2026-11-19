# Independent production local-reference host join review

Reviewer `/root/persona_dispatch_review`, separate context, same Codex family. Date: 2026-11-07. Product source and canonical data were read-only; isolated worktrees, exported source and disposable configured stores were used. No real LLM or paid service call occurred.

## Reviewed identities

- Initial consumer: `7997d5101709b18115912c20f687daf979c3a54a`, with producer `0d9714c1ac84c36082491ee2c264706a16fd14b5`.
- Corrected consumer runtime: `11439f4e1809cf4cb8188b610fd7582a3b6160e2`.
- Corrected producer: `f6edd022d4389237fcee5d6c0a4db8a0d0b13399`.
- Corrected nine-file producer runtime digest: `0f85831175f24aea7237a6a003bdb14972a32cf13a7e76394c3fa9898b3763d6`.

## Material finding and correction

The initial review found one P2 recovery defect: the host fingerprint bound only a store path. A newly initialized same-config store at that path returned the same fingerprint but different binding IDs for the same native execution. The evidence and initial disposition remain in `INITIAL-REVIEW.md` and `store-identity-7997d51.json`.

The producer now creates a unique immutable store-instance ID, writes matching append-only SQLite metadata before publishing its completion marker, and validates marker/DB agreement. Its read-only `identity` action returns exactly the store schema, instance ID and configuration digest. Every actual provider transaction/snapshot checks the opened database identity; an old open bridge rejects a different same-path store. Old, missing, future or mismatched store identity metadata is rejected without migration or repair.

The consumer now includes that immutable identity in its preflight fingerprint, compares the public producer identity handshake with the preflight marker, and passes the preflight identity into module startup to reject configuration switches. The actual host resume check rejects a new same-path store before changing supervisor state; restoring the original store resumes the same native job. Mutable SQLite bytes are not used as the resume fingerprint.

The original independent reproducer now reports `identityChanged: true` when a fresh same-config store replaces the original path. The old store is preserved in the review fixture. This closes the identified recovery gap for distinct initialization instances. Complete backups/clones of the same instance retain the same identity; same-instance rollback/anti-tampering is explicitly not claimed.

## Independently executed evidence

Environment: Windows, Node v24.18.0, Python 3.11.9.

- Built both frozen consumer revisions. The exact production-host test passed on the corrected pair with all nine producer source hashes checked. It verifies Korean/emoji context, public input authorization, real native OrgSession/OrgAttempt/job/agent linkage, a completed mock job's logical inclusion receipt, same-job resume, changed-config rejection and fresh-same-path-store rejection preserving supervisor bytes. Restoring the original store passes resume again.
- The corrected producer source-export verifier independently passed 17 tests with the exact runtime digest above, covering strict marker/DB identity, same-path replacement, actual opened-DB checks, read-only identity, Unicode CLI/embedded paths, malformed input and explicit initialization.
- Initial selected host/policy/admission regressions passed 19 tests. This is historical evidence for `7997d51`, not a fresh whole-suite run on the correction; the corrected helper/host paths were tested with the targeted native-host scenario and independent probes.
- Independent real public-producer + Node helper + Pi scripted-loop probes for revocation and expiry each record exactly one model call and one inclusion receipt, then `PERSONA_INPUT_NOT_AUTHORIZED` before the next call. These negative probes use explicitly synthetic organization/attempt scope; actual native ID mapping is established separately by the host test.
- Missing store now fails during preflight before spawning a producer. An injected malformed child response rejects startup and closes the process. The corrected observed times were 1 ms and 105 ms respectively; these are single-run observations, not performance guarantees.
- Actual producer initialization process exits immediately before and after completion-marker publication preserve the earlier fail-closed/restart behavior. Before-marker startup and re-init are refused; after-marker startup succeeds with one identity. DB bytes remain unchanged by those restart checks. This is process-restart evidence, not power-loss durability.

Commands include:

```text
npm run build
node --test --test-timeout=30000 test/vera-local-reference-host.test.mjs
python -I -B scripts/verify_local_reference.py NEW_EVIDENCE_DIRECTORY
python -I -B scripts/package_local_reference.py --output NEW_RUNTIME_DIRECTORY
node store-identity-probe-r4.mjs
node dispatch-lifecycle-probe-r4.mjs
python -I -B crash_probe.py EXPORTED_RUNTIME_DIRECTORY
```

`PIDA_TEST_LOCAL_REFERENCE` selected the exact corrected exported runtime, and `PYTHON` selected the explicit Python 3.11 executable. No source fixture or historical private authorization shim is loaded by the production helper.

## Artifacts and limits

This directory contains the original and corrected independent probe scripts/output. `final-review-manifest.json` pins their exact hashes plus the corrected producer export evidence in `D:/ChantaResearchGroup/Vera-reference-review-evidence-r4-20261107`. Reviewed source worktrees were clean. Runtime source diff integrity checks passed. A separate copied-evidence CRLF formatting issue was sent to the owner for archival preservation plus readable LF copies; its final status is recorded below.

The parent assembly must still verify the complete producer dependency export and its Python/service executable. This review does not establish packaged Python service, Linux lifecycle, final desktop acceptance, real LLM behavior, remote authentication, canonical writeback or semantic memory benefit. The profile remains one explicit static reference persona/store, organization-bound native execution only, with no grant renewal/config update, graph/model support, memory/state-write IPC or producer-use receipts. Actual semantic benefit and deployment performance are unknown.

Recheck after either source, store schema, launch identity, config/policy or packaging/platform changes. Withdraw the result if a different store initialization resumes unnoticed, rejected authority reaches a next input call, native IDs are substituted, code-only errors leak sensitive input, or the recorded source exports cannot reproduce the evidence.

## Archival delta and final disposition

Documentation correction `affdf10ca0034d57477884e89f43e74b1aa009ba` preserves both original initial-review JSON files byte-for-byte in `original-json-bytes.zip`; their hashes independently match the reviewer originals. Adjacent readable copies use LF and no BOM. The full `7997d51..affdf10` whitespace check passes. The reviewed local-reference helper, host join, source lock and corresponding test remain identical to `11439f4`. Intervening observation-TUI changes are outside this review; this result does not approve that unrelated code.

The P2 distinct-store recovery finding is closed for the corrected pair. No remaining material finding was identified in the stated scope.

**Verdict: PASS after correction for the pinned Windows local-reference producer/host join and distinct-store resume protection.**
