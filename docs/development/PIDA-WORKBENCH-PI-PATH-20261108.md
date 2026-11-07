# Windows Pi file adapter nested-path correction

The actual C A continuation used the legitimate requested path
`artifacts/organization-a-result.json`. Its `workspace_write` returned
INVALID_PATH, so the native run correctly remained failed even though its final
reported JSON contained the expected data. No file artifact or acceptance was
claimed. The [immutable actual observation](two-org-case-c-a-negative-20261108.json)
preserves root empty yield, executed child and single continuation separately
from this failed artifact boundary. No model/auth request was made to diagnose it.

An isolated replay of the frozen 2b787fd Windows package reproduced nested Pi
write failure, successful flat Pi write and successful direct nested
PidaWorkbench.write. The wrapper first guard-validates a forward-slash logical
path, then called native `relative` again in read/access/write callbacks. Windows
reintroduced backslashes that the logical validator correctly rejects. This is
an adapter conversion defect, not a model supplying an invalid requested path.

The correction adds one local `guardedRelative` helper: call the same containment
and link guard first, then normalize its relative result to forward slashes.
Only the three Pi operations use that result. `validPath`, `safePath`, mkdir,
direct workbench APIs, authorization, effect classification, snapshots, budgets
and persistence remain unchanged. There is no flat-file prompt workaround or
relaxation of traversal/absolute/drive/reparse restrictions.

Build and 29 focused Windows cases passed (six new path cases plus 23 native
yield regressions). New cases cover nested write/read/edit, exact final bytes,
flat/direct baseline, owner isolation, invalid paths across all three tools,
actual directory junction and hardlink denial, and an actual local Pi scripted
flow with final artifact hash. Linux source-overlay tests passed all six new
cases and all five existing workbench cases with the unchanged production
dependency closure. No new distribution or desktop execution is implied.

The existing Windows workbench suite remains four pass and one file-symlink
EPERM setup failure at line 92. The identical failure was reproduced against
the exact frozen 2b787fd package; it was not skipped or repaired by this change.
The new Windows junction and hardlink adversaries run without that privilege.

Test construction corrections are retained: edit takes current `edits[]`, not
legacy top-level oldText/newText; a run retains prior artifact versions so the
test must select the exact final hash; the external test import rewriter needed
double-quote support; the Linux source overlay initially omitted unchanged
examples/web assets needed by the existing HTTP demo test. Correcting these
fixtures required no extra product change. Original logs/probes and failed
fixture attempts are preserved in the
[archive](workbench-pi-path-evidence-20261108/original-evidence.zip), with source
hashes and outcomes in [validation](workbench-pi-path-evidence-20261108/validation.json).

Independent source review is pending at this author freeze. Old C package,
case files and its six requests remain unchanged; prior validation six requests
stay separate, for twelve total recorded calls before any new release. B and
all retries remain held. A new runtime package and fresh verification identity
require their own acceptance; no legacy fingerprint rewrite is proposed.

The bounded claim is withdrawn if nested paths still fail, an escape/link path
becomes readable or writable, another owner's files become visible, effect
classification changes, or actual bytes disagree with recorded artifact hashes.
Validity is limited to the pinned source and tested Windows/Linux contracts.
Leaving the prior runtime unchanged is the deployment alternative until review.
