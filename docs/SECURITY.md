# Security boundaries

## Enforced in this MVP

- HTTP bearer authentication is required for every session operation. Principals come from a host callback; body identity/permission/provider/tool fields are rejected.
- Session ownership covers listing, persistent restoration, reads, runs, traces, cancellation and deletion. A foreign ID gets the same 404 as an unknown ID.
- Tools are a host-registered allowlist. The embedded runtime has no tools by default. New standalone workspaces explicitly compose the bounded workbench; raw Pi built-ins remain inactive. Every business tool checks the current run's permissions and optional additional authorization before execution.
- Pi validates the tool arguments. Exceptions from business code are replaced with stable error codes before being returned to Pi.
- An explicit resource loader supplies no ambient extensions, prompts, themes or project instruction files. Host-selected, bundled coding skills are loaded explicitly and exposed through a read-only allowlisted guide tool. Prompt command/template expansion is disabled. Model configuration and credential stores are in memory; ambient `~/.pi` files are not read by the configured stores.
- Credentials are not hardcoded, serialized into traces, returned as API config or bundled into the web example. Endpoint keys are read from the injected environment on every request.
- Traces contain timestamps, ordered sequence numbers, session/run IDs, event types, tool names and outcome codes; no prompts, arguments, tool payloads or raw provider errors.
- Unknown origins are rejected. CORS uses one explicit origin, not a wildcard. The example has a restrictive CSP and uses `textContent` for model output.
- Input sizes, sessions, runs, turns, tool calls and trace retention are bounded. Slow SSE consumers exceeding 1 MiB of queued data are disconnected and cancellation is requested.

## Not an OS isolation boundary

Pi and custom tool/provider functions execute as trusted code in the Node process. Tool allowlisting is not protection against a malicious registered tool, extension, host SDK caller or compromised dependency. Such code may access filesystem/network/credentials with process authority. To accept untrusted code, use process/container/VM isolation and independent egress/resource policies.

Cancellation and deadlines are **cooperative**. An AbortSignal cannot stop a tool that ignores it, synchronous CPU loops or irrevocable external effects. Do not abandon an in-flight tool and reuse its session: Pida waits for settlement. Untrusted/long-running execution requires a killable worker boundary. Provider/protocol retries and cache warming are disabled. A length-truncated assistant response may be retried at most once by default (0–2 configurable), with a fresh instruction to inspect current state and issue smaller calls. This does not directly replay previous tool calls; tools still enforce authorization and revision guards. Pi automatic compaction is enabled by default and uses the configured model.

The host must enforce tenant and row-level permissions in its business services; a permission such as `orders:read` alone is not a row-level filter. `authorize` must respect its signal and must not grant access based on model instructions. Permissions are captured per run, so mid-run revocation should be checked by `authorize` or the downstream service.

## Before remote production use

Integrate a real identity provider, TLS, ingress rate limiting, tenant quotas, auditing/retention policy, secret rotation, egress controls, production storage hardening and operational monitoring. The sample's static token authenticates one fixed demo account and is not an SSO implementation. Local restart recovery is implemented; no distributed locks, tamper-evident audit ledger, idempotent command replay or business transaction rollback is present.

Endpoint URLs are trusted deployment configuration. HTTPS checks do not constitute an SSRF filter, network sandbox or destination allowlist. Provider/model overrides cannot be supplied to session/run requests. The optional local settings routes allow explicit administration only with `pida:configure`; ordinary application principals are denied. Custom provider factories are trusted host extension points.

Prompts, assistant output and successful tool results remain sensitive conversation data, even though traces are metadata-only. An LLM can repeat information it was legitimately given. Do not place secrets in prompts/tool output, and apply your application's data minimization and display rules. Raw Pi model errors are not returned; generated assistant text is not guaranteed secret-free.

No claim of vulnerability-free dependencies or a completed penetration test is made. License notices and dependency provenance are documented separately.

## Local workspace storage and launch

Unreleased PATCH-03–08 adds a separate private effect ledger (`effect-key.json`, `effects/`) and metadata observation archive (`observations/`) under the selected state directory. Effect intent is recorded before host mutations; persistence failure prevents execution. Uncertain effects block later mutations until trusted `pida:recover` reconciliation. This is a single-process, session-scoped replay guard, not an exactly-once transaction or cross-session semantic deduplicator. Host tools must accurately declare effects and implement any declared idempotency.

Observation exports omit raw prompt/tool data and credentials, but paths, model/tool names, hashes and identifiers remain sensitive metadata. Session-owner checks protect archive/recovery reads even without provider initialization. There is no model/HTTP reconciliation mutation route. Observation failures are best effort and never grant permissions or cancel otherwise valid work. Local completeness does not establish external sink delivery. Exports are neither encrypted nor authenticated by their unkeyed payload digest.

New receipt/key/manifest replacements fsync the file before rename; observation JSONL append is best effort. There is still no cross-file transaction, directory-fsync/power-loss guarantee or automatic corrupted-state repair. Existing metadata/SDK transcript guarantees are unchanged. State must remain private; native Windows ACL behavior has not been validated. Session deletion removes receipt/archive history, and deployments must plan retention/backups rather than deleting an unresolved session to bypass its recovery guard.

