# Process Intelligence tools — Pida 0.8.4

The first supported path is completed-run batch analysis: owned runtime snapshots → actual PIX variants and DFG discovery → a frozen model → separate evaluation runs → an explicitly authorized analysis reference in the selected Persona provider → the next model input. Schumpeter is not required. The Python engine is optional; ordinary Pi runs remain usable without it.

This is the first slice of INT-PD-02/06/07/08/09. It does not implement the complete organization controller, current-cut guidance loop, TUI or enterprise federation. [The requirement ledger](PI-NATIVE-VALIDATION.md) keeps those boundaries visible.

## Enable the optional engine

Use an owner-authorized read-only checkout/export of `Chanta-Research-Group/PIX` at commit `3205d832d5dcdc6901f916b35496a0c60b657e7a`. Preserve original file bytes, including mixed line endings. Do not install an unrelated package named PIX from a package index. The verified code is not included in the Pida package and no dependency is downloaded at runtime.

Add these fields to the existing workspace `pida.config.json`, merging the permissions into the existing array:

```json
{
  "processIntelligence": {
    "pythonExecutable": "D:/Python312/python.exe",
    "sourceDirectory": "D:/tools/PIX-pinned",
    "sourceCommit": "3205d832d5dcdc6901f916b35496a0c60b657e7a",
    "sourceDigest": "b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510",
    "timeoutMs": 10000,
    "maxRuns": 32,
    "maxEvents": 4096,
    "maxCallsPerRun": 2
  },
  "permissions": ["pi:read", "pi:analyze", "pi:remember"]
}
```

These are example Windows paths, not a Windows acceptance result. Select the actual installed Python executable and pinned source root on your host. The worker expects `src/pix` under that root. Python 3.12.14 was tested on Linux. The existing state/config/provider settings remain in place. Capability configuration changes take effect after workspace restart; they do not swap tools in an active run.

Registration and permission are separate. The tools are advertised only when the caller has the corresponding permission. `pi:remember` also requires `agent:memory:write`; the standalone workspace already gives its authenticated local user the existing memory permissions. An embedding host must grant both deliberately.

Without configuration, `pi_history` reports `configured:false` and analysis returns `PIX_NOT_CONFIGURED`, without calling an LLM to invent statistics. Invalid/missing engine binaries or changed source pins produce explicit unavailable/error codes. A broken PIX installation does not disable ordinary agent execution.

## Agent-facing tools and host API

| Tool | Actual behavior | Permission |
| --- | --- | --- |
| `pi_history` | Lists owned run references/digests, observed cohort, terminal status and exclusions; provides current context revision for CAS | `pi:read` |
| `pi_reflect` | Calls actual PIX variants/discovery for an explicit bounded selection; stores fixed empirical model and native evidence | `pi:analyze` |
| `pi_awareness` | Calls actual PIX alignment on separate completed cases/tasks against the fixed model | `pi:analyze` |
| `pi_analysis_read` | Reads a bounded summary, rechecking source access, cut and model integrity | `pi:read` |
| `pi_analysis_remember` | Appends a sourced result/model reference through the selected provider using expected context revision and stable idempotency key | `pi:remember` + `agent:memory:write` |

Example instruction: “먼저 pi_history로 내 완료 기록을 확인하고, 같은 역할·모델·도구 조건의 기록을 골라 성찰해 주세요. 실패도 분모에 포함하고, 그 모델로 별도 실행을 평가해 주세요. 결과를 기억에 저장하기 전에는 현재 revision을 확인해 주세요.”

The embedding API exports `ProcessIntelligence`, `createPixProcessPort` and `createLocalPersonaProvider`. `createWorkspace(...).processIntelligence` contains active main/agent services. `ProcessIntelligence.read(principal, resultRef)` returns the full native evidence to an authorized host; model-facing tools return bounded summaries. No new endpoint accepts arbitrary Python, a shell command, a source path or an owner chosen by the model.

An embedding host may use `registerReferenceModel` to register an aspirational or mandatory DFG with a policy reference/digest and `pi:policy:register`. The agent tools cannot create a mandatory policy. Such registration does not enforce the policy or approve work. It only supplies an explicitly typed comparison model.

