import { createRunDetails } from "/run-details.js";
import { explainError } from "/pida-client.js";
const $ = id => document.getElementById(id);
const statuses = { queued: "대기", running: "실행 중", completed: "실행 완료", failed: "실패", cancelled: "중단됨", interrupted: "서버 종료로 중단됨", limited: "실행 한도 도달" };
const activities = { retry_scheduled: "모델 재시도 대기", retry_finished: "재시도 결과", summarization_retry_attempt_start: "압축 재시도", summarization_retry_finished: "압축 재시도 결과", run_started: "작업 시작", turn_started: "모델 응답 대기", tool_started: "도구 실행", tool_completed: "도구 완료", tool_failed: "도구 실패", run_finished: "실행 종료", compaction_started: "컨텍스트 압축", compaction_completed: "압축 완료", output_retry: "출력 한도 재시도" };
const stamp = value => value ? new Date(value).toLocaleString("ko-KR") : "시간 미기록";
const textNode = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };

export function createAgents({ client }) {
  let connected = false, serviceAvailable = false, generation = 0, timer, refreshing = false, mutating = false, artifactSequence = 0;
  const runDetails = createRunDetails({ container: $("agent-run-details"), load: () => client.getAgentJobTools(agent.id, selectedJobId), explain: explainError });
  let agents = [], agent, jobs = [], selectedId, selectedJobId, memory, view = "jobs", personaDirty = false, personaBaseRevision, stateBaseHead, stateBaseRelationships, pendingRequest, recoveryEffects;
  function errorMessage(error) {
    if (error.code?.includes("CONFLICT")) return "다른 변경이 먼저 저장됐습니다. 현재 개정과 입력 내용을 비교한 뒤 다시 편집하세요.";
    if (error.status === 403) return "상주 에이전트 접근 권한이 없습니다.";
    if (error.code === "AGENTS_DISABLED") return "이 서버에는 상주 에이전트가 연결되지 않았습니다.";
    return error.code ? `${explainError(error.code)} (${error.code})` : "서버 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.";
  }
  function controls() {
    for (const form of ["agent-create-form", "agent-job-form", "agent-persona-form", "agent-state-form", "agent-experience-form", "agent-steer-form"]) {
      for (const button of $(form)?.querySelectorAll("button") ?? []) button.disabled = !connected || !serviceAvailable || mutating || (form !== "agent-create-form" && !agent);
    }
    $("agents-refresh").disabled = !connected || mutating;
    $("agent-toggle-pause").disabled = !agent || mutating || (agent.paused && agent.needsReconciliation);
    $("agent-recovery-load").disabled = !agent || mutating;
    $("agent-recovery-save").disabled = mutating || !recoveryEffects || !$("agent-recovery-inspected").checked || [...$("agent-recovery-effects").querySelectorAll("select")].some(field => !field.value);
    const job = jobs.find(item => item.id === selectedJobId);
    $("agent-job-cancel").disabled = mutating || !job || !["queued", "running"].includes(job.status);
    const correction = $("agent-experience-kind").value === "correction";
    $("agent-correction-label").hidden = !correction; $("agent-correction-target").required = correction;
  }
  function renderAgents() {
    $("agents-list").replaceChildren();
    for (const item of agents) {
      const button = textNode("button", "", "agent-list-item");
      button.setAttribute("aria-current", String(item.id === selectedId));
      button.append(textNode("strong", item.name), textNode("span", `${item.paused ? "대기열 정지" : "대기열 활성"}${item.needsReconciliation ? " · 상태 확인 필요" : ""}${item.role ? " · " + item.role : ""}`));
      button.onclick = () => { if (!mutating) void select(item.id); };
      $("agents-list").append(button);
    }
    if (!agents.length) $("agents-list").append(textNode("p", "등록된 에이전트가 없습니다.", "field-hint"));
    $("agent-empty").hidden = !!agent; $("agent-detail").hidden = !agent;
    if (!agent) return;
    $("agent-title").textContent = agent.name; $("agent-role-label").textContent = agent.role || "역할 미지정";
    $("agent-state").textContent = `${agent.paused ? "대기열 정지 · 실행 중인 작업은 별도로 중단하세요" : "대기열 활성"} · ${jobs.filter(j => j.status === "running").length} 실행 / ${jobs.filter(j => j.status === "queued").length} 대기`;
    $("agent-reconciliation").hidden = !agent.needsReconciliation;
    $("agent-recovery").hidden = !agent.needsReconciliation;
    $("agent-toggle-pause").textContent = agent.paused ? "대기열 재개" : "대기열 일시 정지";
    $("agent-enqueue-note").textContent = agent.paused ? "요청은 저장됩니다. 대기열을 재개하면 실행합니다." : "브라우저를 닫아도 서버의 작업 대기열은 유지됩니다.";
  }
  function renderJobs() {
    $("agent-jobs").replaceChildren();
    for (const job of jobs) {
      const button = textNode("button", "", "agent-list-item"); button.dataset.status = job.status;
      button.setAttribute("aria-current", String(job.id === selectedJobId));
      button.append(textNode("strong", `${statuses[job.status] ?? job.status} · ${job.input.slice(0, 90)}`), textNode("span", stamp(job.createdAt)));
      button.onclick = () => { selectedJobId = job.id; $("agent-steer-form").reset(); renderJobs(); controls(); };
      $("agent-jobs").append(button);
    }
    if (!jobs.length) $("agent-jobs").append(textNode("p", "저장된 작업이 없습니다.", "field-hint"));
    const job = jobs.find(item => item.id === selectedJobId); $("agent-job-detail").hidden = !job;
    runDetails.select(job && agent ? `${agent.id}:${job.id}` : undefined, job?.runId);
    if (!job) return;
    $("agent-job-state").textContent = `${statuses[job.status] ?? job.status}${job.status === "running" ? job.currentTool ? " · " + job.currentTool : " · 모델 응답 대기" : ""}`;
    $("agent-job-time").textContent = `요청 ${stamp(job.createdAt)}${job.lastSignalAt ? " · 마지막 신호 " + stamp(job.lastSignalAt) : ""}`;
    $("agent-job-request").textContent = job.input;
    $("agent-job-activity").replaceChildren();
    for (const event of (job.activity ?? []).slice(-60)) $("agent-job-activity").append(textNode("li", `${stamp(event.timestamp)} · ${activities[event.type] ?? event.type}${event.toolName ? " · " + event.toolName : ""}${event.code ? " · " + event.code : ""}`));
    $("agent-job-result").textContent = job.result?.text || job.latestText || (job.status === "queued" ? "실행 순서를 기다리고 있습니다." : job.status === "running" ? "실행 신호를 기다리고 있습니다." : "저장된 응답 본문이 없습니다.");
    $("agent-job-code").textContent = [job.code ?? job.result?.code, job.result?.persistenceError].filter(Boolean).map(code => `${explainError(code)} (${code})`).join(" · ");
    $("agent-steer-form").hidden = job.status !== "running" || !job.runId;
  }
  function stateContent(value) {
    const fragment = document.createDocumentFragment(), info = value.information;
    for (const [label, content] of [["목표", info.goal], ["현재 이해", info.understanding], ["불확실성", info.uncertainties?.join("\n") || "기록 없음"], ["다음 행동", info.nextAction]]) {
      const row = textNode("p", ""); row.append(textNode("strong", label + " · "), document.createTextNode(content ?? "")); fragment.append(row);
    }
    fragment.append(textNode("p", `상태 ${value.id} · 근거 ${(value.sourceRefs ?? []).join(", ") || "기록 없음"}`, "field-hint"));
    if (info.relationships?.length) { const list = document.createElement("ul"); for (const relation of info.relationships) list.append(textNode("li", `${relation.subject} · ${relation.predicate} · ${relation.object}`)); fragment.append(textNode("strong", `관계 ${info.relationships.length}건`), list); }
    if (value.conflicts?.unresolved?.length) fragment.append(textNode("p", `미해결 충돌 ${value.conflicts.unresolved.length}건 · ${value.conflicts.unresolved.map(c => `${c.field}: ${c.description}`).join(" / ")}`, "notice"));
    if (value.conflicts?.resolved?.length) fragment.append(textNode("p", `해결 기록 · ${value.conflicts.resolved.map(c => `${c.field}: ${c.resolution}`).join(" / ")}`, "field-hint"));
    return fragment;
  }
  function renderMemory() {
    if (!memory) return;
    $("agent-memory-state").textContent = `페르소나 개정 ${memory.persona?.revision ?? 0} · 경험 ${memory.experiences.length}건 · 상태 ${memory.states.length}건${personaDirty ? " · 페르소나 입력 수정 중" : ""}`;
    if (!personaDirty) $("agent-persona-text").value = memory.persona?.text ?? "";
    $("agent-persona-history").replaceChildren();
    for (const item of (memory.personaHistory ?? []).slice(-20).reverse()) { const details = document.createElement("details"); details.append(textNode("summary", `개정 ${item.revision} · ${stamp(item.updatedAt)}`), textNode("p", item.text), textNode("p", (item.sourceRefs ?? []).join(", "), "field-hint")); $("agent-persona-history").append(details); }
    $("agent-experiences").replaceChildren();
    for (const item of memory.experiences.slice(-30).reverse()) {
      const article = document.createElement("article");
      article.append(textNode("strong", `${item.kind} · ${item.status} · 개정 ${item.revision}`), textNode("p", item.text), textNode("p", `근거 ${(item.sourceRefs ?? []).join(", ")} · ${item.authority ?? ""}`, "field-hint"));
      $("agent-experiences").append(article);
    }
    if (!memory.experiences.length) $("agent-experiences").append(textNode("p", "저장된 경험이 없습니다.", "field-hint"));
    const selectedCorrection = $("agent-correction-target").value, activeExperiences = memory.experiences.filter(item => item.status === "active");
    $("agent-correction-target").replaceChildren();
    const emptyTarget = textNode("option", activeExperiences.length ? "교정할 경험 선택" : "교정할 활성 경험 없음"); emptyTarget.value = ""; $("agent-correction-target").append(emptyTarget);
    for (const item of activeExperiences) { const option = textNode("option", `${item.kind} · ${item.text.slice(0, 100)} · ${item.id}`); option.value = item.id; $("agent-correction-target").append(option); }
    if (activeExperiences.some(item => item.id === selectedCorrection)) $("agent-correction-target").value = selectedCorrection;
    const head = memory.states.find(s => s.id === memory.head);
    $("agent-current-state").replaceChildren(head ? stateContent(head) : textNode("p", "아직 기록된 작업 상태가 없습니다.", "field-hint"));
    $("agent-state-history").replaceChildren();
    for (const item of memory.states.slice(-20).reverse()) { const details = document.createElement("details"); details.append(textNode("summary", `${item.id} · ${item.information.goal}`), stateContent(item)); $("agent-state-history").append(details); }
  }
  async function loadDetail(active = generation) {
    const id = selectedId; if (!id) return;
    const [detail, result, saved] = await Promise.all([client.getAgent(id), client.listAgentJobs(id), client.getAgentMemory(id)]);
    if (!connected || active !== generation || id !== selectedId) return;
    agent = detail; jobs = result.jobs; memory = saved;
    if (!jobs.some(j => j.id === selectedJobId)) selectedJobId = jobs.find(j => j.status === "running")?.id ?? jobs.at(-1)?.id;
    renderAgents(); renderJobs(); renderMemory(); controls();
    if ($("agent-artifacts").open) await loadArtifacts();
  }
  async function loadArtifacts() {
    const id = selectedId, active = generation; if (!id) return;
    const workspace = await client.getAgentWorkbench(id); if (id !== selectedId || active !== generation) return;
    const previous = $("agent-artifact-file").value; $("agent-artifact-file").replaceChildren();
    const option = textNode("option", workspace.files.length ? "파일 선택" : "저장된 파일 없음"); option.value = ""; $("agent-artifact-file").append(option);
    for (const file of workspace.files) { const option = textNode("option", file.path); option.value = file.path; $("agent-artifact-file").append(option); }
    if (workspace.files.some(f => f.path === previous)) $("agent-artifact-file").value = previous;
    else $("agent-artifact-source").textContent = "";
    $("agent-artifact-status").textContent = `${workspace.files.length}개 파일 · 읽기 전용 조회`;
    if ($("agent-artifact-file").value) await readArtifact(false);
  }
  async function readArtifact(clear = true) {
    const id = selectedId, path = $("agent-artifact-file").value, active = generation, sequence = ++artifactSequence;
    if (clear) $("agent-artifact-source").textContent = ""; if (!id || !path) return;
    try { const file = await client.readAgentFile(id, path); if (active === generation && sequence === artifactSequence) $("agent-artifact-source").textContent = file.content; }
    catch (error) { if (active === generation && sequence === artifactSequence) $("agent-artifact-status").textContent = errorMessage(error); }
  }
  function schedule() {
    clearTimeout(timer); if (!connected) return;
    timer = setTimeout(() => void refresh(), document.hidden || !serviceAvailable ? 10000 : 2000);
  }
  async function refresh() {
    if (!connected || refreshing || mutating) { schedule(); return; }
    refreshing = true; const active = generation;
    try {
      const result = await client.listAgents(); if (!connected || active !== generation) return;
      serviceAvailable = true; agents = result.agents;
      if (!agents.some(a => a.id === selectedId)) { selectedId = agents[0]?.id; selectedJobId = undefined; personaDirty = false; }
      agent = agents.find(a => a.id === selectedId); renderAgents();
      await loadDetail(active);
      if (active === generation) $("agents-status").textContent = `서버 상태 확인 · ${new Date().toLocaleTimeString("ko-KR")}`;
    } catch (error) { if (active === generation) { if (error.status === 403 || error.code === "AGENTS_DISABLED") serviceAvailable = false; $("agents-status").textContent = errorMessage(error); } }
    finally { refreshing = false; controls(); if (active === generation) schedule(); }
  }
  async function select(id) {
    ++generation; selectedId = id; selectedJobId = undefined; personaDirty = false; personaBaseRevision = stateBaseHead = stateBaseRelationships = undefined; pendingRequest = undefined;
    agent = agents.find(a => a.id === id); jobs = []; memory = undefined;
    recoveryEffects = undefined; $("agent-recovery-form").hidden = true; $("agent-recovery-form").reset(); $("agent-recovery-status").textContent = "";
    $("agent-artifact-source").textContent = ""; $("agent-artifact-file").replaceChildren();
    sessionStorage.setItem("pida-agent", id); $("agent-error").textContent = "";
    for (const form of ["agent-job-form", "agent-persona-form", "agent-state-form", "agent-experience-form", "agent-steer-form"]) $(form)?.reset();
    renderAgents(); renderJobs();
    try { await loadDetail(); } catch (error) { $("agent-error").textContent = errorMessage(error); } finally { controls(); schedule(); }
  }
  async function mutate(operation) {
    if (!connected || !serviceAvailable || mutating) return;
    mutating = true; clearTimeout(timer); controls(); $("agent-error").textContent = "";
    try { await operation(); } catch (error) { $("agent-error").textContent = errorMessage(error); }
    finally { mutating = false; controls(); await refresh(); }
  }
  function showView(next) {
    view = next;
    for (const name of ["jobs", "memory"]) { $("agent-panel-" + name).hidden = name !== view; $("agent-tab-" + name).setAttribute("aria-selected", String(name === view)); $("agent-tab-" + name).tabIndex = name === view ? 0 : -1; }
  }
  for (const name of ["jobs", "memory"]) {
    $("agent-tab-" + name).onclick = () => showView(name);
    $("agent-tab-" + name).onkeydown = event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); showView(view === "jobs" ? "memory" : "jobs"); $("agent-tab-" + view).focus(); } };
  }
  $("agents-refresh").onclick = () => void refresh();
  $("agent-create-form").onsubmit = event => { event.preventDefault(); void mutate(async () => {
    const created = await client.createAgent({ name: $("agent-name").value.trim(), role: $("agent-role").value.trim(), persona: $("agent-initial-persona").value.trim() });
    selectedId = created.id; selectedJobId = undefined; personaDirty = false; sessionStorage.setItem("pida-agent", selectedId); $("agent-create-form").reset();
  }); };
  $("agent-job-input").oninput = () => { pendingRequest = undefined; };
  $("agent-job-form").onsubmit = event => { event.preventDefault(); if (!agent) return; const input = $("agent-job-input").value.trim(); if (!input) return;
    pendingRequest ??= { input, requestId: crypto.randomUUID() };
    void mutate(async () => { const job = await client.enqueueAgentJob(agent.id, pendingRequest); selectedJobId = job.id; pendingRequest = undefined; $("agent-job-input").value = ""; });
  };
  $("agent-toggle-pause").onclick = () => { if (agent) void mutate(() => agent.paused ? client.resumeAgent(agent.id) : client.pauseAgent(agent.id)); };
  $("agent-job-cancel").onclick = () => { if (agent && selectedJobId) void mutate(() => client.cancelAgentJob(agent.id, selectedJobId)); };
  $("agent-steer-form").onsubmit = event => { event.preventDefault(); const job = jobs.find(j => j.id === selectedJobId); if (!agent || job?.status !== "running" || !job.runId) return; const raw = $("agent-steer-text").value, text = raw.trim(), id = agent.id, active = generation; if (!text) return; void mutate(async () => { await client.steerAgentJob(id, job.id, text, job.runId); if (generation === active && agent?.id === id && selectedJobId === job.id && $("agent-steer-text").value === raw) $("agent-steer-text").value = ""; }); };
  $("agent-recovery-load").onclick = () => void mutate(async () => {
    if (!agent) return;
    const job = [...jobs].reverse().find(j => j.status === "interrupted" || j.result?.recovery);
    if (!job) { $("agent-recovery-status").textContent = "복구 대상 작업을 찾지 못했습니다. 서버 기록을 확인하세요."; return; }
    const recovery = await client.getAgentJobRecovery(agent.id, job.id); recoveryEffects = recovery.pendingEffects;
    $("agent-recovery-effects").replaceChildren(); $("agent-recovery-form").reset();
    for (const effect of recoveryEffects) {
      const label = textNode("label", `${effect.toolName} · ${effect.id}`), field = document.createElement("select"); field.dataset.effectId = effect.id; field.required = true;
      for (const [value, text] of [["", "실제 상태를 확인한 후 선택"], ["applied", "변경이 적용됨"], ["not_applied", "변경이 적용되지 않음"]]) { const option = textNode("option", text); option.value = value; field.append(option); }
      label.append(field); $("agent-recovery-effects").append(label);
    }
    $("agent-recovery-form").hidden = false; $("agent-recovery-status").textContent = recoveryEffects.length ? `미확인 변경 ${recoveryEffects.length}건 · 적용 여부를 각각 확인하세요.` : "미확인 도구 변경 기록 없음 · 중단된 작업의 실제 상태를 확인하세요.";
  });
  $("agent-recovery-form").oninput = controls;
  $("agent-recovery-form").onsubmit = event => { event.preventDefault(); if (!agent || $("agent-recovery-save").disabled) return; void mutate(async () => {
    const effects = [...$("agent-recovery-effects").querySelectorAll("select")].map(field => ({ id: field.dataset.effectId, state: field.value }));
    await client.reconcileAgent(agent.id, { inspected: true, effects, note: $("agent-recovery-note").value.trim() }); recoveryEffects = undefined; $("agent-recovery-form").hidden = true;
  }); };
  $("agent-persona-text").oninput = () => { if (!personaDirty) personaBaseRevision = memory?.persona?.revision ?? null; personaDirty = true; };
  $("agent-persona-reload").onclick = () => { personaDirty = false; personaBaseRevision = undefined; renderMemory(); };
  $("agent-state-reload").onclick = () => {
    const head = memory?.states.find(s => s.id === memory.head)?.information; stateBaseHead = memory?.head ?? null;
    stateBaseRelationships = (head?.relationships ?? []).map(relation => ({ ...relation }));
    $("agent-state-goal").value = head?.goal ?? ""; $("agent-state-understanding").value = head?.understanding ?? ""; $("agent-state-uncertainties").value = head?.uncertainties?.join("\n") ?? ""; $("agent-state-next").value = head?.nextAction ?? "";
  };
  $("agent-artifacts").ontoggle = () => { if ($("agent-artifacts").open) void loadArtifacts().catch(error => { $("agent-artifact-status").textContent = errorMessage(error); }); };
  $("agent-artifact-file").onchange = () => void readArtifact();
  $("agent-persona-form").onsubmit = event => { event.preventDefault(); if (!agent || !memory) return; void mutate(async () => {
    await client.reviseAgentPersona(agent.id, { expectedRevision: personaBaseRevision === undefined ? memory.persona?.revision ?? null : personaBaseRevision, text: $("agent-persona-text").value.trim(), sourceRefs: ["user:" + new Date().toISOString()] }); personaDirty = false; personaBaseRevision = undefined;
  }); };
  $("agent-state-form").oninput = () => { if (stateBaseHead === undefined) { stateBaseHead = memory?.head ?? null; stateBaseRelationships = (memory?.states.find(s => s.id === stateBaseHead)?.information.relationships ?? []).map(relation => ({ ...relation })); } };
  $("agent-state-form").onsubmit = event => { event.preventDefault(); if (!agent || !memory) return; void mutate(async () => {
    const head = stateBaseHead === undefined ? memory.head : stateBaseHead;
    const relationships = stateBaseRelationships ?? memory.states.find(s => s.id === head)?.information.relationships ?? [];
    await client.transitionAgentMemory(agent.id, { expectedHead: head, parentIds: head ? [head] : [], information: { goal: $("agent-state-goal").value.trim(), understanding: $("agent-state-understanding").value.trim(), uncertainties: $("agent-state-uncertainties").value.split("\n").map(s => s.trim()).filter(Boolean), nextAction: $("agent-state-next").value.trim(), relationships }, sourceRefs: ["user:" + new Date().toISOString()] }); $("agent-state-form").reset(); stateBaseHead = stateBaseRelationships = undefined;
  }); };
  $("agent-experience-kind").onchange = controls;
  $("agent-experience-form").onsubmit = event => { event.preventDefault(); if (!agent) return; void mutate(async () => {
    const kind = $("agent-experience-kind").value, correctionTarget = $("agent-correction-target").value;
    if (kind === "correction" && !memory?.experiences.some(item => item.id === correctionTarget && item.status === "active")) { $("agent-error").textContent = "교정할 활성 경험을 선택하세요."; return; }
    await client.rememberAgentExperience(agent.id, { kind, text: $("agent-experience-text").value.trim(), sourceRefs: ["user:" + new Date().toISOString()], ...(kind === "correction" ? { supersedes: [correctionTarget] } : {}) }); $("agent-experience-form").reset();
  }); };
  return {
    async connect() { connected = true; ++generation; selectedId = sessionStorage.getItem("pida-agent") ?? undefined; await refresh(); },
    reset() { connected = serviceAvailable = false; ++generation; ++artifactSequence; clearTimeout(timer); agents = []; agent = memory = undefined; jobs = []; personaDirty = false; personaBaseRevision = stateBaseHead = stateBaseRelationships = undefined; pendingRequest = recoveryEffects = undefined; for (const form of ["agent-create-form", "agent-job-form", "agent-persona-form", "agent-state-form", "agent-experience-form", "agent-recovery-form", "agent-steer-form"]) $(form).reset(); for (const id of ["agent-experiences", "agent-current-state", "agent-state-history", "agent-persona-history", "agent-job-activity", "agent-recovery-effects", "agent-artifact-file"]) $(id).replaceChildren(); for (const id of ["agent-job-request", "agent-job-result", "agent-job-code", "agent-error", "agent-artifact-source", "agent-artifact-status", "agent-recovery-status", "agent-memory-state"]) $(id).textContent = ""; $("agent-recovery-form").hidden = true; renderAgents(); renderJobs(); controls(); },
  };
}
