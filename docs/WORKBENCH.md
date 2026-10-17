# Workbench: work → verify → repair → reuse

Pida 0.5 composes existing tools instead of replacing the agent harness:

| Function | Reused implementation | Pida integration |
| --- | --- | --- |
| Work | Pi createReadTool/createWriteTool/createEditTool | Per-user bounded filesystem operations; approved business tools remain available |
| Execute / verify | quickjs-emscripten 0.32.0 / QuickJS WASM | Terminable worker, virtual files, assertions, bounded CPU/memory/output |
| Repair / recover | Pi agent loop and edit tool; host Git | Failed test results returned to the model; automatic checkpoints and explicit restore |
| Accumulate | Pi SKILL.md format and loadSkillsFromDir | Retested immutable script/test/file bundles, discovery, instructions and reuse across sessions/restarts |

This is a JavaScript artifact-building profile, not a general-purpose development VM. It does not run a shell, Python, Node modules, npm builds, browser tests or a React development server. It cannot modify Pida's installed runtime, server secrets or approved Node tool directory. The workbench is optional for embedded hosts. New CLI workspaces enable it by default and need Git on PATH. Existing workspaces retain their previous behavior.

## Start and use

Install with npm, pnpm or bun as described in [WORKSPACE.md](WORKSPACE.md). Run setup, select a real LLM provider and model, and use **작업 파일 · 결과물 · 저장된 스킬** in the web UI. Upload a small text/CSV/JSON file; it is stored under `uploads/`. Example chat request:

> uploads/sales.csv를 읽고 월별 합계 대시보드를 artifacts/sales.html로 만들어줘. 집계 로직은 JavaScript로 분리하고 기대값을 assert로 검사해. 실패하면 수정하고 다시 검사한 뒤, 통과한 스크립트와 테스트를 sales-dashboard-v1 스킬로 저장해줘.

The provider decides and calls the tools through Pi. The default mock provider still only looks up sample lots: it is not a simulated general agent. After a run, refresh the file panel, select the generated HTML for a sandboxed static preview, or download it. Ask `skill_list`, read a skill's instructions, and use `skill_run` in later conversations. Workbench files are shared by the same authenticated principal across sessions; other principals get separate directories.

To enable this profile in an existing configuration, add:

```json
"workbench": { "enabled": true }
```

Append these permissions to the existing `permissions` array and restart:

```json
["workbench:read", "workbench:write", "workbench:execute", "workbench:history", "skills:write"]
```

Do not replace existing business permissions. Set `workbench.enabled` to false to disable the profile without removing files. Generic `new PidaRuntime()` remains tool-free unless the host explicitly supplies tools.

## Script contract

Scripts are synchronous JavaScript, with no import/module loader, Node globals or network. A fresh QuickJS context is created for each execution. Files persist, globals do not. Available guest APIs:

```js
const rows = JSON.parse(pida.readText("uploads/sales.json"));
eval(pida.readText("lib/total.js")); // compose another workspace script
const options = pida.input;          // JSON input from workspace_run / skill_run
console.log(total(rows));
pida.writeText("artifacts/total.json", JSON.stringify({ total: total(rows) }));
```

Read-only test example:

```js
eval(pida.readText("lib/total.js"));
assert(total([10, 20, 30]) === 60, "total must equal 60");
assert(total([]) === 0, "empty input must equal zero");
```

`workspace_test` requires at least one completed `assert`. An error returns `{ok:false,error,output,assertions}` to Pi so it can inspect, edit and retry. A test file cannot write files. `workspace_run` applies staged writes only after success; a thrown error/cancellation discards them. Test failure is an ordinary tool result, allowing the Pi loop to recover; overall run completion does not by itself prove every test passed. Inspect the test results and final artifact.

| Tool | Inputs / effect | Required permissions |
| --- | --- | --- |
| workspace_list / workspace_read | List files; Pi read schema (`path`, optional `offset`, `limit`) | read |
| workspace_write / workspace_edit | Pi write (`path`, `content`) or edit (`path`, `edits:[{oldText,newText}]`) schema | write + read |
| workspace_run | `path`, optional JSON `input`; execute and commit output files | execute + write + read |
| workspace_test | `path`; read-only assertions | execute + read |
| workspace_history | Recent Git checkpoint IDs | history + read |
| workspace_restore | `checkpoint`; save current state then restore selected files | history + write + read |
| skill_list / skill_read | Discover Pi skill metadata / read `name` instructions | read |
| skill_save | `name`, `description`, `instructions`, `scriptPath`, `testPath`; retest then snapshot all current files | skills:write + execute + read |
| skill_run | `name`, optional JSON `input`; retest stored snapshot and run script | execute + write + read |

In the table, read/write/execute/history abbreviate `workbench:*`. All required permissions are checked by the service independently of model text. Skill names use lowercase letters, digits and hyphens. Saved names cannot be overwritten; save a new version name. Skills retain the complete current file snapshot (including uploaded data), which should be considered when storing sensitive inputs. `skill_run` uses the saved snapshot plus explicit JSON input, not subsequently edited workspace files. Its output writes into the current workspace.

## Embed or call from another app

```ts
import { PidaRuntime, PidaWorkbench, workbenchPrompt } from "pida-core";
import { createPidaServer } from "pida-core/http";

const workbench = new PidaWorkbench("/private/pida/workbench");
const runtime = new PidaRuntime({
  provider: myPiProviderFactory,
  tools: [...workbench.tools(), ...myApprovedBusinessTools],
  systemPrompt: workbenchPrompt,
  maxTurns: 24, maxToolCalls: 48, maxRunMs: 120_000,
});
const server = createPidaServer({ runtime, workbench, authenticate: myIdentityVerifier });
```

Use exactly one workbench service per directory, in one process. Pass trusted identity-derived permissions; never copy claims from a request body. The optional HTTP routes are:

- `GET /v1/workbench`: files, saved skills and latest 20 checkpoints.
- `GET /v1/workbench/file?path=...`: authenticated JSON `{path,content}`.
- `POST /v1/workbench/file`: JSON `{path,content}` upload/write.

`PidaClient` exposes `getWorkbench`, `readWorkspaceFile`, `writeWorkspaceFile`. Run tools through normal session chat execution; these routes do not add an unauthenticated execution API. Generated HTML is never served directly as an executable same-origin page.

## Limits and evidence

Files: 64 files, 128 KiB each, 2 MiB total; text only. Paths are relative ASCII names (letters, digits, spaces, underscore, hyphen, slash and extension dots); hidden path components, traversal, symlinks and hardlinks are rejected. Skills: 32 per principal. JavaScript: 32 MiB WASM memory, default 2 seconds, 12,000 output characters. The parent terminates overdue or cancelled workers. Git history size is not bounded; manage retention externally. Use a trusted local filesystem, not shared attacker-controlled paths.

The integration suite executes the **real Pi loop with scripted model responses**, writes an intentionally incorrect sum, observes a failed assertion, repairs it with Pi edit, retests, renders HTML, saves a Pi skill and reuses that snapshot after restart with new input. Additional cases check permissions, per-principal isolation, paths/links, resource limits, failed-write discard, exact Git restoration and authenticated HTTP files. `scripts/workbench-demo.mjs` runs this deterministic demonstration into a separate workspace for UI inspection. It requires no model key and does not demonstrate real-model planning quality.

Passing generated assertions is evidence only for those assertions. Independent acceptance tests, real-provider tool selection, arbitrary business tasks and production multi-tenant isolation remain separate acceptance work. See [SECURITY.md](SECURITY.md).
