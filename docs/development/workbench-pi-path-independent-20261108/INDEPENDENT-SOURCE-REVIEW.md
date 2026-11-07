# Independent Windows Pi workbench path review — 2026-11-08

Reviewer `/root/pida_windows_review`; product source read only. Exact source
`b7f7d523c6fede56d508575a6bb78afa343e5566`; baseline
`2b787fd4c234747da22726ec03a3e4c6619ae95f`. All tests created fresh private
directories and synthetic content. No seed, live case, account, provider/model,
UI, stable cache, or held runtime/workspace was used or changed.

## Independently observed defect and correction

**P2, corrected in source:** on the exact accepted Windows2b package,
`workspace_write` with `artifacts/deep folder/review.json` fails `INVALID_PATH`
and reports `not_applied`, with no changed artifact. Direct
`PidaWorkbench.write/read` of that same nested path succeeds. Pi nested read
also fails `INVALID_PATH`; nested edit reports its wrapped INVALID_PATH error
and existing conservative `unknown` effect classification. Flat Pi write/read/
edit work. The same nested operations work on the baseline Linux package.
This was independently reproduced, rather than inferred from the live case.

`src/workbench.ts:329` already validates an absolute Pi path by converting its
relative path to forward slashes and passing it through `safePath`. The former
read/access/write callbacks then called `relative` again, introducing Windows
backslashes rejected by the logical path validator. At `src/workbench.ts:332`,
the new `guardedRelative` first invokes that unchanged guard and only then
normalizes the validated relative path. Callbacks at333–337 use it consistently.
The raw argument validator, containment/link checks, mkdir guard, quotas,
authorization, snapshots, Git mutation, and direct API remain unchanged.

The only runtime source delta is `src/workbench.ts` (6 insertions/3 deletions).
Source SHA-256 is
`d9c1fdb13ab71b74d1d593e3aca57f64724a97a6b6c96ee9486bc1502a5778b9`.
An independent clean checkout/build succeeded. Only `dist/workbench.js` differs
from the prior150-file compiled runtime; its SHA-256 is
`043a0eeb21907103d07e70907653e59544f162ffcc68c68495b96c0f118b99a9`.
Linux tested those exact compiled bytes in a new review-only module assembly
with the accepted production dependency closure. This is not a new distribution.

## Independent scenarios

`probe.mjs` is an independent direct public Workbench/Pi-tool probe, SHA-256
`06e50d1df800a5b96bd648b35d81519c375aae9300c23edd59d99b0a25bac3b6`.
It ran separately against packaged baseline and fixed source on both platforms:
**four fresh runs,61 tool invocations per run**. Counts are tool invocations,
not61 independent test cases. Raw results are `windows-baseline.json`,
`linux-baseline.json`, `windows-fixed.json`, `linux-fixed.json`.

| Check | Windows baseline | Windows fixed | Linux baseline/fixed |
| --- | --- | --- | --- |
| Pi nested write/read/edit | Reproduced failure | Succeeds | Succeeds |
| Flat Pi write/read/edit | Succeeds | Succeeds | Succeeds |
| Direct nested read/write | Succeeds | Succeeds | Succeeds |
| Path and link negatives | Denied | Denied | Denied |
| Reopen retains exact content | Confirmed | Confirmed | Confirmed |

The probe additionally checks:

- Multi-level paths with spaces, hyphens and underscores. Successful writes and
  edits report applied/completed, exact content and byte length. Tool evidence
  paths use forward slashes; SHA-256 and artifact ID are independently computed
  from the path/content. Fixed Windows/Linux artifact identities are identical.
  Reads produce no changed artifact. Direct APIs and reopened state agree.
- Sixteen invalid path forms across read/write/edit (**48 calls per run**):
  traversal, dot components, POSIX absolute, Windows absolute/drive-relative,
  UNC, backslashes, repeated separators, hidden components, NUL and empty path.
  All remain `INVALID_PATH`/not_applied with no changed artifacts and unchanged
  complete workbench status/history after the denial series.
- Directory symlink on Linux / junction on Windows, hardlink, and dangling
  directory link. Attempts remain `UNSAFE_FILE`; outside sentinel bytes remain
  unchanged and no dangling destination is created. These are actual link
  operations, not mocks. Windows file-symlink privilege was not needed.
- Missing write permission is denied; a separate principal has an empty file
  set. No fixture state or authorization is shared across the four runs.

The callbacks `effectResult`, `classifyResult` and `evidence` are checked
directly. This review does not claim a new model run or independently retested
runtime effect-ledger crash recovery. The author's separately recorded actual
local Pi flow and29 Windows targeted cases /11 Linux cases remain author
evidence. Its Windows existing-suite file-symlink EPERM is recorded as a fixture
setup failure also present on baseline, not a passed test or a waived product
gate. This review's own junction/hardlink/dangling-link cases all ran.

The accepted baseline package trees remain unchanged, confirmed after the
probes by their full pinned verifiers (`windows-held-package-unchanged.json`,
`linux-held-package-unchanged.json`). `metadata.json` pins revisions, source,
compiled/probe hashes and exact fresh directories. No held real C state or
request count was inspected or rewritten.

## Scope, falsification and remaining work

Evidence applies to the exact source above on Windows10.0.26200 and WSL Linux
x64, using standalone Node24.18.0 and the previously pinned Git closures.
It does not establish arbitrary-depth Windows paths, new OS support, race-free
filesystem behavior beyond existing guards, a rebuilt distribution, managed
desktop capture, or success of a new real-provider case. New packaging and
consumer acceptance remain separate gates; existing deployments are unchanged.

Withdraw the result if raw backslash/absolute/traversal arguments become
accepted, links redirect writes, a fixed nested read/write/edit fails, artifact
identity differs from actual bytes/path, invalid requests change owned state,
or the source/compiled hashes differ. Its validity ends at such changes or a
contradicting reproduction; leaving deployment unchanged is still available.

**Conclusion: bounded PASS for source b7f7d523's Windows nested Pi-path fix,
with containment/link defenses and Linux behavior preserved in the independent
scenarios; new distribution acceptance remains pending.**
