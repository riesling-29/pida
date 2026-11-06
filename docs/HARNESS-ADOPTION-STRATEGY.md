# Pida harness strategy: reuse, evaluate, replace

Updated scope, 2026-11-02: [CORE-AND-HOME-HARNESS.md](CORE-AND-HOME-HARNESS.md) defines the two required products: a reusable core and a complete home coding/personal-assistant harness. The minimal interfaces and deferrals below describe earlier adoption stages; they are not permission to omit required user capabilities. Reuse remains the implementation strategy, and full user workflows remain the acceptance standard.

Decision date: 2026-10-28 KST. Direction supplied by minero, including the explicit clarification that this conversation and work scope are Pida only. This changes the development strategy; it does not assert that a new backend, fork, updater or integration is already implemented.

## Objective and ownership

The user's larger project is Agent Legion Engineering based on Schumpeter and Memory Substrate. That explains why Pida should reuse replaceable coding harnesses instead of becoming a separate coding-assistant development program. It does not authorize developing Schumpeter, Memory Substrate or agent-organization infrastructure in this workstream.

Pida's original product goal remains: see the real application beside a conversation, request a change, have a coding-capable agent implement and check it, inspect the result, and continue or recover. Coding-assistant capability is essential to that product. Reusing the coding engine does not reduce Pida to a backend connector.

The scope here is Pida: delivering that visual development experience, adopting an existing coding environment, maintaining a small integration surface, tracking upstream updates, and making replacement practical. Whether general coding work belongs in the expanded Web UI or an existing TUI is an empirical product decision; see [INTERFACE-DIRECTION.md](INTERFACE-DIRECTION.md). External systems appear below only to clarify responsibility boundaries.

The user directs goals, desired outcomes and material tradeoffs. Engineering owns dependency selection, adapter implementation, routine compatibility work and verification. The user should be able to adopt a working tool or discard a poor one without becoming its internal maintainer.

| Component | Responsibility |
| --- | --- |
| External coding harness (OMP, Pi, or a better candidate) | Coding loop, editing/search, shell/build/test facilities, TUI, language tooling and harness-specific optimizations |
| Pida product interface | Visible application/project context, natural-language direction, preview/change inspection, verification status and recovery interaction |
| Pida integration boundary | Explicit task invocation, capability mapping, applicable execution policy, cancellation/result handling, and observed evidence export |
| Schumpeter / Operations (external context, out of scope) | Agent coordination, mission state, process intelligence and experience reuse |
| Memory Substrate (external context, out of scope) | Persistent memory/identity/context continuity independent of one replaceable harness |

The existing Pi-based runtime is a usable backend and an integration asset. It is not a requirement to reproduce every capability of OMP inside pida-core. Existing PATCH-00–08 implementation and its documented acceptance limits remain unchanged.

## Adoption order

2026-11-02 clarification: direct source reuse/vendoring and ports are explicitly allowed alongside forks, packages and native executables. Prefer the smallest maintained upstream implementation that fulfills the whole capability; do not default to reimplementing from inspiration. Keep source/version provenance, applicable LICENSE/NOTICE/third-party terms and clear modifications. Reuse must reach the user's actual execution path and interface.

1. Use a pinned upstream release with configuration and existing extensions when sufficient.
2. Actively use a fork when we need a controlled distribution, a small fix, or a reproducible upstream-sync branch. Keep the upstream delta small and explicit.
3. Connect through supported SDK, RPC, ACP or other documented interfaces when the application needs integration.
4. Add narrowly scoped code only for a demonstrated requirement that cannot be met by those mechanisms.
5. Replace a candidate whose compatibility burden or task quality outweighs its value. Avoid sunk-cost expansion into maintaining a second coding platform.

OMP is an initial evaluation candidate because it already supplies the requested coding/TUI surface. This is not a selection or performance verdict. The existing Pi backend remains available; alternative tools can replace either candidate when actual outcomes justify it. No fork repository has been created by this decision.

