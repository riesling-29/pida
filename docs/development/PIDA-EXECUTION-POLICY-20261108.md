# Managed execution policy source validation

This is a new source-only unit based on runtime b7 and docs parent a2336d1. The exact contract is [EXECUTION-POLICY-1](../EXECUTION-POLICY-1.md). Source is isolated at `D:/ChantaResearchGroup/pida-execution-policy-20261108`, branch `feat/trusted-execution-policy-20261108`. The original pida checkout, all accepted runtime distributions, D workspace and previous cases are unchanged.

Implemented: fixed named policy catalog, trusted workspace bounds, organization/create/admission/join ceilings, managed host manifest/ready v2 and admission capabilities v2. Default smoke/1 retains20s/run and selects60s/org; explicit work/1 selects180s/run and900s/org. Standalone no-policy behavior retains its prior1h native default and repair options. Persona catalogue semantics and all tool permissions are untouched.

## Owner checks actually run

- `npm run build`: PASS (TypeScript source build only; no npm pack, distribution archive, account or provider call).
- `node --test --test-timeout=30000 test/execution-policy.test.mjs`: 13 PASS.
- `node --test --test-timeout=30000 test/execution-policy.test.mjs test/organization-yield.test.mjs test/organization-admission.test.mjs test/organization.test.mjs test/collaboration-policy-client.test.mjs test/provider-diagnostic.test.mjs`: 71 PASS, 0 failed, 0 skipped, about20.08s observed. Includes actual local Node host/Python policy and scripted Pi, not remote model calls.

The new cases cover exact catalog/digest rejection, both native defaults, overbudget no-publication snapshots, standalone defaults, admission lost-ACK/reopen identity, explicit/implicit native delegate/join/continuation, unchanged deadlines, trusted runtime override, fresh/resume actual processes, wrong-policy/legacy manifest byte preservation, and expiry/cancellation after reopen. Existing tests cover current authority revocation, SIGKILL/interruption, unknown usage/token guard/provider failure, late cancellation and native applied-join proof.

Initial implementation checks caught a TypeScript literal-widening error (fixed with explicit ID union). Test setup corrections were: maxConcurrent9 exceeded the existing config maximum8; public PidaClient requires a token callback; initWorkspace's demonstration tool needed disabling in the generic trusted-runtime fixture; and expiry observation needed awaiting the already-asynchronous reconciliation rather than assuming the first immediate read had settled. These were fixture/type corrections, not reasons to relax runtime guards. Final commands above passed after corrections.

[validation.json](execution-policy-evidence-20261108/validation.json) records changed-source hashes and command outcomes observed through the execution tool. The broad command stdout was captured by that tool rather than separately saved as a repository log; this record does not invent a raw log. Golden profiles are source-generated and their digest algorithm is tested. Diff integrity is checked separately.

## Limits and next step

This is not a package, UI or general coding acceptance. Proposed longer values have no adequacy evidence. Costs remain unknown; observed token limits are not provider billing caps. Supervisor policy persistence is enforced by the managed launcher identity, not a new standalone state schema. Existing old workspaces reopen only with their exact retained source; no migration is offered. Command execution, project selection and per-agent Persona mapping are explicitly excluded.

Next: independent read-only source/adversarial review of the frozen commit; then a separately authorized Schumpeter consumer and distribution unit. Withdraw on over-budget admission, deadline reset, profile mismatch mutation, bypassed cancellation/usage/authority guards, or changed standalone behavior. Valid only for this source and the tested local Windows environment.
