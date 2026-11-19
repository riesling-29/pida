# Independent host shutdown correction

Independent review of `ebd22ef` reproduced an actual host retaining `/health` HTTP 200 after parent EOF when runtime cleanup rejected. Original corrected probe and output are preserved byte-for-byte in [host-close-review-evidence-20261107](host-close-review-evidence-20261107/). The probe's original assertions describe the defect, not the corrected expected result.

The host now stops HTTP acceptance first, attempts runtime and Persona cleanup independently, and waits for all results with a five-second bound. Rejection or timeout emits a fixed error code and exits 1; success exits 0. Shutdown is idempotent. This is deliberate process-owner shutdown, not a promise that arbitrary foreign resources survive forced process exit.

Developer verification ran `node --test --test-timeout=20000 test/collaboration-policy-client.test.mjs`: five tests passed. Two added actual child-process tests inject a runtime close rejection or never-settling promise, then close parent stdin. Both verify unreachable HTTP, a separately written Persona-close marker, and bounded failure exit. Existing Python policy and native host mapping tests also pass. [Actual output](pida-host-close-fix-output.txt). No paid calls or canonical Persona memory were used.

Independent recheck is separate and pending at this record. Withdraw the fix if runtime failure leaves HTTP accepting, skips Persona cleanup, conceals the failure exit, or hangs past the documented bound. This evidence applies to this source and environment; changes to host shutdown or lifecycle ownership require a new check.
