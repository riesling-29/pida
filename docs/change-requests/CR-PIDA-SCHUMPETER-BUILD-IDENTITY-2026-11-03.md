# ChangeRequest — imported PIX source identity

- request_id: `CR-PIDA-SCHUMPETER-2026-11-03-02`
- requester: pida-core
- owner: Schumpeter
- status: NEEDS_OWNER_REVIEW
- source: `fa6535763141ef686baac3d4dd91ab2be7450ae7`, `src/schumpeter/pix_port.py`, `_pixel_identity`

## Observed issue

The current function runs `git -C <imported-package-parent> rev-parse HEAD`.
Git searches parent directories, so an untracked verified PIX source snapshot
inside a Pida checkout reports the **Pida** HEAD as PIX's commit. During the
actual consumer probe that value was
`7653da2bc6f91506b6ff6c8fa434061156885f93`, while the independently verified
240-file PIX source digest was
`b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510`.
Package metadata was unavailable, and the raw imported-file digest remained
correct. This is an identity attribution issue, not an import rejection.

## Requested owner change

Treat an inferred Git commit as authoritative only when the imported module is
actually tracked at the expected repository-relative path and its bytes match
the recorded revision (including a dirty-state policy). Otherwise report the
commit as unknown and retain source digests/provenance. Add a regression with a
PIX snapshot nested inside an unrelated Git checkout. A neutral unpacked source
must also remain unknown rather than inventing a commit. Installed package
metadata alone must not replace the actual imported-source identity.

Pida made no Schumpeter changes. Its final file-import probe runs from a neutral
directory and independently verifies engine source bytes before import. The
consumer's returned Git/package metadata is recorded as advisory. This CR is
not a current import blocker; the successful 39-check integration remains valid
for its pinned sources. No message or external issue was submitted by creating
this record.
