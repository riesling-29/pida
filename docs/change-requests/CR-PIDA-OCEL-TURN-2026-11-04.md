# CR-PIDA-OCEL-TURN-2026-11-04

Producer: Pida 0.8.10. Target: Schumpeter observation/export consumer.
Status: producer implemented and locally tested; consumer integration NOT_RUN.
No external repository was changed.

## Requested additive acceptance

1. Accept producer validator revision `pida.export-validation/0.4` with optional
   `payload.turn_id` (string) and `payload.turn_index` (positive integer).
   Preserve the observed `turn_started`/`turn_finished` lifecycle and exact IDs.
   Existing observation/bundle schema IDs and source event identities remain.
2. Preserve additional observed `object_refs` for agent, task and turn; do not
   assume this array always contains exactly session and run IDs.
3. Optionally consume standard OCEL 2.0 exports from owned run/job
   `export?format=ocel`, or the `format=ocel-bundle` wrapper containing mapping,
   source digest, OCEL digest, completeness and limitations. Treat ongoing cuts
   as snapshots, not as independently append-only finished ledgers.
4. Consume `pida.pi.ocel-evidence/1` results as scoped process-verification
   evidence. Preserve the fixed policy/model digest, source run/digest, OCEL
   digest, pinned engine identity and native evidence. Do not translate
   `conforms` or OCEL structure acceptance into artifact/task VERIFIED.

## Contract material and acceptance

- `fixtures/current-producer/`: current closed producer schemas and synthetic
  Pi/stdio-MCP events, with negative cases and checksums.
- `fixtures/pix-ocel/`: genuine standard OCEL derived from a scripted Pi run,
  actual pinned PIX evidence and explicit failure/pending cases.
- `docs/PIX-OCEL-0.8.10.md`: mapping, storage and verification boundaries.

Consumer test should import these without dropping turn identities or qualified
relationships, preserve unknown/incomplete state, reject invalid references,
and retain artifact-version/result-digest linkage. Missing legacy turn IDs must
remain unobserved. Please return the accepted contract revision and integration
result; no new PIX producer API is required for this slice.
