# Pida 0.8.6 — CR follow-up validation

2026-11-03 KST. Scope: Pida only. [Plan](CR-FOLLOWUP-PLAN.md),
[CR index](change-requests/README.md), [usage and boundaries](PIX-PROFILES.md).

## Baseline and sources

Started on local `fix/runtime-stabilization` at
`7653da2bc6f91506b6ff6c8fa434061156885f93` (0.8.5), with a clean worktree.
Existing draft PR1 uses remote branch `fix/runtime-stabilization-00-02`, parent
`a11e4145c14eb8d357a8fbac8dbd8b6b8d0f0a4a`. These are the corresponding
local/delivered baselines; the connector-delivered commit history differs.
This version is 0.8.6. No dependency additions or Pi upgrade.

| Source | Observed revision | Use |
| --- | --- | --- |
| PIX | `a0831bc0b34fd7feebfba928066b90b114ae531e` | Owner alternative, native prefix/object APIs, source-only fixture and explicit new consumer pin |
| Existing PIX batch pin | `3205d832d5dcdc6901f916b35496a0c60b657e7a` | Unchanged batch compatibility; 240 Python source files have the same digest at both observed pins |
| Persona Site | `c506e321c685573481648ecf120e8f2d1214bb83` | Candidate-authority descriptor fixture and partial owner response |
| Schumpeter | `fa6535763141ef686baac3d4dd91ab2be7450ae7` | Late owner repair; actual explicit current-profile import |

PIX source digest:
`b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510`.
Incoming response bytes and their SHA-256 are retained under
`docs/change-requests/incoming/`. Source checkouts were read only. No other app
was patched; the additional consumer build-identity finding is a separate CR.

## Completion by gate

| Gate | Status | Evidence / limits |
| --- | --- | --- |
| CR reconciliation and patch plan | COMPLETE | Current owner responses compared with 0.8.5; old batch, Persona adapter and observation paths reused |
| Pida implementation | COMPLETE for this slice | Optional native prefix/object service, workspace tools, immutable results and guarded continuation |
| Automated Pida tests | PASS | 346/346, build included, no skipped tests |
| Actual PIX execution | PASS | 28 checks using source-verified PIX; old batch 18 checks also pass |
| Pi workspace → PIX | PASS with scripted model | Actual Pi tool invocation through the new workspace integration; no alternate agent loop |
| Persona Site contract fixture | PASS | Current validator accepts exact fixture and rejects tampering/wrong agent; no remote authorization or model-consumption claim |
| Pida export → actual Schumpeter/PIX | PASS for explicit file-import profile | 39 checks, nine bundles, 136 events; current metadata retained and repeat delivery deduplicated |
| Remote Persona authentication / CAS append | OWNER-PENDING | Public grant/binding/revalidation/readback and agreed append protocol not supplied |
| Live LLM / Windows / production joint operation | NOT_RUN | Synthetic facts and scripted model decisions; no account or company gateway inference |
| Independent task acceptance / federation | NOT_IMPLEMENTED in this slice | Runtime completion and importer success preserve UNKNOWN task acceptance |

## What changed and what was reused

The existing bounded Python transport now supports separately validated JSON
protocols. The old batch protocol, source pin and semantics remain unchanged.
The new `pida.pix.profiles/1` request passes native models to PIX rather than
creating a new algorithm or silently converting a DFG. It supports approximate
sequential prefixes and terminal whole-object alignment as distinct profiles.

`ProcessProfileAnalysis` resolves host-authorized references, fixes the selected
cut/model/policy/generation before compute, checks access and freshness again
before publishing, and stores exact immutable requests/results. Resumption
requires matching source identity and a valid native checkpoint. Source
corrections require an explicit new generation. Task/artifact/scope/model changes
cannot silently reuse a previous checkpoint. Historical result reads recheck
current authorization and applicability. The trusted host owns source ledger,
publication and CAS; this consumer adds no source writer or model adoption.

The SDK/workspace factory installs three opt-in permission-guarded reference
tools. Existing workspaces remain usable without a source provider. Native
results retain partial order, scope exclusions and unresolved cost. An open
prefix is pending; a zero-cost approximate witness does not prove completion.
Object alignment is unavailable for an open object cut. No business acceptance
or Persona write is inferred from a process judgment.

