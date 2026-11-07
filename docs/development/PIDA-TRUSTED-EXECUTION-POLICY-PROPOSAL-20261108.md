# Trusted execution policy scoping (proposal only)

Snapshot: runtime `b7f7d523c6fede56d508575a6bb78afa343e5566`; read-only inspection at docs HEAD `d049e8cfed53be7cec5671db808959fe5efd31e4`. No implementation, package rebuild, provider call or existing workspace change is authorized by this proposal.

## Observed boundary

- `examples/schumpeter-host.mjs:89` fixes managed run time at 20,000 ms, provider/output retries at zero, token observation limit 16,384 and concurrency two. `src/workspace.ts:630` supplies workbench defaults of 24 turns/48 tools; managed maxRunMs overrides its 180,000 ms default.
- `src/workspace.ts:130` already validates maxRunMs as an integer 1,000..900,000. No new standalone maxTurns/maxToolCalls settings are needed for the first profile change.
- Managed desktop reservations currently select timeout_ms 60,000 and repair zero. This is a desktop default, not the generic native createOrganization default (3,600,000). Admission definition already includes timeout_ms/repair, digests them, persists an absolute deadline and permits 1,000..86,400,000 ms/repair 0..3 (`src/organization-admission.ts:32`; `src/agent-supervisor.ts:647`).
- Join requests allow 1,000..3,600,000 ms, then persist min(organization deadline, current time + requested join interval). Dispatch also combines the organization deadline signal with run cancellation (`src/agent-supervisor.ts:688,981`). Reopen does not reset those deadlines.
- Current source/config/Persona identity must exactly match the host manifest before resume (`examples/host-workspace.mjs:35`). Existing BB/C/D states must keep their exact retained runtime. Changing only a launcher run limit would leave organization time at 60 seconds and is insufficient.

## A. Smallest proposed budget contract

Use one immutable trusted **host-level** catalog selection, `pida.execution-policy/1`. Renderer chooses a named profile from trusted advertised options, never raw runtime JSON. Proposed first catalog (engineering choices, not proven adequate coding budgets):

| Profile | Run ceiling | Organization default/maximum | Join ceiling | Repairs |
| --- | ---: | ---: | ---: | ---: |
| smoke/1 | 20,000 ms | 60,000 / 60,000 ms | 60,000 ms | 0 |
| work/1 | 180,000 ms | 900,000 / 900,000 ms | 900,000 ms | 0 |

Both retain 24 turns/48 tools, zero provider/output retries, token observation limit16,384, concurrency2 and existing cancellation/effect guards. Actual provider cost remains unknown; these are not a hard aggregate model-call or billing cap. Longer budgets do not grant more tools, repairs or project access.

Validate closed catalog keys/known profile version, integer positive values inside existing native maxima, run<=organization maximum, join<=organization maximum, and fixed unchanged safety fields. For the first slice allow only the named default organization interval (or a separately declared smaller trusted value), no user arbitrary number. Do not add unbounded profiles. A short explicit join request remains short: selecting work/1 must not silently turn a requested45 seconds into15 minutes.

- pida launcher resolves the selected catalog entry before fresh initialization, writes existing config.runtime.maxRunMs, and supplies a trusted optional organization/join ceiling to AgentSupervisor. No new standalone workspace schema is needed.
- Version the **new host manifest/ready capability**, exposing the resolved profile ID, canonical policy digest and effective limits. Keep old source/manifests untouched. New profile/source requires a fresh workspace; existing workspace reopen selects its retained exact runtime and recorded profile, never upgrades implicitly. Manifest mismatch must fail before mutation.
- Keep organization admission/1 and receipt/1 shapes: timeout_ms and repair already bind the actual per-goal definition. Schumpeter pins the host policy digest in trusted host registration and reservation authority, rejects stale mappings, and sends the supported timeout into the existing definition. The same current authority callback validates it at admit/dispatch. Pida independently rejects a new admission exceeding the trusted host ceiling before enqueue/receipt. This avoids adding profile fields to every envelope merely to duplicate immutable host identity.
- Apply the trusted ceiling to explicit native create and implicit join-created sessions when running that managed host; standalone runtimes with no such policy retain existing semantics. New joins validate requested bounds (or use the selected default when omitted) and remain capped by the persisted organization deadline. Retries, children and continuations cannot reset either deadline. Existing completed/expired state does not gain time when reopened.
- If per-goal **run** limits or hot profile switching are required, this minimal host-level approach no longer suffices: choose a separately versioned admission/policy snapshot instead. Do not squeeze mutable run limits into an unchanged admission contract.

