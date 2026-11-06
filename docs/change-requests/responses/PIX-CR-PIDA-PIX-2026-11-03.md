# Pida response to the PIX owner's alternative

2026-11-03 KST. Request identity: **(pida-core, CR-PIDA-PIX-2026-11-03)**.
Owner response [preserved here](../incoming/PIX-RESPONSE-CR-PIDA-PIX-2026-11-03.md),
PIX PR14 `a0831bc0b34fd7feebfba928066b90b114ae531e`.

**Accepted for two explicitly separate consumer profiles in Pida 0.8.6.**
The existing batch interface and exact `3205d832...` source allowlist remain
unchanged. The new protocol deliberately pins PR14 with the unchanged engine
digest; no engine algorithm, dependency or other repository was modified.

- `sequential-prefix/1` invokes the public Petri-net proxy and stream APIs.
  Explicit source sequence and closure are required. Open completion is pending;
  all witness costs remain approximate/partial. Native checkpoints survive a
  Pida restart and preserve exact JSON bytes. Reserialization is rejected by the
  native codec instead of weakening its digest verification.
- `object-terminal/1` invokes `align_object_log` on the exact authorized completed
  snapshot with selected object types/qualifiers and `tie_policy=reject`.
  Shared events occur once; independent selected objects retain partial order.
  Actor/object/relation exclusions are retained. Nonterminal object cuts and
  same-object uncertain ordering are not silently interpreted as supported.
- The host-selected source port supplies its existing authoritative ledger/CAS,
  access, immutable revisions and models. Pida checks scope and coverage before
  compute and rechecks the entire selection afterward. The read-only API neither
  publishes source events nor advances a source head. Agent tools select owned
  references only. No automatic model adoption or memory writer was added.
- An unchanged prefix may resume its owned checkpoint. Correction in the same
  generation is rejected; a new generation, model/policy/scope/task/artifact
  identity recomputes. Native results remain immutable; source revocation denies
  derived reads and source changes label old applicability STALE.

Actual Pida process/SDK/workspace integration is exercised by
`scripts/pix-profiles-check.mjs` using real pinned PIX and Pi with synthetic
source facts/scripted model decisions. The check includes open vs early-close,
byte-identical resumed future, shared participation, bounded unknown results,
revoke, stale publication and a permission-guarded workspace tool invocation.
The unmodified batch protocol is separately regression checked.

[Usage](../../PIX-PROFILES.md) and [final validation](../../CR-FOLLOWUP-VALIDATION.md)
record exact execution evidence. This closes the selected Pida consumer-adapter
gate, not live-LLM efficacy, Windows acceptance, external source onboarding,
canonical Persona persistence, generic DFG-to-Petri-net conversion, arbitrary
DAG support or an incremental object-current-cut engine. Further engine requests
require a concrete new unsupported use case; no generic engine defect remains
open from this selected slice.
