# Private platform runtime distribution

This is a modified local Schumpeter integration build of pida-core 0.8.18, not an
untouched upstream release. Each runtime manifest supplies `distribution_id`
(`pida-0.8.18+schumpeter.<source-prefix>.<platform>`), full source revision, source
archive/compiled npm archive hashes, dependency lock identity, full runtime file
hashes/modes, Node ABI, native addon paths and license inventory. The parent UI
should display that build identity. No package is published by this task.

## Layout and runtime requirements

```
runtime/
  manifest.json
  node/node[.exe]       # official Node, original LICENSE and README
  pida/                # npm package + pinned production node_modules
  git/                 # platform-specific bundled local workbench Git
```

The desktop copies this as `resources/pida-runtime`. Use explicit internal
executable/package paths, not global Node/npm/Git or Electron's Node ABI.
Windows Git PATH entry is `git/cmd`; Linux is `git/bin`. Preserve Linux executable
modes through the tar archive/native filesystem. Never flatten the Git closure.

The base profile omits development and optional npm dependencies, uses
`npm ci --ignore-scripts --omit=dev --omit=optional`, and has no runtime npm/cache
requirement. Browser automation/Playwright is not bundled. The API-only default
uses pida-local Persona and does not require Python. The optional production
reference helper requires the separately verified Persona source export plus
Python, or the parent's frozen service `--persona-bridge` entrypoint; see
[its contract](PIDA-LOCAL-REFERENCE-HOST-20261107.md). The historical synthetic
module is not production canonical memory. No provider credentials are included.

Official Node 24.18.0 x64 provenance:

| Platform | Archive | SHA-256 |
| --- | --- | --- |
| Windows | [node-v24.18.0-win-x64.zip](https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip) | `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821` |
| Linux | [node-v24.18.0-linux-x64.tar.xz](https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz) | `55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742` |

Both hashes were checked against the official release `SHASUMS256.txt` downloaded
over HTTPS. The final inventory records binary hashes separately. Node's original
license contains its dependency notices. Pida's package license remains
`UNLICENSED`; all installed dependency license fields and discovered notice files
are inventoried, without inferring additional distribution rights.

Windows bundles the complete official MinGit 2.56.0.windows.4 archive closure:
[provenance, source and 13-command proof](MINGIT-DISTRIBUTION-2026-11-07.md).
Linux bundles a deliberately smaller local-workbench Git 2.53.0 closure from
three exact official Ubuntu packages:
[provenance, source, libraries and 13-command proof](LINUX-GIT-DISTRIBUTION-2026-11-07.md).
Linux remote helpers, Perl/SSH/credential tools are not included or claimed.
The selected Git ELF needs GLIBC_2.38 symbols and a system `/bin/sh`/glibc loader;
the tested environment is Ubuntu 26.04.1 x64 with glibc 2.43. This symbol floor is
not a claim of acceptance on every distribution at that version. The full Ubuntu
Git package's dependency floor differs because omitted helpers have more needs.

Pi TUI includes platform-specific native prebuilds. Only official standalone
Node 24.18.0 is tested here. Linux native clipboard can require libxcb and optional
desktop clipboard tools; API/observation tests do not establish clipboard support.
There is no Electron native-module ABI compatibility claim. The final desktop
must keep the standalone Node process boundary.

Use a short per-user Windows host directory and the parent's conservative path
preflight. The workbench fixes do not establish arbitrary-depth Windows paths.
Never point the host at the user's existing standalone runtime for this assembly.

## Build, launch and verification

`scripts/runtime-platform-lock.json` pins official artifacts.
`scripts/package-runtime.mjs` takes `--output NEW_DIR --source FULL_COMMIT
--node-archive ARCHIVE --git-directory CLOSURE`. It archives that Git revision,
compiles matching runtime source into the isolated staging tree and packs the npm
archive. A `--package-tar` build on another platform requires the matching
`.source.json` sidecar and exact archive hash; it installs platform production
dependencies from the same shrinkwrap. Build-only tools/cache stay outside the
runtime archive. No lifecycle scripts or global installation are run.

The initial pack failed because npm omitted `npm-shrinkwrap.json` from the package
files whitelist; `14bea12` explicitly includes it. Failed staging/logs are retained
as historical evidence. Unpinned dependency resolution was not substituted.

Launch `<node> <pida>/examples/schumpeter-host.mjs --workspace <new-short-dir>
--host-id <registered-id>` with the parent's trusted current policy URL/token.
The parent reads the one private ready line, verifies the host ID and retains the
API token outside renderer/metadata. Default standalone CLI collaboration remains
disabled; this explicit managed entrypoint requires the configured authoritative
loopback policy. `--workspace-mode resume` preserves native identities/receipts,
rotates transport token and fails closed on source/profile/config/store mismatch.
It does not recreate organizations or replay interrupted effects automatically.

`scripts/verify-runtime-distribution.mjs <runtime> <expected-manifest-sha256>`
checks the exact platform file tree, bytes, modes and contained links. The expected
manifest hash comes from the trusted handoff, not the directory being verified.
`scripts/probe-runtime-distribution.mjs <runtime> <result.json>` copies the runtime
outside the source checkout, uses explicit bundled Node/Git and a minimal child
environment, then completes a mock native job, exports its terminal event and
reopens the same job/attempt with a rotated transport token. The test policy denies
external admissions; this probe uses the explicit owner native organization API.
`--reference` additionally tests the configured external reference bridge; it
does not initialize the store or imply Python is included in the Node artifact.

The separate [observation terminal](PIDA-OBSERVATION-TUI-20261107.md) uses only
audited noninitializing host reads. It is host-wide, not organization-scoped;
task/artifact controls remain Schumpeter's responsibility.

## Acceptance boundaries

Actual platform artifact hashes and clean-process outcomes are appended in the
handoff evidence after the final reviewed source freeze. Historical candidate
artifacts must not be substituted. API-only and explicit external-Python reference
profiles are distinct from the parent's Electron/Python GUI package. No new paid
model call, desktop rendering, general remote Git, broad Linux compatibility,
semantic Persona improvement or billing claim is made by packaging tests.

Withdraw this distribution if a file/source/dependency pin differs, a clean
process requires developer modules/global executables, native state changes on
denied resume, a required license/notice is missing, or the tested runtime cannot
complete/reopen its native job. Validity is limited to the exact recorded build
and environments; future source/profile/Node changes need a new artifact check.
