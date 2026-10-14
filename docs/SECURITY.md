# Security boundaries

## Enforced in this MVP

- HTTP bearer authentication is required for every session operation. Principals come from a host callback; body identity/permission/provider/tool fields are rejected.
- Session ownership covers reads, runs, traces, cancellation and deletion. A foreign ID gets the same 404 as an unknown ID.
- Tools are a host-registered allowlist. No built-in tool is active. Every business tool checks the current run's permissions and optional additional authorization before execution.
- Pi validates the tool arguments. Exceptions from business code are replaced with stable error codes before being returned to Pi.
- An explicit resource loader supplies no extensions, skills, prompts, themes or project instruction files. Prompt command/template expansion is disabled. Model configuration and credential stores are in memory; ambient `~/.pi` files are not read by the configured stores.
- Credentials are not hardcoded, serialized into traces, returned as API config or bundled into the web example. Endpoint keys are read from the injected environment on every request.
- Traces contain timestamps, ordered sequence numbers, session/run IDs, event types, tool names and outcome codes; no prompts, arguments, tool payloads or raw provider errors.
- Unknown origins are rejected. CORS uses one explicit origin, not a wildcard. The example has a restrictive CSP and uses `textContent` for model output.
- Input sizes, sessions, runs, turns, tool calls and trace retention are bounded. Slow SSE consumers exceeding 1 MiB of queued data are disconnected and cancellation is requested.

## Not an OS isolation boundary

Pi and custom tool/provider functions execute as trusted code in the Node process. Tool allowlisting is not protection against a malicious registered tool, extension, host SDK caller or compromised dependency. Such code may access filesystem/network/credentials with process authority. To accept untrusted code, use process/container/VM isolation and independent egress/resource policies.

Cancellation and deadlines are **cooperative**. An AbortSignal cannot stop a tool that ignores it, synchronous CPU loops or irrevocable external effects. Do not abandon an in-flight tool and reuse its session: Pida waits for settlement. Untrusted/long-running execution requires a killable worker boundary. Automatic retries and cache warming are disabled, including protocol retries in Pi settings.

The host must enforce tenant and row-level permissions in its business services; a permission such as `orders:read` alone is not a row-level filter. `authorize` must respect its signal and must not grant access based on model instructions. Permissions are captured per run, so mid-run revocation should be checked by `authorize` or the downstream service.

## Before remote production use

Integrate a real identity provider, TLS, ingress rate limiting, tenant quotas, auditing/retention policy, secret rotation, egress controls, persistent storage and operational monitoring. The sample's static token authenticates one fixed demo account and is not an SSO implementation. No distributed locks, restart recovery, tamper-evident audit ledger, idempotent command replay or business transaction rollback is present.

Endpoint URLs are trusted deployment configuration. HTTPS checks do not constitute an SSRF filter, network sandbox or destination allowlist. Provider/model overrides cannot be supplied by untrusted HTTP callers. Custom provider factories are trusted host extension points.

Prompts, assistant output and successful tool results remain sensitive conversation data, even though traces are metadata-only. An LLM can repeat information it was legitimately given. Do not place secrets in prompts/tool output, and apply your application's data minimization and display rules. Raw Pi model errors are not returned; generated assistant text is not guaranteed secret-free.

No claim of vulnerability-free dependencies or a completed penetration test is made. License notices and dependency provenance are documented separately.
