# Cross-App ChangeRequest — PIX current-cut and partial-order capability selection

This is a request for the PIX owner. It does not authorize Pida to change PIX core, public APIs, tests, lockfiles, deployment or data. The existing batch consumer works; this request concerns selecting and verifying the next supported profiles.

## Request identity

- **request_id:** `CR-PIDA-PIX-2026-11-03`
- **Created:** 2026-11-03, Asia/Seoul.
- **requester_app / owner:** pida-core / Pida runtime and consumer adapter maintainers.
- **owner_app / owner:** PIX / public computation-contract maintainers.
- **Related requirements:** `INT-PD-07`, `INT-PD-08`, `INT-PD-09`, `INT-PD-10`, `INT-PD-14`; integrated report sections 04, 16, 25–29.
- **Purpose and authority:** select a reproducible public calculation profile for a nonterminal current cut and for explicitly partially ordered/shared events. PIX owns generic model/operator/metric semantics. Pida owns authorization, scope, event mapping, budgets, cut revisions and decisions derived from the results. Pida must not turn an offline terminal model into an online model merely by changing its label.

## Current confirmed state

| Item | Observed state |
| --- | --- |
| Consumer repo | `riesling-29/pida` |
| Consumer starting baseline | Remote PR #1 head `e08edcfc98b0ca7e3450714865eaae294b1c1c3f`, package 0.8.3; equivalent local delivery commit `0b454cbf087881967e748127b7c699fe8d7c700e` |
| Current consumer work | Version 0.8.4 patch under integration review; commit not yet assigned at this request's creation |
| Consumer worker identity | `scripts/pix-worker.py`, SHA-256 `f04be8198c42965eb2eb73490e3e99e873eca963bf2abca6fef34fcbf480ea7b` |
| Producer repo / inspected head | `Chanta-Research-Group/PIX`, PR #13 head `3205d832d5dcdc6901f916b35496a0c60b657e7a`, still current when checked 2026-11-03 |
| Producer implementation reference | `70df30ac38a11ba40536447f33d0fb1a93669418`; the later head records its readiness evidence |
| Actual engine used | Unmodified source, package `0.5.0`, 240 Python files; source digest `b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510` |
| Environment | Linux, Python 3.12.14; isolated `-I -B` process with explicit source selection |
| Consumer contract | `pida.pix.worker.v1`; this is a Pida-owned JSON worker protocol, not a new PIX API |
| Verified capability | Completed case-local source sequence → exact variants and DFG discovery → frozen accepting graph → separate case DFG alignment |
| Native result contract | `pix.analysis-result` 1.3.0, operator versions 1.0.0, public native serialization and lineage retained |

Evidence levels are separate:

1. **Code inspected:** `CaseLog`, `case_traces`, `catalog_trace_variants`, `discover_dfg`, `DFGAlignmentModel`, `align_dfg`, `result_document` and their contracts/tests.
2. **Actually executed:** the calls above on synthetic consumer inputs, including partial and unavailable cases; 18 acceptance assertions passed. Source materialization was checked against 242 Git blobs, including all 240 Python files. This is real PIX computation from source, not an installed-wheel claim or a scripted PIX result.
3. **Observed as candidate assets, not integrated here:** `pix.case_centric.online_alignment` exposes `OnlineAlignmentSpec`, `build_online_alignment_proxy`, `OnlineAlignmentStream` and checkpoint/snapshot types; `pix.compute.object_conformance` and its contracts expose joint object-event scope and partial-order alignment. Their existence does **not** yet establish compatibility with Pida's selected DFG model or a particular current-cut policy.
4. **NOT_RUN:** current-cut/online profile, partial-order consumer, actual PersonaSubstrate provider, live LLM behavior, Windows and long-term outcome improvement.

We do not assert that PIX lacks current-cut or partial-order functionality. The request is to select the appropriate existing capability and confirm its exact supported semantics; an engine change is requested only if a reproducible gap remains after that selection.

