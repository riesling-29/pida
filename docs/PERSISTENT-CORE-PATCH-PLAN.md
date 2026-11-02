# Persistent Core patch plan — 2026-11-02

Baseline: local `fix/runtime-stabilization`, `529d992`, package 0.7.0, Pi SDK 1.2.0. Remote review branch: `fix/runtime-stabilization-00-02`, PR #1. This plan extends the existing Pi runtime; it does not replace its model/tool/session loop.

## Product contract

Pida has two consumers: hosts embedding a generic agent core, and the bundled personal/coding harness. Persistent agents retain identity, sessions and pending work without continuously calling a model. The server process must remain running for execution. A restarted process may resume queued work, but must not silently replay an interrupted side effect.

Three memory tiers describe purpose, not a TTL. Persona memory is versioned and correctable. Long-term experience records sources and corrections. Short-term memory is a durable information state: goal, understanding, relationships, uncertainty and next action. Its causal succession/branch/merge is separate from the job lifecycle. No process-mining engine or external Memory Substrate is added.

## Implementation batch

| Patch | Concrete change | Completion evidence |
| --- | --- | --- |
| PC-01 | Export UI-independent memory/supervisor/connector contracts, preserve existing runtime APIs and host authorization | Embedded imports, build and regression tests |
| PC-02 | Atomic three-tier memory, persona history, sourced experience corrections, information-state parents/CAS/branch/merge, bounded context and memory tools | Reload, ownership integration, conflict and source tests |
| PC-03 | Durable agent registry, separate Pi sessions, bounded job queue, concurrency and shared-project single writer, idempotent submission, pause/cancel and restart reconciliation | Three agents, duplicate requests, cancellation and interrupted-restart scenarios |
| PC-04 | Bind actual project AGENTS.md/explicit skills, Pi steering/follow-up, and per-run memory projection | Scripted real Pi SDK tests; stale-run rejection |
| PC-05 | Private host-installed provider connector contract, no credential/protocol assumptions or silent provider fallback | Local connector fixture, path/version/error-redaction checks |
| PC-06 | Authenticated HTTP/SDK operations for agents, memories, queue, artifacts and project files/diff | HTTP owner/permission tests and durable reconnect scenarios |
| PC-07 | Working persistent-agent tab, visible live job evidence, memory editing, project file/change inspection and disconnect continuation | Browser when available; JS syntax and API integration checks separately reported |
| PC-08 | One integrated review, targeted corrections, documentation, version 0.8.0 and review-branch delivery | Exact commands/results, remaining limits, PR commit/tree verification |
| PC-09 — added during implementation | Repository program discovery → deterministic proxy contract → host activation with pinned source/executable → callable Pi business tool; CLI, HTTP/SDK and catalog UI | Real child-process/stdin/output/cancellation tests, actual npm/Node fixtures, source-change rejection and targeted integration review |

PC-09 carries forward the user's Chanta-Core notion of controlling external tools/programs. It adds execution adapters to Pida, without importing Schumpeter's control plane or the historical contract-only/non-dispatching restrictions into this newly authorized runtime feature. Discovery itself never imports or runs repository code. Node bins, npm scripts and explicit manifests have usable proxy paths; Python entrypoint discovery is reported as adapter-required until an actual executable/input/output contract is supplied.

## Reuse and responsibility

Pi 1.2.0 supplies the execution loop, providers, sessions, compaction, stream events, project tools and steer/follow-up primitives. MAGI's workspace ownership, durable execution, evidence distinctions and isolated companion patterns inform the supervisor boundary. Codex's explicit run/item identity and guarded steering inform the transport. New glue is identified as Pida code; no upstream implementation is claimed to have been copied unless source and license notices are actually included.

The present batch keeps one Pi owner per run. Codex exec-server/app-server are separate future integration choices, not an invisible nested executor. A private connector remains trusted host code; file path checks do not sandbox imported JavaScript or a trusted host shell.

## Deliberate follow-on work and gates

These are product requirements, **not claims that this batch already provides Codex/OpenClaw parity**:

- Native process executor with live stdout/stdin/PTY and enforceable sandbox: pin an available Codex exec-server build/protocol, test cancellation and disconnect, retain license notices. Do not substitute an unsandboxed shell while labeling it sandboxed.
- MCP package lifecycle, channels (messaging/mail), schedules and unattended triggers: install/enable host-approved adapters and exercise actual end-to-end paths. A tool registry alone is not a shipped channel.
- Per-agent host-defined model/tool/project presets, credential isolation and operational service installers across Windows/Linux.
- Full upstream update automation: pinned dependency/fork changes through a compatibility-tested review branch; upstream merges are not presumed conflict-free.
- Actual model/company gateway and browser evidence: use available authorized environments. Mock/scripted protocol fixtures do not establish model quality, company authentication compatibility, or browser behavior.

No organizational Mission Loop, PIX/OCEL engine, external shared-memory platform, automatic persona rewriting, public deployment or main-branch merge is included.
