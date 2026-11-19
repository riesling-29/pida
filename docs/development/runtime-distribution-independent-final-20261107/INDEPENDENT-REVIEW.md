# Independent pida runtime distribution review — 2026-11-07

Reviewer: `/root/pida_windows_review`. Read-only product review; all new files are
external evidence or isolated review fixtures. No product code, global Git
configuration, canonical Persona store, UI, or paid provider was changed/used.

## Identity and reviewed artifacts

Application and npm source: `bb9886ffc3a2a815e3c255b7dbfc83b4b4bac5e3`.
Original author evidence revision: `5ea098c0f06e12d0024878446ec3a2705f949934`.
Linux packaging correction: `46e22f5f3868e56ece5eaed9d0582ff7a160a800`.
The correction changes the packaging script, not the application/npm source.
The shared npm package SHA-256 is
`5e93895d6848c009d5e88a4b4119a886e26561decbb5fed303d2e953b99e650d`.

| Artifact | Accepted archive SHA-256 | Manifest SHA-256 | Files |
| --- | --- | --- | --- |
| Windows x64 | `1d96edc0160d79c06c0a5cbe94dc6feb800a3efab09bc8b08cd065ad025023d4` | `0d63aac8c755d601a4e8bff151ea3648bc4afd00393449c533d0b4600d5d9e6b` | 15975 |
| Linux x64 r2 | `937d1a762b61c96bc558b4aca3fb3647ec01823b894e62c387013adb5d01576c` | `bdb1abd8c643b6b90854ff8a8e5f7ec40e837fc3c18f6a4c8d81cef8aeacc08a` | 15649 |

Exact archive locations are in `archive-checksums.json`. Review copies are
`D:/pdrv-20261107/runtime` and
`/var/tmp/pida-review-dist-r2-20261107/runtime`. No author runtime/store was used
for the executions. Each host probe copies the review runtime again to its own
new temporary directory.

## Finding and correction

**P2, fixed:** the original Linux archive
`7a2b4236d896866c3e4f9a09387bbc3ce5da3e457ca16d3749ab1cfb59ddee0b`
recorded all 49 Git files with mode 0777. Ordinary Linux tar extraction under
the tested default umask produced 0755, causing `RUNTIME_TREE_MISMATCH` despite
matching bytes. This was independently reproduced; see
`linux-normal-extraction-diff.json`. Functional smoke success did not override
that distribution failure.

At the correction revision, `scripts/package-runtime.mjs:68` canonicalizes Git
directories and the two intended executables to 0755, data/libraries to 0644,
before inventory and archive creation. `scripts/package-runtime.mjs:108` records
builder-script and platform-lock identities. This is confined to Linux Git
staging. Independently verified correction script SHA
`1f4b14df625ddd47f59787a08beda005c1fccf4e69454a64eb7a5b4ac8e336e5`
and lock SHA `bb970d860a8c9e3255007976fa21240746dbc4d7b171e4eb6ce55c8cf9560fba`
match the committed files and corrected manifest (`review-metadata.json`).

Ordinary extraction of r2 passed the exact verifier; a separate Python file,
mode, byte and extra-file comparison found zero differences. Evidence:
`linux-r2-exact-verifier.json`, `linux-r2-independent-tree-diff.json`.
Windows exact verification also passed (`windows-exact-verifier.json`).
The old archive is historical failed evidence and must not be selected for
desktop assembly. The owner was asked to update the handoff/document pointers.

## Independently executed evidence

- Checked out exact application source in
  `D:/ChantaResearchGroup/pida-review-distribution-20261107`, installed its lock
  with lifecycle scripts disabled, and rebuilt. All 148 compiled `dist` files
  byte-match Windows; Linux has the same 148 hashes. This is an independent
  build/source comparison, not only a manifest assertion.