## Minimal reproduction and expected semantics

The inputs contain no private data. The complete requests, native outputs and byte digests are in `test/fixtures/pix/`; see its `evidence.json` and `docs/PIX-CAPABILITIES.md`.

Actual reproduction:

```sh
python -B scripts/pix-worker-check.py --source /absolute/path/to/pinned-pix
```

| Actual batch case | Observed public computation/output | Meaning retained |
| --- | --- | --- |
| 12 ordinary successes, 6 reproduce-first successes, 2 failures | `catalog_trace_variants`: frequencies `[12, 6, 2]`, cumulative case counts `[12, 18, 20]` | Denominator is 20; failures remain included. Native top-variant percentage is not case coverage. |
| Separate `request → edit → test → deliver` | Frozen DFG `align_dfg`: `optimal`, cost 0 | Accepted by that fixed graph; no business-success assertion. |
| Separate `request → reproduce → edit → test → review → deliver` | `optimal`, cost 1 | Added review differs empirically; the worker does not call it a policy violation. |
| Same evaluation with `maxStates: 1` | `partial`, `search_limit`, cost `null` | Unknown optimum remains unknown. |
| Discovery with `maxEventPairs: 1` | `partial`; no frozen `model` published | A lower-bound graph is not silently promoted into a complete reference model. |

Example result artifact SHA-256 values:

- Reflection: `0753459fda20a98deb9b86df7d5d35ccc7ac1bf3f2b4111f6a38522432e33c99`.
- Held-out extra-review deviation: `c1358b4eae97e5212304db2ead37cf839eb459b6564ec8fdbf497dc4b9aaded5`.
- Limited alignment: `554d24f04a8233952b5e13454a0438b76ca8a82aa6605be5fa19e968f0033f3d`.

These are exact consumer artifact bytes, not claims about the truth of work performed by a model. Native parent IDs resolve to supplied native trace results.

### Requested capability comparison

Please identify an existing public operator/profile for each applicable case and provide the exact model language, input type, ordering and termination policy, supported metrics, checkpoint revision behavior, budgets and result limitations. An explicit unsupported answer is preferable to treating different operators as interchangeable.

| Comparison | Input requiring a decision | Required distinction |
| --- | --- | --- |
| Completed trace vs current prefix | Fixed model `request → edit → test → deliver`; current cut only contains `request → edit`, task still running | A future test/delivery may be pending. Offline completion insertions must not automatically become current violations. Specify prefix/terminal modes and their results. |
| DFG vs Petri-net/path proxy | Current Pida artifact is `DFGAlignmentModel`; online candidates use their own model/proxy contracts | State whether conversion preserves the required language and completion semantics. Do not infer Petri-net concurrency from DFG edges. |
| Ordered trace vs partial order | Start precedes independent reads A and B; both precede verification; no observed A/B order | Preserve incomparability or explicitly reject it. Timestamp ties, IDs or arrival order must not invent causal order. |
| Shared event and object scope | One verification event refers to two exact artifact revisions; an agent also participates in unrelated tasks | Preserve event identity and selected participation. Do not duplicate shared evidence as independent cases or merge all tasks through the same agent. |
| Append vs correction/new generation | New source event extends cut C; a correction supersedes an earlier event; a source restart creates a new generation | Declare which checkpoint transitions are supported, which require recomputation, and how native identities bind to the selected cut. |
| Empirical vs aspirational vs mandatory | An extra review differs from the empirical graph but is permitted or required by another policy | Report model-relative results. Business interpretation, activation authority and execution grants stay with the consumer/policy owner. |
| Same inputs, different operators | DFG alignment, available online prefix profile and selected object-conformance profile | Compare only metrics with defined compatible meaning. Do not rename raw edit cost as normalized fitness or treat incomparable scores as a ranking. |

### Acceptance cases to agree

