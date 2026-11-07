# Explicit local host for Schumpeter

Pida and Schumpeter owners agreed this boundary on 2026-11-07. Pida owns the fixed-endpoint policy client, existing workspace/supervisor integration, authenticated capability/receipt APIs and host entrypoint. Schumpeter owns authoritative current mappings, the policy endpoint, parent-process secret handling, desktop launch/connect and enterprise acceptance. This adds no second organization runtime.

## Launch and connection

After building/installing Pida with Node >=22.19, the trusted parent can launch:

```text
node <pida-package>/examples/schumpeter-host.mjs --workspace <new-empty-short-path> --host-id <registered-host-id>
```

Set `PIDA_SCHUMPETER_AUTH_URL` to `http://127.0.0.1:<policy-port>/v1/pida-authorization` and `PIDA_SCHUMPETER_AUTH_TOKEN` to the separately registered host-policy credential through the child environment. These are host settings, never envelope, model or renderer selections. Only URLs resolving under WHATWG normalization to the literal `127.0.0.1` / `::1` address and the fixed path are accepted; DNS hostnames, URL credentials, query, fragment and redirects are rejected. No global plugin installation is needed.

The entrypoint refuses a nonempty or symlink workspace, initializes a fresh private runtime, binds Pida to `127.0.0.1` on an ephemeral port and emits **one private parent-pipe message**, not a log:

```text
{type:"pida-host-ready",protocol:"pida.local-host/1",host_id,base_url,api_token,principal_id:"local-user",capabilities,provider_mode,persona_mode}
```

The parent must verify `host_id`, loopback address, protocol and authenticated capability readback before attaching. Keep `api_token` in the service's private connection state; never put it in UI metadata, ordinary logs, command-line arguments or repository evidence. It differs from the policy credential. Closing parent stdin or SIGINT/SIGTERM closes this host; it does not stop another workspace's runtime.

Default mode is explicitly `mock` + `pida-local`. The existing scripted mock only exercises its synthetic lot-status tool; it is not proof of arbitrary autonomous work. `--provider-workspace <approved-existing-config>` can select an existing native ChatGPT provider and supported credential store while all sessions/workbench/runtime state stay in the fresh workspace. No existing session is opened or copied. The selected credential store may perform its normal OAuth refresh; credential bytes are not copied into new evidence. Other provider reuse profiles fail explicitly rather than silently choosing a billing path.

The narrow host permits workbench read/write/history, not OS project shell or arbitrary plugins. It sets a 20-second run bound, zero provider/output retries and a 16,384 observed-token guard (including the large workbench tool context). The guard is not a hard provider output/billing cap. General product deployments can embed `createWorkspace` with explicit policy and their own supported host configuration rather than treating this example as unrestricted administration.

## Current policy wire

[`createCollaborationPolicyClient`](../src/collaboration-policy-client.ts) calls only the configured endpoint with a separate bearer credential, a fresh nonce, timeout/abort and a bounded JSON response. Requests use `schumpeter.pida.authorization.request/1` with `request_id`, `phase`, authenticated `principal_id`, configured `host_id` and the complete existing envelope. The response has exactly ten fields: `schema_version`, `request_id`, `phase`, `authorized`, `principal_id`, `host_id`, `payload_digest`, `room_revision`, `contract_revision`, `recipient`. Its schema is `schumpeter.pida.authorization.response/1`; all echoed bindings must match, and only literal `authorized:true` allows work. Denied/unavailable/malformed/stale/redirected/oversized/timed-out responses fail closed.

Schumpeter's endpoint authenticates the registered host first and then checks its stored principal policy, current sender binding, persistent recipient organization -> host/native OrgSession/agent mapping, both room and contract identities/revisions, and phase authority. Echoing request values without these checks is not an implementation of this policy. Responses should use `Cache-Control: no-store`; the fresh nonce and phase prevent replayed decisions from satisfying a new check.

Shared Unicode fixtures: [request](../fixtures/collaboration/authorization-request-v1.json), SHA256 `c3792f9b191d8fb6298497a4f448c1e2f043ed944ed4a22852d09f15cef7f41a`; [response](../fixtures/collaboration/authorization-response-v1.json), SHA256 `227778c4cf704a1314c22a9196006670e15f21cd58335085d0625345a5468e6d`. The existing envelope/digest contract remains in [COLLABORATION-1.md](COLLABORATION-1.md). ASCII IDs now reject trailing newline explicitly; UUID-shaped native IDs require exact length.

