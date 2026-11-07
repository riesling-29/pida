# Independent host observation TUI wrapper review

Original source: `495f6f6877aa5836ebd9f839462984d8bb806a7b`.
Corrected source: `8bf35c47091af4623ab88d4c666628f0d2657601`.
Reviewer: `/root/pida_windows_review`, separate-context, same Codex model family.
Date: 2026-11-07. Environment: Windows, Node 24.18.0.

An isolated detached worktree was installed and built from the pinned npm lock. The original and corrected actual-host tests were independently run. No implementation files, user runtime/configuration, real provider credentials or GUI were changed. Tests launched disposable synthetic hosts and a deny-by-default local policy server.

## Finding and correction

**P2, fixed:** The original method-only GET guard did not establish managed-state immutability. On a fresh paused agent, `connection.client.getAgentWorkbench(agent.id)` used the same endpoint as the inherited Files inspection and sent only GET. Nevertheless, the host lazily created its workbench, Git repository and initial commit. The independent probe observed zero attach changes, **45 new paths** after Files inspection, and one history entry. The original developer assertion checked four existing files and missed these new paths.

Evidence remains unchanged in `read-state-probe.mjs`, `read-state-probe-result.json`, `read-state-probe.log` and its command record. This was not an authority escalation or second process writing runtime state: it was a preexisting host-owned lazy initialization reached through an ostensibly observational route.

The correction uses an explicit allowlist of noninitializing reads: host info/capabilities, agent inventory/overview/profile and native job list/detail. Files, tools, exports, recovery and memory detail GETs are rejected locally with definite 403. Existing server APIs retain their semantics. Source inspection confirmed allowed supervisor getters return existing state copies; the observer does not open a new workspace/runtime.

Independent `read-state-fixed-probe.mjs` repeats the original scenario against the corrected source. Files inspection is denied before HTTP, only the initial capabilities/info requests occur, and the entire managed tree remains byte-for-byte/path-for-path unchanged. The updated actual-host regression also passes with full-tree snapshots, controller Files inspection, unsupported detail requests, blocked submit/create/cancel/resume, wrong-host/token rejection, and a queued job completing under its original owner after observer detach.

## Further independent evidence

`network-fixed-probe.mjs` independently verifies:

- An actual HTTP redirect is rejected; the destination receives zero requests.
- Wrong capability schema, wrong host and disabled collaboration fail before info/UI setup.
- Seven malformed/non-loopback/credential/query/path/fragment endpoint forms are rejected before fetch.
- Five mutation APIs reject before HTTP with definite 403, rather than uncertain-delivery state.
- Closing the observer aborts subsequent reads while the original server remains available.
- Invalid entrypoint arguments produce only the static failure message, without the synthetic token or configured URL.

`layout-probe.mjs` verifies separate UI persistence, rejection of relative paths, UTF-8 byte limits, malformed JSON preserving the prior layout, invalid scope rejection, hardlink load/save refusal and ancestor junction refusal. These are actual disposable Windows filesystem operations.

The public `runAgentTerminal` and `PidaClient` remain reused. The inherited TUI closes its controller and view on Ctrl+D/signals/EOF; the wrapper closes only its own request lifetime. No generic job creation, cancellation, runtime continuation or managed configuration write is performed by the wrapper's allowed operations. The tested detach proof uses the actual host and client/controller; physical terminal rendering and signal delivery through the final PTY remain separate integration gates.

## Evidence scope and remaining limits

Source/test hashes and all review scripts, command records, logs and result hashes are listed in `evidence-hashes.json` and `source-hashes.json`. Original failed evidence is preserved beside corrected evidence. The corrected worktree is clean.

This is **host-wide observation**, not organization-scoped authorization. Its private transport credential retains host-wide authority; the local UI guard is not a server-side restricted token. The parent must provide current credentials through the private environment and select a separate parent-owned layout directory. The wrapper does not infer that directory from the managed workspace.

No fullscreen/native keyboard/IME/resize, packaged Node runtime, Linux desktop, live model, performance or entire product acceptance is claimed. Unsupported detail controls may remain visible but fail explicitly; Schumpeter must supply its separate authorized task/detail UI. No claim is made that concurrent legitimate host execution stops modifying its state while observed.

Reopen the verdict if an allowed read initializes managed state, a blocked write/detail request reaches HTTP, detach cancels host work, a redirect leaks the private credential, identity mismatch opens the UI, or source/dependency/route semantics change. Validity is limited to these exact bytes and the tested synthetic Windows environment.

**Verdict: PASS after correction for the bounded host-wide observation TUI wrapper.**
