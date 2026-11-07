# Windows runtime corrections — 2026-11-07

Owner: `/root/pida_owner/windows_runtime`. Worktree:
`D:/ChantaResearchGroup/pida-win-runtime-20261107`, branch
`fix/windows-runtime-20261107`, baseline
`a3ba7619eea6946873a313871febb100d0220273`.
This is a bounded pida implementation record, not desktop or cross-app acceptance.
No provider call, user workspace, global Git setting or credential was used.
The source/evidence manifest beside this report identifies the tested bytes.

## Observed failures and changes

1. The native program in `project-tools.test.mjs` exited 7; Pi's PowerShell
   `-Command` wrapper returned 1. The shared pida PowerShell adapter now explicitly
   propagates the final native failure code, preserving explicit `exit` and final
   successful statement semantics. Foreground and managed execution use the same
   adapter and retain Pi's cancellation/cleanup driver and environment filtering.
   Compound PowerShell scripts needing a particular earlier program's result must
   capture it and explicitly `exit`; this is not an AST-based provenance analysis
   of every cmdlet/native statement.
2. Actual async readers opened the turn OCEL cut, and Windows returned `EPERM`
   when the synchronous final checkpoint replaced it. The JSONL source had
   `run_finished`, but the materialized file did not. Finalization now awaits
   bounded yielding retries (5, 10, 25, 50, 100 ms) only for Windows sharing-like
   errors (`EPERM`, `EACCES`, `EBUSY`). It does not delete the old file. Permanent
   errors receive no retry. Exhaustion retains `OCEL_CHECKPOINT_UNAVAILABLE` in
   persisted archive health and after reopen. `bundle.complete` still describes
   the source JSONL/manifest; optional projection failure does not rewrite the
   model execution result. Runtime finalization and interrupted-run restoration
   both await this boundary.
3. The existing agent HTTP test failed Git initialization with `Filename too
   long` creating a hook template. Scoped `core.longpaths=true` fixed that but
   exposed Git's absolute `$GIT_DIR too big` guard during commit. Using explicit
   sibling-relative Git/worktree paths from the owned files directory fixes both
   observed cases, without changing configuration outside the invocation.

## Verification

Environment: Windows, Node 24.18.0, Git 2.55.0.windows.3, Windows PowerShell
5.1.26100.9711, pinned Pi packages 1.2.0. `npm run build` passed.

Baseline command (unmodified baseline source):

```powershell
node --test --test-timeout=20000 --test-name-pattern='real project shell|foreground shell|native Pi turns|agent HTTP routes' test/project-tools.test.mjs test/ocel.test.mjs test/agents-http.test.mjs
```

[before.log](windows-runtime-evidence-20261107/before.log): 4 tests, 1 pass and
the 3 described failures. Diagnostic instrumentation only wraps filesystem
rename and Git subprocess calls; it is not part of production execution.
[diagnostic.log](windows-runtime-evidence-20261107/diagnostic.log) and
[longpaths-intermediate.log](windows-runtime-evidence-20261107/longpaths-intermediate.log)
retain the underlying errors. The original review's independent before logs
remain in `D:/ChantaResearchGroup/pida-review-delivery-20261107`.

Final regression command:

```powershell
node --test --test-timeout=30000 test/windows-runtime.test.mjs test/project-tools.test.mjs test/ocel.test.mjs test/agents-http.test.mjs test/workbench.test.mjs test/commands.test.mjs test/commands-http-ui.test.mjs test/workspace-commands.test.mjs test/audit-storage-display.test.mjs
```

[after-final.log](windows-runtime-evidence-20261107/after-final.log): 55 tests,
51 pass, 2 fail at existing fixture `symlink()` creation with Windows `EPERM`,
2 existing POSIX-only skips. Neither symlink fixture was changed or skipped by
this work. This is not a green full suite claim. The two failing tests are
`file boundaries reject symlinks, hardlinks and binary input` and
`workspace permissions, principal isolation, traversal, links and total quotas
are independently enforced`.

[windows-focused.log](windows-runtime-evidence-20261107/windows-focused.log):
all 5 new regressions pass. They cover native code 7/0, explicit exit 19,
PowerShell cmdlet failure and successful final statement, owned nested Git
write/read/reopen, transient terminal rename sharing, persistent sharing
exhaustion with six attempts, and permanent EIO with one attempt. The latter
three use explicit synthetic filesystem faults in an isolated child process;
the existing OCEL test separately exercises real concurrent reads and a scripted
Pi run. Actual command execution, Git, filesystem and HTTP behavior are real;
no live model was used. Existing cancellation, environment exclusion,
observation loss, ownership and persistence tests passed in the final run.

## Remaining limits and falsification

- Git for Windows still fails before per-invocation longpaths takes effect when
  `history.git/config` itself is too long, and very long working directories can
  fail process launch. Earlier over-deep probes intentionally remain in
  `path-boundary.log`, `deep-path-intermediate.log` and `git-cwd-probe.log`.
  The passing regression has a 239-character working directory, a configuration
  path below 260 characters, and a 277-character Git template path on this
  machine. Use a short host workspace root; arbitrary-depth support is not
  claimed. A host preflight/more scalable path layout remains future work.
- A permanently unavailable OCEL destination remains unavailable; the source
  bundle and its persisted known limit must be inspected. Retries are not a
  transactional multi-file snapshot or proof of all disk failure recovery.
- The source-copy environment and existing Windows symlink restrictions remain
  material; Linux behavior has not been independently rerun in this unit.
- Reopen without the materialization failure limit, a completed run with stale
  terminal OCEL after a recoverable reader releases within the retry window, or
  loss of expected native exit status falsifies the corresponding correction.
  Regressions in owner isolation or cancellation also withdraw acceptance.
  Evidence applies to these exact sources/dependency versions as of this date;
  changed Pi/Git/OS versions require relevant checks again.

Bounded result: the three reproduced defects are corrected in the tested
environment, with the declared deep-root and fixture restrictions unresolved.
Next action is independent review and parent cherry-pick before desktop join.