## Defects found and corrected

- The first actual continuation probe exposed a native checkpoint digest break:
  parsing Python JSON and reserializing it in JavaScript changed `1.0` to `1`.
  Native result/checkpoint JSON is now carried as exact bytes in a string with
  its SHA-256. Resumed and uninterrupted native outputs match byte for byte;
  reserialized-number and wrong-generation checkpoints are rejected.
- A transport caller could mutate its request while the worker ran. Response
  validation now uses a clone of the exact dispatched bytes. The regression is
  included in the final suite.
- Integrated self-review tightened closed host metadata and continuation
  identity to include task/artifact/model-kind/provenance/scope. One integrated
  self-review was performed; no independent review is claimed.

Schumpeter's repaired importer resolved the previously observed contract block.
The older 0.8.5 failed experiment and lock remain intact. A separate source
identity issue was observed in its advisory PIX metadata when a source snapshot
is nested in Pida's Git checkout; see
[the owner CR](change-requests/CR-PIDA-SCHUMPETER-BUILD-IDENTITY-2026-11-03.md).
The final probe uses a neutral working directory and independently pinned source
bytes; it does not treat advisory Git/package fields as engine identity.

## Commands and actual results

Environment: Linux x64; Node 24.22.1; npm 11.9.0; Python 3.12.14;
official Pi AI / Agent Core / Coding Agent 1.2.0 (unchanged exact pins).

| Command | Result |
| --- | --- |
| `npm test` | 346 passed, 0 failed/cancelled/skipped, 25.083689 s; includes TypeScript build |
| `python -B scripts/pix-worker-check.py --source .pida-test-pix-profiles-source` | 18 passed using the existing batch identity and actual verified source |
| `node scripts/pix-profiles-check.mjs --source .pida-test-pix-profiles-source --output .pida-test-profile-final` | 28 passed; hashes show tested runtime/source unchanged during probe |
| `node scripts/generate-current-export-fixture.mjs` | Current 0.8.6 positive/negative producer captures regenerated and validated |
| `python -I -B scripts/schumpeter-current-check.py ...` | 39 passed; nine bundles / 136 events; final exact command below |
| `npm pack --dry-run --ignore-scripts --json` | PASS; compiled new modules and worker included, temporary/private stores excluded |
| `git diff --check` and evidence/source digest checks | PASS |

The final consumer invocation used `/tmp` as its working directory:

```sh
python -I -B /workspace/scratch/1e97a966156f/pida/scripts/schumpeter-current-check.py \
  --source /workspace/scratch/893bf6c2c285/schumpeter \
  --pix-source /workspace/scratch/1e97a966156f/pida/.pida-test-pix-profiles-source \
  --workspace-bundle /workspace/scratch/1e97a966156f/pida/.pida-test-profile-final/workspace-run.json \
  --output /workspace/scratch/1e97a966156f/pida/.pida-test-profile-final/schumpeter-current-isolated.json
```

`fixtures/pix-profiles/evidence/` contains the exact final raw JSON reports and
captures. `index.json` catalogs their bytes, with no regenerated identities.
The PIX report pins executed source/build hashes. The Schumpeter report pins its
15 source files, mapping, interpreter, probe and worker, plus each imported
bundle digest. The two new bundles are current 0.8.6; seven Persona bundles remain
historical 0.8.5 evidence. All nine consumer decisions are REQUEST_EVIDENCE with
task outcome UNKNOWN. The Site fixture check belongs to the automated suite,
not the actual-engine report.

## Remaining work

The host must supply its existing authoritative source/access port to activate
the new tools; this is not an automatic live-cut subscription or end-user model
editor. Remote Persona contracts, independent local acceptance, durable
organization/federation contracts, live-model efficacy and Windows execution
remain separate gates. The Schumpeter source-identity CR is owner-pending and
does not invalidate the independently pinned local import result.

Changes are delivered as a version-specific 0.8.6 commit on existing draft PR1.
No merge, release, deployment, tag, message, external service or data migration
is part of this work.
