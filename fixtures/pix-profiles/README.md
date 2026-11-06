# Pida 0.8.6 — actual PIX profiles and current Hub consumer

All facts and model decisions in these captures are synthetic. PIX, the Pida
runtime, Pi tool loop and Schumpeter consumer are real source-verified local
implementations. No private Persona content or live account inference is used.

- `evidence/report.json`: 28 actual native profile/service/workspace assertions,
  executed Pida hashes and seven raw artifact digests.
- `evidence/open.json`, `early-close.json`, `continued.json`: exact requests,
  native result/checkpoint JSON strings and hashes. Do not parse/reserialize the
  embedded native JSON to regenerate a checkpoint.
- `evidence/objects.json`: terminal selected-object alignment with shared
  verification and explicit scope exclusions.
- `evidence/negative-results.json`, `host-results.json`: limits, unsupported
  ordering/model/cut, guarded continuation, new generations and source access.
- `evidence/workspace-run.json`: actual Pi → Pida tool → PIX run, with scripted
  model decisions and UNKNOWN independent verification.
- `evidence/schumpeter-current.json`: 39 actual explicit-profile consumer checks,
  nine bundles / 136 events, duplicate delivery and exact metadata preservation.
  It binds the current workspace capture and current producer fixture by digest;
  the seven other Persona captures remain the historical 0.8.5 originals.
- `schumpeter-source-lock.json`: exact 15-file consumer source pin, separate from
  the older historical blocked probe.
- `index.json`: raw artifact catalog; copying does not change event IDs or bytes.

The existing PIX batch commit pin remains unchanged. New profiles explicitly pin
`a0831bc0b34fd7feebfba928066b90b114ae531e`; both observed revisions contain the
same verified 240 Python source files. Source fixture provenance is in
`test/fixtures/pix-profiles/source.json`. Persona Site contract-only provenance
is in `test/fixtures/vera-site/source.json`; it is exercised by the automated
suite, not this PIX report.

See [validation](../../docs/CR-FOLLOWUP-VALIDATION.md) for exact commands and
remaining gates, and [usage](../../docs/PIX-PROFILES.md) for trusted host setup.
Independent task acceptance, remote Persona authorization/CAS append, live LLM,
Windows and federation remain unverified or outside this slice as documented.