## Mapping and scope

`pida.sequential-tool-lifecycle/1` projects each run independently into request, tool start/completion/failure and runtime outcome activities. Original event IDs and source order are retained. It never joins unrelated tasks by a shared agent ID or sorts a concurrent trace into a fictional sequential process.

Incomplete/non-run snapshots, observed concurrent or nested tools, missing model cohorts and runs that invoke PI tools are excluded with reasons. The last rule prevents a default reflection-on-reflection loop. Failed, cancelled, limited, interrupted and unknown outcomes remain distinct. Excluded runs stay in the selection denominator; the result reports selected/included/excluded counts and observation coverage. “Complete” refers to Pida's selected producer journal, not the totality of external behavior.

A cohort fixes observed agent/persona/scope/role, model/API, effective configuration fingerprints and toolset fingerprints. Mixed cohorts are rejected with `COHORT_MISMATCH_SELECT_ONE_ROLE_MODEL_TOOLSET`; select one cohort explicitly. Workspace role instructions are represented by a stable digest-derived role ID, not copied into default export metadata. Older runs without a managed input receipt are marked `unbound-legacy`, not retroactively certified as managed.

Main-sequence selection uses a frequency-descending prefix, ties broken by activity-array codepoint order, until the requested **selected-case** coverage is reached. Each variant's proportion uses all selected cases. The discovered DFG uses all included cases, not only this display prefix. It can accept unseen combinations of observed edges; a zero-cost alignment is not proof of an exact historical variant. [PIX operator semantics and limits](PIX-CAPABILITIES.md) explain the actual computation.

Evaluation cannot reuse a training run or another attempt of the same task. It may use explicitly held-out completed historical cases; it does not claim a live streaming current-cut calculation. The fixed model and its source engine pin remain immutable. Optimal edit cost is returned as raw cost, not invented normalized fitness. Partial/unknown/search-limited results never become positive conformance.

## Evidence, retention and authority

Computation artifacts live in the workspace's private state directory under `process-intelligence/<logical-agent>/`. Records bind owner, logical agent, input cuts, model/result digests, mapping/profile and actual engine build. The cache key includes the selected inputs, model, profile and engine pin. Duplicate calls/restarts reuse exact persisted results. Reading cached results rechecks ownership and referenced source/model integrity; stale/deleted sources revoke the derived read.

Analysis storage is separate from persona authority. The default provider appends an `agent-report` reference to the existing `AgentMemoryStore` with CAS and idempotency. It does not change persona text, WorkingState or policy. Non-default trusted SDK principals use isolated memory scopes. If a host selects an external provider, local canonical memory tools and HTTP memory routes are disabled; Pida does not write the same memory into both authorities. External provider compatibility remains a contract proposal until tested against its actual implementation.

Context generation, loading and actual provider-facing logical-input inclusion are recorded separately. Pida's receipt proves the host included the exact selected text at the Pi dispatch boundary, not that the model internally used or understood it. Memory text and private profile instructions are not copied into default observation payloads.

The current worker has byte/time/event/search bounds, a minimal environment and a verified source import snapshot. It is a trusted process boundary, not an enforcing OS sandbox or total memory/billing cap. Analysis elapsed time is measured; billing cost is unknown. No business acceptance, automatic behavioral correction or identity rewrite follows from conformance.

## Reproduce

Run the following from a source checkout; the published runtime package includes the worker but not the development test scripts.

```sh
npm ci --ignore-scripts
npm run build
npm test
python -B scripts/pix-worker-check.py --source /absolute/path/to/PIX-pinned
node scripts/pi-native-integration-check.mjs --source /absolute/path/to/PIX-pinned --python /absolute/path/to/python
```

The latter checks require the separately pinned engine. They use synthetic tasks and scripted model decisions with actual Pi/PIX, not a live LLM. The generated report identifies source/compiled hashes and every evidence file. Actual PersonaSubstrate, Schumpeter import, live models, Windows UI/IME, long-term improvement and current-cut guidance remain separate acceptance profiles.
