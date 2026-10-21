# Pida 0.6.1: local-model recovery and coding guides

## What changed

- Provider response probe: up to 1,024 output tokens, 60 seconds, explicit output-limit/timeout errors. This tests a text response; it is not a tool-capability benchmark.
- Automatic Pi compaction enabled by default. Reserve is `min(contextWindow / 2, max(4096, maxTokens + 4096))`; recent history is `max(256, min(8000, contextWindow * .15))`. Pi triggers compaction at its threshold/overflow boundaries, not at every token. Very small contexts can still be insufficient for the system prompt and tool schemas.
- Both chats show context usage (estimated; unknown immediately after compaction), manual compression and manual summary handoff. Handoff carries the compacted summary **and retained recent messages**, strips thinking, retains the original session and workspace, and never executes tools during transfer. Short histories transfer without unnecessary summarization. An oversized transfer fails without silently dropping requirements.
- Output-limit responses retry once by default, instructing the model to inspect current state and make smaller complete edits. All attempts share the original run deadline and turn/tool budgets. Repeated truncation returns `OUTPUT_LIMIT`; empty answers return `EMPTY_RESPONSE`.
- Workspace run deadline: 180 seconds by default. Embedded runtime default remains 60 seconds.
- Selected Superpowers debugging and verification skills are bundled from a pinned commit, registered as native Pi skill metadata and read on demand through `coding_guide`. No ambient package scanning or executable extension installation. This is not the complete Superpowers suite or mitsupi.
- Optional browser `ui_check`: same renderer as service, fresh desktop viewport, script errors and ordered clicks/visible-text assertions. No source changes. A successful check covers only supplied steps and observed errors, not all UI behavior.

## Configuration

Add these optional top-level fields to the existing `pida.config.json`, preserving the provider, tools, stateDir and permissions:

```json
{
  "runtime": { "maxRunMs": 180000, "autoCompaction": true, "maxOutputRetries": 1 },
  "codingPacks": ["debugging", "verification"],
  "browserChecks": false
}
```

This is a fragment, not a complete workspace config. `codingPacks: []` disables bundled guides. Restart after changing these options. No model context/output limit is silently increased: set the Pida context size to the actual context loaded by LM Studio. Larger output limits may also need a larger execution deadline. Automatic compression and output length are separate constraints.

For browser checks, install optional dependencies and Chromium (`npx playwright install chromium`), set `browserChecks` to `true`, and restart. On hosts with an existing compatible browser, the server-only `PIDA_BROWSER_EXECUTABLE` environment variable selects it. Absence of a usable browser returns `BROWSER_UNAVAILABLE` without changing the UI. Browser checks are optional; normal use needs no browser installation on the server.

## Updating a Windows source checkout

Stop the running Pida server first. From the existing checkout:

```powershell
cd D:\pida
git status --short
git pull --ff-only origin feat/pida-workspace
npm ci --ignore-scripts
npm run build
npm start
```

If the earlier manual `src/provider-settings.ts` probe fix is still a local modification, preserve it before pulling:

```powershell
git stash push -m "local provider probe fix before 0.6.1" -- src/provider-settings.ts
```

The new version includes the probe fix. Keep the stash as a backup; do not blindly reapply it. Other local modifications require review before updating. Keep `.env`, `pida.config.json` and `.pida` in place; no reinitialization is needed. Back up the state directory before any future data migration. This version adds no metadata schema migration.

## Remaining roadmap

Automatic cross-session handoff, arbitrary third-party executable extension loading, full multi-file app builds, draft/publish workflows, enterprise SSO/RBAC and multi-tenant execution isolation remain future work. The present release provides automatic compaction plus explicit handoff, not an unlimited context guarantee. Real LM Studio/Qwen quality and speed must be confirmed on the user's machine; protocol/faux tests do not establish model quality.
