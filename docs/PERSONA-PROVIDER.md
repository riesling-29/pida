# Managed Persona context consumer

Pida owns the execution/input boundary. `PersonaProvider` in `src/persona-provider.ts` is a **Pida consumer port**, not a claim that PersonaSubstrate currently implements this API. No PersonaSubstrate repository, canonical database, identity record or service is changed by this patch.

## Authority and reuse

| Information | Existing local authority | External-provider boundary |
| --- | --- | --- |
| Persona text and versions | `AgentMemoryStore.personaHistory` | Selected provider; no local mirror write |
| Sourced experience/corrections | Existing `AgentMemoryStore.experiences` | Provider append contract |
| WorkingState contents and CAS | Existing `AgentMemoryStore.states/head` | Provider-owned transition, not an execution-state update |
| Behavior analysis references | Sourced `agent-report` experience in that same store | Optional `appendAnalysis`; unsupported when absent |
| Execution phase/task/job status | Pida runtime/supervisor | Remains Pida-owned |
| Input-inclusion receipt | Pida provider-facing transcript hook | External provider cannot certify consumption |

`createLocalPersonaProvider(memory, { principalId, workspaceId, personaId?, role?, maxChars? })` wraps the existing memory store. It does not create another identity registry. The generated local persona ID is stable for the host-selected principal, workspace identity and logical agent ID. Embedded SDK principals use separate original memory stores and distinct default identities/scopes. Moving to another workspace requires an explicit stable `personaId` if identity continuity is desired; a filesystem path alone is not a universal identity.

The main runtime's existing observation agent UUID remains unchanged. The binding's logical agent ID (`main` or a registered worker ID), persona ID and scope are joined to each observation run through the descriptor. The workspace exports a digest of private role instructions as a cohort ID (including legacy empty roles), not the original role text. A role label grants no permission.

## Actual input boundary

`RuntimeOptions.personaProvider` and legacy `contextForRun` are mutually exclusive. Before each managed run:

1. The runtime supplies the authenticated principal, selected logical agent, session/run/task and cancellation signal to the chosen provider.
2. The provider selects text and descriptor from one memory read. The descriptor binds persona revision, selected state/experience revisions, full-store context revision, selected-text digest, renderer, scope and omissions.
3. Pida validates the closed descriptor and matching text digest, then appends the reference context using Pi's custom message API. `context_snapshot_loaded` means loaded, not consumed.
4. At the public Pi stream-function boundary, after context transforms and conversion, Pida checks that the exact pinned text is present in a user reference message. It records `context_input_included` or `context_input_omitted`, linked to the request ID and attempt. Managed omission prevents provider dispatch.

The receipt's `inclusion_scope: pi-logical-context` identifies the provider-facing Pi execution transcript. Each receipt consumes one prepared execution-request marker. Pi's internal summary calls reuse the stream hook but are distinguished by the observed `compaction_start`/`compaction_end` lifecycle; they cannot reuse the previous execution request ID or emit an execution inclusion receipt. A normal managed dispatch without a prepared boundary fails closed. Internal summarization usage remains an explicit manifest limit. This does not establish serialized provider wire bytes, model comprehension, obedience, task success or beneficial use. Cancellation before this boundary produces no inclusion receipt. Raw context and persona text are not in default observations.

The prepared projection preserves Pi's leading system/tool baseline before host reference context, including native Responses requests. Only tools granted to the current run principal are active; full registered inventory still reports ungranted tools separately. This avoids spending a small model's context budget on tools it cannot use. Forced calls to known ungranted tools remain forbidden.

If compaction/pruning removes the context before request preparation, Pida reprojects the same run-pinned snapshot. It does not silently select newer memory during that run. A later run resolves a new snapshot; persisted session metadata preserves prior binding provenance through restart/handoff. Legacy contexts without a Persona binding remain distinguishable and do not gain a managed-Persona claim.

Automatic compaction stays enabled. Its output reserve includes the configured model output plus a window-scaled growth margin, capped at half the window. This preserves a useful input budget for small local models without imposing a fixed 4k margin; large windows retain the existing 4k growth margin.

## Storing analysis for the next context

`appendAnalysis` takes the same authenticated request plus `expectedRevision`, `idempotencyKey` and a closed record:

```ts
{
  kind: "reflection" | "awareness",
  modelKind: "empirical" | "aspirational" | "mandatory",
  modelRef, modelDigest,
  resultRef, resultDigest,
  snapshotDigest,
  evidenceRefs,
  interpretation? // explicitly an agent report
}
```

