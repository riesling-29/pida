# Terminal and Web on the same Pida host

Available from 0.8.7; current work surface 0.8.14. The terminal uses the existing Pi TUI 1.2.0 components and
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

`npm start` opens the **server log**, not the terminal interface. The new startup
message states this and prints the exact attach command. In the TUI, the header
must say `pida 0.8.14 · MULTI TUI`, with visible function-key menus and a prompt editor.
If the header shows an older version, update the PR branch and rebuild the same
checkout before relaunching. No second workspace server is needed.

An installed CLI also supports `pida tui ./my-agent`. The default opens the
multi-agent workspace without creating a main session. F3 connects/creates an
agent; F6 splits; F2 manages tabs; F7 focuses panels; F8 controls actual jobs.
See [full multi-agent controls and home test guide](MULTI-AGENT-0.8.14.md).

`--main` opens the existing single-session view. `--new` creates a new main
session; `--session UUID` selects an existing main session, so both flags also
select the single-session UI. Never start a second host against the same lock.

The CLI reads the selected workspace's existing application token and local
port; no token needs to be copied into the terminal. Model credentials remain
with the host, so existing ChatGPT, local endpoint and private connector
configuration is reused. Provider settings remain in Web (`/web`), or the
existing `pida configure` flow. The TUI does not replace a company's connector.

## TempleOS-inspired interaction

This follows the user's supplied interpretation of the Pitano/TempleOS thread,
the prior 2026-10-28 Pida discussion and [interface direction](INTERFACE-DIRECTION.md).
The original `pitano: 따라잡기` conversation was not recovered during 0.8.7.
For 0.8.8, the user's subsequently supplied interface-philosophy document was
read successfully through its saved copy after attachment delivery failed.
Its practical correction is that compression must retain the structure needed
for judgment; command memorization and unexplained hidden state are avoidable
friction. The original historical conversation remains unverified.

The design aims to preserve the information needed for active judgment while
removing repetitive presentation. It does not reproduce 640×480, a fixed
16-color appearance or artificial inconvenience, and it does not claim a proven
cognitive benefit or establish Terry Davis's motives.

| Principle | Implemented behavior |
| --- | --- |
| Expose structure | Target/model/version, session/title, conversation and persistent intent/structure/execution/judgment overview |
| Remove redundant presentation | No dashboard tiles, animated progress theater or repeating success badges; details open on demand |
| Keep meaningful decisions explicit | Normal request, steering, follow-up, cancellation and client detach are separate commands |
| Keep evidence inspectable | `/diff` shows actual Git changes; `/tools` shows recorded output and exit codes; `/activity` shows traces and manifest verification separately |
| Preserve direct work | Clickable navigation, F1 menu, F5 file selector, keyboard shortcuts, slash completion, multiline editor and bracketed paste |
| Adapt density | Side-by-side conversation/overview at 104+ columns; narrow screens retain goal and verification, with F7 opening the full overview; F8 toggles guidance |
| Reduce routine effort | Session attach and observation reuse server state; no duplicate model run or per-tool confirmation loop |

From 0.8.11 the actual renderer uses the approved near-black green background
(`#010201`) and cool light text (`#bbc6c3`), with subtly shaded section headers,
menus and selection. Blank cells are painted too; the terminal's global palette
and font settings are not changed. Pi detects truecolor support and otherwise
uses a 256-color approximation (near-black shades may become plain black).
`NO_COLOR=1` disables Pida's decorative colors. Status is written in text as well.
Untrusted model, file and tool content
is stripped of terminal control sequences before display. Message and panel
display limits are explicit; they do not truncate the server's saved history.

The earlier green Web/TUI HTML previews were interactive **design prototypes**.
0.8.11 applied their color direction. 0.8.14 implements their multi-agent
tabs and bounded nested splits using real owned jobs. Structured file/line
request-target binding remains planned. A preview alone is not implementation
evidence; the new version has real renderer and CLI/HTTP/PTY checks.

Font selection belongs to the terminal application. Pida cannot apply an HTML
font stack to Windows Terminal. In a truecolor-capable terminal that is not
detected automatically, `$env:COLORTERM = 'truecolor'` before launching enables
Pi's truecolor path. If `NO_COLOR` is set, the terminal remains monochrome until
that opt-out is removed. No credential or workspace configuration needs changing.

## Single-session commands and controls (`--main`)

| Operation | Control |
| --- | --- |
| Discover actions without memorizing commands | F1, `/menu` or click the menu; arrows/Enter choose, Esc closes |
| Work overview / guidance density | F7 or `/overview`; F8 or `/density` toggles guidance/concise text |
| Submit / newline | Enter / Shift+Enter or Alt+Enter (terminal support varies) |
| Sessions / new / exact resume | F2 or `/sessions`, `/new`, `/resume UUID` |
| Execution and verification | F3 or `/activity` |
| Recorded tool results | F4 or `/tools` |
| Project files / file content | F5 opens a folder/file selector; Enter navigates/reads. `/files [directory]`, `/read path` also work |
| Git changes | F6 or `/diff` (requires the configured project view) |
| Current model, context and pending input | `/status` |
| Add instructions during execution | `/steer text` |
| Queue input after the current work | `/followup text`; queued inputs are not durable across host restart |
| Compact / summarize and continue | `/compact`, `/handoff` |
| Stop the observed run | `/stop` or Ctrl+C while running |
| Clear an idle input | Ctrl+C while idle |
| Close a detail panel | Escape or `/back`; Escape also returns from the narrow overview |
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

The default overview uses the latest actual user request, permitted-tool and
instruction metadata, run-correlated trace facts and the ended run's manifest.
No inferred plan, completion percentage or success criteria are fabricated.
Manifest retrieval is asynchronous and fenced by session/run/request identity;
failure remains unknown and does not stop session observation. Scoped checks are
labeled as recorded at run end, never as current independent acceptance.
Git change counts appear only after F6 reads them, with the observation time and
whole-worktree scope. F6 refreshes that view; it is not a per-run edit count.

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
[0.8.11 theme validation](TUI-0.8.11.md), [0.8.8 validation](TUI-0.8.8.md) and [historical 0.8.7 validation](TUI-VALIDATION.md). Windows Terminal/PowerShell and interactive
Korean IME require user-environment validation; synthetic Korean paste and width
checks are not a claim of native IME testing. Live LLM, company gateway and actual
browser rendering were not executed for this patch.
