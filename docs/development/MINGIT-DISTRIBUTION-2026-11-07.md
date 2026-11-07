# Official Windows MinGit dependency — 2026-11-07

Packaging-only unit owned by `/root/pida_owner/windows_runtime`. Runtime source
was not changed. The parent runtime's declared freeze is `30077f3`; this isolated
documentation worktree remains based on Windows correction `649c2bc`.

## Artifact handoff

Copy the **entire** directory:
`D:/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107/git-windows`.
Use `cmd/git.exe`, or put that directory's `cmd` first in the child process PATH.
The full unmodified package includes `cmd`, `etc`, `ucrt64`, `usr` and
`LICENSE.txt`, not just a portable-looking executable. No global installation,
system Git configuration change, PATH mutation or installer execution occurred.

| Identity | Value |
| --- | --- |
| Official release | [v2.56.0.windows.4](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4) |
| Download | [MinGit-2.56.0.4-64-bit.zip](https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/MinGit-2.56.0.4-64-bit.zip) |
| Local archive | `D:/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107/MinGit-2.56.0.4-64-bit.zip` |
| Official and actual SHA-256 | `e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877` |
| Archive size | 39,846,926 bytes |
| Expanded closure | 375 files, 96,237,338 bytes |
| Reported version | `git version 2.56.0.windows.4` |
| File-inventory digest | `4e4948e91d46854ebcdaee2ecfb91a7296429bc6a7af35814e65dcdade9bb513` |

All 375 extracted files match their archive entry's SHA-256; no additional files
were present. The downloaded ZIP matched the hash published in the official
release table. Windows Authenticode verification of `cmd/git.exe` returned
`Valid`. This supplements the release hash; individual signing coverage for
every executable/DLL was not asserted.

## Evidence and reproduction

- [provenance.json](mingit-evidence-20261107/provenance.json): official URLs,
  archive checksum and exact extraction verification.
- [result.json](mingit-evidence-20261107/result.json): all file paths/sizes/hashes,
  license-file inventory, sanitized environment and 13 real invocation results.
- [package-versions.txt](mingit-evidence-20261107/package-versions.txt): byte-exact
  upstream `etc/package-versions.txt`. This describes the release build's package
  versions; it is not proof that every listed package's full installation is in
  MinGit. The file inventory is the actual distributed closure.
- [probe.mjs](mingit-evidence-20261107/probe.mjs) and
  [verify-archive.ps1](mingit-evidence-20261107/verify-archive.ps1): reproducible
  checks, without runtime edits or paid/model calls.

```powershell
node docs/development/mingit-evidence-20261107/probe.mjs D:/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107/git-windows docs/development/mingit-evidence-20261107/result.json
./docs/development/mingit-evidence-20261107/verify-archive.ps1 -ArtifactRoot D:/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107
```

The probe launched `git.exe` by name with PATH containing **only** the artifact's
`cmd` directory. `where.exe` resolved that exact executable. `SystemRoot` remained
available for Windows DLL loading; HOME/USERPROFILE/TEMP were isolated synthetic
directories. `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, disabled hooks
and signing, and per-command author identity match pida's local-workbench intent.
The actual user's configuration was not read. The synthetic `.gitconfig` sentinel
and the entire packaged file inventory were unchanged after the test.

Actual local commands passed: version, init, empty commit, rev-parse, add, content
commit, second rev-parse, status, log, merge-base, diff, ls-tree and show. The
retrieved artifact contained a synthetic Korean string and matched the committed
content. The temporary repository was removed only after its resolved path was
verified beneath the OS temp directory. Nothing was sent to a remote.

## License and source inventory

Preserve `LICENSE.txt` (Git's GPL v2 text), `ucrt64/share/licenses/**`,
`usr/share/licenses/**`, `ucrt64/doc/git-credential-manager/LICENSE` and all other
unmodified package files. `result.json` enumerates 45 license-related files,
including GCC runtime exceptions, LGPL/GPL components and permissively licensed
libraries. No single-license claim is made for the complete package.

Git source is identified by the official
[v2.56.0.windows.4 tag](https://github.com/git-for-windows/git/tree/v2.56.0.windows.4).
The retained upstream package-version inventory identifies supporting components
such as MSYS2 runtime, shell utilities, OpenSSL, curl and credential helpers.
This unit preserves upstream notices and provenance; it does not assemble every
component's corresponding source archive or certify a downstream public
redistribution plan. Those source-distribution details remain a packaging release
responsibility before public release. The binaries themselves remain local
artifacts outside Git; this commit contains documentation and test evidence only.

## External constraints and falsification

[Official requirements](https://gitforwindows.org/requirements.html) specify
Windows 10 or later on x64 for this release. This was exercised on Windows
`10.0.26200`, x64; Windows 10, ARM64 emulation and a pristine VM were not separately
tested. Normal OS facilities and DLLs remain external dependencies. This is not
a Linux Git artifact or a general-purpose Unix environment.

[MinGit's official scope](https://gitforwindows.org/mingit.html) is noninteractive
application use. Interactive UI, Perl-dependent features, arbitrary hooks,
network remotes and user credential integrations were not tested. The original
pida workbench's deep-root constraint remains: use a short workspace root;
this dependency swap is not evidence that Git config discovery accepts arbitrary
Windows path lengths.

Any archive mismatch, missing file, clean-PATH resolution outside the packaged
tree, changed package/global sentinel, or failure of the listed Git commands
withdraws this bounded result. Evidence applies to these exact bytes and this
environment as of the date above; updates need checksum and relevant execution
checks again. Clean-PATH success does not replace packaged-app or clean-VM tests.

Bounded result: the official full MinGit x64 closure is assembled and verified
for the listed local workbench operations; parent desktop packaging/acceptance
and downstream release-source handling remain separate.
