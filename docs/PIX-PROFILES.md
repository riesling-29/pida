# PIX selected profiles — 0.8.6

The optional SDK consumer implements the alternatives selected by the PIX owner
in [the CR response](change-requests/incoming/PIX-RESPONSE-CR-PIDA-PIX-2026-11-03.md).
The existing `pida.pix.worker.v1` batch interface and commit allowlist remain intact.
The same bounded process transport and worker now also expose
`pida.pix.profiles/1`. All calculation uses the existing PIX public operators.

| Profile | Required model and source | Result meaning |
| --- | --- | --- |
| `sequential-prefix/1` | Native Petri net, explicit accepting transition paths, independently justified contiguous case sequence | Approximate witness upper bound. Open completion is pending; even closed zero-cost results remain partial. |
| `object-terminal/1` | Native OCPN, exact artifact revision IDs/E2O, explicit completed task snapshot, timezone-aware point times | Terminal event-weighted alignment. Independent selected objects remain unordered; same-object time ties are unavailable. |

The latter is not a live object-cut algorithm. Pida does not convert the existing
empirical DFG into a Petri net, infer concurrent order from IDs, or call these
different costs one normalized fitness score. Models do not grant permissions.

## Host setup

Select the read-only PIX source at **`a0831bc0b34fd7feebfba928066b90b114ae531e`**
(PR14). Engine 0.5.0 has the same 240 Python files and SHA-256
`b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510`.
This is a deliberate new profile pin; do not change the batch configuration's
`3205d832...` commit merely because the source digest is equal.

```ts
import { createPixProfileProcessPort, pixProfileBuild } from 'pida-core';
import { createWorkspace } from 'pida-core/workspace';

const port = createPixProfileProcessPort({
  pythonExecutable: '/absolute/path/to/python',
  workerPath: '/absolute/path/to/pida/scripts/pix-worker.py',
  sourceDirectory: '/absolute/path/to/PIX-profile-pin',
  expectedSourceCommit: pixProfileBuild.sourceCommit,
  expectedSourceDigest: pixProfileBuild.sourceDigest,
  timeoutMs: 10000,
});
const app = await createWorkspace('/absolute/workspace', {
  processProfiles({ agentId, workspaceId }) {
    return {
      port, enginePin: pixProfileBuild,
      // Your existing authoritative source must implement PiProfileSource.
      // This is an embedding hook, not a bundled provider or automatic mapper.
      source: sourceForAgent(agentId, workspaceId),
    };
  },
});
```

`sourceForAgent` above is host application code, not an exported Pida function.
The host owns its existing event ledger, publication/CAS, authenticated access,
model selection and policy/artifact revisions. `PiProfileSource.resolve` must
recheck access each time and return the full typed `PiProfileSelection` for the
requested cut/model references. `list` optionally advertises at most 64 such
pairs. Pida validates principal/agent ownership, selected counts/exclusions,
provenance, scope, generation and the closed worker contract. It re-resolves the
selection after computation; any change rejects the result as `PI_STALE_CUT`.
This read-only port does not pretend to implement an external ledger transaction.

Source sequence must already be justified by the selected mapping. Do not fill
gaps or renumber omitted observations. Exclusions remain explicit in coverage.
Object type selection does not filter events: authorize/select the task's exact
events before passing the whole-log snapshot. An unrelated actor must not join
tasks. Native object/relation exclusions are exposed in the result summary.

The host supplies immutable `pix.model/1.0.0` documents, parsed by PIX's native
codec. Model revision, kind (empirical/aspirational/mandatory), derivation, source,
policy and scope are separate. The public SDK types are in `pix-profiles.ts` and
`process-profiles.ts`. A model-producing tool cannot publish sources or change
the host's selected model through this interface.

## Tools, evidence and continuation

When the host configures the factory, main and persistent-agent workspaces gain:

| Tool | Permission | Behavior |
| --- | --- | --- |
| `pi_profile_list` | `pi:read` | Revalidates and lists selected cut/model references. |
| `pi_profile_analyze` | `pi:analyze` | Bounded computation, optionally continuing an owned result's checkpoint. |
| `pi_profile_result` | `pi:read` | Fresh source authorization; labels changed evidence STALE. |

No permissions are added by registration. Existing Web/HTTP/SDK run paths can
invoke these tools. There is no automatic live monitor, new model-selection UI
or JSON-only standalone setup for arbitrary host sources. Existing batch tools
and ordinary agent execution do not need this factory.

`ProcessProfileAnalysis` stores private immutable results under
`process-profiles/<agent>/`. The artifacts bind owner, logical agent, exact
selection/request, source/model/policy/artifact revisions and actual engine pin.
Tools return bounded summaries; `app.processProfiles.get(agentId).read(...)`
returns full evidence after authorization. A changed source makes historical
results STALE; revoked access denies even their metadata. No result is adopted
or written into Persona automatically. Overall business acceptance is UNKNOWN.

Checkpoint continuation is allowed only for an unchanged prefix, same case,
generation/model/proxy/budgets and task/artifact/scope/policy identity. Corrections
within the same generation are rejected. An explicit new generation recomputes
from its selected facts. An explicitly closed source cannot be reopened by
appending events. Previous evidence remains immutable. Caller-selected prior
result references are owner checked; the model cannot supply arbitrary checkpoint
bytes. This avoids adding another mutable source head or implicit CAS writer.

Native results and checkpoints retain **exact JSON strings plus SHA-256**. Do not
parse and reserialize these strings: JavaScript can turn `1.0` into `1`, invalidating
the native PIX document digest. The computation metadata and its source digest
are not a canonical OCEL digest, a signature, permission or task acceptance.

The process boundary reuses isolated Python, verified temporary source copies,
minimal environment, bounded input/output/stderr, deadline and cancellation.
It is not an enforcing OS sandbox. Source-port calls must honor the supplied
abort signal; source availability is a host responsibility. Native Windows
execution of this new Pida consumer remains untested.

## Reproduce actual integration

```sh
npm run build
npm test
node scripts/pix-profiles-check.mjs --source /absolute/PIX-profile-pin --output /absolute/new-output
python -B scripts/pix-worker-check.py --source /absolute/PIX-batch-pin
```

The first integration command uses actual PIX/Pida/Pi with synthetic source facts
and a scripted model. It includes a workspace tool call. It does not measure live
LLM efficacy or authenticate a remote Persona provider. [Validation](CR-FOLLOWUP-VALIDATION.md)
separates those boundaries and contains exact command/build/evidence references.
