# Independent immutable distribution delta review — 2026-11-08

Reviewer: `/root/pida_windows_review`. Product source was read only. Executions
used new review extraction/temp directories; no UI, account/provider request,
held workspace, stable cache or global configuration was changed. The review
does not deploy or replace an existing runtime.

## Exact identity

Application source: `2b787fd4c234747da22726ec03a3e4c6619ae95f`.
Author handoff/evidence commit: `7b061527fc42ec082c967697b0e48c971101b0ab`.
The independently reviewed diagnostic and durable native-join source behavior
is not reopened as a new full semantics review here.

| Platform | Archive SHA-256 | Manifest SHA-256 | Files |
| --- | --- | --- | --- |
| Windows x64 | `db9e1041ec932165adcbe383a38a5178cf3b58f0654db245e6783c8db2302986` | `a46e2337721394e6b8d494b6b06e721754cda01f982a2127e996da8fa80a8003` | 16011 |
| Linux x64 | `dcb721282aaca7c1c83c7ce7f3fa25e700b437df79a8f2b2cab37d75f134bd33` | `0dfb09e7abfeac166d75cb0dc33ca9c6c5b7baa6fc7fb81ff9d066a5c8ee084f` | 15685 |

`metadata.json` contains exact archive paths and rehashed source, package,
builder, lock and probe identities. Shared npm archive SHA is
`ff1ff9bb734cc1a7267b1fc8a495b6c16c318c67f21cc5b4c4c1200afdfd8ffd`.
Regenerated `git archive` of the exact source matches manifest source SHA
`aa37a564eb8c7208f6968225e5f2b6b781ddaa96192db62c2be2b989dd674465`.
The reviewed Linux mode correction and platform lock are byte-identical to the
previous accepted revision (script `1f4b14df...e336e5`, lock `bb970d86...60fba`).

## Independent execution and inspection

1. Checked out exact source in the isolated review worktree, confirmed clean
   tracked state, and ran `npm run build` successfully. All **150 compiled files**
   in each runtime byte-match this independent build. All **340 other own-package
   files** byte-match the pinned source worktree, including packaged notices,
   examples, fixtures and documents. No package file was edited for testing.
2. Extracted the pinned archives normally into `D:/pdrv-20261108/runtime` and
   `/var/tmp/pida-review-dist-20261108/runtime`. Full exact platform manifest/tree
   verification passed after all probes. A separate Python Linux mode/byte/extra
   file comparison returned zero differences. Runtime counts are16011/15685.
3. Compared complete Node/Git/npm-dependency manifest entries, then checked actual
   trees with the verifier. All **15521 Windows / 15195 Linux vendor files** are
   byte/mode-identical to the previously independently accepted artifacts. All
   125 dependency records, lock, Node identity and license inventory are unchanged.
   The prior official Node/MinGit/Ubuntu provenance therefore applies without a
   new upstream download. Previous report SHA:
   `fdf273daffac7195873913f50684ffcbe031b44449f02c130a09fb544d457823`.
4. Verified all retained license files exist/nonempty (Windows165/Linux124),
   known credential filenames are absent, and development compiler, Playwright,
   runtime npm and build cache are absent at their checked paths. The filename
   check is bounded, not a general secret-scanning certification. No provider
   credential was supplied. Both packaged observation modules loaded; wrapper
   SHA remains `f71d8f4f678fc052403de02dfe05981240d893af2624f51ae48f3cdb2e61d72c`.
5. Independently ran **23/23 native yield cases on each platform** through the
   packaged public runtime APIs and packaged faux-provider dependency. Test
   source is the exact frozen `test/organization-yield.test.mjs`, SHA
   `1eadc1d4bc752a229847ee1200154634320721a26b78089e0f77ec3773769c64`.
   The inspected author transport rewrites import locations only and launches
   bundled Node with isolated HOME, bundled Git first in PATH and disabled
   global/system Git config. It creates temporary state outside the package.
   Cases include real native delegate/join, waiting and child-first completion,
   required failure, nonempty baseline, paused-child restart with exactly one
   continuation, no replay after reopen, actual terminal OCEL and empty-text
   fidelity, absence of premature acceptance, and negative guard/proof cases.
   These are independent executions of author test scenarios, not independently
   invented scenarios. See `windows-packaged-yield.log` and
   `linux-packaged-yield.log` (23 pass, zero failures/skips each).
6. Independently ran the delivered stock host's base mock fresh/resume smoke on
   both platforms. Both completed a real native owner-created organization/job,
   exported `run_finished`, reopened the same job/attempt and rotated transport
   tokens. See `windows-base.json` and `linux-base.json`. Synthetic host/policy
   tokens were used; no provider credentials or account API was used. The policy
   denies external admissions, so this does not establish successful external
   admission authorization.

The initial reviewer audit helper passed Array.map's extra arguments to
path.resolve and failed before reading artifacts. It was corrected to a unary
callback; no product or assertion changed (`reviewer-fixture-correction.txt`).
`audit-delta.mjs` and `metadata.py` preserve the reproducible comparisons.

## Distinct evidence and remaining boundaries

The stock delivered mock wrapper remains a single-root mock. Multi-agent join
evidence above comes from an external SDK test harness using the normal public
APIs and faux dependency. No hidden production test mode or scripted wrapper
injection was introduced. This review does not turn SDK tests into managed
multi-agent GUI acceptance or validate consumer artifact/diagnostic selection.

The owner's new-build source-backed Persona fresh/resume results are recorded
in the frozen handoff; this narrow delta did **not** independently rerun the
external Python reference profile. Its helper/fixture source bytes and vendor
closure remain unchanged; previous independent reference acceptance and the
new author evidence are distinct from new independent base/SDK executions.
The parent's frozen Python bridge/desktop assembly remains a separate gate.

Unchanged environment boundary: Windows10.0.26200.9711 and WSL Ubuntu26.04.1 x64,
glibc2.43. The unchanged selected Git ELF needs GLIBC_2.38 symbols, private
pcre2/zlib, system libc/loader and `/bin/sh`. This is not acceptance on all
glibc2.38 systems. Native clipboard/GUI, Electron ABI, musl/ARM64/older Linux,
remote Git/SSH/Perl, live models/account quota/billing, and public redistribution
rights are not established. Long-path support remains the prior bounded
short app-owned Windows root. No full suite was run or waived here.

Validity is limited to the hashes, source and tested profiles above. Withdraw
this result if artifact bytes/modes/source pins differ, dependency closure or
required notices drift, clean package execution needs developer modules/global
Node/Git, terminal/native lineage is inconsistent, restart duplicates a
continuation, or a test must modify package bytes/held workspaces to pass.
Leaving deployed packages unchanged remains an available deployment choice;
this review supplies evidence for a separate consumer/desktop gate.

**Conclusion: bounded PASS for the exact new Windows/Linux distribution delta,
including source identity, unchanged vendor closure, stock base fresh/resume,
and external packaged-SDK native join/restart; no remaining finding in that
scope.**
