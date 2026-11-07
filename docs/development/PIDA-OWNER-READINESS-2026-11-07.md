# Pida owner readiness and collaboration contract intake

Date: 2026-11-07 (Asia/Seoul). Scope: initial owner readiness and source inspection only.

Subsequent authorized implementation is recorded separately; the initial findings
below remain historical. Current owner branch is
`feat/pida-durable-collaboration-20261107`. The final platform artifact source is
`bb9886ffc3a2a815e3c255b7dbfc83b4b4bac5e3`; later evidence/docs commits do not
change those artifact bytes. See [distribution handoff](PIDA-RUNTIME-DISTRIBUTION-20261107.md),
[atomic organization admission](PIDA-ORGANIZATION-ADMISSION-20261107.md),
[source-backed reference Persona](PIDA-LOCAL-REFERENCE-HOST-20261107.md) and
[observation terminal](PIDA-OBSERVATION-TUI-20261107.md).
Independent focused reviews passed after recorded fixes, and both platform
packages passed base/reference mock-job restart probes. Full desktop/PTY assembly,
fresh provider connection and the final real multi-organization scenario remain
separate parent-owned gates; no complete-product acceptance is claimed here.

## Intended boundary

Pida remains independently usable for one or many agents. It owns organization execution, native jobs, joins, bounded repair and local acceptance. PersonaSubstrate owns persona identity and memory. Schumpeter owns the outer session containing multiple organizations and cross-organization collaboration. PIX owns neutral process computation. These boundaries come from the user's current direction; this document does not turn a cross-app request into authority to change another app.

This unit changes documentation only. No runtime behavior, dependency, public endpoint or remote service was changed. No remote messages, push, merge or deployment occurred.

## Checkout and reproducible baseline

| Item | Observed value |
| --- | --- |
| Writable owner checkout | `D:/ChantaResearchGroup/pida` |
| Origin | `https://github.com/riesling-29/pida.git` |
| Source HEAD | `30fef192b478b1697bb95a22ad7340cf1c485b03` |
| Owner branch | `docs/pida-owner-intake-20261107` |
| Initial worktree | Clean, freshly cloned; documentation changes in this unit remain uncommitted |
| Ref refresh | GitHub default/main returned the same HEAD; open PR collection returned `[]` during this intake |
| Package / Pi | Pida `0.8.18`; Pi packages pinned `1.2.0` |
| Local runtime | Node `v24.18.0`; dependencies not installed in the owner checkout |
| Local instructions | No repository `AGENTS.md` or `PROJECT_STATE.md` found in this clone |

Initial discovery searched `D:/ChantaResearchGroup`, not the whole machine. The historical path in the multi-agent guide subsequently revealed another checkout: `D:/pida`, on `main` at the same HEAD, with untracked `audit-report.json`, `my-agent/`, `pida-real-run-utf8.json`, and `pida-real-run.json`. That checkout and its contents were not changed. The isolated checkout above avoids writing into that existing working state.

## What the current code supplies

The following are source-backed implementation observations, not newly executed product acceptance results.

| Contract | Available behavior | Limit relevant to integration |
| --- | --- | --- |
| Create / inspect / attach mapping | [`PidaClient`](../../src/client.ts) exposes `listOrganizations`, `createOrganization`, `getOrganization`, `cancelOrganization`; [`AgentSupervisor`](../../src/agent-supervisor.ts) scopes organizations to the authenticated principal. Create request IDs reuse the same organization for the same definition; conflicting input is rejected. | Pida `OrgSession` is a goal-bound execution containing tasks/attempts/joins, not a permanent company organization identity. Schumpeter must bind its organization identity to a host and native session explicitly. Existing list/get can support inspection; this is not a new attach authorization protocol. |
| Native work dispatch | `enqueueAgentJob` accepts input, request ID and optional parent job. Supervisor deduplicates by agent/request ID and checks payload/parent consistency. | Native request ID and ownership checks are not a versioned external room/contract envelope. No independent durable external inbox/outbox schema was found under those names in current `src`. |
| Continuation | [`OrgSession`, `OrgTask`, `OrgAttempt`, `BatchJoin`](../../src/organization.ts) represent the execution domain. A join can persist its child result set and schedule a continuation on the same parent agent session; bounded repair is a new attempt. | This is native child-job continuation. Arbitrary cross-organization reply/late-reply correlation has no equivalent public external contract yet. Do not relabel it as an already implemented federation inbox. |
| Durable state | Supervisor state version 2 records jobs and organization state. Interrupted running work is not blindly replayed on restart. | File replacement and persisted job state do not prove a multi-file transaction or power-loss guarantee. An external receipt and a job mapping must have a defined crash boundary before claiming durable delivery. |
| Midrun input | Current run steering/follow-up uses request ID conflict checking. [`runtime.ts`](../../src/runtime.ts) explicitly reports `queuedInputDurable: false` and current-run deduplication. | A successful steering acknowledgement cannot be advertised as a restart-safe external receive receipt or as model consumption. |
| Persona | [`PersonaProvider`](../PERSONA-PROVIDER.md) is a Pida consumer port. The Vera adapter uses pinned Binding/VeraContext types and per-dispatch `authorizeInput`. Logical context inclusion receipts are linked to the input/attempt. | Local default memory is not proof of canonical external persona identity. Current evidence includes synthetic local integration and a test-only private read-validation shim; public remote authorization/readback is still owner-pending. `pi-logical-context` inclusion does not prove provider wire bytes, comprehension, task success or canonical memory append. |
| Local acceptance | Host-selected checks bind artifact snapshot, criteria and environment revision. `getOrganization` rechecks current artifact identity before reporting current acceptance. | A model saying PASS is not acceptance. A native local receipt is not enterprise acceptance or an external collaboration contract receipt. |
| Trace / PIX | [`observation.ts`](../../src/observation.ts) and OCEL exports expose bounded observations and coverage diagnostics. [`PIX-PROFILES.md`](../PIX-PROFILES.md) documents batch and selected prefix/object-terminal consumers. | Exact source/profile pins, justified sequence and loss/coverage constraints still apply. A completed export is observation, not live control. No implicit total order or cross-org causality should be inferred from wall-clock timestamps. |
| Human surfaces | Existing Web/TUI agent panels and standalone operation are documented in [`MULTI-AGENT-0.8.14.md`](../MULTI-AGENT-0.8.14.md) and [`TUI-0.8.17.md`](../TUI-0.8.17.md). | Dedicated organization creation UI and multi-agent read-only push observer remain separate work. This intake did not verify Windows IME, Linux execution, packaging or a desktop application. |

