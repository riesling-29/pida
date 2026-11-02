# Trusted project coding

The project profile adds an existing repository alongside the private UI workbench. It reuses the pinned Pi SDK's file reading, exact edits, writes, directory listing, find presentation, and foreground shell execution. Pida still owns permissions, error classification, effects and run limits. MAGI's general-purpose tools and explicit execution state motivated this integration; its Go engine is not copied.

The host selects an existing project directory through `project` in `pida.config.json`:

```json
{
  "project": {
    "enabled": true,
    "root": "D:/work/sample-project",
    "trustedHost": false,
    "timeoutSeconds": 120
  }
}
```

This fragment is added to the existing configuration, not used as a complete file. Grant `project:read` and `project:write` to inspect and edit. Enabling shell execution requires both `trustedHost: true` and `project:execute`. `shell` can be `powershell` or `bash`; the default is PowerShell on Windows, Bash elsewhere. The shell executable, language runtime and project dependencies must already be installed. The host should use a development copy of a repository.

## Tools and scope

| Tool | Permission | Scope |
| --- | --- | --- |
| `project_read`, `project_ls`, `project_find`, `project_grep` | `project:read` | Inspect the selected repository |
| `project_write`, `project_edit` | `project:write` | Create or edit project text files |
| `project_shell` | `project:execute` | Foreground build/test commands with host privileges |

File tools reject paths outside the root, symbolic links, hard-linked files, `.git`, `.pida`, `.env`, and `.env.*` at any depth. The host additionally supplies protected configuration/state paths. File contents are limited to 4 MiB; binary reads are rejected. Search skips dependency/build folders, limits traversal to 10,000 entries / 2,000 files, and does not implement `.gitignore` semantics. `project_grep` requires installed `rg` on PATH and never downloads it. It returns at most 200 lines. Tool responses are bounded and may be truncated.

These file checks are not OS-level isolation against a hostile concurrent process replacing directories. **Shell execution is trusted host execution, not a sandbox.** Its working directory does not restrict filesystem or network access. It can read files outside the project and use programs already installed under the host account. Pida strips provider tokens and arbitrary environment variables from the child environment, but programs can still read credentials from accessible files or OS stores. Use OS/container isolation when that is required.

The shell environment retains ordinary executable paths, temporary/home/profile paths and Windows system variables. It excludes arbitrary inherited secrets and startup injection variables such as `NODE_OPTIONS` and `BASH_ENV`. Do not send secrets in commands. Command output is conversation data and can contain whatever the program prints; metadata traces only contain sanitized status codes, not command/output text.

## Results and recovery

The shell timeout is 1–600 seconds, defaults to 120, and is an upper bound for model requests. Pi propagates cancellation to the process tree. No managed background jobs or persistent development server lifecycle is offered by this patch; do not request detached commands.

An exited command is recorded as executed even when its exit code is nonzero: it may have changed files. A timeout, cancellation or uncertain launch error returns an unknown effect requiring inspection before retry. Neither cancellation nor a failed test rolls back project files. Inspect changes before retrying.

Repeated identical shell calls are not labeled idempotent. A host-owned mutation generation changes only after a project file tool actually changes content, allowing the same test command after a repair. A no-op write does not clear replay protection. Changes made by shell commands or by another application do not advance this generation; inspect such cases and start a new user request rather than blindly replaying within the same run.

Project files are separate from the private workbench and the service preview. Current workbench snapshots, diffs, restore and manifest artifact hashes do not cover arbitrary project files. A successful command exit code alone does not produce independent VERIFIED status. Reports must identify commands run and any verification limitations. UI preview remains for self-contained `app/index.html` in the workbench; React/dev-server previews are not added here.

## Acceptance test

Use a disposable repository with a small failing unit test. Ask Pida to read its instructions, reproduce the failing test, edit the smallest necessary source change, run the test again, and report the actual command and exit code. Inspect the repository diff. Test cancellation separately on a disposable long-running command. Linux fixtures execute real Node commands through Pi; Windows PowerShell and the company endpoint still require testing in the user's environment.