- **Normal:** fixed model and explicit completed input reproduce the existing batch results; a supported prefix evolves predictably when its next event arrives.
- **Failure/limits:** search, state, input or time limits preserve `partial`/unknown and exact admitted coverage. Missing source events and unknown timestamps remain explicit.
- **Permissions:** engine inputs contain only host-authorized scope. Engine metrics create no grants; another persona/task is excluded by Pida before invocation. No provider token is required for this local computation.
- **Concurrency:** partial-order inputs retain incomparability; repeated delivery of an identical cut/result is distinguishable from a conflicting payload. CAS and adoption are Pida/Persona responsibilities, not assumed engine transactions.
- **Compatibility:** source pin, public operator/spec and model revision are recorded. Unsupported conversion, checkpoint version, current-cut mode or metric returns an explicit limitation rather than a replacement interpretation.
- **Staleness:** a changed cut/model/policy/artifact invalidates the old applicability claim in Pida; it does not alter the historical native result. The engine must document which input identities its own result/checkpoint covers.

Only the batch cases and worker boundaries listed above have been executed in this request. The requested comparison is not a claim that the future profiles already pass.

## Change impact and continued progress

- **Compatibility:** the current Pida batch worker remains `pida.pix.worker.v1`. PIX API changes are not a prerequisite. If an existing public capability fits, add a separately versioned Pida profile/adapter without changing the producer. Any necessary generic PIX API extension belongs to the PIX owner and needs a normal/error fixture and compatibility statement.
- **Migration:** no production migration requested. Pida's existing immutable empirical models remain valid for their original batch profile. A new online/object model gets a new identity and explicit conversion lineage; it does not overwrite older models.
- **Fallback and loss:** completed per-run sequential batch analysis remains available; no online/current-cut or object-concurrency claim is made. PIX unconfigured/unavailable does not block ordinary agent execution. Scope or unsupported ordering cannot be repaired by fabricated sorting or invented events.
- **Blocked path:** truthful live-current-cut feedback using the selected model, and analysis of shared/partially ordered events, remain pending the capability decision and Pida-side integration tests. No unrelated execution, batch Reflection/Awareness, Persona contract work or local organization work is blocked.
- **Continuing Pida work:** scoped snapshot mapping, immutable results, cohort separation, bounded invocation, model/context provenance, authority enforcement, adoption/staleness tracking and the existing recovery boundary.
- **Requested owner artifacts:** a public API/profile matrix for the cases above; exact executable examples with normal/partial/unsupported outcomes; source/build pin; native result/checkpoint fixtures; and any necessary generic change proposal supported by a counterexample. Please recommend reuse before new API development.

### Deployment notes for the consumer

The Pida process adapter passes only `SystemRoot`, `windir`, `TEMP`, `TMP`, `TMPDIR`, `LANG` and `LC_ALL` from the environment when present; it selects the interpreter and worker by absolute path and does not require or forward LLM/API credentials or `PYTHONPATH`. It preserves only the runtime environment needed by the selected local interpreter. This is not an OS filesystem/network sandbox, and Windows process-tree containment has not been proven by the Linux check.

Windows source delivery must preserve the exact pinned bytes. In this source, three Python files contain original CRLF and others use LF; blanket newline conversion, including Git `core.autocrlf` conversion, changes the digest. Prefer a byte-preserving archive/export of the exact source pin. Do not weaken the digest check or rewrite the source to make a different build appear identical. Run the consumer acceptance command using the installed Windows Python and record that platform's result separately. An unverified Windows run stays NOT_RUN.

## Owner response — to be completed separately

- **Status:** pending; choose `accepted / needs-evidence / alternative / rejected`.
- **Decision rationale and responsibility boundary:** not yet supplied.
- **Producer contract revision / selected capability / fixture / validation:** not yet supplied.
- **Consumer recheck scope:** after the owner response, implement only the selected Pida adapter/profile and rerun the agreed cases against the exact producer build; retain independent batch regression evidence.

Until the owner responds, requested future profiles are proposals. This file records a request inside Pida; it does not post to the PIX repository, alter its implementation or imply actual cross-app integration.
