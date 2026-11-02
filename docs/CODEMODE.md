# Authorized tool composition

`program_compose` runs an async JavaScript body in the official Pi 1.2
`CodemodeSandbox`. It is optional. A host must enable it, name its callable
business tools, and grant `programs:compose`. Each nested call also needs its
normal business-tool permission and passes the host's `authorize` policy.

```ts
const runtime = new PidaRuntime({
  provider,
  tools: [lookupAlpha, lookupBeta, saveSummary],
  codemode: {
    enabled: true,
    tools: ["lookup_alpha", "lookup_beta", "save_summary"],
    maxCalls: 16,
    timeoutMs: 30000,
    memoryLimitBytes: 33554432,
    maxOutputChars: 8192,
  },
});
```

The principal needs `programs:compose` and the permissions declared by the
selected tools. Enabling composition does not grant those permissions. Omit
`codemode` or set `enabled: false` to leave the tool unregistered. An explicitly
empty `tools` array permits sandbox computation with no business-tool access.
Unknown names and `program_compose` itself are rejected in the host allowlist.

Standalone workspaces accept the same `codemode` object in `pida.config.json`.
For example, with project tools already enabled, add
`"codemode":{"enabled":true,"tools":["project_read","project_find","project_grep"]}`
and retain existing permissions while adding `programs:compose` and
`project:read`. Restart the server after changing capabilities. The settings
composition panel lists `program_compose` with source `pi-codemode` for both
the main runtime and activated persistent agents.

Example model tool input:

```json
{
  "code": "const [a,b] = await Promise.all([tools.lookup_alpha({}),tools.lookup_beta({})]); const saved = await tools.save_summary({value:a.total+b.total}); text(saved); return {checked:2};"
}
```

Use `await` for every call. Pi permits declared read tools to run in parallel
and serializes nested writes. Read operations may overlap a write; this is not
a transaction or a database snapshot. A host must mark effects accurately.
The outer composition remains sequential with other model-issued tool calls.

## Execution boundary

The VM receives only the explicit allowlist intersected with the current
principal's permissions. It has no direct filesystem, process, module loader,
or network API. Its `store`/`load` values are local to that invocation and are
not persisted. Models cannot raise limits through source comments.

Injected functions call the public Pi `ExtensionToolContext.executeTool`, which
validates arguments and emits normal nested-call events. This reaches Pida's
existing guarded custom-tool wrapper: permission, host policy, run tool budget,
effect ledger, cancellation, evidence capture and result classification. The
composition never calls a business tool's `execute` function directly. Pi's
own argument validation/coercion behavior applies.

Pi assigns nested IDs such as `outer-id/1`. Pida traces include
`parentToolCallId`; observation payloads include `parent_tool_call_id`.
Default traces/observations contain metadata, not the script, tool arguments,
or tool output. Pi's private session transcript keeps its existing bounded
nested-call records.

The container itself creates no write receipt. Each changing nested tool owns
its actual receipt. A completed write remains recorded even if later code
fails. No error, timeout, cancellation, or process restart automatically
replays the composition. The existing effect ledger continues to block
duplicate non-idempotent operations and unresolved effects.

## Limits and outcomes

| Host field | Default | Allowed range |
| --- | --- | --- |
| `maxCalls` | 16 | 1–64 |
| `timeoutMs` | 30,000 | 100–120,000 ms |
| `memoryLimitBytes` | 32 MiB | 4–128 MiB |
| `maxOutputChars` | 8,192 | 256–24,000 JSON characters |

The run's existing limits can be lower. Its tool budget counts the outer call
and every nested call that reaches Pida's wrapper. The local composition
budget additionally bounds attempted injected calls before Pi dispatch.

`maxOutputChars` bounds the serialized result sent back to the model, including
call metadata. Omitted output/value/call rows set `truncated: true`. Images are
represented by an omission notice. Pi's sandbox also has its own upstream
collection caps; the configured output limit is not an incremental stdout
stream or a process-wide memory limit. The memory setting bounds the QuickJS
heap, not arbitrary memory allocated by trusted host tools.

Results contain `ok`, `output`, optional `value`/`code`, bounded `calls`,
`callCount`, `truncated`, and `autoReplay: false`. Codes distinguish script,
sandbox, timeout, cancellation, call-budget, and unawaited-call failures.
Model completion text cannot override the runtime's classified failures.

Cancellation stops the worker and drains guarded nested outcomes before the
parent settles. A host tool that ignores its abort signal cannot be forcibly
stopped as ordinary JavaScript. Pida reports its effect as unknown and retains
the shared run lease until the underlying callback actually settles. Same
session reuse, reconciliation, deletion and single-writer reuse remain blocked
while that callback is outstanding; runtime close also waits before releasing
its private-state lock. Hosts should implement cooperative cancellation or
place uncooperative code behind a process/container boundary.

## Verification

`test/codemode.test.mjs` uses actual Pi sessions, the official sandbox worker,
and scripted faux-provider decisions. It covers parallel reads, serial writes,
JSON result flow, validation, permissions/host policy, parent IDs, failure after
a write, cancellation and effect recovery, leases, and execution limits.

These are SDK/OS integration checks. They do not establish real-model coding
quality, Windows behavior, or compatibility with a particular corporate LLM.