- `.env` is created exclusively with mode 0600 and a random 256-bit application token. The generated `.gitignore` excludes `.env` and default `.pida/`. If you customize `stateDir`, exclude that directory from git and backups as appropriate. Windows permissions depend on the host ACL; Unix file modes are not a Windows security guarantee.
- The state directory and child directories are created with mode 0700. Pi writes transcripts inside that private directory. Existing directory ACLs/modes are not repaired automatically; protect the workspace before using sensitive data. Storage is not encrypted by Pida.
- Conversation JSONL contains prompts, model messages and tool arguments/results. Metadata includes a title derived from the first prompt. Metadata-only tracing is not a claim that the whole workspace contains no sensitive data.
- `pida open` / `start --open` pass the local application token to the OS browser launcher in a URL fragment. It is not sent to the HTTP server or printed by normal startup. The page removes the fragment from the current history entry and keeps the token in memory only. The launcher arguments, browser/extension environment and any copied launch URL must still be treated as sensitive. `pida token` deliberately prints it only on explicit request.
- The CLI loads workspace `.env` values into its own process if the shell has not already set them, so approved business tools can use their own environment credentials. The embedded workspace factory resolves provider credentials from `.env` without mutating the host process environment.
- Enabled modules execute with full Node authority, including at import time. Module selection and per-call authorization do not sandbox that code. `doctor` and `tools` listing do not import it.
- Local lock files are a single-host guard, not a distributed lock. Do not share a writable workspace across servers. After a crash, verify the process has ended and use `pida unlock`; no work is replayed automatically. External side effects may already have happened before interruption.
- Writes use atomic replacement for application metadata, but Pi JSONL and metadata are separate files. There is no cross-file transaction, fsync durability guarantee or automatic repair of corrupted data. Back up and apply retention to the state directory according to your data policy.

## Provider settings administration (0.3)

The local operator may intentionally connect arbitrary company/local endpoints. This is trusted configuration, not an untrusted-user proxy or SSRF sandbox. The generic HTTP adapter does not expose settings by default; do not enable it for tenant users without an independent admin policy. Model-list fetches reject redirects, cap response size and time out. The apply probe contains no previous conversation or tools, but invokes the real provider and may incur a small charge.

Typed provider keys are saved with mode 0600 via atomic replacement under the private state directory. They override environment keys only for the exact stored URL, API and variable name. To return to environment-managed credentials, stop the server and remove `provider-key.json`. Changing URL/protocol requires an explicitly supplied key or explicit keyless mode. Keys are never returned by GET or apply responses. Browser password fields clear after a successful apply and at logout; they are not stored in browser storage.

The connection probe and file update are not a distributed transaction. Failed probes leave configuration untouched. Configuration and credential files are separate writes; failed config writes attempt to restore the previous key. Abrupt power loss between writes is not guaranteed recoverable automatically. Provider changes are rejected while a run or session creation is active, and no active tool is interrupted to apply new settings.

## Native provider credentials (0.4)

Named services use Pi's native adapters and pinned catalog endpoints. API keys are saved per provider under the private state directory (`provider-key-<id>.json`, mode 0600), not in config, transcripts or API responses. Switching providers retains their separate keys; deleting the relevant key file revokes local storage, but remote key revocation is the provider's responsibility. Files are plaintext with restrictive permissions, not encrypted secret storage. Native inputs reject custom endpoint overrides. Catalog browsing is offline and does not establish model access. OAuth/subscription credentials are not accepted as an implemented login flow.

## Workbench profile (0.5)

Pi file tools use custom filesystem operations restricted to a principal-specific text-file root. Paths, symlinks, hardlinks, file counts and sizes are checked. Metadata, Git internals, provider keys and verified skill bundles are outside the agent-writable root. Workbench operations serialize per principal within one service instance. This is a local single-process profile, not a hostile shared-filesystem or multi-process service: a trusted host administrator can modify files, change permissions and replace skill hashes. Run only one PidaWorkbench per state directory. Git history is a recovery mechanism, not a tamper-proof audit or atomic transaction store. Apply/restore interrupted by process or disk failure may be partial; use recorded checkpoints for recovery. Retained history grows and needs an operator retention policy.

Generated JavaScript runs in QuickJS WASM inside a terminable Node worker with an empty environment. Only a bounded virtual text filesystem, input, logging and assertions are exposed. The guest receives no Node, process, network or module-loader capabilities. The WASM memory limit is 32 MiB; the execution deadline is 2 seconds by default, at most 5 seconds, plus up to 1 second for worker startup/termination. Output is capped at 12,000 characters. Worker errors and cancellation discard staged writes; writes apply only after execution succeeds. This does not sandbox deployer-approved Node tool modules, and is not an independently audited VM/container boundary. Dependency/runtime vulnerabilities remain possible.

Tests run read-only and must complete at least one assertion. A saved skill snapshots the current files, tests before saving and tests again before reuse. Passing an agent-authored test does not prove the business requirement or prevent a weak, irrelevant or intentionally misleading test. Use independent acceptance tests for consequential work. Skill updates require a new version name; saved skills are never imported into Node or automatically elevated into trusted plugins. User-provided input and skill text never grant permission.

The UI renders model text with textContent. Generated HTML is fetched as authenticated JSON and displayed only in an opaque-origin iframe with an empty sandbox and a separate CSP blocking scripts, forms and network resources. Inline CSS is allowed to render static dashboards. Downloading HTML and opening it outside this preview uses the user's normal browser security context; review generated code before doing so. This profile provides static HTML previews, not a live React dev server, browser testing or deployment.


### Optional browser checks

`browserChecks: true` registers `ui_check` with `workbench:execute` and `workbench:read` permissions. A fresh headless browser uses the same nonce/CSP renderer as the service, no persistent profile or credentials, no downloads, blocked service workers and denied external HTTP requests. Checks are bounded to 15 seconds and 10 steps. This is functional verification, not a substitute for OS/container isolation of a multi-tenant browser service. Keep it disabled unless the deployment provides a suitable browser execution environment.
