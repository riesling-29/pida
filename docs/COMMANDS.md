# Managed project commands

Trusted-host projects have `project_command_start`, `project_command_read`, `project_command_wait`, `project_command_cancel`, and `project_command_list`. Existing `project_shell` remains available for bounded foreground commands. The new commands reuse the installed Pi `createLocalBashOperations` / `createLocalPowerShellOperations` driver; no second model loop or replacement shell engine is introduced.

`start` returns a command ID after persisting admission. This is not a completion claim. The command owns its execution lifetime independently of an individual model turn or HTTP wait. A `waitTimeoutMs` only ends that wait; `deadlineMs` is a separate execution deadline that requests cancellation. Start requests can carry a host request ID to recover the same handle without executing again. Start the command in the foreground inside its managed shell; do not add `&`, daemonize it, or start an untracked server.

`read` returns `{ command, output }` with a caller-supplied byte offset and `nextOffset`. Every reader has its own cursor: UI polling does not consume model output. The default Pi driver combines stdout/stderr, so the result explicitly says `outputStream: combined`. Live tails are bounded, UTF-8 character boundaries are preserved, and completed large output can use the private output store. `lossy` reports missing observed bytes. Returned output is not automatically a verification result.

`cancel` returns `requested` and `stopping` while Pi is still settling. The final status distinguishes completion, nonzero exit, cancellation, execution deadline, interrupted host ownership, and unknown cleanup. `close()` requests cancellation of owned active commands and waits for settlement. If the driver fails to settle within the cleanup bound, the handle becomes `unknown`; this does not prove the process stopped. An individual wait's AbortSignal cancels only that wait.

Commands require `project:execute` to start/cancel and `project:read` to inspect. Every handle is bound to a principal and session. Model arguments cannot change the workspace, environment, executable backend, or command state directory. Provider/OAuth environment variables and shell startup injection variables are excluded from the inherited command environment. This is a trusted-host execution policy, not a filesystem sandbox.

Project file writes and foreground shell execution are blocked while a managed command is active or requires recovery. Host applications must apply the same guard to other mutators of the shared project, such as approved program proxies or project Git operations. They must also coordinate starting a command with their existing active-run lease; the command manager itself cannot discover unrelated host writers.

The bundled workspace connects those guards before effect admission for all changing tools, including extension/MCP/program tools. A later request in the same owned session can inspect or cancel its running command; other sessions cannot acquire the project run lease. Unknown command state blocks subsequent runs until explicit command recovery. Deletion and compaction/handoff of a session with active or unreconciled commands are rejected. Cancelling a workspace run also requests cancellation of its same-session commands when the principal has execution permission. Commands may outlive a normally completed model run, so inspect the command panel rather than inferring completion from the chat response.

The main workspace, Studio and agent job views include an owned command panel with independent output cursors. Authenticated HTTP/SDK methods list, read, cancel and acknowledge inspected command recovery. There is deliberately no HTTP start endpoint: launch stays in the existing authorized Pi tool/run path. A command recovery acknowledgment does not resolve an unrelated effect-ledger receipt.

On restart, an unfinished saved handle becomes `interrupted` with `COMMAND_PROCESS_LOST`, `directExited: unknown`, and `rangeExited: unknown`. It is never automatically re-executed, reattached by PID, or treated as completed. Cancellation/deadline/unknown outcomes require inspection before further managed project writes. After inspecting actual files and processes, the host recovery API can call `acknowledgeRecovery`; it requires `pida:recover` plus ownership and project execution permission and is not registered as a model tool. Acknowledgment does not change the recorded outcome or claim process termination.

## Actual executor capabilities

| Capability | Pi local backend |
| --- | --- |
| Bash / PowerShell command execution | Uses the installed Pi operations; PowerShell requires Windows and an installed executable |
| Direct command outcome | Exit code or explicit failure; never equated with independent verification |
| POSIX cancellation | Pi process-group kill, best effort; ordinary descendant cancellation is tested on Linux |
| Windows cancellation | Pi System32 `taskkill /F /T`, best effort; not runtime-tested here |
| Managed range exit proof | Unavailable; `rangeExited` remains `unknown` |
| PTY / interactive stdin / resize | Unsupported by this manager release; PTY requests are rejected before launch |
| Filesystem/network sandbox | Default is `none`; requested unsupported policies are rejected before launch |
| Resume running OS process after server restart | Unsupported; saved handle reports interrupted ownership |

Escaped process groups, detached descendants, or descendants retaining inherited pipes can exceed Pi's cleanup guarantees. The package does not claim Windows Job Objects, Linux cgroup ownership, native PTY isolation, or network confinement. A host-owned `ProcessExecutor` can implement an additional sandbox policy; Pida passes the policy to that selected adapter and never silently downgrades it. No optional native executor is installed by this patch. PTY remains rejected until a complete interactive handle contract is implemented even if a supplied adapter has an underlying PTY facility.

## Host integration

`createProjectTools(config, { commandStateDirectory, commandExecutor? })` returns `commands` alongside `tools` and `prompt` for trusted-host projects. Select a private directory under the workspace state root, register the returned tools for both main and agent runtimes, expose owner-checked command operations through the existing authenticated transport, and await `commands.close()` on workspace shutdown. Protect the command state directory from project file tools.

`createWorkspace()` performs this wiring automatically and exposes `commands` for trusted host embedding. A supplied `createWorkspace(directory, {commandExecutor})` selects the optional host adapter without changing the agent loop. A default project still uses Pi's local backend. Private command state stays under the selected workspace's state directory, including when the project is elsewhere.

The manager's host methods are `start`, `read`, `wait`, `cancel`, `list`, `acknowledgeRecovery`, `capabilities`, `hasActive`, `hasRecoveryRequired`, `assertCanMutate`, and `close`. `capabilities()` describes the selected backend and the manager's actual exposed functionality. The in-process adapter is selected by trusted host code; no model-supplied module import is supported.

Focused tests use real Node commands through Pi for long execution, wait/deadline separation, owner and permission checks, provider-environment exclusion, UTF-8 output, ordinary POSIX descendant cancellation, shutdown, actual host SIGKILL and interrupted restoration, plus a scripted Pi model flow that calls start/wait/read. Native Windows execution, escaped-descendant containment, PTY, and sandbox enforcement are not validated by those tests.
