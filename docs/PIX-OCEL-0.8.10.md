# PIX native skill and OCEL 2.0 — 0.8.10

Scope: Pida only. Reuse the official Pi turn lifecycle, the existing observation
archive and the existing pinned PIX subprocess transport. No PIX algorithms,
Schumpeter orchestration, or Persona canonical memory are reimplemented.

## Patch and delivery ledger

| Slice | Implementation | Validation |
| --- | --- | --- |
| OCEL mapping | `exportOcel`, standard JSON, stable typed object/event IDs, E2O/O2O qualifiers | Actual Pi run and real PIX import/semantic validation |
| Durable recording | Explicit observed Pi turn IDs/start/end; OCEL checkpoint at each turn end, final manifest metadata at run end | Checkpoint reads, restart equality, incomplete-cut handling |
| Native skill | Bundled `pix-process-verification`; available by default also in headless/personal compositions | Pack loading and explicit opt-out |
| PIX verification | `pi_ocel`, `pi_verify_run`, `pi_verification_read`; fixed lifecycle policy through actual PIX | Normal, incomplete, dangling-reference, missing-end and parallel-call cases |
| Evidence | Immutable PI result with exact source, OCEL, policy/model and result digests | Source ownership, stale-source revalidation, restart, call budget |
| Interfaces | SDK, owned session/agent-job export, CLI `--ocel`, TUI `/ocel`, Studio download | HTTP ownership and SDK, TUI controller, Web DOM regression; real browser visual trial NOT_RUN |
| External deployment | Requires the host's pinned PIX checkout and interpreter | Linux/Python native engine tested; company API, Windows and live-model trials NOT_RUN |
| External Hub | Additive producer contract revision and CR provided | Actual Schumpeter consumer integration NOT_RUN |

Planning and implementation are complete for these slices. A real PIX calculation
is distinct from a real LLM test: native integration uses scripted Pi model
responses and synthetic business data. It tests the actual Pi → guarded tool →
Python worker → PIX → stored evidence path, not model competence.

## What is recorded

OCEL 2.0 JSON has the standard four top-level arrays: `eventTypes`, `objectTypes`,
`events`, `objects`. Pida metadata/digests are supplied separately, not inserted
as a proprietary replacement for the standard document.

| Object | Recorded links |
| --- | --- |
| Agent / Session / Task / Run | actor, session, task, execution; run belongs to the session/task/agent |
| Turn | actual Pi turn UUID and index, belongs to run |
| ModelRequest | actual request ID, belongs to run and observed turn |
| ToolCall | actual call ID, run/turn, observed parent call when present |
| Artifact / ArtifactVersion | path identity, immutable content/version identity, changed/removed/checked references |
| Verification / Evidence | actual verification ID, tool call, exact checked artifact versions |
| Operation | observed session restoration/maintenance that is not a model run |

Event IDs derive from the persisted source ID and source event ID. Object IDs
are typed, source-scoped hashes of observed identities. Re-exporting or restarting
does not regenerate them. Qualifiers carry the meaning of each relation.
Observation sequence is preserved explicitly and does not claim a global causal
order between agents or concurrent tools.

Final manifest artifacts also appear when no tool generated an artifact-change
event. Their relation is `reported_current_artifact` or
`observed_artifact_version`; no creation event is fabricated. The final
`current_at_run_end` verification attribute is dated at the observed run end,
not backdated to the original test. A passing test of version A is not promoted
to verification of a subsequently edited version B.

Original prompts, assistant reasoning, credentials and raw tool inputs/outputs
are not included. Context descriptor text is omitted; its observation digest
remains. Existing permitted metadata such as tool/model names and artifact
paths is retained. Lost events, open cuts, legacy unobserved turn IDs, and
unsupported/uncaptured host project artifacts remain explicit limitations.

## Persistence and compatibility

For each run in the configured runtime storage directory:

```
observations/SESSION/RUN.jsonl
observations/SESSION/RUN.manifest.json
observations/SESSION/RUN.ocel.json
observations/SESSION/RUN.ocel.meta.json
```

JSONL is the recovery journal. OCEL is automatically materialized at observed
turn ends and final run completion, rather than being a free-text turn diary.
Each materialized JSON file is atomically replaced. The document and metadata
are not one filesystem transaction; verify the digest when consuming files.
SDK/HTTP exports rebuild the selected cut from authoritative observations,
so they do not trust a stale materialized file after a crash. A storage-less
embedded runtime supports export but cannot provide durable checkpoints.

Exporter metadata declares `pida.ocel20/1`, source and OCEL digests,
completeness and limitations. Legacy exports retain existing observation/bundle
schema IDs; validator revision is now `pida.export-validation/0.4`, adding
optional `turn_id`/`turn_index` payload fields and `turn_finished` observations.
Old histories can be exported without guessing previously unobserved turn IDs.
The baseline JSONL/bundle endpoints remain available.

## PIX computation and its meaning

The new `pida.pix.ocel-verification/1` consumer protocol reuses the existing
bounded transport and bundled worker. It uses the existing batch-profile source
pin, not the separate object-prefix profile pin:

- Repository: `Chanta-Research-Group/PIX`
- Commit: `3205d832d5dcdc6901f916b35496a0c60b657e7a`
- Python source digest: `b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510`
- Package: `0.5.0`; tested with Python `3.12.14`

Public APIs: `pix.ocel.import_ocel(format="ocel20-json")` performs parsing and
semantic validation. Existing `pix.event_log.case_traces`,
`pix.case_centric.sequence_alignment.align_dfg` and
`pix.results.result_document` provide alignment and native evidence.