Do not run the same work through nested agent loops just to label an external harness as Pida. Each attempt has one execution owner. External backend failures must not cause blind replay through another backend when changes may already have happened.

## Upstream update policy

A fork provides a controlled place to track upstream; it does not make conflicting modifications automatically compatible. The intended workflow is:

- Track an explicit upstream release/ref and keep the current accepted revision pinned.
- Fetch upstream changes into a candidate branch automatically and generate a reviewable update with its source/version and dependency changes.
- Run a small contract and representative task suite against that candidate.
- Adopt passing candidates under the deployment's authorized promotion policy; retain or restore the previous revision on failure.
- Treat repeated conflicts or expensive compatibility repairs as a reason to remove our patch or replace the candidate, rather than making the user supervise source-level maintenance.

Prefer upstream fixes or external extensions over long-lived core edits. Keep state migration and rollback separate from source synchronization: reverting code does not necessarily undo a changed session format. Backend-native sessions may need to stay pinned to their original backend/version. Preserve portable tasks, artifact/evidence references and Memory Substrate records without promising arbitrary transcript interchangeability.

This updater/CI flow is a design decision only. No scheduled synchronization, automatic merge, deployment or new permission grant is enabled here.

## Minimal integration contract

Implement only what the first real integration requires: start a task, stream supported events, cancel, obtain an outcome and artifact/evidence references, and identify the exact backend/version. Expose a capability declaration for resumption, tool-level authorization and event visibility. Unknown or unsupported capabilities must stay explicit.

Pida's current per-tool permission checks and effect receipts do not automatically govern an external process. An adapter must either connect real enforcement to the external tool boundary or declare that the guarantee is unavailable and use an appropriate host execution boundary. Never infer success, verification, cache hits or tool events from missing telemetry.

Reuse the existing observation/manifest contracts where facts are actually captured. Do not copy all backend transcripts into a new canonical memory store; Memory Substrate owns durable cross-backend continuity. Do not introduce a universal adapter framework before a concrete second backend requires it.

## Acceptance and discard criteria

Evaluate candidates on representative company work with the same model/backend and comparable budgets: a bug fix, a small feature, a multi-file change and a failure/restart case. Record actual test outcomes, regressions, completion time, user interventions and available usage/cache metadata. Mark unavailable observations unknown. Expand evaluation only when it resolves a concrete selection risk.

Accept a candidate when it performs the required work and fits the deployment's actual constraints. Discard or defer it when repeated failures, fragile upgrades, missing execution boundaries, or ongoing custom development exceed the benefit. No claim of being better than OMP follows from adding features or passing synthetic runtime tests.

User-facing reports should answer: does it work for our tasks, what improved or regressed, what cannot be verified, and should we keep, roll back or replace it? Routine code-level choices stay with engineering.

## Revised next work

This supersedes the conversational PATCH-09–13 proposal as a standalone in-house coding-profile/TUI/LSP development program. Those items were proposals, not implemented patches.

1. Establish the actual company LiteLLM/model connection and reproduce the reported cache symptom. Keep infrastructure/cache diagnosis separate from coding-harness quality.
2. Evaluate a pinned existing harness with its tools and existing TUI as a working baseline. Compare extending Pida's Web UI for general coding with reusing that TUI; do not assume a custom TUI must be built. Reuse configuration and packages first; use a minimal fork only when it serves a concrete need.
3. Connect the successful candidate to Pida through the smallest supported interface needed to observe and control real tasks. Preserve Pida's export boundary for future external integration.
4. Add candidate-update checks and rollback handling once the backend and acceptance cases are known.
5. Evaluate Pida by whether it reliably supplies useful execution, evidence and replaceability to the larger project. Work on external systems requires a separate task in their own context.

Do not pre-build a new terminal editor, shell, patch engine, LSP/debugger stack, coding-agent scheduler or model SDK. A demonstrated missing capability may justify a bounded extension; it is not a default roadmap item.
