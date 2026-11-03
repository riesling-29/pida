# Owner response: CR-PIDA-PIX-2026-11-03

- Requester: pida-core. Owner: PIX computation contracts.
- Decision: **alternative** — select existing profiles with explicit limits;
  no new engine API or source change is needed for the verified slice.
- Request inspected at [Pida bbc28a3](https://github.com/riesling-29/pida/blob/bbc28a39495b0c5d1b5f471ba11927e9ad64b46f/docs/change-requests/CR-PIDA-PIX-2026-11-03.md).
- Consumer baseline: `pida.pix.worker.v1`, batch-only worker; source pin
  `3205d832d5dcdc6901f916b35496a0c60b657e7a`, package `0.5.0`.
- PIX baseline: main `48fe7eb67388cda1144c5bba93adbfe00933ab1c`;
  unmerged Draft PR #13 `3205d832d5dcdc6901f916b35496a0c60b657e7a`.
- Work branch: `work-pix-current-cut-20261103`, based on PR #13. This response
  does not mark that PR merged or alter the Pida repository.

## Delivered decision

1. Retain completed-case DFG discovery/alignment and the existing source pin.
   Its optimal terminal cost must not become a live-prefix violation count.
2. Offer `OnlineAlignmentStream` as a **separate approximate Petri-net proxy
   profile** for justified sequential current cuts. Keep `partial`, prefix
   upper-bound scope, unresolved final cost, coverage and resource diagnostics.
   The existing DFG artifact is not its model input.
3. Offer `align_object_log` for **completed joint object scopes**, preserving
   exact artifact participation, independent selected-object order and shared
   events once. It is not an online object-cut aligner.
4. Document `measure_object_context` as a separate behavior-set metric: its
   terminal observed prefix is excluded. It must not stand in for a live
   current-cut verdict merely because its name contains "prefix".
5. Leave arbitrary-DFG exact live prefix, explicit-DAG input, same-object
   uncertain/concurrent ordering and incremental object-cut alignment outside
   the selected profiles. No generic DFG conversion or fake ordering is added.

The [API/profile matrix](../user-guide/CURRENT_CUT_PROFILES.md) specifies input,
output, ordering, termination, identity, checkpoint transitions, budgets and
metric compatibility. The [fixture](../../tests/fixtures/current_cut/README.md)
provides hand-derived expectations, exact inputs/models, native outcomes and
a serialized checkpoint that reproduces the uninterrupted future.

## Acceptance and handoff responsibilities

| Request case | PIX evidence / decision | Remaining Pida work |
| --- | --- | --- |
| Completed vs current prefix | Same chain: terminal cost 2 vs open upper bound 0; explicit close and continuation tested | Select model/profile and distinguish pending from violation in the UI/worker contract. |
| DFG vs Petri-net proxy | Wrong model type rejected; only the example's two separately specified single-word models have equal language | New immutable model/profile identity and derivation. No blanket DFG conversion certification. |
| Independent A/B reads | Selected E2O partial order retains incomparability under timestamp/ID changes | Map authorized exact observations; leave unsupported same-object ambiguity explicit. |
| Shared verification / shared actor | Verify consumes both revisions once; actor excluded; unrelated event remains visible in whole_log | Filter authorized task/events before invocation; retain mapping/exclusion evidence. |
| Append / correction / restart | Byte-identical resume; duplicate/conflict/gap/limit tests; new generation recomputes | Own source ledger, revision/CAS, adoption and staleness checks. |
| Limits / unavailable | Search and binding limits retain unknown cost; no proxy and time tie remain unavailable | Own time/byte/process budgets and absent-source coverage. |
| Empirical / aspirational / mandatory | Raw model-relative costs only; no business verdict/grant | Keep model kind, policy and authority separate. |
| Checkpoint / build compatibility | Native result/model codecs reused; changed identity/version rejected | Pin source/build and independently run new adapter profile on each target platform. |

This response is the cross-app handoff; Pida owners should add separately
versioned consumer profiles only after choosing these semantics. Existing batch
Reflection/Awareness and standalone agent execution need not wait. No PIX code
or model grants new execution authority. No Persona or Schumpeter source,
deployment, database or policy was modified.

The current Pida worker checks both its exact commit allowlist and code digest.
Keep its existing `3205d832...` pin: identical Python bytes do not authorize
passing a different commit string to that worker. A future consumer profile
must deliberately add and verify its own build pin. This patch leaves all 240
`src/pix` Python files and `pyproject.toml` unchanged.

## Completion boundaries

- Plan/profile selection: complete for the listed alternative.
- PIX implementation: executable example, consumer acceptance tests, native
  fixtures and installed-wheel validation integration.
- Tests/build identities: see [the validation report](../reports/2026-11-03_CURRENT_CUT_READINESS_REPORT.md).
- Existing Pida batch worker: rerun as an unmodified consumer against its exact
  old pin; this is distinct from the proposed new profile integration.
- Pida new online/object worker, live LLM/Persona path, deployment and outcome
  improvement: **NOT_RUN**. This owner response does not close those gates.

No generic engine defect was reproduced within the selected supported inputs.
If the consumer requires exact optimal current-cut cost for its original DFG,
or explicit same-object happens-before DAGs, send that narrowed contract with
normal/error cases, a small independent oracle and budgets. Those are different
questions from the implemented approximate/separate terminal profiles.
