# Independent native join yield review

Reviewed source: `2b787fd4c234747da22726ec03a3e4c6619ae95f`, with provider-diagnostic
base `1f9c5ebcef8095f008c4a1d472bd86a2e995408e`. The review checkout is
`D:/ChantaResearchGroup/pida-join-review-20261108`. Product source was not edited.
This is a separate-context, same-Codex-family review on Windows with Node
24.18.0 and the existing pinned dependencies. No provider, authentication or GUI
request was made. The scripted Pi provider tests execute the actual local
runtime, tools and supervisor, not a replacement join implementation.

## Evidence before correction

The isolated baseline `12eb2155f326c53aa7444127a2ca966d7923d159` has no `src/`
diff from the accepted `bb9886ffc3a2a815e3c255b7dbfc83b4b4bac5e3` runtime.
Its existing organization suite passed 13 tests. Two independent differential
cases reproduced the missing boundary: a nonempty acknowledgement after a
successful native join produced a continuation; an empty normal final reply
produced `EMPTY_RESPONSE` and blocked the join while the concurrent child
completed. Both expected-outcome tests passed.

The first construction of that differential fixture used one shared execution
slot and incorrectly expected the child to complete after its organization had
failed. That child instead failed before execution. The retained successful
reproduction uses two independent workspace keys and a delayed child, matching
the relevant concurrency shape. This was a review-fixture correction, not a
product change or newly discovered product defect.

All 13 retained actual user-retry artifact hashes matched the owner's public
negative record. Independent metadata inspection confirmed root
`196954f5-9514-44de-969a-8c446d7781ce` failed with empty text, child
`1988f585-dc8c-4774-bd6d-4bf0d161ac61` completed, and the join had no continuation.
The selected retry contains three root model requests and one child request,
all with reported usage. These are historical observations, not calls made by
this review. The review copied no raw challenge value, tool arguments or
credential material into its evidence.

## Source boundary examined

The new host-only `BusinessTool.confirmRunYield` callback is captured only after
a classified successful tool invocation and its effect receipt settles
`applied`. Model text, tool names and returned flags do not supply that callback.
Host extension code is trusted authority at this boundary; the callback is not
a defense against a malicious host registering arbitrary code.

The native callback revalidates active parent/agent/owner/run/session identity,
latest task attempt, live organization, waiting join revision and deadlines,
and direct child membership. Its permission proof is the actual run-scoped
principal. Later reconciliation and continuation dispatch still re-fetch
current permissions and external policy. Yield itself grants no new execution
authority.

The runtime requires a normal `stop`, actual empty text, no prior guard, no
pending effects/tools and no cancellation/deadline. The callback is synchronous
and must return literal `true`; false, exception, thenable and truthy objects
do not permit a yield. The proof is checked again after asynchronous work-review
collection. That intermediate review receives conservative `EMPTY_RESPONSE`;
only the final settled outcome can become `completed / AGENT_JOIN_YIELDED`.
The actual text stays empty. The supervisor is not rewriting a failed persisted
job into success.

This code means the initial run yielded. It is not a final task artifact or task
acceptance. A required child failure still blocks the join; successful children
lead to one distinct continuation. Consumers must reject the yielded initial
run as a final captured artifact. Schumpeter's separate capture-consumer change
is outside this review.

## Independent execution

- Build: `node scripts/task.mjs build` passed.
- Targeted producer suites: 62 passed, zero failed/skipped.
- Additional independent tests: 17 passed, zero failed/skipped.
- Native cases covered a child finishing early and later, required child
  failure, durable reopen with no duplicate continuation, foreign
  run/session/owner/job/revision, cancelled join, and close before native terminal
  persistence. The last remains interrupted and creates no continuation on reopen.
- Guard cases covered name/marker spoofing, false/throw/thenable/truthy callbacks,
  not-applied/unknown/failed effects, provider failure, unchanged nonempty text,
  cancellation and stale proof during work-review collection. The producer
  suites additionally exercise usage/token guards, deadline and paused-child
  restart. These are overlapping scenarios, not independent statistical trials.
- Native initial-run result, job and exported `run_finished` agree on completed
  yield and preserve empty text. The export validates with the existing
  observation-bundle validator. With no host acceptance criteria, organization
  acceptance remains `UNKNOWN` after the synthetic continuation.

Exact commands, source/test hashes and artifact hashes are recorded in
`review-metadata.json` and `evidence-hashes.json`. Logs retain the separate
baseline and candidate runs. The four review scripts are included for replay.

## Scope and withdrawal conditions

No blocking defect was found in this pinned source boundary. Package assembly,
Linux execution of the changed runtime, actual model behavior, desktop capture,
cross-organization handoff and full product acceptance were not tested here.
The two earlier real failures remain failures; these tests do not revise them.
Billing and future real-model success are unknown.

The result is invalidated by changed source/dependencies, an absent or stale
join yielding, a higher-priority failure becoming success, inconsistent native
terminal records, premature task acceptance, duplicate continuation after
restart, or a cancelled boundary persisting successful yield. The unchanged
old runtime remains a deployment alternative until the separate package and
consumer gates pass.

Conclusion: **PASS for the exact native join-yield source contract and the
bounded local tests above; no broader product acceptance is implied.**
