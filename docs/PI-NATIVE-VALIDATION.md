# PI-native first slice — 0.8.4

Date: 2026-11-03. Input: the user's common integrated report v1.0, app-specific Pida prompt and Cross-App ChangeRequest template. Requirements `INT-PD-*` are not the old IRD PD identifiers. Scope is this Pida repository only.

## Baseline and selected patch

| Item | Observed baseline |
| --- | --- |
| Local repository / branch | `/workspace/scratch/1e97a966156f/pida`, `fix/runtime-stabilization` |
| Local HEAD | `0b454cb`, 0.8.3 |
| Remote development branch | `riesling-29/pida`, `fix/runtime-stabilization-00-02` |
| Remote PR / HEAD | Draft PR1, `e08edcfc98b0ca7e3450714865eaae294b1c1c3f` |
| Initial dirty changes | None; existing worktrees preserved |
| Environment | Linux x64, Node24.22.1, npm11.9.0, Python3.12.14 |
| Runtime dependency | Official Pi1.2.0 exact pins; no loop/SDK upgrade |
| Baseline test evidence | Prior release reported288/288; not treated as this slice's live evidence |
| Other apps | Read-only references only; no edits, commits, migrations or service restarts |

Reused: Pi sessions/stream dispatch, runtime authorization/effects, `ObservationArchive`, closed export validator, `AgentMemoryStore` CAS and private atomic storage, workspace composition and existing supervisor. No second execution loop, identity database or process-mining algorithm was created.

The selected implementation is the report's first batch slice: current export → direct PIX reflection → fixed model → separate trace awareness → permitted provider append → next actual logical model input. Organization join/local acceptance is explicitly the next independent slice, not a prerequisite hidden inside the PI worker.

## Requirement disposition

| ID | Current disposition | Implementation/test evidence or remaining work |
| --- | --- | --- |
| INT-PD-01 | Partial existing; OrgSession not implemented | Existing supervisor/jobs reused; organization goal/criteria/task/attempt controller remains planned |
| INT-PD-02 | This slice: managed local binding; external contract-only | `persona-provider`, `run-context`, runtime dispatch receipts; provider and workspace tests; actual external Persona NOT_RUN |
| INT-PD-03 | Partial existing; join/continuation not implemented | Durable request IDs/jobs/parent refs exist; next slice in `PI-NATIVE-ORG-GAPS.md` |
| INT-PD-04 | Not implemented | Existing async delegation is not a durable conversational inbox/question loop |
| INT-PD-05 | Existing reused and regression-tested | Effects, interrupted sessions, command control/cancellation; no new external-effect replay policy |
| INT-PD-06 | This slice fixes actual producer incompatibility; broader contract partial | Closed typed metadata/descriptor/receipt schema, current Pi/MCP export fixture, duplicate/conflict/gap and restart identity checks; Schumpeter import NOT_RUN |
| INT-PD-07 | Implemented and real engine integration tested | Optional pinned Python worker and TS process port; no Schumpeter dependency; missing engine fallback |
| INT-PD-08 | Implemented for completed sequential batch profile | Actual variants/DFG; selected denominator, failure/exclusion counts, cohort guards, native lineage; semantic personality labels not fabricated |
| INT-PD-09 | Implemented for fixed DFG batch profile | Actual raw-cost alignment; held-out runs/tasks; empirical vs mandatory semantics; partial/unsupported/unknown kept distinct |
| INT-PD-10 | Partial: stale terminal cut/model checks | Live current cuts and guidance/adoption/action/outcome control chain not implemented |
| INT-PD-11 | Partial existing; independent local task acceptance not implemented | Artifact-bound tool checks and result manifest remain; model completion is not independent PASS |
| INT-PD-12 | Not implemented in this slice | Existing Web editing/preview preserved; mouse TUI/Windows IME acceptance pending |
| INT-PD-13 | Partial existing | Scoped extensions/MCP/pins/lifecycle reused; no external native CLI/ACP runner claimed |
| INT-PD-14 | Existing + bounded PI execution | Owner/scope/permission, input/output/time/events/calls/artifact limits; no new OS sandbox, aggregate org billing/resource cap |
| INT-PD-15 | Not implemented | No procedure candidate experiment/activation/rollback or demonstrated improvement |
| INT-PD-16 | Partial producer readiness | Current fixtures/CR supplied; enterprise command acceptance and federation not implemented |

