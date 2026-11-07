# Two-organization real-case preparation — not executed

This is a bounded plan and evidence helper, not approval to make another paid
call. Root must first confirm the final joined desktop/provider/package is ready.
The application source remains `bb9886f`; Linux packaging recipe `46e22f5` only
corrects modes. This unit changes tests/helpers/docs, not the runtime package.

The agreed scenario has **three actual profiles, two native goals and four
expected native jobs**: organization A root/child/continuation, then organization
B's distinct worker as a fresh root. No third goal, automatic repair or hidden
retry is planned. At most two native participants belong to a goal. A child
cannot delegate to B because B is outside A's native participants; a delegation
back to its ancestor is also rejected. These are runtime restrictions. The
instruction to delegate exactly once is a model instruction, monitored rather
than presented as a new permission boundary.

## Existing provider and bounds

[Read-only preflight](two-org-smoke-provider-preflight-20261107.json) observed the
already authorized provider configuration: native OpenAI, `gpt-6-astra`, ChatGPT
auth, credential present. It used only supported credential status, without
refresh/network calls or credential values. Presence does not establish current
provider authorization or successful future refresh. The parent supplies the
approved provider-settings workspace through `--provider-workspace`; the new
managed runtime never opens/replays that workspace's conversations. The host
forces low thinking. OAuth cost remains **unknown** unless actually measured.

| Bound | Current supported behavior |
| --- | --- |
| Per native run | 20 seconds, 24 model turns, 48 tool calls |
| Provider/output retries | 0 / 0; automatic compaction false |
| Token observation | 16,384 per run, checked after responses; not a billing cap |
| Host concurrency | 2; A then B are admitted sequentially |
| A native organization | max_repair_attempts 0, timeout_ms 90,000 |
| A durable join | timeoutMs 45,000, one required child, no optional children |
| B native organization | max_repair_attempts 0, timeout_ms 45,000 |
| Case monitor | 500 ms observation cadence; stop after >12 observed requests, unexpected jobs/agents, unknown effects or 180 seconds active case time |

`src/workspace.ts` supplies the agent/workbench defaults 24/48. The ordinary
runtime constructor's generic defaults 8/16 do not apply here. Workspace config
does **not** expose maxTurns/maxToolCalls, so no unsupported JSON keys or changed
host source are used to tighten them. The monitor is observational and may
overshoot between reads; it is not a hard aggregate-call cap. Planned requests
are approximately A root 3 + child 1 + continuation 2, then B 2 = **8 estimated**.
Report actual requests/turns/status/elapsed time afterwards, not the estimate.

The accepted managed profile grants native workbench read/write/history and
delegation, but no project shell, network/web tool or workbench execution
permission. It enables no user tool directory or coding pack. Actual available
tool metadata must still be retained with the run; do not infer a capability from
the model's prose. `workspace_write` writes only that agent's private workbench.
This is not a three-tool allowlist: other built-in workbench/UI and local agent
memory tools can remain available. The goals explicitly limit requested work;
unexpected tool use is recorded and reviewed rather than falsely claimed to be
prevented by a per-job capability filter.

On a guard/failure: use the parent's current-authority cancel control once, then
read back. If bounded cancellation cannot settle, terminate the dedicated host
and retain interrupted/unknown evidence. Do not restart to replay an uncertain
effect, resend a new goal, refresh credentials repeatedly, or ask the model to
repair automatically. Runtime limits are ceilings, not a claim all calls finish
before a provider-side operation completes.

## Operator ordering and Persona challenge

Schumpeter records operator question → provider clarification → requester
re-ask/detail before admitting A. These are explicit operator/imported-result
messages, not fabricated agent-send tool calls. Then:

1. Generate a fresh case/seed locally with `preparePersonaChallenge` **before**
   initializing A's app-owned reference store. Only `persona_description` goes
   into that explicit Persona configuration. Keep the seed/oracle outside native
   workbenches and model-visible goals, acceptance criteria and injected results.
   The store identity and config are immutable for this run. No canonical memory
   is used. One configured reference Persona may bind A's two real agent IDs;
   this does not establish two independently evolved Persona identities.
2. After three native profile IDs exist, pass the same case/seed plus those IDs
   to `prepareTwoOrgSmoke`. Its public plan contains no seed or precomputed
   answer. Root A delegates exactly the prepared generic child instruction:
   obtain `probe_seed` from the child's own selected Persona, compute
   `probe_seed * 3 + 7`, return JSON. Root then registers `agent_join` and ends.
3. The child reports the derived value. The host creates a real continuation of
   A's root task. That continuation writes
   `artifacts/organization-a-result.json` in the **root's** workbench with case_id,
   derived, actual child_job_id and child_agent_id. Child/root filesystems are
   separate; a child result is transferred as native join data, not assumed to
   be a shared file. No harness-generated child result is injected.
