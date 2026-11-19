# Native join yield after an empty normal final response

The retained user retry delegated a child, durably registered agent_join, and
ended with an empty normal assistant response. The generic EMPTY_RESPONSE guard
failed that parent and blocked its join even though the child completed. The
[negative evidence](two-org-a-user-retry-negative-20261108.json) remains unchanged.
This source correction neither replays that work nor changes its stored outcome.

## Bounded handoff contract

Only an actual host tool with `BusinessTool.confirmRunYield` can supply a yield
proof. The callback is not in the model schema or returned payload. Runtime
captures it only after a classified successful invocation and its effect-ledger
receipt has settled `applied`. A tool name, model marker, raw returned flag,
read-only effect, failed/not-applied/unknown effect is insufficient.

The native agent_join callback validates the persisted join ID and revision,
parent job/run/session, active non-aborted supervisor lease, owner and delegated
principal, current latest native OrgAttempt/OrgTask, active OrgSession/deadline,
waiting join/deadline, participants and every direct child membership. It is
synchronous, read-only, and performs no I/O. Only literal true grants a yield;
exceptions and thenables fail closed. The permission snapshot is the actual
run-scoped principal. Existing join reconciliation and continuation dispatch
resolve current owner permission and external admission policy again; yielding
does not grant a later execution authorization.

The runtime may yield only after `stopReason === 'stop'` with empty actual text,
no earlier guard/failure, no pending effects/tools and no cancellation/deadline.
The proof is checked again after asynchronous work-review collection. That
collection receives provisional EMPTY_RESPONSE, never premature success.
Final settle stores the actual terminal outcome. If authority/state changed
during that boundary the result remains failed, cancelled or limited; no failed
runtime is rewritten to a completed supervisor job.

Successful yield uses the existing RunResult fields:

```json
{"status":"completed","code":"AGENT_JOIN_YIELDED","text":""}
```

This means the initial run yielded, not that the task/organization succeeded.
The actual empty text is preserved. The waiting task receives no acceptance
receipt. Existing durable reconciliation creates at most one continuation when
required children succeed and all members settle. Required failure blocks it.
The initial admission receipt's job ID is immutable; a final continuation has a
distinct job/run/attempt and is selected through the native task graph.
Consumers must not capture the empty yielded initial run as a final artifact.

Unknown usage/token/cost limits, provider error/aborted, run timeout, cancellation,
effect recovery, persistence failure and classified tool failure keep priority.
Generic empty responses without an applied current native join still fail.
No prompt-only acknowledgement, manufactured output, new schema, automatic
replay or provider retry is introduced. Crash before native terminal persistence
retains existing interrupted recovery semantics.

## Verification and limits

Independent review of exact `2b787fd4c234747da22726ec03a3e4c6619ae95f`
passed the build, all 62 focused cases and 17 additional adversarial cases.
The [review report](native-join-yield-independent-20261108/INDEPENDENT-NATIVE-JOIN-YIELD-REVIEW.md)
preserves the bounded verdict and baseline reproduction. Original top-level
probe sources, results and logs are stored byte-for-byte in the
[archive](native-join-yield-independent-20261108/original-evidence.zip) with
[hash index](native-join-yield-independent-20261108/archive-index.json).
This independent context uses the same model family; it does not establish
package, consumer capture or live-model acceptance.

Build and 62 focused cases passed, including 23 new yield cases and existing
organization/provider/runtime tests. Actual local Pi with a scripted provider
exercised waiting child, child finishing before parent, required failure,
nonempty baseline, paused-child restart and exactly one continuation. Other
cases reject tool-name spoofing, false/throw/thenable/truthy callbacks,
read/not-applied/unknown/failed effects, foreign run and stale/cancelled join;
cancellation, revision change and deadline during work-review await; provider
failure, unknown usage and token limits. Run/job/observation status and actual
text agree, and completed yield survives reopen without reexecution.

Initial test construction mistakes were corrected: JSON roundtrip comparison
must omit undefined optional fields; parallel child-first setup must assign
separate workspace keys; existing token-limit code is TOKEN_BUDGET. No runtime
limit or product assertion was weakened to make these tests pass.

See [validation record](native-join-yield-validation-20261108.json) for source
hashes and command. Its pending-review field describes the original author
freeze; the later independent report above supplies the separate review result.
No external model/auth call or actual desktop acceptance was performed.
The held bb9886 package, old real-case workspace and both negative attempts are
unchanged. New runtime packaging/source identity must be reviewed before a new
verification workspace uses this behavior; there is no legacy identity rewrite.

The bounded claim is withdrawn if an absent/stale/foreign join yields, a higher
priority guard becomes success, native result/observation disagree, a waiting
run gains task acceptance, restart duplicates a continuation, or a cancelled
work-review boundary persists successful yield. Its validity is limited to the
exact source hashes and tested local contracts; billing and future real-model
completion are unknown. Leaving the old runtime unchanged remains the valid
deployment alternative until independent review and package gates pass.
