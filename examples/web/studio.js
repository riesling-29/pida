import { explainError } from "/pida-client.js";
const $ = id => document.getElementById(id);
const outcomes = { completed: "실행 완료", failed: "실행 실패", cancelled: "중단됨", limited: "실행 한도 도달", interrupted: "서버 종료로 중단됨" };
const cleanPrompt = text => text.replace(/^\[PIDA (?:UI|CODE) STUDIO\][\s\S]*?\nUSER REQUEST:\n/, "");
const activityLabels = { run_started: "요청 시작", turn_started: "모델 응답 대기", tool_started: "도구 실행", tool_completed: "도구 완료", tool_failed: "도구 실패", compaction_started: "컨텍스트 압축 시작", compaction_completed: "컨텍스트 압축 완료", compaction_failed: "컨텍스트 압축 실패", output_retry: "출력 한도 후 재시도", model_request: "모델 응답 대기", model_response: "모델 응답 수신", run_finished: "실행 종료" };
const duration = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`; };

export function createStudio({ client, request, changed, disconnected }) {
  let connected = false, hostBusy = false, busy = false, remoteRunning = false, mock = false, available = false;
  let state = { html: "", revision: "", templates: [] }, workspace = { files: [] }, mode = "studio", session, selectedTemplate;
  let generation = 0, refreshSequence = 0, fileSequence = 0, mobile = false, selectedFile = "", target = "ui", view = "preview", poll;
  let review, changes, bundle, reviewNote = "";
  let activity, activityTimer, projectTools = false, previewRefreshing = false;
  const payloads = new Map(), rendered = new Map(), renderErrors = new Set();
  const frames = [$("studio-frame"), $("service-frame")];
  const status = text => { if ($("studio-run-status").textContent !== text) $("studio-run-status").textContent = text; };
  const issue = error => status(["UI_REVISION_CONFLICT", "WORKSPACE_REVISION_CONFLICT"].includes(error.code) ? "다른 작업에서 파일이 변경됐습니다. 새로고침 후 변경 내역을 확인하세요." : explainError(error.code));
  const reviewKey = () => "pida-studio-review:" + session;
  function resetActivity() {
    clearInterval(activityTimer); activityTimer = undefined; activity = undefined;
    $("studio-activity").hidden = true; $("studio-activity-list").replaceChildren();
    $("studio-activity-count").textContent = ""; $("studio-activity-clock").textContent = ""; $("studio-activity-stale").hidden = true;
  }
  function activityClock() {
    if (!activity) return;
    const end = activity.endedAt ?? Date.now();
    $("studio-activity-clock").textContent = `${activity.startObserved ? "경과" : "관측 이후"} ${duration(end - activity.startedAt)} · 마지막 신호 ${duration(end - activity.lastAt)} 전`;
    // An aging signal is not proof of a stalled model, nor a fabricated heartbeat.
    $("studio-activity-stale").hidden = !activity.running || Date.now() - activity.lastAt < 30000;
  }
  function beginActivity(runId, timestamp, startObserved = false) {
    resetActivity();
    const time = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : Date.now();
    activity = { runId, startedAt: time, startObserved, lastAt: time, running: true, tools: new Map(), seen: new Set(), total: 0, cancelling: false };
    $("studio-activity").hidden = false; $("studio-activity").open = true;
    activityTimer = setInterval(activityClock, 1000); activityClock();
  }
  function stopActivity(timestamp) {
    if (!activity) return;
    activity.running = false; activity.tools.clear();
    activity.endedAt = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : Date.now();
    clearInterval(activityTimer); activityTimer = undefined; activityClock();
  }
  function activityStatus(text) {
    if (!activity?.running) return;
    status(activity.cancelling ? "중단 요청 중 · 최종 상태를 기다리고 있습니다." : activity.tools.size ? `실행 중 · ${[...activity.tools.values()].join(", ")}` : text);
  }
  function receiveTrace(event) {
    if (!activity || activity.runId !== event.runId) beginActivity(event.runId, event.timestamp, event.type === "run_started");
    const key = event.sequence;
    if (activity.seen.has(key)) return;
    activity.seen.add(key);
    // Only the bounded server trace is replayed; cap deduplication as well as DOM rows.
    if (activity.seen.size > 2000) activity.seen.delete(activity.seen.values().next().value);
    const time = Date.parse(event.timestamp);
    if (Number.isFinite(time)) activity.lastAt = Math.max(activity.lastAt, time);
    if (event.type === "run_started") { activity.startedAt = time || activity.startedAt; activity.startObserved = true; }
    const label = activityLabels[event.type];
    if (label) {
      const li = document.createElement("li"), stamp = document.createElement("time"), text = document.createElement("span");
      stamp.textContent = new Date(Number.isFinite(time) ? time : Date.now()).toLocaleTimeString([], { hour12: false });
      text.textContent = `${event.type === "run_finished" ? outcomes[event.status] ?? label : label}${event.toolName ? " · " + event.toolName.slice(0, 100) : ""}${event.code ? " · " + event.code.slice(0, 100) : ""}`;
      li.dataset.activity = event.type; li.append(stamp, text);
      const list = $("studio-activity-list"), atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      list.append(li); if (list.children.length > 60) list.firstElementChild.remove();
      $("studio-activity-count").textContent = ++activity.total > 60 ? "최근 60건" : `${activity.total}건`;
      if (atEnd) list.scrollTop = list.scrollHeight;
    }
    if (event.type === "tool_started") activity.tools.set(event.toolCallId ?? event.toolName, event.toolName ?? "도구");
    if (["tool_completed", "tool_failed"].includes(event.type)) activity.tools.delete(event.toolCallId ?? event.toolName);
    if (event.type === "run_finished") { stopActivity(event.timestamp); status(`${outcomes[event.status] ?? "실행 상태 미확인"} · 아래 변경·검증 결과를 확인하세요.`); }
    else if (event.type === "compaction_started") activityStatus("긴 대화를 요약하고 있습니다…");
    else if (event.type === "output_retry") activityStatus("출력 한도 이후 더 작은 수정으로 이어갑니다…");
    else activityStatus(event.type === "tool_failed" ? "도구 실패 · 후속 응답을 기다리고 있습니다." : "모델 응답을 기다리고 있습니다.");
    activityClock();
  }
  function restoreActivity(events, running, lastStatus) {
    const latest = events.at(-1);
    if (!latest) return;
    for (const event of events.filter(e => e.runId === latest.runId)) receiveTrace(event);
    if (!running) {
      if (activity?.running) stopActivity(latest.timestamp);
      status(`${outcomes[lastStatus] ?? "실행 상태 미확인"} · 아래 변경·검증 결과를 확인하세요.`);
    }
  }
  function saveReview() { if (session && review) sessionStorage.setItem(reviewKey(), JSON.stringify(review)); }
  function clearReview() {
    review = changes = bundle = undefined; reviewNote = "";
    resetActivity();
    $("studio-goal").textContent = "목표를 입력하고 실제 변경을 확인하세요.";
    $("studio-events").replaceChildren(); renderReview();
  }
  function controls() {
    const locked = busy || remoteRunning || hostBusy || !connected;
    for (const id of ["choose-template", "first-template", "studio-refresh", "studio-target-mode", "studio-file"]) $(id).disabled = locked || !available;
    $("studio-target-mode").disabled = locked || (!available && !projectTools);
    $("apply-template").disabled = locked || !selectedTemplate;
    for (const id of ["studio-send", "studio-prompt"]) $(id).disabled = locked || mock || (!available && !(target === "project" && projectTools)) || (target === "ui" && !state.html);
    $("studio-new-chat").disabled = locked;
    for (const id of ["studio-compact", "studio-handoff"]) $(id).disabled = locked || !session;
    $("studio-cancel").disabled = !(busy || remoteRunning) || !session;
    $("studio-restore").disabled = locked || target === "project" || !workspace.canCheckpoint || !review?.base || !review?.revision || !changes?.files.length || workspace.revision !== review.revision || !!bundle?.manifest?.known_limits?.includes("EFFECT_STATE_REQUIRES_RECONCILIATION");
    $("mode-disconnect").disabled = locked;
    for (const button of $("template-grid").querySelectorAll("button")) button.disabled = locked;
    $("studio-demo").hidden = !mock; $("open-service").disabled = !state.html;
    $("mode-tabs").hidden = !connected;
    $("studio-target-mode").value = target;
    $("studio-target").textContent = target === "ui" ? "app/index.html" : target === "project" ? "서버에 설정한 프로젝트 · project_* 도구" : selectedFile || "작업 공간 전체";
    $("studio-prompt").placeholder = target === "ui" ? "왼쪽 메뉴에 분석 페이지를 추가하고 기존 기능을 유지해줘." : target === "project" ? "프로젝트 구조를 살펴보고 버그를 수정한 뒤 관련 테스트를 실행해줘." : "이 파일을 수정하고 테스트를 실행해줘. 실제 검사 결과도 알려줘.";
    showMode(mode);
  }
  function showMode(next) {
    mode = next;
    for (const name of ["service", "studio", "workspace"]) {
      $(name === "workspace" ? "workspace" : name + "-view").hidden = !connected || name !== mode;
      document.querySelector(`#mode-tabs [data-mode="${name}"]`).setAttribute("aria-pressed", String(name === mode));
    }
    document.body.dataset.mode = mode; requestAnimationFrame(resize);
  }
  function showView(next) {
    view = next;
    document.querySelector(".studio-tabs").hidden = target === "project";
    $("studio-project-panel").hidden = target !== "project";
    for (const name of ["preview", "files", "changes"]) {
      $("studio-panel-" + name).hidden = target === "project" || name !== view;
      $("studio-tab-" + name).setAttribute("aria-selected", String(name === view));
      $("studio-tab-" + name).tabIndex = name === view ? 0 : -1;
    }
    if (view === "files" && target !== "project") void readFile();
    requestAnimationFrame(resize);
  }
  function resize() {
    const width = mobile ? 390 : 1280, height = mobile ? 760 : 820;
    const container = $("studio-canvas"), viewport = $("preview-viewport"), frame = $("studio-frame");
    const scale = Math.min(1, Math.max(0.1, (container.clientWidth - 32) / width));
    viewport.style.width = `${width * scale}px`; viewport.style.height = `${height * scale}px`;
    frame.style.width = `${width}px`; frame.style.height = `${height}px`; frame.style.transform = `scale(${scale})`;
  }
  new ResizeObserver(resize).observe($("studio-canvas"));
  function renderState() {
    $("studio-sync").textContent = target === "project" ? "프로젝트 변경은 서비스 작업 공간의 미리보기·파일 복원 범위에 포함되지 않습니다." : !state.html ? "서비스 화면 없음 · 파일 작업은 바로 시작할 수 있습니다" : `저장 ${state.revision.slice(0, 8)} · ${renderErrors.size ? "화면 스크립트 오류" : rendered.get("studio-frame") === state.revision ? "미리보기 로드됨" : "미리보기 로딩 중"}`;
  }
  function render(force = false) {
    $("service-empty").hidden = !!state.html; $("studio-empty").hidden = !!state.html; $("preview-viewport").hidden = !state.html;
    for (const frame of frames) {
      frame.hidden = !state.html;
      if (!state.html) { frame.removeAttribute("src"); payloads.delete(frame); rendered.delete(frame.id); renderErrors.delete(frame.id); continue; }
      if (!force && payloads.get(frame)?.revision === state.revision) continue;
      rendered.delete(frame.id); renderErrors.delete(frame.id);
      payloads.set(frame, { html: state.html, revision: state.revision, renderId: crypto.randomUUID() });
      frame.src = `/studio-frame.html?view=${frame.id}&v=${encodeURIComponent(state.revision)}&refresh=${Date.now()}`;
    }
    renderState(); resize(); controls();
  }
  window.addEventListener("message", event => {
    const frame = frames.find(f => f.contentWindow === event.source), payload = frame && payloads.get(frame);
    if (!connected || !payload) return;
    if (event.data?.type === "pida:ready") frame.contentWindow.postMessage({ type: "pida:render", html: payload.html, renderId: payload.renderId }, "*");
    if (event.data?.renderId !== payload.renderId) return;
    if (event.data.type === "pida:render-error") renderErrors.add(frame.id);
    if (event.data.type === "pida:rendered") rendered.set(frame.id, payload.revision);
    renderState(); // Loading signals are not verification evidence.
  });
  async function readFile() {
    const active = generation, sequence = ++fileSequence, path = selectedFile;
    $("studio-source").textContent = path ? "파일을 읽고 있습니다…" : "대화로 파일을 만들거나 작업 공간에서 올리세요.";
    $("studio-file-meta").textContent = "";
    if (!path) return;
    try {
      const file = await client.readWorkspaceFile(path);
      if (active !== generation || sequence !== fileSequence) return;
      $("studio-source").textContent = file.content;
      $("studio-file-meta").textContent = `${new TextEncoder().encode(file.content).length.toLocaleString()} bytes · 읽기 전용 보기`;
    } catch (error) { if (active === generation && sequence === fileSequence) $("studio-source").textContent = explainError(error.code); }
  }
  function renderFiles() {
    if (!workspace.files.some(f => f.path === selectedFile)) selectedFile = workspace.files[0]?.path ?? "";
    $("studio-file").replaceChildren();
    for (const file of workspace.files) { const option = document.createElement("option"); option.value = file.path; option.textContent = file.path; $("studio-file").append(option); }
    if (!workspace.files.length) { const option = document.createElement("option"); option.value = ""; option.textContent = "선택한 파일 없음"; $("studio-file").append(option); }
    $("studio-file").value = selectedFile;
    if (view === "files") void readFile();
  }
  async function refresh(force = false) {
    const active = generation, sequence = ++refreshSequence;
    try {
      const [result, files] = await Promise.all([request("/v1/studio"), client.getWorkbench()]);
      if (active !== generation || sequence !== refreshSequence) return;
      available = true; state = result; workspace = files; renderFiles(); render(force); renderReview();
    } catch (error) {
      if (active !== generation || sequence !== refreshSequence) return;
      if (error.status === 403 || error.status === 404) {
        available = false; state = { html: "", revision: "", templates: [] }; workspace = { files: [] }; selectedFile = ""; fileSequence++;
        $("studio-source").textContent = "작업 파일 접근 권한이 없습니다."; renderFiles(); render();
        status("이 서버에는 제작 기능 또는 접근 권한이 없습니다.");
      } else throw error;
    }
  }
  function refreshDuringRun() {
    if (previewRefreshing) return;
    previewRefreshing = true;
    const active = generation;
    // Keep consuming trace events even when preview/checkpoint reads are slow.
    void refresh().catch(() => { if (active === generation) reviewNote = "실행 중 화면 갱신 실패 · 완료 후 다시 확인합니다."; })
      .finally(() => { previewRefreshing = false; });
  }
  function renderReview() {
    $("studio-change-count").textContent = changes?.files.length ?? 0;
    $("studio-change-summary").textContent = changes ? `${changes.files.length}개 파일 변경 · ${changes.base.slice(0, 8)} → ${changes.head.slice(0, 8)}${changes.truncated ? " · diff 일부만 표시" : ""}${review?.revision && workspace.revision !== review.revision ? " · 이후 변경 있음" : ""}` : reviewNote || "요청 전후의 파일 변경을 여기에 표시합니다.";
    $("studio-diff").textContent = changes?.diff || (changes ? "파일 변경 없음" : "");
    $("studio-changed-files").replaceChildren();
    for (const path of changes?.files ?? []) { const li = document.createElement("li"); li.textContent = path; $("studio-changed-files").append(li); }
    const manifest = bundle?.manifest;
    $("studio-outcome").textContent = manifest ? `${outcomes[manifest.reported_status] ?? "상태 미확인"}${manifest.code ? " · " + explainError(manifest.code) : ""}` : review ? "실행 결과 미확인 · 아직 검증되지 않았습니다" : "아직 실행한 요청이 없습니다.";
    $("studio-verification").replaceChildren();
    for (const check of manifest?.verification_results ?? []) {
      const current = check.current_at_run_end && check.artifact_snapshot_digest === workspace.revision;
      const li = document.createElement("li");
      li.textContent = `${check.scope === "isolated-browser" ? "브라우저" : "JavaScript"} 검사: ${check.status === "PASSED" ? "통과" : check.status === "FAILED" ? "실패" : "실행 환경 없음"} · ${current ? "현재 파일과 일치" : "현재 파일에 유효한 검증으로 볼 수 없음"}${check.assertions !== undefined ? ` · ${check.assertions}개 단언` : ""}`;
      li.dataset.result = current && check.status === "PASSED" ? "passed" : check.status === "FAILED" ? "failed" : "unknown";
      $("studio-verification").append(li);
    }
    if (!manifest?.verification_results?.length) { const li = document.createElement("li"); li.textContent = "검증 결과 없음 · 화면 표시나 모델의 완료 응답만으로 검증되지 않습니다."; $("studio-verification").append(li); }
    $("studio-evidence-scope").textContent = `${bundle && !bundle.complete ? "실행 기록 일부 누락. " : ""}${reviewNote ? reviewNote + " " : ""}검사는 실행한 범위만 확인합니다. 전체 요구사항에 대한 독립 검증은 미확인입니다. 파일 복원은 저장된 스킬·외부 시스템을 되돌리지 않습니다.`;
    controls();
  }
  async function loadReview() {
    if (!review || !session) { renderReview(); return; }
    const active = generation, current = review, id = session;
    const results = await Promise.allSettled([
      current.base && current.head ? client.getChanges(current.base, current.head) : Promise.resolve(undefined),
      current.runId ? client.exportRun(id, current.runId) : Promise.resolve(undefined),
    ]);
    if (active !== generation || current !== review || id !== session) return;
    changes = results[0].status === "fulfilled" ? results[0].value : undefined;
    bundle = results[1].status === "fulfilled" ? results[1].value : undefined;
    if (results.some(r => r.status === "rejected")) reviewNote = "변경 내역 또는 실행 근거를 불러오지 못했습니다. 새로고침으로 다시 확인하세요.";
    $("studio-events").replaceChildren();
    if (bundle) {
      for (const event of bundle.events.filter(e => ["tool_started", "tool_completed", "tool_failed", "timeout", "cancellation", "output_retry"].includes(e.activity)).slice(-40)) {
        const li = document.createElement("li"); li.textContent = `${event.activity} ${event.payload.tool_name ?? ""}${event.payload.code ? " · " + event.payload.code : ""}`; $("studio-events").append(li);
      }
    }
    renderReview();
  }
  async function finishReview() {
    if (review?.base && !review.head) {
      try { const end = await client.captureCheckpoint(); review.head = end.checkpoint; review.revision = end.revision; saveReview(); }
      catch { reviewNote = "요청 후 파일 상태를 기록하지 못했습니다. 자동 복원은 사용할 수 없습니다."; }
    }
    await refresh(); await loadReview();
  }
  function templates() {
    selectedTemplate = undefined; $("template-grid").replaceChildren();
    for (const template of state.templates) {
      const card = document.createElement("button"); card.type = "button"; card.className = "template-card"; card.setAttribute("aria-pressed", "false");
      const sketch = document.createElement("div"); sketch.className = `template-sketch sketch-${template.layout}`; sketch.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 5; i++) sketch.append(document.createElement("i"));
      const title = document.createElement("strong"), detail = document.createElement("span"); title.textContent = template.name; detail.textContent = template.description;
      card.append(sketch, title, detail);
      card.onclick = () => { selectedTemplate = template.id; for (const b of $("template-grid").children) b.setAttribute("aria-pressed", String(b === card)); controls(); };
      $("template-grid").append(card);
    }
    $("template-notice").textContent = state.html ? "템플릿을 바꾸면 현재 화면이 교체됩니다. 기존 파일은 Git 이력에 남습니다." : "선택한 템플릿으로 서비스 화면을 시작합니다.";
    controls(); $("template-dialog").showModal();
  }
  function message(role, text) {
    $("studio-messages").querySelector(".studio-chat-empty")?.remove();
    const article = document.createElement("article"), label = document.createElement("strong"), body = document.createElement("p");
    article.className = role; label.textContent = role === "user" ? "YOU" : "PIDA"; body.textContent = text;
    article.append(label, body); $("studio-messages").append(article); return body;
  }
  function contextLabel(data) {
    const c = data.context;
    $("studio-context").textContent = c ? `컨텍스트 ${c.percent == null ? "측정 대기" : c.percent.toFixed(0) + "%"} / ${c.contextWindow.toLocaleString()} · 자동 압축 ${data.autoCompaction ? "켜짐" : "꺼짐"}` : "대화 시작 후 컨텍스트를 표시합니다";
  }
  function schedulePoll() {
    clearTimeout(poll);
    if (!remoteRunning || !connected) return;
    const active = generation;
    poll = setTimeout(async () => {
      try {
        const data = await client.getSession(session);
        if (active !== generation) return;
        remoteRunning = data.running; contextLabel(data);
        const traces = await client.getTrace(session);
        if (active !== generation) return;
        restoreActivity(traces.events, data.running, data.lastStatus); await refresh();
        if (!remoteRunning) { await restoreChat(); await finishReview(); status("이전 실행이 종료됐습니다. 실제 변경과 결과를 확인하세요."); }
      } catch (error) { if (active === generation) issue(error); }
      if (active === generation) { changed(); controls(); schedulePoll(); }
    }, 1500);
  }
  async function restoreChat() {
    if (!session) return;
    try {
      const data = await client.getSession(session); contextLabel(data); remoteRunning = data.running;
      const traces = (await client.getTrace(session)).events, latest = traces.at(-1);
      restoreActivity(traces, data.running, data.lastStatus);
      if (latest && latest.runId !== review?.runId) {
        review = { runId: latest.runId, target, file: selectedFile }; changes = bundle = undefined;
        reviewNote = "이 실행의 요청 전 변경 기준이 없어 파일 비교·복원은 사용할 수 없습니다.";
        saveReview(); renderReview();
      }
      $("studio-messages").replaceChildren();
      for (const item of data.messages) message(item.role, item.role === "user" ? cleanPrompt(item.text) : item.text);
      const last = data.messages.filter(m => m.role === "user").at(-1);
      if (last) $("studio-goal").textContent = cleanPrompt(last.text).slice(0, 180);
      if (data.running && !activity) status("이전 요청이 실행 중입니다. 상태를 확인하고 있습니다.");
      schedulePoll(); changed(); controls();
    } catch (error) {
      if (error.status !== 404) throw error;
      session = undefined; remoteRunning = false; sessionStorage.removeItem("pida-studio-session"); clearReview();
    }
  }
  async function compact(handoff) {
    if (!session || busy || remoteRunning || hostBusy) return;
    busy = true; changed(); controls(); status(handoff ? "작업 맥락을 새 대화로 옮기고 있습니다…" : "대화를 압축하고 있습니다…");
    try {
      const result = await client.compactSession(session, handoff);
      if (result.sessionId !== session) clearReview();
      session = result.sessionId; sessionStorage.setItem("pida-studio-session", session); await restoreChat();
      status(handoff ? "맥락을 새 대화로 옮겼습니다. 파일은 유지됩니다." : "대화를 압축했습니다. 파일은 유지됩니다.");
    } catch (error) { issue(error); }
    finally { busy = false; changed(); controls(); }
  }
  async function send(event) {
    event.preventDefault();
    if (busy || remoteRunning || hostBusy || !connected || mock || (!available && !(target === "project" && projectTools)) || (target === "ui" && !state.html)) return;
    const text = $("studio-prompt").value.trim(); if (!text) return;
    const before = state.revision;
    busy = true; clearReview(); review = {}; changed(); controls();
    beginActivity(undefined, new Date().toISOString()); status("요청을 보내고 있습니다…");
    $("studio-goal").textContent = text.slice(0, 180);
    message("user", text); const output = message("assistant", "작업을 시작하고 있습니다…");
    let answer = "", result;
    try {
      if (!session) { session = (await client.createSession()).sessionId; sessionStorage.setItem("pida-studio-session", session); }
      if (target === "project") reviewNote = "프로젝트 저장소 변경은 서비스 작업 공간의 파일 비교·복원 범위에 포함되지 않습니다.";
      else if (workspace.canCheckpoint) {
        try { review.base = (await client.captureCheckpoint()).checkpoint; }
        catch { reviewNote = "요청 전 변경 기준을 기록하지 못했습니다. 변경 비교·자동 복원을 사용할 수 없습니다."; }
      } else reviewNote = "변경 기록 권한이 없어 비교·자동 복원을 사용할 수 없습니다.";
      review.target = target; review.file = selectedFile; saveReview(); controls();
      const instructions = target === "ui"
        ? `You are editing the service UI shown beside this chat. Read the current app with ui_read, preserve existing features, then use ui_patch for small changes or ui_apply for a complete replacement. Re-read revisions between changes. Keep self-contained HTML with inline CSS/JavaScript and addEventListener. No external resources, network, frames, localStorage or parent access. Current revision at request start: ${before}.`
        : target === "project" ? `You are working in the operator-configured host project, not the isolated service workbench. Use registered project_* tools to inspect the project and its applicable AGENTS.md instructions, read relevant files, make requested changes, and execute relevant tests when project_shell is available. Check actual registered tool capabilities and permissions. Preserve unrelated and user changes. Do not put project changes into the service workbench unless explicitly requested. The service workbench's checkpoints, diff and restore do not cover this project or external side effects. Report changed paths and actual verification outputs honestly.`
        : `You are working on files in the isolated service workbench. Selected file (context, not a scope authorization): ${JSON.stringify(selectedFile || null)}. Read relevant files before editing; use registered workbench tools. JavaScript tests run in QuickJS using workspace_test; this workbench has no Node.js, Python, npm or network. The separately configured host project, if any, is a different target. Preserve unrelated files and the service UI unless the user requests changes.`;
      const prompt = `[PIDA ${target === "ui" ? "UI" : "CODE"} STUDIO]\n${instructions} Apply requested changes with tools, not just a code block in chat. Run relevant available checks and report their scope honestly. Rendering is not verification.\nUSER REQUEST:\n${text}`;
      for await (const event of client.stream(session, prompt, { disconnectPolicy: "continue" })) {
        if (event.type === "text_delta") {
          answer += event.delta; output.textContent = answer;
          if (activity?.running) { activity.lastAt = Date.now(); activityStatus("모델 응답을 받고 있습니다."); activityClock(); }
        }
        if (event.type === "trace") {
          receiveTrace(event.trace);
          if (event.trace.type === "run_started") { review.runId = event.trace.runId; saveReview(); }
          if (["tool_completed", "tool_failed"].includes(event.trace.type)) refreshDuringRun();
        }
        if (event.type === "result") { result = event.result; if (activity?.running) stopActivity(); review.runId = result.runId; saveReview(); output.textContent = [result.text, ...[...new Set([result.code, result.persistenceError])].filter(Boolean).map(explainError)].filter(Boolean).join("\n\n") || "응답이 없습니다."; }
        $("studio-messages").scrollTop = $("studio-messages").scrollHeight;
      }
      if (result?.status === "completed") $("studio-prompt").value = "";
      status(`${outcomes[result?.status] ?? "실행 상태 미확인"} · 아래 변경·검증 결과를 확인하세요.`);
    } catch (error) { issue(error); }
    finally {
      try { const data = session && await client.getSession(session); if (data) { contextLabel(data); remoteRunning = data.running; } }
      catch {
        reviewNote = "서버 실행 상태를 다시 확인하지 못했습니다. 새로고침 후 확인하세요.";
        if (session && activity?.runId) { remoteRunning = true; status("서버 실행 상태 미확인 · 연결을 다시 확인하고 있습니다."); }
      }
      if (!remoteRunning && activity?.running) stopActivity();
      if (!remoteRunning) await finishReview().catch(() => { reviewNote = "결과 조회 실패 · 새로고침으로 다시 확인하세요."; renderReview(); });
      busy = false; changed(); controls(); schedulePoll(); $("studio-prompt").focus();
    }
  }
  for (const button of document.querySelectorAll("#mode-tabs [data-mode]")) button.onclick = () => { showMode(button.dataset.mode); if (button.dataset.mode !== "workspace") refresh().catch(issue); };
  for (const name of ["preview", "files", "changes"]) $("studio-tab-" + name).onclick = () => showView(name);
  document.querySelector(".studio-tabs").onkeydown = event => {
    const names = ["preview", "files", "changes"], focused = names.find(name => event.target === $("studio-tab-" + name)), index = names.indexOf(focused ?? view);
    const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : undefined;
    if (next !== undefined) { event.preventDefault(); showView(names[next]); $("studio-tab-" + names[next]).focus(); }
  };
  $("studio-target-mode").onchange = () => { target = $("studio-target-mode").value; showView(target === "files" ? "files" : "preview"); renderState(); controls(); };
  $("studio-file").onchange = () => { selectedFile = $("studio-file").value; target = "files"; controls(); void readFile(); };
  $("start-building").onclick = () => showMode("studio"); $("open-service").onclick = () => showMode("service"); $("mode-disconnect").onclick = disconnected;
  $("choose-template").onclick = templates; $("first-template").onclick = templates; $("close-templates").onclick = () => $("template-dialog").close();
  $("apply-template").onclick = async () => {
    if (busy || remoteRunning || hostBusy || !selectedTemplate) return;
    busy = true; changed(); controls();
    try { await request("/v1/studio/template", { method: "POST", body: { templateId: selectedTemplate, expectedRevision: state.revision } }); $("template-dialog").close(); await refresh(); status("템플릿을 적용했습니다. 대화로 기능을 추가하세요."); }
    catch (error) { issue(error); await refresh().catch(() => {}); }
    finally { busy = false; changed(); controls(); }
  };
  $("studio-restore").onclick = async () => {
    if ($("studio-restore").disabled || !review?.base || !confirm("이 요청 전의 전체 작업 파일로 복원합니다. 현재 파일은 Git 이력에 보관됩니다. 저장된 스킬과 외부 변경은 복원되지 않습니다. 계속할까요?")) return;
    busy = true; changed(); controls();
    try { await client.restoreCheckpoint(review.base, review.revision); await refresh(true); status("요청 전 파일로 복원했습니다. 이전 검증의 현재 유효성을 다시 확인하세요."); }
    catch (error) { issue(error); await refresh().catch(() => {}); }
    finally { busy = false; changed(); controls(); }
  };
  $("studio-compact").onclick = () => compact(false); $("studio-handoff").onclick = () => compact(true); $("studio-form").onsubmit = send;
  $("studio-prompt").onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) { event.preventDefault(); $("studio-form").requestSubmit(); } };
  $("studio-new-chat").onclick = () => { if (busy || remoteRunning || hostBusy) return; session = undefined; sessionStorage.removeItem("pida-studio-session"); clearReview(); $("studio-messages").replaceChildren(); status("새 대화 · 현재 파일은 유지됩니다."); controls(); };
  $("studio-cancel").onclick = async () => {
    $("studio-cancel").disabled = true;
    if (activity?.running) { activity.cancelling = true; activityStatus(""); }
    try { await client.cancel(session); if (activity?.running) status("중단 요청을 전달했습니다. 최종 상태를 기다리고 있습니다."); }
    catch (error) { if (activity) activity.cancelling = false; issue(error); controls(); }
  };
  $("studio-refresh").onclick = async () => { try { await refresh(true); await restoreChat(); if (!remoteRunning) await finishReview(); } catch (error) { issue(error); } };
  for (const button of document.querySelectorAll("[data-suggestion]")) button.onclick = () => { $("studio-prompt").value = button.dataset.suggestion; $("studio-prompt").focus(); };
  for (const size of ["desktop", "mobile"]) $("preview-" + size).onclick = () => { mobile = size === "mobile"; $("preview-desktop").setAttribute("aria-pressed", String(!mobile)); $("preview-mobile").setAttribute("aria-pressed", String(mobile)); resize(); };
  return {
    get busy() { return busy || remoteRunning; },
    update({ connected: value, busy: parentBusy }) { connected = value; hostBusy = parentBusy; controls(); },
    async connect(info) {
      generation++; clearTimeout(poll); connected = true; mock = info.provider?.mode === "mock";
      projectTools = info.tools?.some(tool => tool.permitted && tool.name.startsWith("project_")) ?? false;
      $("studio-project-option").hidden = !projectTools; $("studio-project-option").disabled = !projectTools;
      const browserChecks = info.tools?.some(tool => tool.permitted && tool.name === "ui_check");
      $("studio-capability").textContent = `현재 실행 환경: 화면 편집 · 파일 수정 · JavaScript 검사${browserChecks ? " · 브라우저 검사 도구" : " · 브라우저 검사 도구 없음"}${projectTools ? " · 별도 프로젝트 도구 (파일 복원 범위 밖)" : ""}`;
      $("studio-model").textContent = info.provider ? info.provider.model : "연결된 모델";
      session = sessionStorage.getItem("pida-studio-session") || undefined; clearReview();
      try { const saved = session && JSON.parse(sessionStorage.getItem(reviewKey()) || "null"); if (saved && typeof saved === "object") { review = saved; target = saved.target === "project" && projectTools ? "project" : saved.target === "files" ? "files" : "ui"; selectedFile = typeof saved.file === "string" ? saved.file : ""; } } catch { /* Optional tab-local metadata is recoverable. */ }
      if (review?.target === "project") reviewNote = "프로젝트 저장소 변경은 서비스 작업 공간의 파일 비교·복원 범위에 포함되지 않습니다.";
      await refresh(); if (!available && projectTools) target = "project";
      await restoreChat(); if (!remoteRunning) await finishReview(); showView(target === "files" ? "files" : "preview"); renderState(); controls();
    },
    reset() {
      generation++; fileSequence++; clearTimeout(poll); connected = busy = remoteRunning = available = false; state = { html: "", revision: "", templates: [] }; workspace = { files: [] }; session = undefined; selectedFile = ""; target = "ui";
      payloads.clear(); rendered.clear(); renderErrors.clear(); for (const frame of frames) frame.removeAttribute("src");
      $("studio-messages").replaceChildren(); $("studio-source").textContent = ""; $("studio-file-meta").textContent = ""; $("template-dialog").close(); clearReview(); showView("preview"); renderFiles(); controls();
    },
    refresh,
  };
}
