# Provider rejection diagnostic - bounded source correction

The first real A run received an error reporting the ChatGPT Subscription Sharing
usage limit. The SDK error message had empty content and zero usage placeholders;
the recorded usage correctly remained unknown/null. The enabled token guard
then made the terminal result limited/USAGE_UNAVAILABLE, before the generic
provider failure classification. This masked the useful rejection category.
The [original negative record](two-org-a-original-negative-20261108.json) remains
unchanged. The [user retry](two-org-a-user-retry-negative-20261108.json) is a
separate native attempt and failed at a different join/empty-output boundary.

This correction preserves actual result text, primary code/status, unknown
usage, token/cost guards and existing retry configuration. It neither verifies
account quota nor retries, refreshes credentials, changes billing paths or
estimates reset time. No held workspace or accepted bb9886 runtime was rewritten.

## Closed diagnostic and terminal carrier

`providerRejectionCode` emits only `PROVIDER_SUBSCRIPTION_SHARING_LIMIT` or
`PROVIDER_REJECTED` for assistant stopReason error. The specific code requires
OpenAI/openai-responses and the exact known message (surrounding whitespace is
allowed). Unmatched/malformed/secret-bearing text stays generic. Success,
toolUse and aborted messages receive no rejection code. Raw provider text is
never copied into the new diagnostic fields.

The existing `model_response.payload.code` records the per-attempt category.
This is history, not automatically the terminal cause. The existing bounded
AgentJob.activity gains exactly one `provider_rejected` trace only when the final
assistant message is an error and the terminal result is failed/limited with
primary code USAGE_UNAVAILABLE, PROVIDER_FAILED or PROVIDER_RETRY_EXHAUSTED.
Recovered success, successful responses with unknown usage, cancellation,
timeouts and unrelated final failures have no terminal rejection trace. The
trace observation carries final request_id/attempt matching model_response.

The actual raw TraceEvent has six keys:

| Field | Value |
| --- | --- |
| sequence | Existing positive trace sequence |
| timestamp | Existing ISO UTC timestamp |
| sessionId | Actual native session ID |
| runId | Actual selected job run ID |
| type | provider_rejected |
| code | One of the two closed codes above |

Consumers read the existing authenticated
`GET /v1/agents/{agentId}/jobs/{jobId}`. Validate the selected terminal job's
native task/attempt lineage, status/primary code and exact session/run, then
accept one valid trace. Missing, malformed, duplicate, conflicting or unknown
carrier values are unavailable, not inferred from raw text or older attempts.
Only a fixed enum-to-text mapping should reach the UI. For example, the specific
code can display that the provider reported a subscription sharing limit while
usage remains unknown; it must not claim independent quota verification. This
does not add a RunResult field or observation/persistence schema version.

The trace is created before runtime state persistence but published with the
settled result, once. Existing trace/job bounds and durability apply. Restoring
a terminal job retains its trace without reexecution. Existing bb9886 runs lack
this carrier; the original real failure must not be retrospectively rewritten.

## Evidence, scope and falsification

Build and 26 focused tests passed: native persisted quota replay with one faux
request and no tool execution; generic secret redaction; recovered retry with
only historical response diagnosis; successful missing-usage response still
limited with no provider diagnostic; existing runtime cancellation/deadline,
turn/tool budgets, owner isolation and history regressions. All provider tests
use scripted Pi or local fixture servers. No external provider/auth call occurred.
An initial test import named lotStatusTool from the wrong module; corrected to
the existing tools export before the successful run. No runtime behavior was
changed for that fixture correction.

Source/evidence hashes are in
[the validation record](provider-diagnostic-validation-20261108.json).
Independent review and a new distribution remain separate gates. Withdraw this
bounded result if raw text leaks, usage placeholders become measured zero,
guards/retry behavior change, terminal diagnostics survive recovered success,
or a trace cannot be joined to the exact terminal native job. The precise message
classifier is valid only for the pinned provider/runtime contract; new errors
remain generic until supported by evidence.
