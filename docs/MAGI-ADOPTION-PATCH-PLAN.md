# MAGI reference audit and Pida implementation plan

Product-scope update, 2026-11-02: this is the historical 0.7.0 implementation batch. Its deferred items are not a complete product roadmap. [Core and home-harness requirements](CORE-AND-HOME-HARNESS.md) now track the required reusable core and complete coding/personal-assistant experience; missing basic capabilities remain unfinished work.

Decision: 2026-10-31 KST. Scope: Pida only. Analyze MAGI first, implement the applicable changes, and leave real company/model acceptance to explicit user trials. No MAGI code is copied and no runtime is replaced by this patch set.

## Baseline and sources

Pida: local `3bbdb23`, delivered branch `fix/runtime-stabilization-00-02` at `1d3345927f4a8d90c5a114356a470e0d8f2e7aaf`, package 0.6.1, Pi SDK 1.2.0. Existing Web Studio, QuickJS workbench, Pi sessions, observation archive, effect receipts and digest-bound result evidence are reused.

MAGI reference is pinned to [b3b34e75](https://github.com/sayaya1090/magi/tree/b3b34e75bd38b6b85752355ac8bc04a262e9b597). This is a source review, not a live-model benchmark or an assertion about its latest release. Read README, ARCHITECTURE, port.go and targeted loop/provider/Council/store implementations. MAGI is a Go application, not a Pi extension that can simply be installed into Pida. Its Apache-2.0 license does not remove integration or maintenance work.

## Findings and disposition

| MAGI mechanism / source | Pida gap or existing asset | Decision |
| --- | --- | --- |
| Resident daemon; ARCHITECTURE §11 | Pida server already owns runtime, but HTTP disconnect cancels a run | Add opt-in detached transport; retain explicit cancel and legacy default. Server exit still interrupts work. |
| Log-derived current activity; core/event, daemon/client | Existing traces are available but Studio leaves completed tools marked running | Derive live and restored UI state from existing bounded trace metadata. |
| Single writer per workspace; companion | Pida per-session serialization does not protect a shared host repository | Add a runtime-wide single-writer gate for the opt-in project profile. |
| Native file/shell tools, diagnostics; adapter/tool/builtin | Workbench is intentionally QuickJS/static UI only | Reuse installed Pi read/write/edit/search/shell tools behind host-selected project permissions. No new shell engine or TUI. |
| Current-state evidence; app/council_advice.go | Pida already captures artifacts at run end and marks stale checks | Preserve this; broaden actual browser checks and keep task acceptance UNKNOWN. |
| Council complete/closing; loop_gates and council adapters | Multiple LLM judgements do not supply missing browser/test evidence | Defer voting and mandatory extra model calls. Deterministic failures must remain failures. |
| Retry/stream failure classes; adapter/llm/openai | Existing Pida bounded output retry and effect receipts | Preserve no blind whole-run replay. Provider retry changes require protocol-specific evidence; do not copy a broad 400/422 retry heuristic. |
| Stable prompt prefix + mutable state tail; app/loop.go | Pida fixed prompt/tool registry already avoids UI timestamps in prompts | Preserve stable prefixes. Do not claim cache hits or fix KV cache without provider telemetry. |
| Optional provider capabilities; internal/port/port.go | Manual model IDs exist; custom headers and explicit compatibility do not | Add env-referenced headers and Pi compatibility settings for LightLLM/company gateways. Discovery failure must not imply inference unsupported. |
| JSONL event reconstruction | Pi sessions and Pida observation archive already exist | Reuse them; do not create a second event-sourced session engine. |
| rewind/fork/replay; app/query.go, fork.go, store/jsonl | Pida has artifact checkpoints and explicit session handoff | Keep conversation branching distinct from file rollback. Defer new replay UI and automatic retry of external effects. |
| Background processes; bash/bgproc | No process registry or restart ownership contract | Defer detached shell jobs. Initial project commands are bounded and cancellable; host mode is not an OS sandbox. |
| Companion/Fleet/SSH | Multi-agent organization is outside current Pida scope | Document as external harness evaluation criteria; no fleet implementation. |
| Engram skill verification and revisions | Pida skill_save/run already hashes, snapshots and retests bundles | Retain existing mechanism; no automatic memory/skill promotion. |
| S² fixed-baseline comparisons | No evidence that extra experiment loops improve our tasks | Defer auto experiments; use same task/model/budget for future candidate evaluation. |
| MCP/Lua/LSP extension ecosystem | Pi already offers upstream extension surfaces | Defer generic plugin framework; register only concrete required tools. |
| Multi-client UI/TUI | Pida HTTP/client contract already reusable | Improve Web Studio first. Do not build another terminal editor. |
| Closed-network console assets | Pida serves local assets | Keep no CDN requirement. Company TLS trust belongs to host CA configuration. |
| Documentation vs claimed verified/append-only | Existing manifests keep scoped agent tests distinct from independent acceptance | Preserve honest boundaries and record synthetic vs real-model tests separately. |

## Implementation batches

1. **MAGI-P01 — Visible execution:** bounded metadata-only timeline, tool-call pairing, elapsed/last-event time, waiting/completed/failed/cancelled transitions, trace replay after refresh. Browser regression reproduces the stale coding_guide case.
2. **MAGI-P02 — Detachable observation:** additive HTTP/client option to keep a run after stream disconnect. Legacy callers still cancel on disconnect. Explicit cancellation and runtime timeout work in both modes; no automatic resubmission on reconnect. Test disconnect, reconnect, cancellation and ownership.
3. **MAGI-P03 — Browser evidence:** backward-compatible click steps plus visibility, fill, selection, count and viewport checks; structured partial results and timeout distinction. Hash full check definition, bind evidence to actual artifact version, retain UNKNOWN task acceptance.
4. **MAGI-P04 — Upstream project tools:** explicit trusted-host project profile with pinned Pi tools, scoped file paths, independent permissions, bounded shell output/time, cancellation and shared-repository serialization. Default workbench remains isolated. Clearly identify unobserved host artifacts and the shell trust boundary.
5. **MAGI-P05 — Company endpoint:** LightLLM/OpenAI-compatible deployment support using Pi protocol options, custom header environment references, consistent discovery/inference auth and preservation of settings. Protocol fixtures, not assumed company connectivity. LightLLM and LiteLLM are separate products.
6. **MAGI-P06 — Delivery and use:** runtime capability disclosure, practical configuration/update instructions, source-linked audit and exact validation record. Keep Pi pinned; upstream replacement/fork remains an evaluation decision, not a nested runtime loop.

## Gates and exclusions

One integrated review after implementation; retest only findings and required regressions. Run TypeScript build, relevant automated tests and real browser fixtures. Record commands and environment. No claim of actual LightLLM/company connectivity or live model E2E without those credentials/endpoints. No deployment, merge, automatic upstream update, new cloud service or Schumpeter/Memory Substrate implementation. Changes go to the existing development branch/PR for local use.

Implementation and validation status will be recorded in MAGI-ADOPTION-VALIDATION.md after the code is complete.
