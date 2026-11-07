# Independent nested-path runtime distribution review — 2026-11-08

Reviewer `/root/pida_windows_review`. Runtime source is
`b7f7d523c6fede56d508575a6bb78afa343e5566`; author handoff/docs freeze is
`37595ed2d33c1f1effa0adefbfc6e408f38a77eb`. This is the immutable distribution
delta following the accepted source review, SHA-256
`6246f3e7d74f3628585b4cc7dbe4a96f8a5f8bcbe10529976a8461f2cde2741e`.
Product source, held case/workspaces, old BB/2b packages and stable caches were
not changed. No GUI, provider/model, account or auth operation was performed.

## Pinned delivery identities

| Platform | Archive SHA-256 | Manifest SHA-256 | Files |
| --- | --- | --- | --- |
| Windows x64 | `b8761c8d363311228d8b808f76546720673694165277d14178662af0a38ef3f0` | `36388ea34cbe9011c1554b389cbdc55dd7789914f862ab744b6587b6e4fcf88f` | 16049 |
| Linux x64 | `e9090be1cf9cd632aa214ae56399358ca83488129cd56d6c467ee373592f0d67` | `b9dca96fab95f1e1e5e4a628c7f03ba821e9a3441675fd269a663876f0238559` | 15723 |

Archive paths and byte sizes are in `metadata.json`. Both archive hashes were
independently calculated. Shared npm archive SHA-256 is
`f9fe665c89617342840657d89f04a6d68fe49455461ab3a115c12208d5ddad63`.
A newly generated `git archive` of the clean exact source matches source hash
`52053706b0da121a0909f7ab8f9df8099243ae52b172110b20840350087ff8a0`.

## Independent checks

- Ordinary archive extraction into new reviewer paths
  `D:/pwr-dist-1108/runtime` and
  `/var/tmp/pida-workbench-dist-review-20261108/runtime` passed full pinned
  tree/byte/mode verification before and after all probes. A separate Linux
  Python comparison also reports zero byte/mode differences or extra files.
- Both packages'150 compiled files match the independently built exact source
  retained from the immediately preceding source review. **Only
  `dist/workbench.js` differs from accepted2b**, with SHA-256
  `043a0eeb21907103d07e70907653e59544f162ffcc68c68495b96c0f118b99a9`.
  All378 other own-package files match the pinned source, including documents,
  examples, fixtures and notices. No second implementation or injected test
  mode was substituted in either package.
- All15521 Windows /15195 Linux vendor entries are byte/mode-identical to the
  accepted2b packages. All125 dependency records, Node identity, dependency
  lock and license inventories are unchanged. Original official Node/MinGit/
  Ubuntu provenance is retained by identity; it was not redundantly downloaded.
  The unchanged builder and platform lock hashes match the frozen source:
  `1f4b14df625ddd47f59787a08beda005c1fccf4e69454a64eb7a5b4ac8e336e5`
  and `bb970d860a8c9e3255007976fa21240746dbc4d7b171e4eb6ce55c8cf9560fba`.
- Retained notices are present/nonempty (Windows165/Linux124). Checked build
  tools/runtime npm/cache locations and known credential filenames are absent.
  This bounded filename inventory is not a general secret-scan certification.
  Observation modules load with bundled Node; wrapper SHA remains
  `f71d8f4f678fc052403de02dfe05981240d893af2624f51ae48f3cdb2e61d72c`.
- Ran the independent source-review probe **directly against each actual
  packaged public Workbench/Pi-tool implementation**, without rewriting imports
  inside the package. Each platform completed61 tool invocations in a separate
  new fixture; these are61 calls, not61 independent test cases. Nested
  write/read/edit, flat controls and direct nested APIs succeed. Effect
  classification, unchanged read evidence, actual file bytes/SHA/artifact ID,
  principal isolation and exact state after reopen are checked.
- The same packaged probes reject48 invalid-path operations per platform
  (16 traversal/absolute/drive/UNC/backslash/dot/NUL/empty forms across the three
  tools). Actual directory junction/symlink, hardlink and dangling-directory
  link checks preserve outside sentinel bytes and create no escaped destination.
  Fixed nested artifact paths remain canonical forward-slash identities.

`windows-delta.json`, `linux-delta.json`, both `*-packaged-path.json`,
both before/after verifier records, `linux-independent-tree-diff.json` and
`metadata.json` preserve the exact independent evidence. `probe.mjs` is
byte-identical to the accepted independent source probe, SHA-256
`06e50d1df800a5b96bd648b35d81519c375aae9300c23edd59d99b0a25bac3b6`.
The probe invokes public tool callbacks and their effect/evidence contract
directly: zero provider/model calls, no new runtime ledger/crash-recovery claim.

## Author evidence and exclusions

Inspected and copied exact author stock base/reference fresh/resume results
(`author-*-clean-probe.json`, `author-*-reference-probe.json`). Each reports an
actual native completed job, terminal event, same job/attempt after resume and
rotated transport token on the new package. Those four runs were **not rerun
independently in this narrow delta**. The author's six packaged path cases
include a local scripted Pi flow; this is also separate author evidence.
The reference profile explicitly uses external Python and a fresh synthetic
producer-source store. It does not establish the parent's frozen Python bridge.
Historical `credentials_used:false` refers to provider credentials; host/policy
tokens in stock smoke are synthetic transport credentials.

The unchanged native join/runtime/agent/observation modules retain their prior
accepted2b evidence; their suite was not presented as newly executed. Stock mock
remains single-root. This review introduces no product scripted multi-agent
mode and makes no actual managed multi-agent or real-provider success claim.

Environment and closure limits remain Windows10.0.26200, standalone Node24.18.0,
and WSL Ubuntu26.04.1 x64/glibc2.43. The unchanged selected Git needs GLIBC_2.38
symbols and system shell/libc/loader; this is not broad Linux compatibility.
Short app-owned Windows paths remain required. Native GUI/clipboard, Electron
ABI, remote Git, musl/ARM64, live account/billing, public redistribution rights,
Schumpeter service/ASAR identity and parent consumer capture are outside scope.
No deployment/cache promotion or old-case state/request-count rewrite occurred.

Validity is limited to the exact pins above. Withdraw if source/archive/tree
identity changes, other executable/vendor bytes drift, required notices vanish,
nested operations fail, invalid/link paths escape or mutate state, artifact
identities mismatch, or clean package use requires developer/global executables.
Leaving existing deployed packages unchanged remains an option while separate
parent service/desktop/consumer gates run.

**Conclusion: bounded PASS for the exact b7f Windows/Linux immutable runtime
distributions and packaged nested-path behavior; no remaining finding in this
delta, with author stock/reference evidence and parent acceptance kept separate.**
