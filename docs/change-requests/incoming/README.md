# Incoming request snapshots

These Markdown files are byte-preserved source requests and responses, not locally rewritten documents. Relative links inside them refer to their **source repository's** directory layout and may not resolve in this copied directory. Pida's responses are maintained separately under `../responses/`.

- Schumpeter original: https://github.com/Chanta-Research-Group/Schumpeter/blob/01d616d0dc32961dc0fc9ab76ca25e08d0f66fc0/docs/change_requests/CR-PIDA-20261103-01.md
- Persona original: `docs/vera-continuity-v0.2/change-requests/CR-PIDA-001.md` in the source-hash-pinned local continuity worktree based on `7378040533b0333c3a24b01fbe8614c1de7b52f1`. The request was not committed in that observed snapshot; no remote URL is invented.

`source-digests.json` records exact request bytes. Executable consumer pins are in `fixtures/cr-integration/consumer-lock.json` at the Pida repository root.
# 0.8.6 additions

`PIX-RESPONSE-CR-PIDA-PIX-2026-11-03.md` preserves the owner response from
PIX PR14 `a0831bc0b34fd7feebfba928066b90b114ae531e`; relative links refer to
that repository. `PERSONA-SITE-RESPONSE-CR-PERSONA-20261103-01.md` preserves
the Site's response from `c506e321c685573481648ecf120e8f2d1214bb83`; relative
paths refer to the Site checkout. These originals remain unchanged; Pida's
dispositions live in the sibling `responses` directory.

The late `SCHUMPETER-RESPONSE-CR-PIDA-SCHUMPETER-2026-11-03-01.md` is preserved
from Schumpeter `fa6535763141ef686baac3d4dd91ab2be7450ae7`, source path
`docs/change_requests/responses/PIDA-CR-PIDA-SCHUMPETER-2026-11-03-01.md`.
Its actual current consumer is separately pinned and exercised in
`fixtures/pix-profiles/` at the Pida repository root. Earlier locks and results
remain historical evidence.
