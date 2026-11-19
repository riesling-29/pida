# Independent Windows runtime review

Reviewed source: `c8a19f7002bb61a2836e039500091dc6e26694fb`.
Before source: `ebd22ef6b5922525201d00db849358ebdf787404`.
Reviewer: `/root/pida_windows_review`, separate-context, same Codex model family.
Date: 2026-11-07. Environment: Windows, Node 24.18.0, Git 2.55.0.windows.3.

The two sources were checked out into separate detached worktrees and built independently with the pinned npm lock. No implementation, global Git setting, user runtime, credential or native GUI was edited or used. Only disposable review fixtures were executed. Both source worktrees remain clean.

## Observed before/after evidence

The same four targeted tests were run in both worktrees:

`node --test --test-timeout=30000 --test-name-pattern="real project shell|foreground shell|native Pi turns|agent HTTP routes" test/project-tools.test.mjs test/ocel.test.mjs test/agents-http.test.mjs`

- Before: 1 pass, 3 failures. The native PowerShell command returned 1 instead of 7; the physical materialized OCEL file omitted the final run event; agent workbench initialization failed with `GIT_OPERATION_FAILED`.
- After: 4 passes. Native exit and environment exclusion, actual concurrent-read OCEL materialization/reopen/HTTP ownership, agent authorization and foreground timeout/cancellation assertions passed.
- Evidence: `baseline-core.log/json`, `fixed-core.log/json` in this directory. The OCEL assertion compares the actual on-disk JSON with the exported final document. Its model is scripted; this is not a live-model acceptance claim.

Additional changed-area regression command:

`node --test --test-timeout=30000 test/windows-runtime.test.mjs test/commands.test.mjs`

Result: 11 pass, 2 existing POSIX-only skips, no failures. These tests cover native 7/0 and explicit 19 exits, final PowerShell statement semantics, nested Git storage, transient/persistent/permanent projection faults, restart-visible materialization limits, actual command output/cursors, replay protection, permissions and cancellation/deadline behavior. Logs: `fixed-regressions.log/json`.

The independent `independent-probe.mjs` additionally exercised:

- Native process exit **3010** with stderr retained.
- Unicode artifact write, subsequent modification, exact Git restore and removal of a later file.
- Reopened content and isolation of another principal.
- A representative disposable host/agent layout with working-directory length 224, Git config path 237 and template path 262 characters.
- User Git configuration hash unchanged before and after the probe. No configuration contents are exported.
- All 7 source hashes and 11 historical evidence hashes match the author's manifest.

The exact paths, hashes and assertions are recorded in `independent-probe-result.json` and `independent-probe.log/json`. This path is representative; the desktop's final host-layout default was not frozen in this review and is not declared accepted.

## Source assessment and limits

No additional material defect was found in the five implementation-file changes. PowerShell uses the existing Pi execution/cancellation driver and introduces no alternate process tree. The documented compound-script limitation remains: a script needing an earlier native result must explicitly capture and exit with it. The relative Git directory is explicitly derived from the owned sibling directory; long-path configuration is invocation-scoped. Source ownership/path validation is retained.

The OCEL retry path yields only for Windows sharing-like errors and remains bounded. It never deletes the previous checkpoint. Persistent failure remains visible after reopening through the health record; source bundle completeness remains distinct from optional OCEL projection availability. This is not a transactional OCEL-plus-metadata write or general power-loss proof.

Unresolved scope remains explicit: arbitrary deep Windows Git roots, finalized desktop host path, Linux runtime regression execution, symlink-capability fixtures, unrelated full-suite timing/fixture failures, live model execution and packaged desktop acceptance. The full suite was not rerun or declared green. The reviewed tests used temporary synthetic data and the scripted model only.

Reopen this verdict if relevant source/dependency versions change, a final OCEL remains stale after a reader releases within the retry window, exhausted projection failure disappears after restart, native exit propagation fails in the documented command subset, Git restore loses bytes or owner isolation regresses. Evidence is valid only for the pinned source and observed environment.

**Verdict: PASS for the bounded Windows shell/terminal-OCEL/Git corrections.**