The main organization source references are `src/client.ts:77`, `src/agent-supervisor.ts:259`, `:390`, `:410`, `:444`, `:531` and `:558`. The behavior and known constraints are documented in [`ORGANIZATION-0.8.17.md`](../ORGANIZATION-0.8.17.md) and [`AUDIT-FIXES-0.8.18.md`](../AUDIT-FIXES-0.8.18.md).

Persona owner coordination identified a source-availability limitation: the public Vera pilot and Pida's newer local-working-tree source snapshot are different baselines. [`consumer-lock.json`](../../fixtures/cr-integration/consumer-lock.json) records Persona baseline `7378040533b0333c3a24b01fbe8614c1de7b52f1` and exact file hashes, including `vera_persona/continuity.py`; this intake has no verified accessible producer checkout for those exact bytes. Treat that producer implementation as `SOURCE_NOT_AVAILABLE`, not as proven by a public revision with older schemas. The Pida adapter and fixture contract remain inspectable.

## Incoming collaboration request

Source: [Schumpeter CR-PIDA-COLLABORATION-20261106-01](https://github.com/Chanta-Research-Group/Schumpeter/blob/237417a5e5742888f565b30581387c7a2833a7f3/docs/change_requests/CR-PIDA-COLLABORATION-20261106-01.md), PR8 source revision `237417a5e5742888f565b30581387c7a2833a7f3`, blob `00dbf1010a936a922e8e68e934f967a3ec0ab748`.

The request calls for versioned external envelopes, durable receive acknowledgements, native job mapping, continuation, stale/revoked/cancelled cases, and recovery after lost acknowledgements. It separates received, enqueued, included in model context, responded and enterprise accepted states. Its Schumpeter local collaboration implementation is not evidence that a live Pida integration exists.

Owner disposition: accepted for shared contract design. Existing organization and job APIs are reusable; a durable external receive/continuation contract remains missing. This is a local owner response, not a published agreement or a claim that the other owners have accepted the proposed design.

## Smallest proposed executable slice

The next slice should bind one authorized external message to one durable native job record. It should not start with a desktop redesign or a new organization runtime. The alternative is to leave live federation disconnected and continue using explicit standalone Pida operations until the required mapping is agreed.

Before runtime edits, coordinate the following with the owning apps:

1. **Identity and authority:** distinguish Schumpeter session/organization IDs, Pida host/native OrgSession/agent/job IDs, and Persona binding IDs. Define who supplies and validates room and contract revisions, recipients and revoked permissions. Reusing names does not establish equivalent authority.
2. **Envelope identity:** agree a version, producer identity, request ID, recipient scope, payload digest, room/revision, contract/revision, sender binding and optional reply reference. Specify deduplication scope; a proposed key is producer + request ID + recipient binding, with identical payload returning the same receipt and mismatched payload rejected.
3. **Atomic receive/job mapping:** select a persistence boundary that prevents an acknowledged message from disappearing and prevents a repeated acknowledgement-lost request from creating a second job. Reuse supervisor enqueue logic. Do not let Schumpeter write the supervisor state file directly. A journal or in-state transaction design is a choice to resolve, not an existing capability.
4. **Evidence phases:** keep durable receive, native job enqueue, logical context inclusion, response, local acceptance and enterprise acceptance separate. Connect each phase using explicit stable IDs; never derive later phases merely because an earlier phase exists.
5. **Continuation policy:** specify the exact parent/task/attempt and expected state. Late answers after cancellation, expiry or authority revocation must not resume work silently. Initially limit execution to a fresh authorized native job if safe reuse of a waiting parent has not been established; report that coverage limit explicitly.
6. **Persona and PIX boundaries:** revalidate the current Persona authorization before model dispatch; no fallback from a required external source to local memory. Supply trace objects/relations and source sequence sufficient for PIX, while leaving any unsupported causal/coverage assertion unavailable.

Proposed acceptance tests for that future slice:

| Scenario | Required observable result / falsification condition |
| --- | --- |
| Receive succeeds; ACK lost; same request resent after restart | Same durable receipt and exact job ID; more than one native job falsifies deduplication |
| Same scoped request ID with changed payload | Deterministic conflict; existing receipt/job unchanged |
| Crash between receive and enqueue | Recovery follows the documented transaction boundary; no acknowledged loss and no duplicate job; untested power-loss durability must remain unclaimed |
| Changed recipient, stale room/contract revision, revoked dispatch authorization | Rejection or explicit unavailable result; no unauthorized native execution |
| Cancelled/expired parent receives a late answer | Explicit late/rejected state; no accidental continuation |
| Message received or queued but not in logical input | No input-included or accepted claim; distinct trace evidence for each actual phase |
| Existing standalone organization flow | Existing join, cancellation, exact-revision acceptance and standalone APIs remain usable |

The first slice does not establish the full two-organization ask/re-ask/answer/resume story required by the CR. That becomes a subsequent integration scenario after the durable mapping is proven. Existing steering cannot be substituted merely to make that scenario appear live.

## Verification performed and deferred

Performed: refreshed Pida main and open PRs through the GitHub connector; inspected local HEAD/branch/worktree and package scripts; inspected relevant README, 0.8.17/0.8.18 docs, CR intake, Persona/PIX contracts, SDK, organization types and supervisor/runtime sources. Read the incoming Schumpeter request at its pinned source revision. Checked this unit's Markdown local links and diff whitespace before handoff.

Existing test sources were inspected as prospective regression targets: [`organization.test.mjs`](../../test/organization.test.mjs), [`agent-supervisor.test.mjs`](../../test/agent-supervisor.test.mjs), [`persona-provider.test.mjs`](../../test/persona-provider.test.mjs), [`vera-persona-provider.test.mjs`](../../test/vera-persona-provider.test.mjs) and [`workspace-persona-pi.test.mjs`](../../test/workspace-persona-pi.test.mjs). Historical test results in existing docs are not counted as new runs. No dependency installation, build, runtime test, actual LLM call, remote Persona acceptance, live two-org run or Windows/Linux product acceptance was executed in this documentation unit. Costs, performance and delivery estimates are unknown.

## pstack operating principles and adaptation

Read [poteto-mode](https://github.com/cursor/plugins/blob/6b0300214a09fd6029cfb7077043125758cd1fd2/pstack/skills/poteto-mode/SKILL.md), [swarm](https://github.com/cursor/plugins/blob/6b0300214a09fd6029cfb7077043125758cd1fd2/pstack/skills/swarm/SKILL.md), and the domain modeling, separate-writable-state, verifiable-unit and proof principles at the same pinned pstack revision. Applied them as a bounded intake unit, explicit domain distinctions, a separate writable checkout and source/artifact verification. Cursor Task/cloud agents and Grok/Claude calls are unavailable in this execution; the actual mechanism is Codex collaboration with the inherited model. No cross-family or independent review is claimed. No global plugin was installed.

## Validity, withdrawal and handoff

These observations apply to Pida HEAD `30fef192b478b1697bb95a22ad7340cf1c485b03` and the pinned incoming CR only. Recheck when either source changes, before implementing the shared envelope, and before asserting any remote integration acceptance. Withdraw any missing-capability judgment if a current authoritative implementation demonstrates the stated contract and recovery properties. Withdraw the proposed minimal-slice recommendation if the owner-agreed mapping cannot preserve native authorization, cancellation or deduplication semantics. Keep unsupported runtime/environment claims unknown until tested.

Decision history: [owner notes](pida-owner-decisions-20261107.tsv). Next action: Schumpeter/Pida agree the identity, authority, receipt phase and persistence boundary; Persona and PIX owners validate their respective dispatch/trace implications; then implement and test that bounded Pida slice in its own change.

Readiness verdict: **ISSUES**. The isolated owner checkout and source baseline are ready; shared durable collaboration contracts and environment acceptance remain unresolved. This verdict is limited to this intake and does not declare the current Pida product failed or the four-app system accepted.
