const $ = id => document.getElementById(id);

export function createStudio({ client, request, changed, disconnected }) {
  let connected = false, hostBusy = false, busy = false, mock = false, available = false;
  let state = { html: "", revision: "", templates: [] }, mode = "studio", session, selectedTemplate;
  let generation = 0, refreshSequence = 0, mobile = false, renderingError = false;
  const payloads = new Map();
  const frames = [$("studio-frame"), $("service-frame")];
  const status = text => { $("studio-run-status").textContent = text; };
  const issue = error => status(error.code === "UI_REVISION_CONFLICT" ? "화면이 다른 작업에서 변경됐습니다. 새로고침 후 다시 선택해주세요." : `처리하지 못했습니다: ${error.message || error.code}`);
  function controls() {
    const locked = busy || hostBusy || !connected;
    for (const id of ["choose-template", "first-template", "studio-refresh"]) $(id).disabled = locked || !available;
    $("apply-template").disabled = locked || !selectedTemplate;
    $("studio-send").disabled = locked || mock || !available || !state.html;
    $("studio-prompt").disabled = locked || mock || !available || !state.html;
    $("studio-new-chat").disabled = locked;
    $("studio-cancel").disabled = !busy || !session;
    $("mode-disconnect").disabled = locked;
    for (const button of $("template-grid").querySelectorAll("button")) button.disabled = locked;
    $("studio-demo").hidden = !mock;
    $("open-service").disabled = !state.html;
    $("mode-tabs").hidden = !connected;
    showMode(mode);
  }
  function showMode(next) {
    mode = next;
    for (const name of ["service", "studio", "workspace"]) {
      $(name === "workspace" ? "workspace" : name + "-view").hidden = !connected || name !== mode;
      document.querySelector(`#mode-tabs [data-mode="${name}"]`).setAttribute("aria-pressed", String(name === mode));
    }
    document.body.dataset.mode = mode;
    requestAnimationFrame(resize);
  }
  function resize() {
    const width = mobile ? 390 : 1280, height = mobile ? 760 : 820;
    const container = $("studio-canvas"), view = $("preview-viewport"), frame = $("studio-frame");
    const scale = Math.min(1, Math.max(0.1, (container.clientWidth - 48) / width));
    view.style.width = `${width * scale}px`; view.style.height = `${height * scale}px`;
    frame.style.width = `${width}px`; frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
  }
  new ResizeObserver(resize).observe($("studio-canvas"));
  function render(force = false) {
    $("service-empty").hidden = !!state.html;
    $("studio-empty").hidden = !!state.html;
    $("preview-viewport").hidden = !state.html;
    for (const frame of frames) {
      frame.hidden = !state.html;
      if (!state.html) { frame.removeAttribute("src"); payloads.delete(frame); continue; }
      if (!force && payloads.get(frame)?.revision === state.revision) continue;
      payloads.set(frame, { html: state.html, revision: state.revision });
      frame.src = `/studio-frame.html?view=${frame.id}&v=${encodeURIComponent(state.revision)}&refresh=${Date.now()}`;
    }
    $("studio-sync").textContent = state.html ? `저장된 화면 · ${state.revision.slice(0, 8)} · 변경 시 자동 반영` : "템플릿을 선택하세요";
    resize(); controls();
  }
  window.addEventListener("message", event => {
    const frame = frames.find(f => f.contentWindow === event.source);
    if (!connected || !frame || !payloads.has(frame)) return;
    if (event.data?.type === "pida:ready") frame.contentWindow.postMessage({ type: "pida:render", html: payloads.get(frame).html }, "*");
    if (event.data?.type === "pida:render-error") { renderingError = true; $("studio-sync").textContent = "화면 스크립트 오류 · 채팅으로 수정을 요청하세요"; }
  });
  async function refresh(force = false) {
    const active = generation, sequence = ++refreshSequence;
    try {
      const result = await request("/v1/studio");
      if (active !== generation || sequence !== refreshSequence) return;
      available = true;
      if (result.revision !== state.revision || force) renderingError = false;
      state = result;
      render(force);
    } catch (error) {
      if (active !== generation || sequence !== refreshSequence) return;
      if (error.status === 403 || error.status === 404) {
        available = false; state = { html: "", revision: "", templates: [] }; render();
        status("이 서버에는 화면 제작 기능 또는 접근 권한이 없습니다.");
      } else throw error;
    }
  }
  function templates() {
    selectedTemplate = undefined;
    $("template-grid").replaceChildren();
    for (const template of state.templates) {
      const card = document.createElement("button"); card.type = "button"; card.className = "template-card"; card.setAttribute("aria-pressed", "false");
      const sketch = document.createElement("div"); sketch.className = `template-sketch sketch-${template.layout}`; sketch.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 5; i++) sketch.append(document.createElement("i"));
      const title = document.createElement("strong"), detail = document.createElement("span"); title.textContent = template.name; detail.textContent = template.description;
      card.append(sketch, title, detail);
      card.onclick = () => { selectedTemplate = template.id; for (const b of $("template-grid").children) b.setAttribute("aria-pressed", String(b === card)); controls(); };
      $("template-grid").append(card);
    }
    $("template-notice").textContent = state.html ? "템플릿을 바꾸면 현재 화면이 교체됩니다. 기존 파일은 작업 공간의 Git 이력에 남습니다." : "선택한 템플릿으로 서비스 화면을 시작합니다.";
    controls(); $("template-dialog").showModal();
  }
  function message(role, text) {
    $("studio-messages").querySelector(".studio-chat-empty")?.remove();
    const article = document.createElement("article"), label = document.createElement("strong"), body = document.createElement("p");
    article.className = role; label.textContent = role === "user" ? "YOU" : "PIDA"; body.textContent = text;
    article.append(label, body); $("studio-messages").append(article); return body;
  }
  async function restoreChat() {
    if (!session) return;
    try {
      const data = await client.getSession(session);
      $("studio-messages").replaceChildren();
      for (const item of data.messages) message(item.role, item.role === "user" ? item.text.replace(/^\[PIDA UI STUDIO\][\s\S]*?\nUSER REQUEST:\n/, "") : item.text);
      if (data.running) { status("이전 요청이 실행 중입니다. 완료 후 화면을 새로고침하세요."); }
    } catch (error) {
      if (error.status !== 404) throw error;
      session = undefined; sessionStorage.removeItem("pida-studio-session");
    }
  }
  async function send(event) {
    event.preventDefault();
    if (busy || hostBusy || !connected || mock || !available || !state.html) return;
    const text = $("studio-prompt").value.trim(); if (!text) return;
    const before = state.revision;
    busy = true; changed(); controls();
    message("user", text); const output = message("assistant", "화면을 확인하고 있습니다…");
    let answer = "", result;
    try {
      if (!session) { session = (await client.createSession()).sessionId; sessionStorage.setItem("pida-studio-session", session); controls(); }
      const prompt = `[PIDA UI STUDIO]\nYou are editing the service UI shown beside this chat. Read the current app with ui_read, preserve existing features, then implement the user's request with ui_patch for small exact changes or ui_apply for a complete replacement, using the revision you just read. Keep self-contained HTML with inline CSS and JavaScript. Use addEventListener, not onclick attributes. No external scripts, network, frames, localStorage, or parent access. Do not just return code in chat. If data is illustrative, label it as sample. Report what was actually changed. Current revision at request start: ${before}.\nUSER REQUEST:\n${text}`;
      for await (const event of client.stream(session, prompt)) {
        if (event.type === "text_delta") { answer += event.delta; output.textContent = answer; }
        if (event.type === "trace") {
          if (event.trace.type === "tool_started") status(`작업 중 · ${event.trace.toolName}`);
          if (event.trace.type === "tool_completed" || event.trace.type === "tool_failed") await refresh();
        }
        if (event.type === "result") { result = event.result; output.textContent = result.text || result.code || "응답이 없습니다."; }
        $("studio-messages").scrollTop = $("studio-messages").scrollHeight;
      }
      await refresh();
      if (result?.status === "completed") {
        $("studio-prompt").value = "";
        status(state.revision !== before ? (renderingError ? "저장됨 · 화면 스크립트 오류를 확인하세요" : "수정 내용을 저장하고 서비스에 반영했습니다.") : "실행 완료 · 저장된 화면 변경은 없습니다.");
      } else status(`실행 ${result?.status === "cancelled" ? "중단됨" : "미완료"} · ${result?.code || result?.status || "연결 상태를 확인하세요"}`);
    } catch (error) { issue(error); await refresh().catch(() => {}); }
    finally { busy = false; changed(); controls(); $("studio-prompt").focus(); }
  }
  for (const button of document.querySelectorAll("#mode-tabs [data-mode]")) button.onclick = () => { showMode(button.dataset.mode); if (button.dataset.mode !== "workspace") refresh().catch(issue); };
  $("start-building").onclick = () => showMode("studio");
  $("open-service").onclick = () => showMode("service");
  $("mode-disconnect").onclick = disconnected;
  $("choose-template").onclick = templates; $("first-template").onclick = templates;
  $("close-templates").onclick = () => $("template-dialog").close();
  $("apply-template").onclick = async () => {
    if (busy || hostBusy || !selectedTemplate) return;
    busy = true; changed(); controls();
    try {
      await request("/v1/studio/template", { method: "POST", body: { templateId: selectedTemplate, expectedRevision: state.revision } });
      $("template-dialog").close(); await refresh(); status("템플릿을 적용했습니다. 오른쪽 채팅에서 기능을 추가하세요.");
    } catch (error) { $("template-dialog").close(); issue(error); await refresh().catch(() => {}); }
    finally { busy = false; changed(); controls(); }
  };
  $("studio-form").onsubmit = send;
  $("studio-prompt").onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) { event.preventDefault(); $("studio-form").requestSubmit(); } };
  $("studio-new-chat").onclick = () => { if (busy || hostBusy) return; session = undefined; sessionStorage.removeItem("pida-studio-session"); $("studio-messages").replaceChildren(); status("새 제작 대화 · 현재 화면은 유지됩니다."); };
  $("studio-cancel").onclick = async () => { $("studio-cancel").disabled = true; try { await client.cancel(session); status("중단을 요청했습니다. 이미 저장된 변경은 유지됩니다."); } catch (error) { issue(error); } };
  $("studio-refresh").onclick = () => refresh(true).catch(issue);
  for (const button of document.querySelectorAll("[data-suggestion]")) button.onclick = () => { $("studio-prompt").value = button.dataset.suggestion; $("studio-prompt").focus(); };
  for (const size of ["desktop", "mobile"]) $("preview-" + size).onclick = () => { mobile = size === "mobile"; $("preview-desktop").setAttribute("aria-pressed", String(!mobile)); $("preview-mobile").setAttribute("aria-pressed", String(mobile)); resize(); };
  return {
    get busy() { return busy; },
    update({ connected: value, busy: parentBusy }) { connected = value; hostBusy = parentBusy; controls(); },
    async connect(info) {
      generation++; connected = true; mock = info.provider?.mode === "mock";
      $("studio-model").textContent = info.provider ? `${info.provider.model} · 연결된 Pida Core` : "호스트에 연결된 Pida Core";
      session = sessionStorage.getItem("pida-studio-session") || undefined;
      await refresh(); await restoreChat(); controls();
    },
    reset() { generation++; connected = false; busy = false; state = { html: "", revision: "", templates: [] }; session = undefined; payloads.clear(); for (const frame of frames) frame.removeAttribute("src"); $("studio-messages").replaceChildren(); $("template-dialog").close(); controls(); },
    refresh,
  };
}
