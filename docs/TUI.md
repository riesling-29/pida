# Terminal and Web on the same Pida host

Available from 0.8.7. The terminal uses the existing Pi TUI 1.2.0 components and
Pida HTTP client. One separately running host owns sessions, Pi execution,
provider/OAuth configuration, tools, permissions, persistence and workspace
locks. Web and TUI are views of that same host.

## Start and attach

After updating this checkout, run `npm run build`. Keep the host running in one
PowerShell terminal:

```powershell
cd D:\pida
npm start -- .\my-agent --open
```

Open another terminal:

```powershell
cd D:\pida
npm run tui -- .\my-agent
```

An installed CLI also supports `pida tui ./my-agent`. It attaches to the newest
accessible main-workspace session or creates one when none exists. `--new`
creates a new session; `--session UUID` opens a specific existing session.
`/sessions` or F2 selects another session. Never start a second host against the
same locked workspace just to open another interface.

The CLI reads the selected workspace's existing application token and local
port; no token needs to be copied into the terminal. Model credentials remain
with the host, so existing ChatGPT, local endpoint and private connector
configuration is reused. Provider settings remain in Web (`/web`), or the
existing `pida configure` flow. The TUI does not replace a company's connector.

## TempleOS-inspired interaction

This follows the user's supplied interpretation of the Pitano/TempleOS thread,
the prior 2026-10-28 Pida discussion and [interface direction](INTERFACE-DIRECTION.md).
The requested original `pitano: 따라잡기` conversation could not be independently
retrieved in this turn; no additional original-source claims are inferred.

The design aims to preserve the information needed for active judgment while
removing repetitive presentation. It does not reproduce 640×480, a fixed
16-color appearance or artificial inconvenience, and it does not claim a proven
cognitive benefit or establish Terry Davis's motives.

| Principle | Implemented behavior |
| --- | --- |
| Expose structure | Stable target/model header, session/title, conversation, execution/context status and input |
| Remove redundant presentation | No dashboard tiles, animated progress theater or repeating success badges; details open on demand |
| Keep meaningful decisions explicit | Normal request, steering, follow-up, cancellation and client detach are separate commands |
| Keep evidence inspectable | `/diff` shows actual Git changes; `/tools` shows recorded output and exit codes; `/activity` shows traces and manifest verification separately |
| Preserve direct work | Keyboard shortcuts, slash completion, multiline editor, bracketed paste and upstream Unicode/IME cursor handling |
| Adapt density | Side-by-side conversation/details at 100+ columns; one detail surface at narrower widths; Escape or `/back` returns to conversation |
| Reduce routine effort | Session attach and observation reuse server state; no duplicate model run or per-tool confirmation loop |

The accent follows the terminal palette; `NO_COLOR=1` disables Pida's decorative
colors. Status is written in text as well. Untrusted model, file and tool content
is stripped of terminal control sequences before display. Message and panel
display limits are explicit; they do not truncate the server's saved history.

## Commands and controls

| Operation | Control |
| --- | --- |
| Submit / newline | Enter / Shift+Enter or Alt+Enter (terminal support varies) |
| Sessions / new / exact resume | F2 or `/sessions`, `/new`, `/resume UUID` |
| Execution and verification | F3 or `/activity` |
| Recorded tool results | F4 or `/tools` |
| Project files / file content | `/files [directory]`, `/read path` |
| Git changes | F6 or `/diff` (requires the configured project view) |
| Current model, context and pending input | `/status` |
| Add instructions during execution | `/steer text` |
| Queue input after the current work | `/followup text`; queued inputs are not durable across host restart |
| Compact / summarize and continue | `/compact`, `/handoff` |
| Stop the observed run | `/stop` or Ctrl+C while running |
| Clear an idle input | Ctrl+C while idle |
| Close a detail panel | Escape or `/back` |
| Scroll a detail panel | Alt+PageUp / Alt+PageDown or wheel over the panel |
| Open the same session in Web | `/web` |
| Refresh / help | `/refresh`, `/help` |
| Detach TUI, keep host/run alive | Ctrl+D or `/quit` |

To send a literal leading slash to the model, begin with `//`. Files are read
through the host's existing authorization boundary. When project tools are not
enabled, `/files` and `/read` use the existing bounded workbench. This is an
inspector; actual code changes still come from authorized agent tools.

The workspace Web tab and TUI observe owned snapshots about once per second
(Web currently 1.8 seconds). This includes capped ephemeral **assistant text**;
reasoning and tool arguments are not added to the public trace or snapshot.
The completed saved message replaces the preview. A client that was already
idle also notices a run initiated from the other surface.

Switching sessions, exiting TUI or losing the connection only detaches its
observation. The separate host must stay alive. `/stop` binds the observed run
ID, so a stale request cannot cancel a later run. The server retains its existing
same-session and shared-project single-writer guards. Network uncertainty never
automatically resubmits a prompt. Server shutdown remains the host terminal's
Ctrl+C; it is not an alias for closing the TUI.

## Scope and validation

This first terminal surface operates the main workspace's existing sessions.
Persistent-agent creation, memory editing, job administration, service preview,
templates and model login remain in the Web UI. It adds no second agent loop,
native command PTY, daemon scheduler, shell permission, OS sandbox or auto-update.
The terminal UI's own PTY verification is distinct from agent command execution.

Actual Linux PTY, Pi/HTTP cross-client and DOM-handler evidence is recorded in
[TUI validation](TUI-VALIDATION.md). Windows Terminal/PowerShell and interactive
Korean IME require user-environment validation; synthetic Korean paste and width
checks are not a claim of native IME testing. Live LLM, company gateway and actual
browser rendering were not executed for this patch.
