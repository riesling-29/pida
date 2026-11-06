---
name: pix-process-verification
description: Use when inspecting an agent's execution, verifying process lifecycles, or exporting OCEL 2.0 evidence. Uses the configured PIX engine and existing Pida process tools.
---

# PIX process verification

Pida automatically records observed runs as OCEL 2.0: Agent, Session, Task,
Run, Turn, ToolCall, ModelRequest, Artifact, ArtifactVersion, Verification and
Evidence objects with qualified event/object and object/object relationships.
The source journal supports crash recovery; each observed turn end materializes
an OCEL cut and run completion adds artifact/verification metadata. A runtime
restart does not invent the missing events of an interrupted run.

## Use the actual tools

1. `pi_history` lists owned runs and exact source digests. Select the execution
   being checked, including failed executions when comparing outcomes.
2. `pi_ocel` inspects its object/event types, coverage and export digest.
3. `pi_verify_run` imports that OCEL into the pinned PIX engine, validates
   referential/attribute integrity, and aligns Run, Turn and ToolCall lifecycles
   against the host's fixed `pida.runtime-lifecycle/1` policy. Separate call
   objects preserve concurrent tools without inventing one sequential case.
4. Read the result's structure status, process judgment, checked-object coverage,
   limits and issues. Cite the returned resultRef, resultDigest, ocelDigest and
   modelDigest. `pi_verification_read` rechecks access and the exact source cut.
5. For custom process expectations use existing `pi_reflect` / `pi_awareness`
   with their documented fixed model, cohort, held-out evaluation and budget
   constraints. Do not learn a model from a run and claim that same run is an
   independent verification of the model.

The standard JSON is available via the owned run export `?format=ocel` or
`pida export SESSION RUN WORKSPACE --ocel`. The SDK also returns coverage and
digests. Do not reconstruct events or edit evidence to make a check pass.

## Meaning of the result

- `structure: PASSED` means PIX accepted the OCEL structure and semantics.
- `processJudgment: conforms` concerns only the declared lifecycle policy.
  A tool that starts and fails can conform while the task itself has failed.
- An open cut remains `pending`; missing PIX configuration is `unavailable`
  with unknown judgments. Source changes require selecting a new exact cut.
- Legacy observations without explicit turn IDs do not establish turn coverage.
- This profile is per-object DFG alignment, not object-centric Petri-net or
  full business-process conformance. Cross-object dependencies are not checked.
- Code correctness still needs actual tests/browser checks tied to the current
  artifact version. Business acceptance and ResultManifest verification_status
  remain UNKNOWN without an independent authority. Never promote them merely
  because PIX or the model reports success.

## Installation and authority

This guide is a bundled Pi native skill. PIX is an optional, host-installed
Python engine selected by `processIntelligence` configuration and exact source
pin. This guide neither installs code nor grants permissions. `pi:read` and
`pi:analyze` are required; memory writes require separate explicit permissions.
Use at most the configured analysis calls per run. No self-modification or
automatic correction follows from a deviation.