## Defects reproduced and corrected

- Clean0.8.3 actual Pi run completed, but its export failed `SCHEMA_INVALID`: runtime descriptor/model/usage/retry fields had outgrown the closed validator. Typed fields and semantic descriptor checks now accept actual producer data; arbitrary payload and malformed context remain rejected. Wire draft IDs and persisted event identities are preserved; validator capability is `pida.export-validation/0.2`.
- Host contract counterexamples found request-cache substitution, unchecked referenced model changes, partial results promoted to conformance, oversized persistent results, and false case membership despite a matching total count. These now fail or remain unknown with explicit evidence.
- Missing/incomplete evaluation cases retain exclusions rather than crashing the task-overlap check.
- Managed workspace binding exposed legacy empty/long role and trusted SDK principal regressions. Workspace role metadata uses a digest-derived ID; local memory routing preserves principal isolation and existing local-user storage.
- An external Persona factory removed local canonical memory tools but the worker prompt still instructed their use. Prompt construction now follows the selected authority.
- Native provider regressions showed that a custom context before Pi's initial system/tool declaration changed the initial Responses tool payload, and unpermitted schemas consumed small-model context. The request projection preserves the Pi baseline and exposes only actually granted tools.
- An8k window with1k output unnecessarily crossed the fixed4k compaction reserve. The margin now scales with the window. A boundary test verifies normal input, actual automatic compaction and the following managed request. Pi's internal summary calls are distinguished by the observed compaction lifecycle; they cannot reuse an execution request's receipt. Unmeasured internal-summary usage is an explicit manifest limit.

## Validation profiles

| Profile | What was actually run | What it does not establish |
| --- | --- | --- |
| Contract/synthetic | Host selection, cache, scopes, CAS and bad-input cases with explicitly named doubles | Actual producer/provider compatibility or model quality |
| Protocol/runtime | Actual Pi loops, local HTTP/MCP servers, process boundaries, context conversion and UI regressions | Live model decisions, Windows rendering |
| Real PIX + synthetic traces | Pinned public APIs and native v1.3.0 documents; 20-case oracle12/6/2, separate evaluations and limits | Enterprise field performance or semantic personality truth |
| Pi → PIX → local Persona | Actual run exports, PI tools, fixed model, evaluation, local CAS append, next provider-facing input receipt; scripted model | Actual PersonaSubstrate/Schumpeter integration or long-term improvement |
| Live / external | NOT_RUN | No credentials/private company data/new paid API access requested |

Final command counts, evidence identities and review outcome are appended after the release gate. The public source fixtures and generated reports identify their exact producing runtime/engine and whether the source is synthetic. Hash equality is an integrity check, not business acceptance.

## Other-owner requests and remaining work

- [Persona context/binding/behavior-reference contract](change-requests/CR-PERSONA-20261103-01.md): consumer-owned adapter implemented; owner compatibility and actual provider acceptance pending.
- [PIX current-cut/model/operator compatibility](change-requests/CR-PIDA-PIX-2026-11-03.md): completed batch path works without core changes; future profiles need owner-confirmed semantics.
- [Schumpeter current producer and federation](change-requests/CR-PIDA-SCHUMPETER-2026-11-03.md): current fixture available; consumer import/local acceptance/federation are separate states.

Requests are repository handoff artifacts, not externally sent messages or assumed owner approvals. Next Pida work is durable organization join/continuation and exact-revision local acceptance, then question/inbox continuation, host-attached TUI and current-cut guidance under separately verified contracts.

Commit policy: one commit for version0.8.4 on the existing development branch/draft PR after tests and one integrated read-only review. No other-repo commit, main merge, tag, release or deployment.

## Independent review and final gate

One separate read-only integrated review was performed on the assembled slice. It identified fourP2 defects; only those findings were selectively rechecked afterward:

