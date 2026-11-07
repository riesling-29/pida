# Explicit local reference Persona host

This unit connects an app-owned reference Persona store to the existing public
`vera-dispatch/0.1.0` consumer. It does not recover historical continuity source,
read canonical Vera data, import fixtures at runtime, or add learning/writeback.

Current producer: `f6edd022d4389237fcee5d6c0a4db8a0d0b13399`, runtime source digest
`0f85831175f24aea7237a6a003bdb14972a32cf13a7e76394c3fa9898b3763d6`.
The nine-file [source lock](../../fixtures/vera-dispatch/local-reference-source-lock.json)
is distinct from the old synthetic dispatch lock. The parent assembly must verify
the complete producer export against this lock before enabling it. A Python
interpreter or the parent's verified embedded Python service is required; Node's
API-only distribution does not imply Python is bundled.

## Trusted configuration

Pass `--persona-module <package>/examples/vera-local-reference-persona.mjs` and
the following parent-owned environment values. No renderer/model controls them.

| Variable | Value |
| --- | --- |
| `PIDA_PERSONA_BRIDGE_EXECUTABLE` | Absolute Python or embedded service executable |
| `PIDA_PERSONA_BRIDGE_PREFIX_ARGS` | JSON string array, e.g. `["-I","-B","/absolute/export/scripts/local_persona_bridge.py"]` |
| `PIDA_PERSONA_BRIDGE_CONFIG` | Absolute reference configuration JSON |
| `PIDA_PERSONA_BRIDGE_STORE` | Absolute previously initialized app-owned store |

The helper appends `serve --config <path> --store <path>` with `shell:false`.
The owner must first explicitly call the same entrypoint's `init` command for a
new store. It never auto-initializes or searches a developer source directory.
Configuration schema is `vera-local-reference/0.1.0`: principal, host_id,
project_id, memory_scope, persona `{persona_id,name,description,source_refs}`,
grant_expires_at. One host module runs one serial bridge process with one selected
Persona; multiple native agent bindings may select that same Persona. Distinct
Personas require distinct explicit provider configurations, not inferred names.

Ready mode is `vera-local-reference/0.1.0`. The producer declares the existing
restricted identity/memory-context/linear-state/dispatch-authorization profile.
This bridge has no state writer and an unprovisioned state is null. Graph,
behavioral models, analysis/artifact references and producer receipts remain
unsupported. Grant renewal and configuration update IPC are not implemented.

The full binding uses actual native agent, host, organization session, run and
OrgAttempt IDs. `task_id` is the native runtime **job** ID; native OrgTask remains
separately available through job.organizationTaskId. Standalone/main-agent paths
without an actual organization attempt are rejected by this optional module.
The generic standalone consumer is unchanged.

Before reopening, the host includes the module's readonly identity digest in its
existing manifest check. That identity binds command argv, executable/absolute
entry-file bytes, exact config bytes, store path and immutable store instance ID.
The `vera-local-store/0.2.0` completion marker has exactly schema_version,
store_instance_id, config_digest, database and created_at. The provider stores
and validates the same marker in SQLite metadata. After opening, the helper's
public `identity` handshake must echo the exact schema/store ID/config digest
before the host is ready. The launcher also passes its preflight identity to the
module, preventing a different configuration snapshot during startup.
Complete producer dependency
source verification is still the parent assembly's responsibility. A changed
configuration/source has no automatic migration. JSONL responses are bounded,
requests time out, malformed data closes the bridge, and EOF/host shutdown closes
the owned process. No raw provider stderr, context text or credentials are logged.

## Evidence and limits

The initial consumer `7997d51` used producer `0d9714c` (digest `6b6800fa...605ac`).
Independent review found a same-path fresh-store replacement could change
binding lineage without changing the host fingerprint. That initial candidate
is superseded for recovery claims. The focused store-identity correction uses
producer `f6edd02` and [additional actual-host evidence](pida-local-reference-store-fix-20261107.txt):
same-path new initialization is rejected before host state mutation; restoring
the original instance restores same-job resume. Old marker versions are rejected
without migration. A complete same-instance backup rollback is not detected by
this local instance anchor; no monotonic anti-rollback or external recovery
anchor is claimed.

[Focused public-port/native-host test](pida-local-reference-host-tests-20261107.txt)
uses the exact nine-file source export and new synthetic reference configuration.
It checks Korean/emoji text bytes through the public port, read-only authorization,
wrong task rejection, actual native job/attempt/session/agent binding, a completed
mock job's logical context inclusion, same-job host resume and byte-preserving
denial after a config change. Synthetic direct-port IDs are explicitly separate
from the actual host's generated IDs.

[Host regression output](pida-local-reference-host-regression-20261107.txt) covers
the existing policy, shutdown, resume, atomic admission and synthetic Persona
paths. No new paid provider call is made. A logical context receipt is not raw
provider wire capture, semantic Persona improvement or artifact acceptance.

Validity is limited to the recorded producer/consumer bytes and tested platforms.
Withdraw compatibility if profile negotiation, Unicode bytes, native identity,
current authorization, bounded cleanup or immutable resume checks fail. Next:
independent consumer/producer join review, then verify the parent-packaged Python
bridge and final desktop assembly separately.
