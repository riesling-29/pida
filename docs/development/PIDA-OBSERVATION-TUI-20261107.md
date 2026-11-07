# Host-wide observation terminal

`examples/schumpeter-observation-tui.mjs` is a client of an already running host.
It imports the existing public `PidaClient` and `runAgentTerminal`, never creates
a workspace/server, and never changes the managed workspace's config or token.

Trusted parent launch:

```
<bundled-node> <installed-pida>/examples/schumpeter-observation-tui.mjs
```

No command-line arguments. Supply only through the private child environment:
`PIDA_TUI_BASE_URL` (current loopback HTTP origin), `PIDA_TUI_TOKEN` (current private
host transport token), `PIDA_TUI_HOST_ID` (registered host ID), and
`PIDA_TUI_LAYOUT_DIRECTORY` (separate parent-owned UI directory). The parent must
not choose the managed runtime directory for UI storage. The child validates the
authenticated current collaboration capability's host ID before opening the UI.
Token rotation requires a new launch with current credentials. Redirects and
non-loopback destinations are rejected. Errors never echo tokens/URLs.

The screen is labelled **HOST-WIDE OBSERVATION ONLY**. This is not an
organization-scoped token: the private local-user credential can access all its
host's native agents. The parent should place the terminal in a host management
view; any PTY display ownership is distinct from runtime authority.

All HTTP mutations are rejected locally with a definite 403 before a network
request. The inherited menu/editor may show actions, but selecting them gives
`HOST_OBSERVATION_ONLY_USE_SCHUMPETER_TASK_CONTROLS`; it does not create uncertain
delivery state. This UI guard is not server-side credential scoping. Existing
generic standalone pida TUI behavior is unchanged. Native TUI submit normally
creates a generic job without an OrgAttempt, so it cannot truthfully dispatch
through the current org-only reference Persona bridge. Use Schumpeter's atomic
organization admission and current-authority controls for tasks.

Ctrl+D, SIGINT, SIGTERM or stdin EOF detaches the client. It does not stop the
managed host, cancel work or synthesize a native continuation. Only UI layouts
are written, with bounded files and no symlink/hardlink targets. The layout key
includes host ID plus the server's authenticated owner scope.

[Actual host test](pida-observation-tui-tests-20261107.txt) checks authenticated
native agent/job readback, wrong host/token rejection, blocked submit/create/
cancel/resume with **zero write HTTP requests**, definite rejection rather than
unknown delivery, unchanged workspace/config/state bytes, and detached queued
work subsequently completing under the original owner client. It also checks
separate layout persistence/path rejection. The policy endpoint denies external
collaboration; the native mock job is created by the test's explicit owner client.
No real model call is made.

This developer test does not establish an actual full-screen PTY rendering or
desktop keyboard/resize acceptance. The parent assembly must run that gate on
Windows/Linux with the bundled executable. Withdraw this slice if attach writes
managed state, leaks the token, bypasses the GET-only guard, selects a foreign
host, or detach stops/cancels host work. Validity is limited to the pinned source
and separately recorded environment evidence.
