# Diagnostic and native join runtime distribution

This new private build pins combined source
`2b787fd4c234747da22726ec03a3e4c6619ae95f`. It includes the independently reviewed
[provider diagnostic](PIDA-PROVIDER-DIAGNOSTIC-20261108.md) and
[native join yield](PIDA-NATIVE-JOIN-YIELD-20261108.md). It does not rewrite the
accepted bb9886 distributions, stable caches or either real-case failure.
New verification uses a fresh workspace and the exact new runtime identity.

[Handoff](runtime-distribution-evidence-20261108/handoff.json) contains full
archive/manifest/source hashes and paths. Both distributions retain the prior
official Node 24.18.0 x64, 125 production dependencies and platform Git closure.
No global install or Electron ABI substitution was made. The unchanged
[layout/configuration contract](PIDA-RUNTIME-DISTRIBUTION-20261107.md) still applies.
Each archive manifest inventories every runtime byte/mode, dependency/license,
source/npm hash and Node ABI. This is pida-core 0.8.18 plus the explicit
Schumpeter source suffix, not an untouched upstream release.

| Platform | Archive SHA256 | Manifest SHA256 |
| --- | --- | --- |
| Windows x64 | db9e1041ec932165adcbe383a38a5178cf3b58f0654db245e6783c8db2302986 | a46e2337721394e6b8d494b6b06e721754cda01f982a2127e996da8fa80a8003 |
| Linux x64 | dcb721282aaca7c1c83c7ce7f3fa25e700b437df79a8f2b2cab37d75f134bd33 | 0dfb09e7abfeac166d75cb0dc33ca9c6c5b7baa6fc7fb81ff9d066a5c8ee084f |

Both archives were extracted normally and passed their exact tree verifier
before and after probes. Stock wrapper fresh/resume checks passed without
developer modules, source checkout or provider credentials: API-only local
Persona and explicit source-backed reference Persona each retained the same
native completed job and rotated transport token on resume. Reference uses
an external Python interpreter and the reviewed f6edd02 source export with a
fresh synthetic store; this does not prove the parent's frozen Python assembly.

The exact 23 native yield tests also passed against each extracted package's
public runtime APIs and production faux-provider dependency. The standalone
[probe](runtime-distribution-evidence-20261108/probe-packaged-yield.mjs) rewrites
only import locations, executes bundled Node with a restricted environment and
creates state in a separate temporary directory. It changes no package bytes.
The initial probe used a CJS resolver for an import-only faux export; corrected
to the dependency's declared ESM export mapping before passing both platforms.

These are two distinct claims: stock delivered wrapper single-root mock and
reference/resume assembly; external test-only native SDK multi-agent join.
The stock mock provider has no scripted multi-agent injection. Consumer
authority/capture/diagnostic join tests must declare their external harness,
and actual managed multi-agent GUI behavior still requires its own gate.
No hidden product test mode or paid model request was added.

Independent distribution delta review is pending at this author handoff.
No real-model, full-suite, GUI, billing or generic Linux compatibility claim
follows. Linux retains the previous glibc 2.38 floor and bounded local Git
closure; Windows uses short app-owned paths. The claim is withdrawn for an
archive/tree mismatch, dependency/source drift, missing native capability,
failed fresh/resume probe, or mutation/replay of held workspaces. It applies
only to the pinned bytes; do nothing remains the deployment alternative until
the remaining package and consumer gates pass.
