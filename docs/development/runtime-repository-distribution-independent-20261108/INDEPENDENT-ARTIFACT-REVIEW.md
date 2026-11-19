# Independent repository runtime artifact review — 2026-11-08

Reviewer `/root/pida_windows_review`. Immutable runtime source
`e9a1d31140bcff34e3c9ef0f82f4b3dbca0ddd68`; external probe/evidence freeze
`083a1c11f574879697c54bb7b7a4d82921728ea6`. The accepted repository runtime
source b525 and separate sidecar2 source review are retained; generator review
SHA is `5799c15d99a62835a627541398594dd5712716dfbd2e15373b89581220b8407a`.
This unit independently tests actual extracted packages in fresh synthetic
projects. No user repository, held case, old runtime/cache, account, GUI or real
provider was used or changed, and no package was promoted.

## Immutable delivery identity

| Platform | Archive SHA-256 | Manifest SHA-256 | Files |
| --- | --- | --- | --- |
| Windows x64 | `ed17b770612ae05df9e732e32bc63736aa3eb6fb0af8ec6384ab3f7412422f58` | `f1b9156e6bee986a88666da451b352e006e18c83639408aa8a062b15f62f8ed1` | 16150 |
| Linux x64 | `581c5a8dd82bfaf2bbe9009bd13f92a92787ace4e69b8cc74bad2bcebe3c314f` | `8b19e5a55fb5f7d5c7b765907f72454b8c12f51a80505e841632f368fecb3b83` | 15824 |

Both sidecars: `8f4bd65fe7a74ac6944059bc97158b13f98fd473b95240352cd2e0ff49d8e579`.
Shared npm archive: `e4e5e2688b39f84b5b0b545c211f292c92239aed752628e64e785226dc3a5777`.
Regenerated exact Git source archive:
`cd7db2dcf3f2af0a63942ba1a043eedb559d7c75faef5b54832038fcdd5cb629`.
All hashes were independently recalculated. `metadata.json` includes delivery
paths, sizes, generator/builder/lock identities and every compiled delta.

## Independent closure checks

Ordinary extraction into `D:/prpd-1108/runtime` and
`/var/tmp/pida-repository-dist-review-20261108/runtime` passed full pinned
tree/byte/mode verification before and after all probes. The corrected verifier
also checked sidecar2's closed shape, source provenance, required regular
inventory entries and both repository goldens. A separate Linux comparison
found zero byte/mode differences or extra files.

All154 compiled files and474 other own-package files (628 total) match the exact
source and independent build from the source review. Nine compiled files differ
from accepted0f: agent-supervisor JS/declaration, index JS/declaration, new
repository-profile JS/declaration, workspace JS/declaration and chatgpt-auth.d.ts.
The last is inferred property order only; its TypeScript source and executable
JS are unchanged. It is explicitly included in the recorded delta. No runtime
source/examples change occurred after the accepted b525 implementation.

Complete vendor entries remain byte/mode-identical to accepted0f:
15521 Windows /15195 Linux files, all125 dependency records, Node identity,
dependency lock and license inventory. Previous official Node/Git/library
provenance applies by exact identity. Notices are present/nonempty
(Windows165/Linux124). Checked build/npm/cache locations and known credential
filenames are absent; this is a bounded inventory check, not comprehensive
secret scanning. The observation module loads, and its wrapper hash remains
`f71d8f4f678fc052403de02dfe05981240d893af2624f51ae48f3cdb2e61d72c`.

## Independent actual package execution

**Repository cases:12/12 pass, zero skipped, on each OS.** The inspected frozen
test source is `2c2ed4ede085da958ecac5bf8bcb361490c7f0ddcd15ef181989d026e8817ed7`.
The external harness maps imports to public packaged ESM exports and modules,
then launches bundled Node with isolated HOME, bundled Git first in PATH, and
global/system Git configuration disabled. No package file is modified.

The reviewer additionally replaced the fixture's synthetic runtime source/hash
placeholders with the actual verified artifact source and manifest pin. This
strengthens fixture identity without changing product code or test assertions.
Original harness, reviewer harness and per-platform adapted test hashes are
recorded in metadata. Windows/Linux result and raw logs are under
`windows-repository/` and `linux-repository/`.

The executed cases establish:

