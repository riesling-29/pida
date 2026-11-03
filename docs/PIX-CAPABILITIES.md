# Direct PIX consumer: first batch slice

Pida owns `scripts/pix-worker.py`, its TypeScript process adapter and domain mapping. It calls the existing PIX public API; it neither embeds Schumpeter nor implements discovery/alignment itself. PIX is optional. A missing or mismatched engine must remain unavailable, while ordinary Pida execution remains usable.

## Verified source and API

The first supported source is [PIX PR #13](https://github.com/Chanta-Research-Group/PIX/pull/13), still at `3205d832d5dcdc6901f916b35496a0c60b657e7a` when checked on 2026-11-03. That commit documents the implementation at `70df30ac38a11ba40536447f33d0fb1a93669418`; the consumer pins the complete Python code at the newer exact commit rather than treating `0.5.0` alone as a build identity.

| Property | Value |
| --- | --- |
| Repository | `Chanta-Research-Group/PIX` |
| Package version | `0.5.0` |
| Source commit | `3205d832d5dcdc6901f916b35496a0c60b657e7a` |
| Python source files | 240 |
| Python source digest | `b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510` |
| Native result format | `pix.analysis-result`, version `1.3.0` |
| Tested interpreter | Python `3.12.14`, Linux |

The digest is SHA-256 of UTF-8 compact JSON, without a trailing newline, containing sorted `[relative_path, sha256(raw_file_bytes)]` pairs for the exact `src/pix/**/*.py` set. Paths use `/` and begin with `src/pix/`. Raw bytes retain original CRLF where present. The materialization used for this check was compared against 242 Git blob hashes (Python code plus README and pyproject); no PIX source file was changed. PIX source is not vendored or published in the Pida package.

| Pida operation | Actual public PIX calls | Meaning |
| --- | --- | --- |
| Reflection | `pix.event_log.case_traces`, `pix.case_centric.catalog_trace_variants`, `pix.case_centric.discover_dfg` | Exact variants/counts plus a discovered accepting activity graph |
| Frozen model | `DFGAlignmentModel` from `pix.case_centric.sequence_alignment` | Explicit activities, edges, starts, ends and empty-word policy |
| Awareness | `pix.case_centric.sequence_alignment.align_dfg` | Optimal raw log/model edit cost, move witness, or explicit search limit/unreachable result |
| Evidence | `pix.results.result_document` | Native operator/spec/source/computation/parent identities and document digest |

`catalog_trace_variants.top_variant_percent` is a percentage of distinct variants, **not case coverage**. The worker requests all variants. Pida's consumer may select a cumulative case-coverage prefix from the returned counts, with its own explicit profile and denominator. Failures and aborts are not silently removed.

The DFG is discovered from all supplied cases and may accept unseen recombinations of observed edges. It is not an exact variant-set model, a Petri net, or a proof of concurrency. A zero cost proves acceptance by this frozen graph under the declared costs; it does not prove a previously observed exact trace, good work, true identity or authorization. A beneficial extra review can have nonzero empirical cost without being an obligation violation. Model kind and policy interpretation belong to the scoped host, outside this neutral worker.

## Input, execution and limits

`pida.pix.worker.v1` accepts one UTF-8 JSON request on stdin and emits one JSON result. No arbitrary Python, shell command, URL, owner/principal or import path is accepted in the request. The host selects an absolute interpreter, the bundled worker, and a source directory. The adapter uses fixed argv with `-I -B`, a separate temporary working directory, bounded I/O, timeout and cancellation. This is a trusted local worker boundary, not an enforcing OS sandbox.

The configured source directory contains `src/pix`. The worker verifies its exact code digest before import and refuses unsupported commit/digest combinations, unexpected sibling import roots, source symlinks and executable bytecode/native caches. It imports an ephemeral copy of the exact bytes just verified, avoiding a source-file change between hashing and import. Python `-B` prevents cache writes; the explicit cache check also prevents reading unverified cached bytecode. Read-only source permissions are useful operationally but do not replace the byte checks.

Request fields:

```json
{
  "schemaVersion": "pida.pix.worker.v1",
  "operation": "reflect",
  "traces": [{"caseId": "run-1", "events": [{"eventId": "event-1", "activity": "tool_started"}]}],
  "limits": {"maxEvents": 10000, "maxVariants": 1000, "maxStates": 100000, "maxEventPairs": 10000}
}
```

Awareness additionally supplies the frozen `model` with `activities`, `edges`, `starts`, `ends`, `acceptsEmpty`. Capabilities has neither traces nor model. Unknown fields, duplicate JSON members, duplicate case/event identities, nonfinite values and unsupported models fail closed. At most 256 cases, 256 distinct activities, 10,000 events, 2 MiB request and 4 MiB output are supported. Host limits may be smaller. Input event order is preserved, never inferred by sorting timestamps or IDs. Shared events across cases are rejected in this sequential profile; a future object-centric projection needs its own contract.

Each successful calculation includes actual engine identity and native documents. Top-level issue summaries are deduplicated; native documents preserve their full diagnostics. A partial graph never becomes a frozen model. `search_limit` with an unknown cost remains partial, not 100% fitness. No field purports to be task acceptance. Native diagnostics explicitly retain unavailable timestamps and the distinction between source order and causal order.

## Reproduction and evidence

Use an owner-authorized read-only source checkout/export at the exact pin. Do not install a similarly named package from a public package index. A normal Git checkout must retain repository line endings for the source digest; exporting a byte-preserving source archive is preferable on Windows when autocrlf is enabled.

```sh
python -B scripts/pix-worker-check.py --source /absolute/path/to/pinned-pix
```

To regenerate the committed consumer fixtures deliberately:

```sh
python -B scripts/pix-worker-check.py --source /absolute/path/to/pinned-pix --write-fixtures test/fixtures/pix
```

The check launches isolated subprocesses from outside the source and Pida working directories. It performs real PIX calculations on synthetic cases: 12 ordinary successes, 6 reproduce-first successes, 2 failures; a held-out conforming trace; a held-out extra-review deviation; and bounded-search/discovery counterexamples. The native result artifacts, exact requests, file digests and worker digest are in `test/fixtures/pix/evidence.json`.

These checks establish the consumer computation path, not live model behavior, actual PersonaSubstrate integration, current-cut semantics, Windows operation or long-term improvement. No LLM supplies the statistics. No Schumpeter installation is needed. The first release supports batch completed traces only; proposed live/current-cut, partial-order and model-storage contracts must be agreed with their respective owners.