| Finding | Correction | Focused evidence |
| --- | --- | --- |
| Incomplete evaluation snapshot dereferenced a missing manifest | Task-overlap check uses supported included cases while exclusions remain in the denominator | `test/pi-native-review.test.mjs` partial/unknown case |
| Known local CAS rejection became an unknown external effect | Pre-dispatch and known local rejections report `not_applied`; uncertain external append remains `unknown` | Actual Pi/effect-ledger cases show no false recovery block and preserve genuine unknown effects |
| Public source refs could forge analysis dedupe markers | Reserved namespaces in public mutations; prior record content/status/ref set checked | Persona tests reject forged and retracted record replay |
| Persona append substituted run ID for task ID | Actual runtime task ID is threaded and checked against source run metadata; valid non-UUID task IDs preserved | External contract fixture receives exact distinct task ID; mismatch rejected before dispatch |

These selected tests plus Persona regressions passed15/15 at review closure. Additional concrete provider/compaction regressions found by the full gate were corrected and rerun; existing assertions were not weakened. This is an independent agent review, not an external security certification.

Final0.8.4 gates:

| Command | Result | Profile |
| --- | --- | --- |
| `npm test` | **329/329 PASS**,0fail/skip,22.5s; includes build | Existing/runtime/protocol + new contract cases |
| `python -B scripts/pix-worker-check.py --source .pida-test-pix-source` | **18/18 PASS** | Actual pinned PIX, synthetic traces |
| `node scripts/pi-native-integration-check.mjs` | **13/13 PASS**,4.26s for this sample | Actual Pi→PIX→local Persona→next logical input; scripted decisions |
| `node scripts/generate-current-export-fixture.mjs` | Actual21-event producer bundle self-validates | Pi + MCP stdio fixture + retry + context |
| `PIDA_CHECK_API_ONLY=1 node scripts/studio-browser-check.mjs` | PASS | Actual HTTP/project/discovery; browser deliberately not run |
| `node scripts/agents-ui-handler-check.mjs` | PASS | DOM handler fixture, not rendered browser |
| `npm ls --depth=0` | PASS; Pi remains1.2.0 | Installed dependencies |
| `npm pack --dry-run --ignore-scripts --json` | PASS; Python worker included, test source/checkout not bundled | Package contents, no publication |
| `git diff --check` | PASS | Patch whitespace |

No additional package dependency was introduced. Actual live LLMs, external PersonaSubstrate, Schumpeter import/enterprise acceptance, Windows execution/browser/TUI and demonstrated long-term improvement remain **NOT_RUN**.

## Exact generated evidence

- Current producer bundle: `fixtures/current-producer/context-mcp-retry.json`; SHA256 `ddf104ef5ee3b5e692805b281900ca7e6138ebda13c4cd426f22dd550349295f`. `index.json` records0.8.4 and `pida.export-validation/0.2`; malformed-context and conflicting-event fixtures are rejected.
- Integrated report: `fixtures/pi-native-integration/report.json`, with14 byte-checked evidence files totaling1,443,019 bytes. Source patch digest `e5741d20ef7b755afdf417b49baebf17aff6c4bb18c332ba667527cfca1dc571`; executed-build digest `0b70113ba84bbf0fbf296c578b73483cbf496aae75c4c0c4bd2496caff4d1c7a`. Source/build/package hashes were captured before execution and verified unchanged afterward.
- Model: `pi-model:4a17c79aec88276bf2fd182257945c34d976cb1a5d88cac5b26313276896f474`.
- Reflection: `pi-result:97681dd6c86a1b5999c605d7a794fa19848e31b50075583ed9c5a3ea1f69ae6e`; actual12/6/2 variants,20 selected cases,2 failed outcomes,0.9 top-two coverage.
- Awareness: `pi-result:731da995ada594da3712a4bc057ef4b48d105904f10289a10fdc0b86baa40870`; later holdout's additional inspection yields actual raw cost2, empirical deviation with no automatic obligation/identity/correction claim.
- Exact native computation IDs, source/compiled file digests, training/evaluation snapshots, local append receipt and next-input descriptor revision/digest are in that report and its evidence files. Native PIX engine source pin is `3205d832d5dcdc6901f916b35496a0c60b657e7a`, code digest `b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510`.

Plan: complete for this first slice. Implementation: complete within the stated batch/local scope. Tests: passed under the above profiles. Actual integration: Pi+PIX+Pida local memory confirmed; external PersonaSubstrate/Schumpeter not confirmed. Commit-readiness: ready on this evidence, with the stated remaining requirements and no deployment authorization implied.