## Existing APIs and organization scaffolding

`GET /v1/collaboration/capabilities` / `PidaClient.getCollaborationCapabilities()` requires authenticated `pida:agents`. It reports configured enabled/disabled status, host ID, schema names, state version 3, process-restart durability and `fresh-task-only` replies. Enabled configuration is not evidence that the remote policy currently grants a message or is reachable. Receive/readback additionally require `pida:collaborate` and fresh policy approval. `CreateWorkspaceOptions.collaboration` is host-injected; default standalone CLI remains disabled. `nativeCredentials` is another host-only option, never an HTTP-selected path.

Reuse agent create/pause/resume and organization create/list/get/cancel APIs. Pause the coordinator before creating a goal-bound organization, then bind the native IDs in Schumpeter before sending messages. For a multi-step fresh-task conversation, a paused coordinator can keep the native organization active while worker participants run; finish by explicit resume/cancel/deadline. Do not describe that as an implemented arbitrary waiting-parent continuation. A receipt remains durable enqueue evidence, not task/enterprise acceptance. The HTTP receive body is bounded to 64 KiB in addition to the envelope limits.

## Optional public Persona example

Use `--persona-module <pida>/examples/vera-dispatch-persona.mjs` with `PIDA_VERA_SOURCE=<exact c1e3617 producer source>` and `PIDA_VERA_PYTHON=<python executable>`. This trusted module validates the separate source lock, launches hidden disposable Python fixtures with a filtered environment and uses only public producer APIs. It exposes `persona_mode:vera-dispatch-synthetic/0.1.0`; it never opens canonical memory. Every selected context binds the actual host, native organization session and agent instance through the task-scope callback. The harmless proof number 73 appears only in its synthetic Persona reference, for a later explicitly scoped context-use check. No such real-model artifact check is claimed by this unit.

An alternative trusted module exports `createHostPersona({hostId,workspaceDirectory,taskScope}) -> {mode,personaProvider,close}`. Module paths come only from trusted parent launch configuration and execute with host authority. They are not dynamically selectable by an agent. The included source is an example restricted profile, not a public remote Persona server or durable canonical memory service.

The included Persona module requires a native organization job. `taskScope` verifies the job's native OrgTask and OrgAttempt membership, then returns `organizationSessionId`, `organizationTaskId`, `attemptId` and `jobId`. The producer binding's `task_id` / exported `externalContext.taskId` denotes the **native runtime job ID**, matching the consumer input contract. Its `attempt_id` / `attemptId` is the exact native **OrgAttempt ID**. The separate **OrgTask ID** is available as `getAgentJob(...).organizationTaskId`; it must not be inferred from `taskId`. `run_id` / `runId` is the actual Pi run ID. Standalone/main work has no native OrgAttempt, so this restricted example rejects context resolution with `HOST_PERSONA_ORGANIZATION_REQUIRED`; it does not synthesize attempt identity. General standalone Pida and other Persona providers are unchanged. Earlier example evidence containing `attempt:<run-id>` remains historical synthetic metadata and is not native organization lineage.

## Evidence and boundaries

[Host/policy validation](development/PIDA-HOST-POLICY-VALIDATION-20261107.md) records 32 focused passes with a real separate Node host, Python policy server, native scripted Pi jobs, receipt readback/revocation, and actual public Persona scope receipts. No paid calls were made by this unit. The package dry-run confirms the host examples, compiled client, Python adapter and separate source lock are included; Node/Python/pinned producer source are explicit external runtime dependencies, not bundled installers. Schumpeter's actual endpoint/desktop and Linux deployment acceptance still require their own integration evidence. Use a short Windows workspace root; independent Windows runtime work is fixing proven Git/OCEL/shell issues and does not claim arbitrary path depth.

Withdraw this contract's acceptance if stale/wrong-scope decisions authorize work, a default standalone host enables delivery without opt-in, or capability/receipt readback bypasses authentication. Recheck after client, authority-service, source, schema or packaging changes. Costs and end-user desktop reliability remain unknown outside recorded tests.
