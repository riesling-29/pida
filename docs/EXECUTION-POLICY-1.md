# Managed execution policy contract 1

Source contract agreed by pida and Schumpeter owners before implementation. This applies to a newly created managed host only. It adds no tool, project, Persona or billing authority.

## Catalog and digest

`resolveExecutionPolicy(id)` selects exactly `smoke/1` or `work/1`; omitted fresh selection is `smoke/1`. The exact resolved closed objects are [profiles-v1.json](../fixtures/execution-policy/profiles-v1.json). `validateExecutionPolicy` compares every field with the selected exact tuple, rejects extra/missing fields, fractional/nonfinite numbers, wrong/future versions and altered digests, and returns an immutable copy.

| Field | smoke/1 | work/1 |
| --- | --- | --- |
| schema_version | pida.execution-policy/1 | pida.execution-policy/1 |
| run_timeout_ms | 20000 | 180000 |
| organization_timeout_ms | 60000 | 900000 |
| join_timeout_ms | 60000 | 900000 |
| max_turns / max_tool_calls | 24 / 48 | 24 / 48 |
| max_provider_retries / max_output_retries / max_repair_attempts | 0 / 0 / 0 | 0 / 0 / 0 |
| max_total_tokens / max_concurrent | 16384 / 2 | 16384 / 2 |

`id` is the selected name; `digest` is SHA256 of UTF-8 `private-state.canonical(body)` with digest itself excluded. Canonical JSON recursively sorts object keys by JavaScript string relational comparison, omits undefined object values and preserves array order. Numbers are fixed safe integers from this catalog, inside pre-existing runtime/org/join maxima. Values are engineering limits, not verified adequacy for arbitrary coding tasks. Token limits are observed-response guards, not hard provider billing caps.

## Launcher, resume and readback

Trusted parent adds optional `--execution-policy smoke/1|work/1`. No renderer arbitrary JSON, environment-selected policy module or model-selected setting is accepted.

New `.pida-host.json` is `pida.local-host.workspace/2`, retaining every existing field and adding exactly `execution_policy_id` and `execution_policy_digest`. The existing source/config/provider/Persona/path pins and exclusive lock checks remain. Resume without a selector reads the persisted policy ID; explicit mismatch, missing ID/digest, unknown profile or old/future manifest rejects before workspace mutation. Existing b7/BB/C/D workspaces must use their retained exact old runtime. This patch offers no state migration or fingerprint rewriting.

The private ready line is `protocol: pida.local-host/2` with exactly these top-level fields: type, protocol, host_id, base_url, api_token, principal_id, capabilities, provider_mode, persona_mode, workspace_mode, execution_policy. The token remains private parent-only transport. `execution_policy` is the exact thirteen-field catalog object. Existing collaboration `capabilities` is still its unchanged /1 shape.

Authenticated organization admission capabilities for a policy-configured host use `schema_version: pida.organization.admission.capabilities/2`. Its closed fields are schema_version, enabled, host_id, admission_schema, receipt_schema, supervisor_state_version, acceptance, execution_policy. All pre-existing values and the acceptance object remain unchanged. With no trusted policy supplied, this API retains the original /1 response with no execution_policy field.

Schumpeter must validate these exact schemas/tuples/digests, persist the selected policy in trusted host/reservation authority and display actual effective limits. It chooses the catalog organization interval for the existing admission definition. Existing admission/1 and receipt/1 schemas do not change: timeout_ms/repair already participate in definition_digest and admission_digest. This patch does not itself implement the Schumpeter consumer.

## Runtime boundaries

`CreateWorkspaceOptions.executionPolicy` is trusted embedding configuration. It is validated and captured once; the runtime uses its bounds after config.runtime, so mutable workspace config cannot loosen them. Supervisor concurrency is also fixed by this policy. No standalone workspace config schema is added, and no policy means unchanged standalone behavior.

Managed native createOrganization defaults to the selected organization interval and rejects a larger timeout or repair>0. Atomic admission performs the same check before authorization, tentative job/task/org/receipt publication or ACK; current definition checks also reapply the ceiling before dispatch. A smaller valid explicit organization interval remains smaller. Existing request/digest conflict semantics remain.

Managed joins default to the selected join interval and reject a larger request. A smaller explicit timeout remains smaller. The persisted join deadline remains min(original organization deadline, registration time + timeout). The implicit join-created organization receives that bounded deadline. Delegated tasks, required/optional children, repairs, joins and continuations retain existing native membership, active-organization and cancellation checks. Dispatch still combines the original organization deadline with its per-run signal. Reopen does not reset deadlines or replay interrupted effects.

Supervisor v4 is unchanged. Persistence of the selected policy is a **managed launcher** guarantee through host manifest/source identity; this does not assert that an arbitrary embedder changing trusted options on the same supervisor directory is refused by an independent supervisor policy store. Such an embedder owns its configuration persistence contract.

No automatic retry, repair, unknown-usage allowance, token/deadline bypass, new permissions, shell/network or additional Persona behavior is introduced. The existing late-cancellation/settled-applied join-yield proof and provider diagnostic guards remain authoritative.

## Validation and withdrawal

See [owner validation](development/PIDA-EXECUTION-POLICY-20261108.md). Withdraw the bounded claim on any accepted over-budget path, altered profile accepted on managed resume, original deadline extension, lost authority/cancellation precedence, or standalone regression. Packaging, parent UI integration, independent review and new actual provider use are separate gates.
