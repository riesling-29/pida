# Independent actual case D workflow review

Reviewed on 2026-11-08 KST by `/root/pida_join_review`. This review read preserved evidence and recomputed comparisons locally. It made no model, authentication, network, desktop UI or product mutation call. The reviewer scripts and results are in this directory; private inputs remain in the explicitly authorized synthetic case directory and are not reproduced here.

## Scope and pins

- Case: `5bd55085-d316-4dc3-97cf-091d70a32478`; host `desktop-c70db42530f74e03`.
- Runtime source: `b7f7d523c6fede56d508575a6bb78afa343e5566`, including previously reviewed native join change `2b787fd4c234747da22726ec03a3e4c6619ae95f` and Windows path change. The observation validator was imported from the separately built checkout at the exact b7 revision.
- Frozen workflow documentation: `c0b6e298b4d82a4974098927f8a08beb2ae357ce`; `two-org-case-d-workflow-20261108.json` SHA-256 `31027d795355fb09c90b4fd5c5838cfbf72ec162f63170d80fb4fcdd1a795ee8`. Working file bytes match the committed blob.
- Private source inventory SHA-256: `af4e661cef6b746deeff4eb0d30c9b9bdcac7e6da32e2a10de63bd7f8c64286d`. All 39 named preserved source files match inventory sizes and hashes.
- Actual Schumpeter captures and review records were read from `D:/ChantaResearchGroup/Schumpeter-shell-d-20261108/desktop-app/evidence`; exact captured result and provenance bytes were read only from its named private `.tools/real-case-d-captured` files.
- Windows package manifest `36388ea34cbe9011c1554b389cbdc55dd7789914f862ab744b6587b6e4fcf88f` and host source digest `9841b860b1bfb16e98e25dfee535a7b7dc06b1020ccce1f29d812567263acdfa` are producer-supplied pins, not an independent full package inventory audit in this slice.

## Recomputed observations

`audit.mjs` completed 133 checks with zero failures. `frozen-record-audit.mjs` completed 19 additional checks with zero failures. These are 152 evidence comparisons, not 152 model runs or product acceptance tests. No owner audit helper was invoked.

The final native cut contains two fresh goal sessions, three agents and four completed jobs. A has one initial attempt, one required child and exactly one continuation in the retained graph. The initial job `6080e981-de8a-4d5e-a14b-571088764a70` retains completed `AGENT_JOIN_YIELDED` with genuinely empty text. Its child is `6745cb3d-3859-4e6f-bfd7-6b99a89903a4`; the ready join binds that child's exact input/result digests and selects continuation `05863fc6-c183-42e4-aaab-e9fe4352cbbb`. Parent and continuation reuse agent and session, with distinct job, run and attempt IDs. A's three jobs are unchanged between the A cut and later B cut. B job `d50e906c-141f-4a57-a6cf-c7f8ea37c54f` belongs to a distinct native goal, agent and session.

All four native observation bundles validate. Each has one consistent terminal event, matching manifest identity and retained healthy export metadata. The request distribution is 3 initial + 1 child + 2 continuation + 2 B = 8. Each request has a corresponding current-provider-check logical input receipt bound to its exact native agent/job/run/session/attempt/organization/host, within the recorded context validity interval. Response usage is reported. The earlier twelve requests were not independently recounted; twenty is the workflow record's historical accounting plus these eight. Billing is unknown.

The actual parent Pi record contains one delegate and one join. The actual child assignment and delegate arguments contain neither the private raw seed nor expected derived answer. The child uses no tools and its case and arithmetic result match the private oracle. A's final output retains the observed child value and exact child IDs. These are observations consistent with use of supplied Persona context; they are not proof of internal model causality or provider-wire context bytes.

For A and B separately, the final native text, retained output file, observed `workspace_write` content and private captured result match byte for byte. The final manifest binds each file's path, size, hash and current artifact reference. A is 178 bytes with SHA-256 `c7a211825563be87603fa099e9f37f719281329d6cc31f8eff9c9936db8513ea`. B is 299 bytes with SHA-256 `041a45360b91254330753a5f1770c25c294037041df3050e49c975df39590cb5`.

B's exact submitted goal and result use the observed A data, A's final result hash, publication revision 4 and continuation job ID. The raw seed is absent from B's goal. This is an operator-forwarded handoff, not evidence that B independently reconstructed A's answer from its own Persona context. The separate coordination message records operator publication, persisted delivery and context inclusion `unobserved`; no agent-sent or automatic message-consumption claim is made.

The A capture selects the completed continuation rather than the initial empty yield, while preserving the immutable initial native admission receipt. B selects its own final job. Both provenance records bind exact selected run/attempt, result bytes/hash and original admission. Both contracts have one capture/submission at publication revision 4 and one separate explicit review resulting in accepted revision 5. The distinct contracts are `c70e1249-05ff-594c-b184-7a2bdd6ceb05` (A) and `67ffbee0-f341-514c-be2b-68919c9fe219` (B). Their declared checks cover only A's case marker and B's `/received` flag; the independent byte/oracle/lineage checks here are additional evidence, not an expansion of those acceptance rules.

Both native organizations retain empty acceptance criteria and native `UNKNOWN` receipts. Schumpeter's explicit declared artifact acceptance does not change native acceptance to accepted.

## Privacy finding retained

The original uncommitted public B readback contained the derived answer. Its exact bytes remain privately preserved with SHA-256 `c8740f64ce74861f74830e3c199c46f1f24ad7df1bbadf1812c3e9f26dc5a8c5`. The corrected public whitelist file has SHA-256 `04b69c32136555dbf941559068375ad082c9c065a8e44c407f306bc41dda1b2e` and excludes both private numeric values. All twenty specifically listed current public D JSON records independently match the frozen workflow hashes and exclude those values. This is a correction with evidence retention, not a claim that disclosure never occurred. The scan covers these exact private values and named files, not a general secret scanner or remote publication audit.

## Reproduction and limits

Run `node audit.mjs` followed by `node frozen-record-audit.mjs` from this directory, with the explicitly scoped private case and named Schumpeter records available. Results are `actual-case-d-audit.json` and `frozen-record-audit.json`; source and output hashes are listed in `evidence-hashes.json`. Do not copy private inputs or the auxiliary shape-inspection helper into public evidence.

This is a review of a bounded observed Windows workflow. A and B cuts are separate snapshots. Exactly one continuation is demonstrated in these retained cuts; crash/restart idempotence is covered only by separate source tests, not a new actual crash experiment here. Final desktop reopen, complete package identity, PIX same-trace analysis, provider account quota and general production readiness remain separate or unknown. Published elapsed timing was not independently remeasured. No source-code or product behavior claim is inferred solely from documentation hashes.

Withdraw the affected finding if any pinned source file or byte hash differs, if additional native attempts or continuation jobs invalidate the retained graph, if capture selects a different job or revision, if the private seed/answer is found in the actual child assignment, or if the purported current receipt has mismatched native identity or validity. Validity is limited to the named case, immutable sources and retained records; changed runtime, configuration, inputs or reopened-state evidence require corresponding review.

Conclusion: the retained actual D evidence supports the bounded native A delegate/join/continuation workflow and operator-mediated A-to-B handoff with exact final artifact capture and separate declared acceptance; no contradiction was found within this review scope.