Fixed host policy `pida.runtime-lifecycle/1`:

| Object projection | Accepted complete lifecycle |
| --- | --- |
| Run | `run_started → run_finished` |
| Turn | `turn_started → turn_finished` |
| ToolCall | `tool_started → tool_completed` or `tool_started → tool_failed` |

Parallel calls remain distinct object projections. This is bounded per-object
DFG alignment over a genuine OCEL log, **not** full object-centric Petri-net
conformance or validation of every cross-object dependency. Unchecked types
are included in coverage. A failed tool can follow a valid lifecycle while the
task fails. Open/incomplete cuts cannot return `conforms`; they remain pending.
An operation with no supported lifecycle objects has unknown process judgment.

`structure: PASSED` means the OCEL passed PIX import/semantic validation.
`processJudgment: conforms` means only acceptance by the declared lifecycle
policy. Artifact correctness, independent task acceptance and business success
remain separate. `ResultManifest.verification_status` stays `UNKNOWN`.
Existing `pi_reflect`/`pi_awareness` remain available for explicit fixed models
and cohort/held-out evaluation; their scope has not been broadened silently.

The worker verifies exact source bytes, uses an isolated interpreter and
temporary input directory, and honors cancellation/time/output bounds. It does
not accept model-selected paths or code. Bounds include 2 MiB input, 4 MiB
output, 256 checked lifecycle objects and 10,000 alignment states per profile
call. Exceeding bounds never produces a fabricated passing result. The worker
is trusted local code, not an OS sandbox.

## Use

OCEL recording needs no PIX installation. To calculate with PIX, install the
documented checkout on the host and configure the existing `processIntelligence`
section; paths are host settings, not model arguments:

```json
{
  "processIntelligence": {
    "pythonExecutable": "C:/Python312/python.exe",
    "sourceDirectory": "D:/PIX",
    "sourceCommit": "3205d832d5dcdc6901f916b35496a0c60b657e7a",
    "sourceDigest": "b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510",
    "timeoutMs": 10000,
    "maxCallsPerRun": 2
  }
}
```

Add `pi:read` and `pi:analyze` to an existing workspace's `permissions` list
without removing its other permissions. Newly initialized workspaces include
those two permissions. Existing explicit permission lists are never upgraded
silently; installing a skill or configuring PIX grants no new authority.
If `codingPacks` is explicitly selected, include `"pix"`; an explicit empty list
opts out. No engine code is downloaded or imported merely by reading the skill.

Example instruction in either UI:

> PIX skill을 읽고, pi_history에서 방금 완료된 작업을 골라 pi_verify_run으로
> 검사해줘. OCEL 구조, 실행 절차, 실제 파일 테스트 결과를 구분해서 알려줘.

Use `/ocel` in the TUI or **실행 근거와 범위 → OCEL 2.0 내보내기** in Studio.
SDK methods: `runtime.exportRunOcel`, `client.exportRunOcel`,
`client.exportAgentJobOcel`. HTTP `export?format=ocel` returns the standard
document; `format=ocel-bundle` also returns digests/coverage. Session and agent-job
ownership checks are preserved.

```powershell
node dist/cli.js export SESSION RUN .\my-agent --ocel > run.ocel.json
```

`pi_verify_run` shares the existing PI per-run computation budget. Its immutable
result includes input run/session/digest, OCEL digest, model digest, artifact
snapshot digest, native PIX result and limitations. Source access and the exact
cut are rechecked after computation and on result reads. Computed results do not
change persona memory or auto-correct a process. Missing/invalid PIX returns
unavailable/unknown while ordinary agent execution continues.

## Validation and remaining integration

2026-11-04, Linux, Node `v24.22.1`, Pi `1.2.0`, Python `3.12.14`:
the complete regression suite passed **367/367**, no failures or skips,
with the real pinned PIX test enabled (28.9 seconds). One integration review
checked identity/ownership, timestamp semantics, source/result digests,
unsupported/incomplete state and existing contract compatibility. It corrected
backdated final freshness metadata and tightened complete-object coverage checks.
Browser visual behavior and a live LLM were not inferred from these results.

Native integration command (Linux paths in this test environment):

```bash
PIDA_TEST_PIX_SOURCE=.pida-test-pix-source PIDA_TEST_OCEL_OUTPUT=fixtures/pix-ocel node --test --test-timeout=20000 test/pix-ocel-native.test.mjs
```

Full regression command with actual PIX enabled:

```bash
PIDA_TEST_PIX_SOURCE=.pida-test-pix-source node scripts/task.mjs test
```

The PIX source directory is an external verified materialization and is not
committed/vendor-copied into Pida. Without `PIDA_TEST_PIX_SOURCE`, the native
integration test reports an explicit skip; other tests do not impersonate PIX.
Committed synthetic samples are in `fixtures/pix-ocel/`. Observation-only
fixtures and negative producer-contract cases are in `fixtures/current-producer/`.

Remaining: live LLM and deployed company gateway trial; Windows Python setup;
actual browser download/rendering trial; external Hub acceptance of the new
optional turn metadata and OCEL format. See
[external consumer change request](change-requests/CR-PIDA-OCEL-TURN-2026-11-04.md).
No automatic multi-agent process orchestration or artifact correctness claim
is introduced by this patch.

Standard reference: https://www.ocel-standard.org/specification/formats/json/
