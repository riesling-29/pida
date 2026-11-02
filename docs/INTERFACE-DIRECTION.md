# Pida interface direction

Date: 2026-10-28 KST. Scope: Pida only. Status: initial Web work-surface implementation and evaluation plan. Preview/file/diff views, revision-bound evidence and guarded file restoration are implemented; general repository execution and TUI integration are not.

## Product goal

The user should be able to see the actual application, request additions or changes in a nearby conversation, and inspect the resulting behavior while continuing the work. Templates are starting points. A reusable coding-capable harness supplies the implementation capability underneath.

General coding assistance is a natural extension of this goal. Its frontend may be Pida's Web UI or a reused upstream TUI. We should select the surface by task effectiveness and maintenance effort, without making a new terminal framework or a general IDE a prerequisite.

## Design reference and interpretation

The user supplied a TempleOS interpretation emphasizing deliberate constraints, direct interaction, visible structure and reduced decorative expression, illustrated by Picasso's progressive reduction of a bull drawing. Adopt those as design values for Pida, not as a requirement to reproduce TempleOS colors, resolution, typography or historical appearance.

The thread is an interpretation supplied as design input. We do not establish Terry Davis's motives or a causal law that less visual expression necessarily improves cognition. Its speculative AGI/hallucination claims are not product requirements.

The operational principle is: remove redundant presentation while keeping the facts needed to understand the work and make consequential decisions. User agency means choosing goals, inspecting outcomes and correcting direction; it does not require the user to manage dependency internals or approve every routine agent action.

| Principle | Pida application | Avoid |
| --- | --- | --- |
| Deliberate simplicity | Stable layout, few meaningful actions, concise labels | Decorative dashboards, multiple cards repeating one fact |
| Visible structure | Show task, target project/document, current change and actual execution state | A confident completion bubble without an observable change |
| Direct interaction | Immediate input acknowledgement and preview refresh with honest pending states | Artificial delays or animations introduced to demand attention |
| Decision-relevant density | Compact change summary; expandable diff and evidence; readable type | Tiny fonts, icon-only mystery controls or a wall of raw logs |
| Meaningful user effort | Make scope changes, conflicting outcomes and irreversible actions understandable | Repeated confirmations for already-authorized reversible work |
| Honest evidence | Distinguish saved, rendered, scoped checks passed and unverified | Treating a model's claim or a visible page as verified correctness |
| Reachable control | Visible stop, correction and recovery actions | Silent background changes or undisclosed partial effects |

Keyboard navigation, accessible focus, sufficient contrast, responsive text and Korean IME support remain usability requirements. A limited semantic color palette can communicate state; color alone cannot carry that state. Neither mouse use nor a Web UI contradicts this philosophy.

## Working hypothesis: evolve Web first, compare with a reused TUI

The existing Pida studio already connects a service preview, templates and a conversation. For the original visual-development task, evolving that surface is the initial hypothesis with the most direct reuse. This is an architectural assessment, not measured proof of lower development cost.

| Decision factor | Extend current Pida Web UI | Reuse Pi/OMP's existing TUI |
| --- | --- | --- |
| See and adjust a web application | Existing side-by-side preview; directly aligned with the original goal | Requires a browser or another preview surface alongside the terminal |
| Repository coding | Needs file/diff/command-result presentation and a suitable backend | Existing terminal coding interaction can provide the baseline |
| Interaction reuse | Current studio, workspace chat and session client already exist | Reuse upstream input/rendering; avoid building a new TUI |
| Operational fit | Useful where browser access is the natural entry point | Useful in terminal/SSH-centered workflows |
| Maintenance burden | Own the Pida-specific composition and backend bridge | Keep changes small; check upstream extension/interface compatibility |

Both surfaces need a working coding backend. Moving from Web to TUI by itself does not supply missing runtime authorization or solve LiteLLM cache behavior. Do not build both full frontends in parallel before a real task demonstrates the need.

A possible outcome is Web for visual work plus an upstream TUI for terminal work. Do not promise shared live sessions merely because both use the same model; session ownership, concurrent writes and resumption support must be explicitly integrated and tested.

## Web composition

Use one consistent work surface with these responsibilities:

- A compact context strip: selected project/document, concise task goal and current execution status. Backend details remain secondary unless needed to understand a failure.
- A primary work area: preview for UI work; files/diff for repository work. Switching views changes how the same task is inspected, not its execution owner.
- An adjacent conversation: requests, corrections and concise progress. If selecting an element becomes supported, bind the selection to a real document revision and show its scope; do not imply visual grounding that the backend does not have.
- An inspectable result area: what changed, what was tested, what failed or remains unknown, and available recovery. Full commands/logs remain reachable without occupying the entire default view.

Example desired result: "Saved 2 files; sidebar visible; navigation checks passed; persistence behavior untested." These are independently sourced states, not a single green success badge.

Routine authorized edits should produce prompt feedback without a confirmation dialog for every tool call. Checks, preview updates, correction and restoration should be part of the normal flow. Any new staging/publishing model must be explicit: today's studio writes the shared saved service document immediately, and this design does not silently change that behavior.

## Current implementation limits

The studio edits a single self-contained HTML service document and supports file work in the same bounded workbench. It now provides preview/file/Git-diff tabs, a selected file as task context, manifest-derived check results, current-snapshot matching and guarded request-before file restoration. File work can start without a UI template. The diff is an inspectable unified Git diff, not a staging/merge editor. It does not provide a general npm/React/backend development environment, general shell execution or element-selection grounding. The architecture must obtain required coding capabilities from an existing harness/tool surface and explicitly wire them into Pida.

The philosophy applies to Pida's host controls. Generated user applications retain the user's own design requirements; do not force every generated application to resemble the host interface.

## Small decision trial

Compare the current/evolved Web surface with a pinned upstream TUI using a suitable common model/backend and equivalent clean repository states where supported:

1. Add a sidebar item, then make a follow-up change while preserving the first change.
2. Repair a small multi-file bug and run the real project tests.
3. Inspect an intentionally failing check, correct it and explain what is still unverified.
4. Interrupt a task after an edit, inspect the actual remaining changes and resume or restore safely.

Record task completion, user interventions, ability to identify actual changes/verification, task time and integration/maintenance effort. Compare cache behavior separately with equivalent requests when diagnosing LiteLLM; do not attribute a backend-routing problem to the frontend without evidence.

Decide whether Web alone is sufficient, an existing TUI adds practical value, or a narrow extension is needed. Build a custom TUI only if the trial reveals a concrete unmet need that upstream reuse cannot address economically. The initial Web acceptance script exercises bounded JavaScript files/tests, UI edits, cancellation with saved changes and restoration using scripted model decisions and real Pi/tools/Chromium. It is not the proposed common-repository Web-versus-TUI trial. No comparative trial outcome, user study or cognitive improvement is claimed yet. See [VALIDATION.md](VALIDATION.md).
