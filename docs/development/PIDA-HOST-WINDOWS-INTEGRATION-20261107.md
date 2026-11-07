# Host and Windows runtime integration

Source: `c8a19f7002bb61a2836e039500091dc6e26694fb`, integrating the isolated Windows worker's `649c2bcae73ae08e467f54f6a2b21af6bd5c6bc2` onto host unit `ebd22ef6b5922525201d00db849358ebdf787404`.

The parent owner ran `node scripts/task.mjs build`, then `node --test --test-timeout=20000 test/windows-runtime.test.mjs test/ocel.test.mjs test/agents-http.test.mjs test/collaboration-policy-client.test.mjs` with the exact source-only public Persona fixture enabled. All 15 tests passed, including both local and public-fixture host processes. [Actual output](pida-host-windows-integration-output.txt) is UTF-8. No paid model call was made.

The policy wire and ready message are unchanged. The Windows changes preserve native shell exit status, use per-command Git path settings, and await terminal OCEL materialization with bounded sharing-error retries. [Worker evidence](WINDOWS-RUNTIME-2026-11-07.md) preserves before/after reproduction and remaining restrictions. This join check does not replace independent review or assert that the full Windows suite passes. Two existing symlink-creation fixtures remain blocked by Windows privilege restrictions; very deep Git configuration paths remain unsupported. Use a short host workspace root.

The example still creates only a fresh workspace. Durable process reopening is an existing embedded workspace capability; a supported desktop launcher resume path is a separate next unit. No desktop restart acceptance is claimed here.

Withdraw this bounded integration result if the same sources fail the recorded checks, if terminal observation health is silently lost on reopen, or if host authorization/readback changes under these runtime fixes. Evidence applies only to the recorded source and environment; changed runtime, Git, provider or host configuration requires relevant checks again.