- Compared cached Node archives with a fresh HTTPS
  [official checksum list](https://nodejs.org/dist/v24.18.0/SHASUMS256.txt).
  Windows and Linux embedded Node executable, LICENSE and README byte-match
  their pinned official archives. Both run standalone Node 24.18.0, ABI 137.
- Matched the MinGit archive SHA against the
  [official release](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4).
  All 375 bundled files byte-match the archive with no missing/extra file.
  The relocated git.exe Authenticode status is Valid. See
  `windows-provenance.json` and `mingit-authenticode.json`.
- Downloaded the three exact official Ubuntu Git/pcre2/zlib archives separately,
  verified their pins, and privately extracted them. Selected Git ELF, both
  private libraries and all 12 retained package notice files byte-match.
  Node provenance, ELF dynamic information and actual linkage are retained in
  `linux-r2-provenance.json`. No system package was installed.
- Audited each platform's 125 production dependency package/version/hash entries
  against its shrinkwrap. All inventoried notice files exist and are nonempty
  (Windows165, Linux124). No packaged TypeScript, Playwright, npm or build cache
  was found at the checked paths. Known credential filenames `.env`, `.npmrc`,
  credentials/auth JSON and private SSH key names were absent. This is a bounded
  inventory check, not a mathematical proof that arbitrary text contains no
  secret. Source/lifecycle profile and clean execution supplied additional
  evidence against a hidden developer dependency.
- Loaded the packaged `dist/agent-tui.js` with each bundled Node and verified
  `runAgentTerminal`. The observation wrapper is present on both platforms,
  SHA `f71d8f4f678fc052403de02dfe05981240d893af2624f51ae48f3cdb2e61d72c`.
  This is packaging/module-load evidence, not a fullscreen/native GUI test.
- Independently executed the inspected author native smoke on each relocated
  platform in both base and reference profiles: `windows-base.json`,
  `windows-reference.json`, `linux-r2-base.json`, `linux-r2-reference.json`.
  Every probe completed a native mock job, exported actual `run_finished`,
  closed cleanly, resumed the same organization/job/attempt without duplication,
  and rotated its transport token. Host processes used explicit packaged Node,
  bundled Git first in a fresh minimal PATH, isolated HOME and disabled global/
  system Git config. The policy rejects external admissions; the exercised
  creation is the explicit owner native organization API. External admission
  authorization success is not established by this smoke.
- For reference probes independently copied and hash-verified the nine-file
  producer export, source digest
  `0f85831175f24aea7237a6a003bdb14972a32cf13a7e76394c3fa9898b3763d6`,
  and initialized separate fresh synthetic stores. Explicit external Python
  3.11.9 on Windows / 3.14.4 on Linux ran with `-I -B`. Actual inclusion bound
  task, attempt, organization and agent IDs. Provision records are
  `windows-reference-provision.json` and `linux-r2-reference-provision.json`.
  No canonical/author store or provider credential was supplied. Synthetic
  host/policy tokens were generated by the probe; `credentials_used:false`
  in the historical result schema refers to provider credentials only.

Scripts and raw outputs are adjacent to this report. Earlier `linux-base.json`
and `linux-reference.json` belong to the failed initial-mode archive; r2 files
supersede those results for final distribution acceptance.

## Scope and remaining limits

Observed systems: Windows10.0.26200.9711 and WSL Ubuntu26.04.1 x64 / glibc2.43.
Independent `readelf` confirms highest required Git symbol GLIBC_2.38;
pcre2/zlib require2.14. `ldd` resolves those two libraries to the private bundle;
libc and loader remain system dependencies, as does `/bin/sh`. This necessary
symbol floor does not prove support on every glibc2.38 distribution. A clean
VM, musl, ARM64 and older-glibc execution were not tested.

The author's separate thirteen-command Git acceptance is referenced in its
documents; this review did not rerun all thirteen as a separate suite. Our
independent native agent/workbench probes exercise actual packaged Git through
the runtime. Optional clipboard/native addons, remote Git/helpers, SSH/Perl,
Electron ABI, full desktop display, real LLM calls, semantic memory improvement,
and the parent's frozen Python bridge remain outside this review. Python is
explicitly external in the tested reference profile. Package UNLICENSED and
notice inventory do not certify public redistribution; corresponding-source
assembly is separate release work.

Validity is limited to the exact archive/source/manifest identities and tested
profiles above. Withdraw this finding if bytes/modes/pins change, required
notices are absent, clean runtime execution requires developer modules/global
Node or Git, or native completion/resume/reference binding fails. Other OS,
profile, Node/ABI or source changes need renewed verification.

**Conclusion: bounded PASS for the unchanged Windows artifact and corrected
Linux r2 artifact in the API-only and explicit external-Python reference
profiles; the original Linux artifact remains rejected.**
