# Trusted Persona catalogue contract 1

This producer-only contract adds a trusted catalogue module to the managed host after execution-policy source 9cbecfd. It reuses the existing immutable `AgentProfile.personaSourceId` and `WorkspacePersonaSource` contracts. It does not change the f6 Persona producer, context schema, standalone defaults, permissions or model configuration.

## Trusted launch and exact input

Launch the existing host with `--persona-module <absolute examples/vera-local-reference-catalogue.mjs>` and private parent environment `PIDA_PERSONA_CATALOGUE=<absolute JSON file>`. This environment value is not a renderer-selected path. The JSON root has exactly `schema_version`, `host_id`, `sources`; version is `pida.persona-catalogue/1`, host matches the managed host, and sources contains 1..32 entries.

Each source has exactly these nine keys:

| Key | Meaning and validation |
| --- | --- |
| id | Existing native source token: lowercase initial letter, then lowercase letters/digits/dot/underscore/hyphen, maximum64; local/workspace reserved. |
| label | Nonblank public label, maximum100, no control characters. |
| profile_id | Lowercase UUID, attested by the trusted parent registry. Pida verifies its shape/uniqueness, not Sch registry membership. |
| persona_id | Explicit configured producer persona ID, maximum256, no controls. Must equal the selected config value. |
| principal_ids | 1..1000 unique nonblank native Pida principal IDs, maximum256 each. Governs catalogue visibility and agent creation. |
| bridge | Exactly executable, prefix_args, config, store. Absolute paths, executable without shell; 0..16 prefix args. |
| config_sha256 | Lowercase SHA256 of the actual config file bytes. |
| store_instance_id | Exact verified store identity: store: followed by32 lowercase hex digits. |
| bridge_identity | Existing reference helper identity recomputed against the explicit bridge settings. |

The `bridge` path strings are bounded4096 characters; prefix arguments are shorter than4096, without NUL/newlines. The catalogue file is bounded262144 bytes. All entries are validated before any producer child starts. Unknown/missing/future keys and mismatched pins fail closed. Source IDs, profile IDs, persona IDs, store instance IDs, and resolved config/store paths must each be unique. Paths compare case-insensitively on Windows. Profiles cannot silently share one store or canonical persona identity in this first version.

`principal_ids` is a different namespace from config.principal, which remains the independently pinned producer authorization identity. No equality assumption is made. A native create-agent request selects `personaSourceId`; the existing supervisor persists it atomically with the generated agent UUID. A consumer must preserve the full source ID in its own create intent/reconciliation record.

## Identity and restart

The module normalizes absolute bridge paths, sorts sources by id and each principal list lexicographically, then hashes `private-state.canonical({catalogue: normalized, reference_helper_sha256})`. The helper hash covers the actually imported reference helper bytes. The existing host manifest independently pins the selected catalogue module bytes and this returned identity. Catalogue formatting/source order changes do not alter semantic identity; label, visibility, profile, config, store, bridge or membership changes do.

The existing reference bridge identity covers the exact config bytes, store path/immutable store identity, configured executable and any absolute file argument bytes. It does not prove the complete transitive Python/service dependency closure. The trusted parent retains that full verified component inventory separately. The same f6/r4 producer source lock remains in fixtures/vera-dispatch/local-reference-source-lock.json.

Every selection is recomputed before launch/resume; the child identity handshake verifies the opened producer store. A live producer also enforces its accepted f6 store identity/current grants. No mutable map or fallback is added. An existing host may not add/remove/remap catalogue entries; this first slice requires a new workspace or a future separately reviewed migration. Existing D/b7 state and runtime remain unchanged. Restoring exact original settings resumes with the same native IDs. Complete same-instance backup rollback remains an acknowledged producer limitation, not a new detection claim.

## Public surface and execution

Ready remains exact11-key `pida.local-host/2`, with `persona_mode: vera-local-reference-catalogue/1` and the unchanged closed execution policy object. Manifest remains `pida.local-host.workspace/2`; policy identity is unchanged. The existing authenticated list-agents `personaSources` shape is exactly `{defaultSourceId,sources}`. Default is explicitly `local`; sources contain `{id,label,authority}` only. The local choice is labelled by Pida and has authority pida-local; external choices use authority external. No config paths, registry IDs, principal lists, store pins or bridge command are exposed there.

Unselected agents use the explicitly advertised local default, never an inferred external profile. An explicit unknown/inaccessible external source fails. Each external source owns one serial bridge process; per-agent provider snapshots are separately held. Cross-source/cross-agent snapshot authorization fails. B expiry/revocation or producer failure does not route to A or local memory. Context uses actual native job/OrgAttempt/session identities; task_id continues to mean job.id, not OrgTask.id. Restricted reference profiles remain organization-only and do not gain auto-learning or canonical imports.

Shutdown attempts every owned bridge close; partial startup closes already opened children. Existing bounded helper IPC/error behavior remains. This is executable trusted module configuration, not a new model-selected plugin surface.

## Verification and withdrawal

See [owner validation](development/PIDA-PERSONA-CATALOGUE-20261108.md). Claims apply only to the frozen source hashes and accepted f6 producer below. Withdraw isolation/resume acceptance if a future source emits another profile's marker, permits unauthorized dispatch, silently changes a persisted source, mutates workspace on identity rejection, or changes this public shape without a new contract/review. No change is the alternative for retained D/global-profile hosts; they continue using their pinned runtime. Independent review, Sch consumer integration, packaged platforms and actual model quality are separate gates.
