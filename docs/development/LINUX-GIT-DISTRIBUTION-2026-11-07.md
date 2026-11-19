# Scoped Linux Git dependency — 2026-11-07

Owner: `/root/pida_owner/windows_runtime`. This is a packaging-only unit: no main
pida source or packaging script was edited. The input lock was read from the
parent's `scripts/runtime-platform-lock.json`; its exact read-time hash is in
[provenance.json](linux-git-evidence-20261107/provenance.json).

## Artifact and scope

Copy only
`D:/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107/git-linux`.
It contains 49 files totaling 5,748,026 bytes; the ordered file inventory digest
is `13671a0da1c4e6409865a96f72ade7d2c9a192b51138d225c06bafbb383e8e27`.
Every actual file path, byte count and SHA-256 is recorded in
[result.json](linux-git-evidence-20261107/result.json).

Entry point is `bin/git`, a relative POSIX shell wrapper. It resolves its own
directory, sets only its own library, template and Git helper paths, then execs
`libexec/git-core/git`. The private `lib` contains `libpcre2-8.so.0` and
`libz.so.1`. Git's templates and package copyright/source notices are preserved.
The publisher must preserve executable permissions on `bin/git` and
`libexec/git-core/git` when transferring the Windows-stored tree to Linux.

This is deliberately the selected **local built-in command** closure, not a full
Ubuntu Git installation. Network helpers, credential integrations, Perl, SSH,
interactive tools and arbitrary hooks are outside the acceptance scope. No host
Git executable or host pcre2/zlib library was copied into the closure. No system
package installation or configuration change occurred. The Windows MinGit
artifact remains unchanged and separate.

## Pinned inputs and source notices

| Package | Exact version | SHA-256 |
| --- | --- | --- |
| git | `1:2.53.0-1ubuntu1` | `c3b36d7357dea773eefe6c4f97ebff416e5afee22489dc1f729e31d6f47872e9` |
| libpcre2-8-0 | `10.46-1build1` | `3e116766f1a7b149994d4745556023d993d26401223d1595520a991d4ba737fb` |
| zlib1g | `1:1.3.dfsg+really1.3.1-1ubuntu3.1` | `450d9322ac4e9baea0f9a74548a20fde73b078235c1f5d1fb7084c2638e33cdd` |

Archives are retained in the parent distribution's `cache` directory. They were
privately extracted with `dpkg-deb -x` only after verifying the pinned checksum;
the selected files were copied without modifying the ELF binaries. Provenance
records full Debian control metadata, URLs, versions and archive sizes.

The original zlib URL in the moving archive and security pools returned 404.
The **same pinned bytes** were recovered from the
[official Ubuntu 2026-10-01 snapshot](https://snapshot.ubuntu.com/ubuntu/20261001T000000Z/pool/main/z/zlib/zlib1g_1.3.dfsg+really1.3.1-1ubuntu3.1_amd64.deb).
No version/hash substitution occurred. The parent was notified to use this URL
in its distribution lock. Git and pcre2 came from their locked Ubuntu archive
URLs, retained verbatim in provenance.

The complete top-level package notice files are retained under
`share/doc/git`, `share/doc/libpcre2-8-0`, and `share/doc/zlib1g`. Their copyright
files identify Git's GPL-2 and component exceptions, PCRE2's BSD-family terms,
and zlib's license, together with upstream source locations. General license
texts under `share/common-licenses` were copied from the host's Ubuntu
`base-files 14ubuntu6.2`; their bytes are individually hashed in the result.
These are document-only additions, not host executable/library dependencies.
The package notices identify source origins; this unit did not assemble all
corresponding source archives or certify downstream public redistribution.
That remains a release-packaging responsibility.

An initial attempt to copy all unrelated Git contrib documentation encountered
a package-relative common-license symlink. Its incomplete output is preserved
separately as `git-linux-incomplete-20261107` and **must not be packaged**. The
final selected closure has no symlinks and contains the relevant notice files
and common license texts explicitly.

## Actual verification

Environment: WSL Ubuntu 26.04, x86_64, GLIBC 2.43. The selected binary reports
`git version 2.53.0`. A fresh copy was relocated to a temporary directory whose
name contains spaces. PATH contained only that copy's `bin`; Git resolved to
that wrapper, while ssh, perl and curl were absent from executable lookup.
HOME was synthetic, global/system Git config was disabled, hooks/signing were
disabled and author identity was per invocation. The user's actual Git config
was not read. The synthetic config sentinel and both the original and relocated
file inventories stayed unchanged.

All 13 real invocations passed: version, init, empty commit, rev-parse, add,
content commit, second rev-parse, status, log, merge-base, diff, ls-tree and show.
`show` returned the exact committed synthetic Korean content. No model or
network operation occurred during this execution probe.

```powershell
wsl -d Ubuntu -- python3 /mnt/d/ChantaResearchGroup/pida-win-runtime-20261107/docs/development/linux-git-evidence-20261107/probe.py
```

[assemble.py](linux-git-evidence-20261107/assemble.py) captures the acquisition,
checksums, extraction, wrapper, notices and ELF analysis. It refuses an existing
target. [probe.py](linux-git-evidence-20261107/probe.py) performs the real isolated
command and relocation check. These evidence scripts use explicit local paths;
the parent's product packaging script is a separate implementation.

## External OS requirements and limits

Actual ELF `NEEDED` entries for the selected Git are pcre2, zlib and libc. `ldd`
resolved pcre2 and zlib to the artifact's private files. System dependencies are
`/bin/sh`, `libc.so.6`, and `/lib64/ld-linux-x86-64.so.2` on x86_64 Linux.
Git's highest referenced GLIBC version is **2.38**; each bundled library's is
2.14. This is an observed necessary symbol-version requirement, not proof that
every distribution with GLIBC 2.38 runs the artifact. Actual testing used 2.43.
The full Ubuntu Git package declares libc >=2.42 for its wider contents; that
package-level constraint is not silently rewritten by this selected-binary test.
Musl, ARM64, older GLIBC and a clean VM were not tested.

Any pinned archive mismatch, missing private dependency, lookup outside the
intended wrapper, changed file inventory/config sentinel, or failure of the
listed operations withdraws this bounded result. Evidence applies to the
exact recorded bytes and environment on this date. Packaged desktop execution,
different distributions, remote Git and public release source handling remain
separate acceptance work.

Bounded result: the pinned Linux x64 local-workbench Git closure is assembled
and passes the thirteen listed operations after relocation with clean PATH.
