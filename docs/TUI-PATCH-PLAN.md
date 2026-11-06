# Pida 0.8.7 — shared Web and terminal work surface

Starting baseline: local `daf43e55f800d42e23551c7bea47fac59723bb46`, delivered
`81acddac69c9acacb7fb82a0e450c46691b14ddf`, package 0.8.6. Pida only.

1. Reuse pinned Pi TUI 1.2.0 editor, terminal, layout, scrolling and selection
   components. Add a thin Pida HTTP client; the existing server owns execution,
   permissions, session persistence, provider/OAuth and workspace locks.
2. Provide a compact header/status, scrollable conversation, prompt editor and
   on-demand session/tool/file/diff panels. Support Korean text, paste, resize,
   keyboard operation and sanitized terminal output. No terminal engine fork.
3. Expose bounded, ephemeral assistant text in the existing owned session view.
   Web and TUI poll the same source even when initially idle; run initiation
   reuses detached SSE. Switching/closing clients never resubmits or cancels work.
   Explicit cancellation binds the observed run ID; simultaneous writes retain
   existing server admission guards.
4. Add `pida tui [workspace] [--session ID | --new]`. Attach to the already running
   server; reuse local credentials without printing them. `/web` opens that same
   session. The separately started server continues after the TUI exits.
5. Verify actual Pi/HTTP cross-client runs, streaming snapshots, cancellation,
   detach/reattach, authorization and terminal-control filtering. Exercise the
   real renderer/editor in a PTY, then run one integrated regression gate and
   commit 0.8.7 to the existing draft PR.

Live-model quality, company networking, Windows-terminal/IME interaction and
full upstream coding-product parity require their own real environment trials.
The terminal is a client for the main workspace sessions; the existing Web UI
continues to provide the full persistent-agent administration surface.

The planned slice is implemented and verified as documented in
[TUI validation](TUI-VALIDATION.md). Actual live-model, Windows/IME and browser
rendering gates remain distinct from completed component/integration tests.
