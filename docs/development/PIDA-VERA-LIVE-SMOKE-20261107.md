# One configured-model Persona smoke

One authorized live request completed on 2026-11-07. This is separate from scripted Pi tests and does not establish desktop, two-organization, semantic persona quality or self-improvement acceptance.

## Exact observed run

- Configured provider/model/auth: `openai` / `gpt-6-astra` / existing ChatGPT credential-store mechanism. Local bundled catalog supports the selection. The existing user's runtime/session was not opened or replayed; only provider configuration and the supported credential store were used. Credential values were never printed or copied into evidence. Normal supported OAuth refresh, if needed, remains owned by that credential store.
- Consumer reviewed at `039d8ef3f153e1d8499566223fad876c8f2105b8`; producer source `c1e3617aa88e6013ea34f76c3f4c41504618f863`, digest `7dd9aa5ea22afaab033b62d54864d6849ac038e414ea7cc93fd341828cd731cb`. The run records exact relevant source/harness hashes. Supervisor lineage edits happened only after this call finished and were not used by the smoke.
- Fresh temporary synthetic workspace and synthetic public Persona fixture. No private memories or previous chat transcript were provided.
- Start `2026-11-07T12:10:22.267Z`; finish `2026-11-07T12:10:26.466Z`, approximately 4.2 seconds for this one run, not a performance estimate.
- Result `completed`, no error code, 15 streamed characters; output matched requested marker `PIDA_PERSONA_OK`. Exactly one actual configured-provider request/response event, one successful public authorization and one `context_input_included` receipt. Exported observation bundle validated.

[Start](vera-dispatch-live-smoke-20261107/start.json), [result](vera-dispatch-live-smoke-20261107/result.json), [actual observation bundle](vera-dispatch-live-smoke-20261107/observation-bundle.json), [one-shot harness](../../scripts/vera-dispatch-live-smoke.mjs). No retry was performed. A credential-pattern check of the exported bundle found none; the evidence is synthetic and contains no credential fields.

## Limits and interpretation

The host configured one turn, no tools, no provider/output retries, low thinking, a 20-second runtime deadline and cancellation after 128 streamed text characters. OAuth's existing payload adapter removes hard output-token limits; `maxTotalTokens:2048` is an observed-response guard. Cancellation is cooperative, not a billing guarantee. Actual billed cost is unknown (`null` in evidence).

The receipt proves exact selected context appeared at the Pi logical input boundary after current public authorization. It is not a capture of serialized provider wire bytes. A correct marker response demonstrates a bounded connection/task outcome, not that the model used or understood every Persona memory. A later desktop scenario can test a harmless value available only in selected synthetic Persona context and a dependent artifact, with a separate acceptance record.

## Independent consumer evidence

The independent reviewer reproduced build, 16 focused tests and seven public producer/scripted-Pi scenarios with no material finding for the restricted profile. [Unmodified review report](persona-independent-review-evidence-20261107/INDEPENDENT-REVIEW.md), SHA256 `a36e159c08682210ed42c388dac4fc67b816b6c1fc6452c7b026a359f3cfa50b`; its result/bundles are preserved in the same directory. That review preceded and did not independently execute this live smoke. Delivery/full-suite/desktop gates remain separate.

This result applies only to the recorded source, selected configured service and single synthetic task. Withdraw or qualify it if source hashes or recorded request/receipt correspondence fail verification; do not extend it to future credentials, provider behavior or organization workflows without new evidence.
