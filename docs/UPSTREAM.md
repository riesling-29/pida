# Verified upstream contracts

Inspection date: 2026-10-14 KST. Recheck on dependency upgrades.

## Repository evidence

- Target: `https://github.com/riesling-29/pida`, private, not archived, writable through the connected GitHub application.
- Initial contents API returned `This repository is empty`; branch list and open PR list were empty. Metadata default branch was `main`, but there was no branch ref or implementation to audit.
- Official old URL `https://api.github.com/repos/badlogic/pi-mono` returned a moved response. Current repository: `https://github.com/earendil-works/pi`, repository ID 1035029907.
- Latest observed release: [v1.2.0](https://github.com/earendil-works/pi/releases/tag/v1.2.0), published 2026-10-12T23:03:53Z (2026-10-13 KST).
- Observed main HEAD: `3daa20280f6a7c7cbe0935680c9a38fdc3863005`. This is an inspection reference, not our package version. Build against release packages, not moving main.
- npm confirmed `@earendil-works/pi-coding-agent@1.2.0`. Installed package declarations and runtime exports were checked and used by the tests.

## Reused contracts

| Component | Verified surface | Pida decision |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `createAgentSession`, `AgentSession.prompt/subscribe/abort/dispose`, `ModelRuntime`, `SessionManager`, `SettingsManager`, custom `ResourceLoader`, `ToolDefinition` | Embed the SDK; explicit safe configuration |
| `@earendil-works/pi-agent-core` | Agent/tool loop, events, `prepareRequest`, `finishTurn` | Reused transitively; preserve Pi-installed hooks |
| `@earendil-works/pi-ai` | `createProvider`, `Provider`, `InMemoryCredentialStore`, protocol implementations, faux provider | Company adapter + host provider factory + deterministic tests |
| `SessionManager.inMemory()` / `create()` / `open()` | Pi-authoritative conversation tree/projection and JSONL storage | Ephemeral embedding or persistent single-process workspace; no homebrew transcript format |
| Pi MIT license | Copyright (c) 2025 Mario Zechner | Notice retained in THIRD_PARTY_NOTICES.md |

Historical `@mariozechner/*` names are not used. Current official main package listing no longer includes the old `pi-web-ui` package; Pida uses a small example UI plus its own transport client, not an unverified legacy UI dependency. Pi-durable, chord and telemetry exist upstream but are not required for this minimal profile.

## Source references

- [Release SDK contract](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/sdk.md)
- [Full-control example](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/examples/sdk/12-full-control.ts)
- [Session persistence contracts](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/core/session-manager.ts)
- [Session factory](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/core/sdk.ts)
- [Model runtime](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/core/model-runtime.ts)
- [AI/provider README](https://github.com/earendil-works/pi/blob/v1.2.0/packages/ai/README.md)
- [Custom providers](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/custom-provider.md)
- [License](https://github.com/earendil-works/pi/blob/v1.2.0/LICENSE)

Pi's upstream README explicitly states that filesystem/process/network/credential permissions are not sandboxed by default. Pida's business authorization is an additional application boundary, not a claim that Pi contains such isolation.

## Provenance and compatibility

Dependencies are consumed from npm, pinned at 1.2.0; transitive Pi packages are also overridden to 1.2.0. `npm-shrinkwrap.json` records resolved tarballs and integrity values. The architecture follows the official full-control example, with explicit stores and no ambient discovered resources. Version 0.2 also uses the public Pi file-session create/open APIs, verified against installed 1.2.0 source and the release source on 2026-10-15. No upstream source tree is vendored or forked.

The release example mentions an internal AuthStorage pattern; the installed public root does not export AuthStorage. Pida uses the publicly exported `InMemoryCredentialStore` from pi-ai instead. Compilation and real-package tests, rather than documentation snippets alone, determine compatibility.