The built-in adapter requires `agent:memory:write` in addition to the analysis-tool permission. It appends to the existing store under its existing private mutation lock. Same key/payload replays return the same record; changed payload conflicts. Another memory write invalidates the expected context revision. This append does not edit persona, move the WorkingState head, activate a behavior model as policy or mark a task complete.

The result contains the appended/replayed experience ID and current context revision. The bounded next context can include these references through the ordinary experience projection. Truncation remains explicit; storing a record does not guarantee it was selected into every later context. The PI consumer owns calculation bytes/evidence; the Persona provider owns the reference/interpretation record. Secret-bearing and reserved internal references are rejected.

Ordinary memory mutation APIs cannot write the reserved analysis idempotency namespaces. Replay checks both internal markers and exact active record content/authority/references; a legacy forged marker or a retracted record cannot impersonate a successful prior analysis append.

## Validation profile and remaining integration

`test/persona-provider.test.mjs` uses actual Pi request conversion/dispatch with a scripted model, the real existing local memory store and a clearly named external contract fixture. It covers scope denial, digest/closed-schema rejection, actual context visibility, cancellation before dispatch, converter omission, pinned reprojection, CAS conflict, duplicate/restart and stored-analysis consumption in a later request.

For 0.8.4, actual PersonaSubstrate integration was **NOT_RUN**. The new 0.8.5 local source integration below supersedes that statement only for its documented synthetic local profile. Public remote provider deployment and canonical data integration are still NOT_RUN. The external authority must not be paired with active local canonical memory writers. External unbound agents do not become managed or verified by attaching a program proxy.

## Vera continuity adapter — 0.8.5

`createVeraPersonaProvider(options)` in the main package export supports the observed `Binding@1.0.0` and `VeraContext@vera-continuity/0.2.0` closed schemas. They are pinned in `src/vera-contract.ts`. Both documented renderers are supported. The adapter validates exact context/text digests, PS-C14N-1 values, host-selected identity/scope/run/task, budget and validity. It preserves external IDs and model/analysis/artifact provenance without pretending they are local memory records.

The embedding host supplies all identifiers plus a `VeraPersonaPort`:

- `resolve(request)` returns `{binding, context}` for the actual Pida `runId`/`taskId`. Principal and authority are configured by the host. An existing Persona is provisioned/bound by its owner; no automatic grant creation is exposed to the model.
- `authorizeInput(request)` performs a **read-only current** permission/source/model-validity check on the exact pinned context before every dispatch. It returns `{authorized:true, requestId, bindingId, contextDigest, inputDigest}` with exact matching values. This method must not enqueue work or create a provider use receipt. A changed, expired, revoked or unsupported request fails closed. Cancellation/timeouts are bounded by the runtime's existing signal.

Use the provider through `new PidaRuntime({personaProvider, ...})`, or return one from `createWorkspace(directory, {personaProvider: hostFactory})`. The existing workspace factory applies to the main and worker runtimes and suppresses local canonical writers. The port is host-supplied SDK configuration, not JSON configuration or a model-selected endpoint. The package does not bundle a Persona server, credentials or a generic Python service launcher.

The runtime clones the converted input across the asynchronous check. Its receipt adds `input_digest`, `input_digest_scheme=source-hmac-sha256`, `fingerprint_scope` and `authorization=current-provider-check`. The digest covers `{model:{provider,id,api},context}` at the Pi logical boundary. It is not a wire/request-options hash or proof that the remote model received or obeyed it. No private fingerprint key is exported. An independent consumer cannot recompute it without trusted host evidence.

Summary calls are reauthorized separately and emit `context_summary_authorized` with the checked descriptor; they do not emit execution inclusion receipts. Explicit compaction creates a fresh binding for that host operation. Normal request preparation removes superseded `pida-run-context` custom messages from the next logical projection. This is not retroactive deletion of stored session history, earlier model responses or summaries; a new history scope/identity requires host-controlled session isolation.

When required local receipt recording fails, dispatch stops. External observation-sink delivery remains best effort and cannot block unrelated execution. Without `storageDir`, `CONTEXT_RECEIPTS_VOLATILE` is reported; existing external providers without the optional hook remain compatible but disclose `PERSONA_AUTHORIZATION_SNAPSHOT_ONLY`. No remote receipt writeback or distributed exactly-once promise is introduced.

The [actual integration runner](../fixtures/cr-integration/README.md) uses real local Persona/Pi code with synthetic data and scripted responses. The test-only shim calls pinned private read-validation methods; a supported public revalidation endpoint and remote receipt/readback contract are requested in the [owner response](change-requests/responses/PERSONA-CR-PIDA-001.md). External WorkingState writes, analysis append/model activation and organization execution phases are not automatically mapped by this context adapter.