Proposed pida files: new small catalog module; `examples/schumpeter-host.mjs`, `examples/host-workspace.mjs`; trusted option forwarding in `src/workspace.ts`; ceiling validation/capability in `src/agent-supervisor.ts`. `src/organization-admission.ts` digest/schema stays unchanged in the minimal option. Runtime guard logic and standalone configuration schema stay unchanged. Schumpeter owns selected-profile UX, trusted launcher arguments, host-ready validation, reservation defaults/authority snapshot and display of effective limits. Both owners agree ready/capability version before edits.

Offline checks: both catalog entries and unknown/extra/NaN/out-of-range values; newhost exact effective24/48 and run limit; omitted legacy option uses original smoke behavior; overbudget admission leaves receipt/job/state byte-identical; changed timeout same request conflicts; child and continuation remain under the original deadline; short join is not extended; expired/revoked/cancelled work cannot proceed; SIGKILL/reopen preserves deadlines and never replays effects; mismatched profile/source/config refuses before writes; existing retained D runtime reopens unchanged. Use short synthetic clocks/controlled provider fixtures, not long real waits or provider calls.

Do-nothing option: keep the proven smoke-only profile and disclose20s/60s. It preserves current evidence, but is not evidence of general long-running practical use.

## B. Execution capability is separate

The accepted managed launcher grants workbench read/write/history, not `workbench:execute`; tools.enabled and codingPacks are empty and there is no selected external project root. Budget changes alone do not create a coding/test application.

1. Smallest isolated capability: an explicitly selected app-owned workbench execution profile can enable existing QuickJS `workspace_run`/`workspace_test`. The code has no Node/shell/import/network, staged writes commit only on success, and execution defaults2s/caps5s (`src/workbench.ts:84,366`). `workbench:execute` also exposes other existing execution-category tools, so do not describe that permission as test-only unless the host filters the exact tool set. Keep this a separate permission/profile digest and UI capability.
2. Real project commands require a separate user-selected project root and explicit command authority. Existing project tools validate protected paths and have durable command tracking, but `project_shell` explicitly is **not a sandbox** and has host filesystem/network access (`src/project-tools.ts:198`). Choosing a cwd does not contain a shell. Do not enable it ambiently or claim file path guards constrain arbitrary commands.
3. Prefer a first closed runner/test selection with explicit executable/argv/environment/deadline and approved manifest/command/runner identity (existing programs approval fields in `src/workspace.ts:109` are a possible foundation). Confirm command admission/cancellation/effect evidence separately. Selecting a real project, symlink/reparse containment, protected credential/state paths, missing runner, process tree cleanup, mutable executable hashes and restart/unknown effects need independent tests. This is a distinct source/authorization contract, not part of the budget change or an automatic permission increase.

## Evidence and withdrawal

Relevant existing records: [host resume](PIDA-HOST-RESUME-20261107.md), [atomic admission](PIDA-ORGANIZATION-ADMISSION-20261107.md), [UI budget correction](two-org-ui-budget-correction-20261107.json), [actual D scope](two-org-case-d-workflow-20261108.json), [independent actual review](two-org-case-d-independent-20261108/INDEPENDENT-ACTUAL-CASE-D-REVIEW.md).

Withdraw the minimal design if profile identity cannot remain immutable across restart, the authoritative adapter cannot bind effective limits, any child/continuation bypasses a deadline, or intended use needs per-goal run limits. No performance/adequacy claim is made for proposed numbers. Valid only for the inspected b7 contract; implementation and independent review remain future gates. Parent/root contract choice is the next action.
