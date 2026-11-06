# CR follow-up — 0.8.6

2026-11-03 KST. Starting Pida: local `7653da2`, remote draft PR1 `a11e414`,
package 0.8.5; clean worktree. Scope: Pida only.

## Evidence and selected work

- PIX PR14 `a0831bc0b34fd7feebfba928066b90b114ae531e` supplies an alternative
  response to `CR-PIDA-PIX-2026-11-03`. Its 240 Python files retain the existing
  engine digest. Keep the old batch commit allowlist unchanged. Adopt two
  separately versioned consumer profiles, with their own explicit build pin.
- Persona Site `c506e321c685573481648ecf120e8f2d1214bb83` responds to
  `CR-PERSONA-20261103-01`. It supplies a bounded candidate-authority formatter;
  public remote authentication/binding and context-revision CAS append remain
  unavailable. Check the new synthetic descriptor against current Pida; preserve
  the already implemented Python-provider adapter and unsupported append state.
- Schumpeter PR6 remains `01d616d0dc32961dc0fc9ab76ca25e08d0f66fc0`. The current
  producer import blocker is unchanged; do not rerun the same blocked test or
  change another app to force acceptance.

Late source recheck during this slice found the new Schumpeter owner commit
`fa6535763141ef686baac3d4dd91ab2be7450ae7`. This is new evidence after the starting
plan above. The follow-up therefore also pins its actual source and runs the
explicit `pida-native/export-validation-0.3` consumer against current Pida bytes.
The older default profile and historical failed probe remain unchanged.

## Patch sequence

1. Reuse the bounded Python process transport and native PIX codecs. Add an
   explicit `pida.pix.profiles/1` protocol for approximate sequential Petri-net
   prefix analysis and completed whole-object-scope alignment. No DFG conversion,
   artificial object ordering, business verdict or new engine algorithm.
2. Provide a host-selected source port and scoped analysis service: fixed model,
   generation/cut/policy provenance, exact event selection, fresh access checks,
   immutable evidence, checkpoint continuation only for unchanged input prefixes.
   Source ledger/CAS stays with the host's existing authoritative source; this
   read-only consumer never advances that source or adopts a model automatically.
3. Connect the service to SDK/workspace tools. The trusted host selects sources
   and models; model tools select references only. Ordinary agents and existing
   batch Reflection/Awareness remain independently usable.
4. Execute the real pinned PIX source through the Pida adapter. Cover open vs
   closed prefixes, resumed future, corrections/build/model changes, shared
   verification, ambiguous order, limits, denied scope and stale results. Keep
   scripted transport/service tests separate from actual engine execution.
5. Preserve incoming owner responses and source hashes; update the intake index,
   response, evidence and version-specific commit/draft PR. Report plan,
   implementation, tests and actual integration separately. No merge/deployment.

## Boundaries

The online result remains `partial`, even at zero cost. A future required step
is pending until an explicit source close. The object operator is terminal and
is unavailable for a nonterminal cut. Independent objects retain partial order;
same-object time ties are rejected. Native bytes and semantics remain PIX-owned.
Model kind is provenance, not a grant. Host publication and external source CAS
are not exposed as agent tools. This patch does not claim live-LLM efficacy,
remote Persona integration, canonical memory writes or Schumpeter task acceptance.

The five planned steps and the late current-consumer check are complete for this
slice. See [validation](CR-FOLLOWUP-VALIDATION.md) for the distinct implementation,
test and actual-integration gates and the remaining owner work.