- Actual stock mode3 fresh startup, twelve-key ready response, capabilities3
  readback and workspace schema3. Queued native job/attempt identity and deadline
  survive resume. Missing/changed bindings, approval receipt, entrypoint, root
  inode or privilege configuration refuse resume with unchanged workspace file
  bytes. Repository mode requires explicit work policy before initialization;
  existing non-repository mode2 startup remains separate.
- Closed fixed-Node profile/projection, source-binding checks, root/approval/
  protected-path rules, unsafe alias and hardlink refusal, and no creation of
  a managed workspace for invalid program manifests.
- In an explicitly scripted SDK embedding: actual baseline fixed program
  failure remains failed; a distinct repair goal edits the synthetic project,
  checks it and reads exact final bytes/revision. Same-run write-effect checker
  replay remains blocked. Root project files are real temporary files, not
  manufactured response-only artifacts.
- Fixed runner rejects model arguments and changed entrypoint; child processes
  do not inherit synthetic host/API/provider secrets. Cancellation stays
  conservative, native cancellation does not replay a job, and two native
  agents serialize the shared-project run lease within this one host.
- Project read/write/edit retain traversal/protected/link checks. Synthetic
  token estimates still trigger the existing managed token ceiling in the
  dedicated unmodified-estimator case.

**Retained stock configurations:4/4 pass on each OS.** Default smoke, explicit
work, work global reference, and work two-profile catalogue run on the same
new packages. Actual mode2 ready/capability/policy tuples match sidecar defaults;
native jobs finish with terminal events, retain IDs/source selections on resume
and rotate transport tokens. Nonempty current-provider reference receipts bind
the expected persona, job, attempt, organization and agent. Wrong policy or
catalogue resume is denied with all workspace file bytes unchanged. Results are
`windows-retained.json` and `linux-retained.json`.

Reference export preparation independently verifies the nine source-locked
f6 producer files, copies no store, and initializes fresh synthetic config/stores
per scenario. Python is explicitly external (Windows3.11.9 / Linux3.14.4, `-I -B`).
No canonical memory or parent frozen Python service was involved.

## Evidence boundaries

The twelve repository cases are independent executions of the inspected author
scenarios, not twelve newly invented tests. Actual stock mode3 startup/resume
and scripted SDK task execution are distinct evidence. The latter deliberately
supplies simulated usage counters to isolate tool-flow behavior; it proves no
real model capacity, task adequacy, token cost or billing fact. The unchanged
token-budget counterexample is retained, not weakened.

The mode3 repository tests use local Persona; retained reference/catalogue tests
exercise non-repository mode2. Their combined mode3-plus-catalogue operation was
not independently exercised here. Workspace refusal snapshots cover file bytes,
not directory metadata or arbitrary concurrent filesystem transactions. Native
empty criteria do not establish independent task/artifact acceptance.

The approved fixed Node program is **not sandboxed**. Project-tool boundaries
and a fixed approved entrypoint do not restrict all possible Node program
effects. Single-writer evidence is scoped to one managed host, not external
writers or multiple hosts. Parent trusted root/program approval and actual
consumer binding remain essential separate gates; synthetic fixture approvals
are not user approval of a real repository.

Environment remains Windows10.0.26200 and WSL Ubuntu26.04.1 x64/glibc2.43,
standalone Node24.18.0/ABI137 and unchanged Git closures. Short Windows roots,
selected Git GLIBC_2.38 symbols/system shell/libc requirements and previous
platform exclusions remain. No new native GUI/clipboard, Electron ABI, remote
Git, musl/ARM64, broad OS, public redistribution or live-model acceptance is made.
Synthetic local transport authentication was used; no external account/auth or
provider request occurred.

Withdraw this result on source/archive/sidecar/generator drift, unexpected
executable/vendor changes, missing required inventory/golden entries, actual
ready/capability/profile mismatch, lost native identity, failed containment or
refusal preservation, unclassified effects/replay, or dependency on developer/
global runtime tooling. Validity is limited to the exact pins and tested scope.
Existing0f/D artifacts remain an unchanged deployment alternative; parent GUI,
trusted integration and actual user-project execution are not approved by this
review alone.

**Conclusion: bounded PASS for the exact e9a1d311 Windows/Linux repository
runtime artifacts, twelve packaged repository cases and four retained stock
configurations per OS; parent/GUI/live-model acceptance remains separate.**
