# Proposed inventory-bound managed-host capabilities

Status: documentation-only proposal, 2026-11-08. No current distribution advertises this file. Policy source9cbecfd passed independent review; catalogue source8aa225e is still awaiting independent review. Neither source result makes a packaged feature available. D/b7 retains its existing verified manifest and ready1 behavior.

## Exact sidecar proposal

Add a regular file `managed-host-capabilities.json` at the runtime root, adjacent to manifest.json. Include it in the existing `pida.runtime-distribution/1` manifest.files inventory before calculating file_count/tree_sha256 and the final externally pinned manifest SHA256. Do not extend the existing manifest schema or treat a detached/unverified JSON file as authority.

The sidecar has exactly these eight top-level keys:

```json
{
  "schema_version": "pida.managed-host.capabilities/1",
  "source_commit": "<exact 40 lowercase hex distribution source commit>",
  "entrypoint": "pida/examples/schumpeter-host.mjs",
  "ready_protocol": "pida.local-host/2",
  "workspace_schema": "pida.local-host.workspace/2",
  "execution_policy": {
    "schema_version": "pida.execution-policy/1",
    "profiles": ["<exact closed smoke/1 policy object>", "<exact closed work/1 policy object>"]
  },
  "admission_capabilities": "pida.organization.admission.capabilities/2",
  "persona_catalogue": null
}
```

The angle-bracket values above are documentation placeholders, not valid release bytes. `execution_policy` has exactly two keys and profiles has exactly two complete13-key policy objects from the packaged source's profiles-v1 golden, ordered smoke/1 then work/1. Both values and digests must match [EXECUTION-POLICY-1.md](../EXECUTION-POLICY-1.md); no arbitrary policy tuples or unknown versions are accepted. This avoids a separate source of numeric defaults in the consumer.

For a future independently accepted and actually packaged catalogue, `persona_catalogue` may instead be exactly:

```json
{
  "schema_version": "pida.persona-catalogue/1",
  "mode": "vera-local-reference-catalogue/1",
  "module": "pida/examples/vera-local-reference-catalogue.mjs",
  "environment_key": "PIDA_PERSONA_CATALOGUE"
}
```

Null means catalogue support is not declared by this distribution. It does not disable or make a claim about legacy global reference mode. Current pending8aa cannot be represented as available until its independent and packaged gates pass. The catalogue declaration advertises a trusted module interface, not provisioned profiles, producer availability, current grants, canonical memory access or a selected persona. Parent registry/source/config/store checks remain required.

## Verification order and provenance

1. Resolve an approved runtime from the parent's trusted cache inventory and externally pinned full manifest SHA. Never choose a capability from revision/name, renderer flags, npm version or an unverified manifest supplied by the renderer.
2. Verify exact platform, all files/bytes/modes/links, file_count and tree hash using the existing distribution verification contract. The sidecar and referenced entrypoint/module must be regular inventory entries with exact bytes/hash. A symlink, absent/extra/malformed file or differing inventory fails this new capability resolution.
3. Parse the sidecar only after full verification. Bound it to16384 bytes; enforce exact closed keys/types/version/constants and policy tuples; require source_commit equality with the verified distribution manifest and its source provenance. Missing sidecar gives no ready2 capability. Historical ready1 remains a separately verified retained path, not a fallback after malformed advertised ready2 data.
4. Persist the selected full manifest SHA, source commit and sidecar SHA in the trusted host/cache binding. The existing manifest digest already transitively binds the sidecar; the separate SHA is an inspectable receipt, not an alternative trust root. No manifest self-hash or circular sidecar inventory digest is introduced.
5. At launch, require actual authenticated/private ready protocol, policy tuple/digest and persona mode to match the selected declaration. Require the actual admission capability readback to match. The sidecar permits attempting the supported path; a mismatching live result still fails closed. Preserve exact selected policy and catalogue identity in native resume validation; this declaration cannot migrate an old workspace.

The release source closure must include the exact new launcher/core/helpers/goldens and any declared module. Existing source archive/package SHA and all-file inventory remain the proof of provenance, with an independent build comparison and clean packaged launch/resume/readback probe. For policy9cb only, persona_catalogue is null; for a later combined source, use its exact new full source pin and a catalogue object only after the corresponding package proof. Source review and release proof stay separate.

## Ownership, future checks and no-change option

Pida owns generating the sidecar before inventory collection in scripts/package-runtime.mjs and validating its closed shape against source goldens. Sch owns consuming only the verified cache metadata, persisting its identity and validating actual ready/capability readback. These source changes are not implemented by this document. No build/archive/runtime or consumer edit is authorized here.

Future meaningful tests: tampered/missing/extra sidecar rejected; malformed/future fields rejected; wrong source pin, altered profile tuple/digest or module inventory mismatch rejected; renderer cannot enable work/1 or catalogue by flag; actual packaged ready2/capability2 equals declaration; resumed wrong policy/catalogue refuses without workspace mutation; independently verified legacy D remains ready1 and unchanged. Both platform release closures must include the exact sidecar bytes and ordinary-extraction verification.

The no-change alternative is retaining D/ready1 and not offering the new policies/catalogue. Withdraw capability availability whenever full inventory verification fails, live readback differs, or the approved artifact/source identity changes. The proposal is valid only for the stated closed versions and currently inspected distribution/launcher contracts; execution adequacy and future model cost remain unknown.
