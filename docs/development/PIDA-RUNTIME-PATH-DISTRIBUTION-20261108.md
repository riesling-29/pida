# Nested-path correction runtime distribution

New private source `b7f7d523c6fede56d508575a6bb78afa343e5566` packages the
[independently reviewed path correction](PIDA-WORKBENCH-PI-PATH-20261108.md).
[Handoff](runtime-distribution-path-evidence-20261108/handoff.json) pins the exact
archive/manifest/source identities. Existing BB and 2b distributions, caches and
failed real cases remain unchanged. Only dist/workbench.js changed among 150
built files, to SHA256 `043a0eeb21907103d07e70907653e59544f162ffcc68c68495b96c0f118b99a9`.
Native join/runtime/agent tools/observation code is byte-identical to the prior
accepted 2b package; its independently accepted join evidence is retained, not
presented as a newly repeated suite.

| Platform | Archive SHA256 | Manifest SHA256 |
| --- | --- | --- |
| Windows x64 | b8761c8d363311228d8b808f76546720673694165277d14178662af0a38ef3f0 | 36388ea34cbe9011c1554b389cbdc55dd7789914f862ab744b6587b6e4fcf88f |
| Linux x64 | e9090be1cf9cd632aa214ae56399358ca83488129cd56d6c467ee373592f0d67 | b9dca96fab95f1e1e5e4a628c7f03ba821e9a3441675fd269a663876f0238559 |

Both archives passed ordinary extraction and exact full-tree checks before and
after probes. All vendor entries, modes, 125 dependency records, Node and Git
are unchanged. The existing [runtime layout and limits](PIDA-RUNTIME-DISTRIBUTION-20261107.md)
apply: official standalone Node 24.18.0, platform Git closure, short Windows
paths, Linux glibc 2.38 floor, explicit optional Persona provider, no runtime
npm/developer-module dependency or Electron ABI substitution.

Author probes on each extracted platform passed stock wrapper base and
source-backed reference fresh/resume, plus six public SDK path cases including
actual local Pi scripted write/read/edit with exact artifact bytes and negative
containment/link cases. External Python and a fresh f6 reference store are
explicit requirements of the reference probe; it does not prove the parent's
frozen Python service. Stock mock remains single-root. No hidden product test
mode, new provider request, billing change or user workspace migration occurred.

Independent package delta review passed these exact archives. The
[report](runtime-path-distribution-independent-20261108/INDEPENDENT-DISTRIBUTION-REVIEW.md)
verifies 150 built files and 378 own source-package files, unchanged vendor
bytes/modes/dependency/license inventory, normal extraction and exact trees
before/after, and 61 public tool invocations per OS including 48 invalid-path
calls, actual links, reopen, effect classification and artifact identity. Four
stock base/reference/resume records remain author evidence in this narrow
delta. The unchanged join suite was retained, not rerun. Original artifacts are
[archived](runtime-path-distribution-independent-20261108/original-evidence.zip)
with [hash index](runtime-path-distribution-independent-20261108/archive-index.json).
Source
acceptance, package closure, parent service/UI and actual model validation are
separate. A fresh verification workspace must retain its new exact runtime
identity; no existing manifest is rewritten. Known prior actual validation
requests remain twelve (old single smoke one, old two-org case five, C case six).

Withdraw the bounded distribution claim on archive/source/tree drift, vendor or
notice changes, failed nested-path or escape tests, unexpected effects/replay,
or dependency on global/developer tooling. It applies only to the pinned bytes
and tested profiles. Keeping existing deployed runtime unchanged remains the
alternative until the remaining independent and desktop gates pass.