4. Capture the actual final continuation artifact as described below. The
   operator forwards its observed bytes/reference and reviews/accepts the exact
   Schumpeter artifact revision. No native acceptance criterion contains the
   private oracle. Empty native criteria remain UNKNOWN even if the external
   semantic oracle and Schumpeter artifact review pass.
5. Build B's goal only with the observed A artifact through `prepareAnswerGoal`.
   B gets a new reservation/request/native OrgSession and writes
   `artifacts/organization-b-answer.json` with the forwarded data and received:true.
   B legitimately consumes A's derived value. Therefore B's matching value is
   **not** evidence that B obtained that value from its own Persona.

Cross-organization correlation is Schumpeter room/contract/message/artifact
identity. B's envelope must not use A's job as `reply_to_job_id`: that optional
native field requires the same recipient agent. A→B is neither a native parent
edge nor a resumed waiting parent. The B goal/definition digest includes the
forwarded source artifact digest, while Schumpeter retains its own logical
artifact revision independently from pida's file-byte revision.

## Exact output and linked trace capture

The [helper](../../test/helpers/two-org-smoke.mjs) contains no goal submission or
provider call. Its public capture reads may reconcile already admitted work; run
the final capture after the native goal has settled. `captureLinkedOrganization`
reads the OrgTask→OrgAttempt→job mapping and exports each actual run separately.
It preserves initial admission root job ID even when the root task's latest
attempt is a continuation. BatchJoin.required/optional are assignment job IDs;
BatchJoin.results identifies selected final child attempts/jobs. Do not conflate
those identities, even though no repair is planned in this case.

Use the root task's actual final continuation record, not admissionReceipt.job_id,
to select the A output. `readCapturedRunArtifact` selects the requested path only
from that validated run's manifest.artifact_refs, then calls the existing public
`PidaClient.readAgentFile` API. The response is `{path,content,revision,bytes}`;
revision is SHA-256 of the exact file bytes, **not** a whole-workbench or
Schumpeter logical revision. It compares bytes/content hash/revision to the
run-captured artifact ref before returning an operator-attributed capture. A
changed/unavailable file is an explicit failure, not replaced by current text or
a synthesized revision. The parent can export these captured bytes to a new
operator-selectable file. No broad Schumpeter file API is required by this helper.

For plain output, only terminal completed `job.result.text` is final reported
text; `latestText` can be partial. Neither is independent acceptance. There is no
historical immutable artifact-byte endpoint; matching returned bytes are copied
into Schumpeter's durable operator publication with their native provenance.

There is no public organization snapshot token. The helper retains before/after
views and explicitly marks `atomic:false`, `snapshot_token:null`, whole
organization completeness UNAVAILABLE. Equal views are not an atomicity proof.
Missing child/continuation bundle or OCEL exports remain explicit gaps. Each run's
source IDs/sequences remain unchanged; no timestamp sorting creates cross-run
causality. Raw capture includes job text and is **not** the metadata-only PIX
input. The Schumpeter analysis adapter must apply its approved closed projection.

The helper can audit **explicitly supplied fresh synthetic** Pi JSONL tool-call
arguments. It emits hashes/booleans, never the raw seed/arguments. A root-created
child assignment containing the seed or expected answer weakens the claim that
the child used its own Persona. Missing/unsupported capture yields UNKNOWN.
Model-generated write output derived from authorized Persona is legitimate and
is not treated as independent harness injection. Do not inspect canonical or
pre-existing user session logs. Logical input inclusion is not raw provider-wire
capture or a proof of internal model causality.

## Preparation verification and remaining gate

[Three preparation checks](two-org-smoke-preparation-tests-20261107.txt) pass:
oracle isolation/derived-output distinction; captured-path/exact-byte artifact
selection with stale rejection; actual scripted Pi root→child→continuation with
three separately valid complete native bundle/OCEL exports and explicit handling
of an injected missing child export. The scripted chain has five model requests,
two executing agents, two tasks and three attempts; it does not exercise real
provider behavior, artifact generation or the final desktop UI. The artifact
selector's byte tests are synthetic unit tests, not an extra actual artifact run.

Before any real execution, root confirms final reviewed packages, actual GUI
provisioning and current source pins. Retain actual jobs/artifact revisions,
provider/context inclusion, call count, failures and unknowns. Withdraw the
Persona-use claim if the private oracle entered independent inputs; withdraw
linked-run completeness if exports/mappings are missing; never promote native
UNKNOWN to PASS from a model's completion text. This preparation is valid only
for the recorded APIs/profiles and does not promise the real scenario will pass.
