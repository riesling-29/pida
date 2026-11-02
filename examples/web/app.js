import { createStudio } from "/studio.js";
import { RunState } from "/run-state.js";
import { createRunInput } from "/run-input.js";
import { createRunDetails } from "/run-details.js";
import { createAgents } from "/agents.js";
import { createComposition } from "/composition.js";
import { PidaClient, explainError } from "/pida-client.js";
const $ = (id) => document.getElementById(id);
let token = "",
  sessionId,
  connected = false,
  pending = false,
  running = false,
  remoteRunning = false,
  sessionPoll;
const client = new PidaClient({ baseUrl: location.origin, token: () => token });
const run = new RunState();
let capabilities = {}, selectionRequest = 0;
const runInput = createRunInput({ client, run, textarea: $("prompt"), selector: $("workspace-input-mode"), section: $("workspace-live-input"), note: $("workspace-input-note"), receipt: $("workspace-input-receipt"), changed: () => controls(), explain: explainError });
const runDetails = createRunDetails({ container: $("workspace-run-details"), load: () => client.getSessionTools(sessionId), explain: explainError });
const composition = createComposition({ client });
const agents = createAgents({ client });
const studio = createStudio({
  client,
  async request(path, options = {}) {
    const response = await fetch(path, { method: options.method ?? "GET", headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { code: value.error, status: response.status });
    return value;
  },
  changed: () => controls(),
  disconnected: () => $("disconnect").click(),
});
const labels = {
  completed: "완료",
  failed: "실패",
  cancelled: "중단됨",
  limited: "실행 한도 도달",
  interrupted: "서버 종료로 중단됨",
};
const errors = {
  UNAUTHORIZED: "접속 토큰을 확인해주세요.",
  SESSION_BUSY:
    "이 대화에서 다른 요청이 실행 중입니다. 새로고침으로 확인해주세요.",
  SESSION_NOT_FOUND: "대화를 찾을 수 없습니다. 대화 목록을 새로고침해주세요.",
  STREAM_INTERRUPTED:
    "연결이 끊겼습니다. 새로고침으로 서버의 실행 상태를 확인해주세요.",
  PROVIDER_FAILED:
    "모델 호출에 실패했습니다. 서버의 모델 설정과 인증 정보를 확인해주세요.",
  TOOL_FORBIDDEN: "이 도구를 실행할 권한이 없습니다.",
  SESSION_LIMIT:
    "저장 가능한 대화 수에 도달했습니다. 필요 없는 대화를 삭제해주세요.",
};
function problem(error) {
  $("error").textContent =
    errors[error.code] ?? (error.code ? explainError(error.code) : error.message) ?? "요청을 처리하지 못했습니다.";
}
function controls() {
  const busy = pending || running || studio.busy || configuring;
  runInput.sync(capabilities); $("workspace-trace-gap").hidden = !run.gap;
  const composerBlocked = !sessionId || pending || studio.busy || configuring;
  $("send").disabled = composerBlocked || (run.running ? !runInput.canSubmit : running || remoteRunning);
  $("send").textContent = run.running ? runInput.label + " 보내기" : "보내기";
  $("cancel").disabled = pending || run.cancelling || !(running || remoteRunning);
  $("connect").disabled = busy;
  for (const id of ["workspace-compact", "workspace-handoff"]) $(id).disabled = !sessionId || busy || remoteRunning;
  $("new-session").disabled = !connected || busy || remoteRunning;
  $("delete-session").disabled = !sessionId || busy || remoteRunning;
  $("refresh").disabled = !connected || busy;
  $("disconnect").disabled = !connected || busy || remoteRunning;
  $("prompt").disabled = composerBlocked;
  for (const button of $("sessions").querySelectorAll("button"))
    button.disabled = busy || remoteRunning;
  $("connection").hidden = connected;
  $("workspace").hidden = !connected;
  document.body.dataset.connected = String(connected);
  $("connection-state").textContent = connected ? "connected" : "offline";
  $("footer-state").textContent = !connected ? "연결 대기" : running || remoteRunning ? "실행 중" : "작업 공간 연결됨";
  $("composer-state").textContent = !sessionId ? "새 대화를 시작하세요" : running || remoteRunning ? "작업을 수행하고 있습니다" : "준비됨";
  $("open-settings").disabled = !connected || ($("provider-settings").hidden && !composition.available);
  $("toggle-sessions").disabled = !connected;
  $("toggle-inspector").disabled = !connected;
  $("refresh-workbench").disabled = busy;
  $("upload-file").disabled = busy;
  $("trace-count").textContent = $("trace").children.length;
  $("trace-empty").hidden = $("trace").children.length > 0;
  providerControls();
  studio.update({ connected, busy: pending || running || remoteRunning || configuring });
}
async function action(fn) {
  if (pending || running || studio.busy || configuring) return;
  pending = true;
  $("error").textContent = "";
  controls();
  try {
    await fn();
  } catch (e) {
    problem(e);
  } finally {
    pending = false;
    controls();
  }
}
function message(role, text) {
  if (!text) return;
  const article = document.createElement("article"),
    label = document.createElement("strong"),
    content = document.createElement("p");
  article.className = role;
  label.textContent = role === "user" ? "YOU" : "PIDA";
  content.textContent = text;
  article.append(label, content);
  $("messages").append(article);
  return content;
}
const traceLabels = { retry_scheduled: "모델 재시도 대기", retry_finished: "재시도 결과", summarization_retry_attempt_start: "압축 재시도", summarization_retry_finished: "압축 재시도 결과", run_started: "작업 시작", turn_started: "모델 응답", tool_started: "도구 실행", tool_completed: "도구 실행 완료", tool_failed: "도구 실행 실패", run_finished: "작업 종료" };
function trace(event) {
  if (!run.acceptTrace(event)) return false;
  renderTrace(event); runDetails.select(sessionId, run.runId); controls();
  return true;
}
function renderTrace(event) {
  const li = document.createElement("li"), sequence = document.createElement("span"), body = document.createElement("div"), kind = document.createElement("span"), detail = document.createElement("span");
  li.title = event.type;
  li.classList.toggle("trace-failed", event.status === "failed" || event.type === "tool_failed");
  sequence.className = "trace-sequence";
  sequence.textContent = String(event.sequence).padStart(2, "0");
  kind.className = "trace-kind";
  kind.textContent = traceLabels[event.type] ?? event.type;
  detail.className = "trace-detail";
  detail.textContent = [event.toolName, labels[event.status] ?? event.status, event.code].filter(Boolean).join(" / ");
  body.append(kind, detail); li.append(sequence, body); $("trace").append(li);
  while ($("trace").children.length > 1000) $("trace").firstChild.remove();
  $("trace-count").textContent = $("trace").children.length;
  $("trace-empty").hidden = true;
}
function emptyConversation() {
  const empty = document.createElement("div"), symbol = document.createElement("span"), title = document.createElement("h3"), hint = document.createElement("p");
  empty.className = "empty"; symbol.className = "empty-symbol"; symbol.textContent = "p_"; symbol.setAttribute("aria-hidden", "true");
  title.textContent = "무엇을 만들어볼까요?";
  hint.textContent = sessionId ? "아래에 요청을 입력하세요. 파일과 실행 결과는 작업 패널에서 확인할 수 있습니다." : "새 대화를 열어 작업을 시작하세요.";
  empty.append(symbol, title, hint); $("messages").replaceChildren(empty);
}
async function list() {
  const ticket = run.ticket(), credential = token;
  const { sessions } = await client.listSessions();
  if (!run.current(ticket) || credential !== token) return [];
  $("sessions").replaceChildren();
  $("session-count").textContent = String(sessions.length).padStart(2, "0");
  for (const s of sessions) {
    const button = document.createElement("button"),
      title = document.createElement("span"),
      detail = document.createElement("small");
    button.className = "session-item";
    button.setAttribute("aria-current", String(s.sessionId === sessionId));
    title.textContent = s.title;
    button.title = s.title;
    if (s.sessionId === sessionId) {
      $("session-title").textContent = s.title;
      $("session-title").title = s.title;
    }
    detail.textContent = `${new Date(s.updatedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · ${s.running ? "실행 중" : (labels[s.lastStatus] ?? "대기")}`;
    button.append(title, detail);
    button.onclick = () => action(() => select(s.sessionId));
    $("sessions").append(button);
  }
  if (!sessions.length)
    $("sessions").textContent = "아직 대화가 없습니다. 새 대화로 시작하세요.";
  return sessions;
}
async function select(id) {
  const request = ++selectionRequest;
  if (run.sessionId !== id) { run.reset(id); runInput.reset(); runDetails.select(id); }
  const ticket = run.ticket();
  const [data, activity] = await Promise.all([client.getSession(id), client.getTrace(id)]);
  if (request !== selectionRequest || !run.current(ticket, { revision: true })) return;
  run.snapshot({ ...data, ...(activity.activeRunId ? { activeRunId: activity.activeRunId, running: true } : {}) }, activity.events);
  const c = data.context;
  $("workspace-context").textContent = c ? `컨텍스트 ${c.percent == null ? "측정 대기" : c.percent.toFixed(0) + "%"} / ${c.contextWindow.toLocaleString()} · 자동 압축 ${data.autoCompaction ? "켜짐" : "꺼짐"}` : "";
  sessionId = id; remoteRunning = run.running;
  runDetails.select(id, run.runId);
  sessionStorage.setItem("pida-session", id);
  $("session-title").textContent = data.title ?? "대화";
  $("session-title").title = data.title ?? "대화";
  setDrawer("sessions", false);
  $("messages").replaceChildren();
  for (const m of data.messages) message(m.role, m.text);
  if (!data.messages.length) emptyConversation();
  $("trace").replaceChildren();
  for (const event of activity.events.filter(event => event.runId === run.runId)) renderTrace(event);
  $("status").textContent = run.running ? "실행 중 · 서버 상태 확인 중" : labels[data.lastStatus] ?? "대기";
  await list();
  if (request !== selectionRequest || !run.current(ticket)) return;
  controls(); $("messages").scrollTop = $("messages").scrollHeight; scheduleSessionPoll();
}
function scheduleSessionPoll() {
  clearTimeout(sessionPoll);
  if (!connected || !(remoteRunning || running) || !sessionId) return;
  const id = sessionId, credential = token, ticket = run.ticket();
  sessionPoll = setTimeout(async () => {
    try {
      const [data, activity] = await Promise.all([client.getSession(id), client.getTrace(id)]);
      if (!connected || sessionId !== id || credential !== token || !run.current(ticket, { revision: true })) return;
      const repair = run.gap, previousRun = run.runId;
      const events = run.snapshot({ ...data, ...(activity.activeRunId ? { activeRunId: activity.activeRunId, running: true } : {}) }, activity.events);
      if (repair || previousRun !== run.runId) { $("trace").replaceChildren(); for (const event of activity.events.filter(row => row.runId === run.runId)) renderTrace(event); }
      else for (const event of events) renderTrace(event);
      remoteRunning = run.running; runDetails.select(id, run.runId);
      if (!running) $("status").textContent = run.running ? "실행 중 · 서버 상태 연결됨" : labels[data.lastStatus] ?? "대기";
      if (!remoteRunning && !running) { await select(id); await refreshWorkbench(); }
    } catch (error) { if (connected && sessionId === id && credential === token && run.current(ticket)) { problem(error); $("status").textContent = "서버 실행 상태 확인 중"; } }
    finally { if (connected && sessionId === id && credential === token && run.current(ticket)) { controls(); scheduleSessionPoll(); } }
  }, 1800);
}
async function connect() {
  token = $("token").value;
  const info = await client.getInfo();
  capabilities = info.capabilities ?? {};
  $("model").textContent = info.provider
    ? `${info.provider.mode === "mock" ? "데모 모델" : info.provider.mode === "endpoint" ? "사용자 지정" : info.provider.mode} · ${info.provider.model}`
    : "호스트 설정 모델";
  $("storage").textContent = info.persistence
    ? "대화 자동 저장"
    : "임시 대화 · 서버 종료 시 삭제";
  $("mock-note").hidden = info.provider?.mode !== "mock";
  $("tools").replaceChildren();
  for (const tool of info.tools) {
    const item = document.createElement("li"), name = document.createElement("strong"), description = document.createElement("p");
    name.textContent = `${tool.name}${tool.permitted ? "" : " · 권한 없음"}`;
    name.classList.toggle("denied", !tool.permitted);
    description.textContent = tool.description;
    item.append(name, description); $("tools").append(item);
  }
  $("tool-count").textContent = info.tools.length;
  if (!info.tools.length) $("tools").textContent = "등록된 도구 없음";
  await loadProviderSettings();
  await composition.refresh();
  await refreshWorkbench();
  if (
    new URLSearchParams(location.hash.slice(1)).get("setup") === "1" ||
    initialSetup
  )
    openSettings();
  connected = true;
  sessionId = undefined;
  remoteRunning = false;
  $("token").value = "";
  const sessions = await list();
  const saved = sessionStorage.getItem("pida-session");
  const recent = sessions.find((s) => s.sessionId === saved) ?? sessions[0];
  if (recent) await select(recent.sessionId);
  else emptyConversation();
  await studio.connect(info);
  await agents.connect();
  pollChatGPT();
}
$("connection-form").onsubmit = (e) => {
  e.preventDefault();
  action(connect);
};
for (const [id, handoff] of [["workspace-compact", false], ["workspace-handoff", true]]) {
  $(id).onclick = () => action(async () => {
    $("status").textContent = handoff ? "요약해서 이어가는 중…" : "대화 압축 중…";
    const result = await client.compactSession(sessionId, handoff);
    await select(result.sessionId); await list();
    $("status").textContent = "작업 맥락을 정리했습니다.";
  });
}
$("new-session").onclick = async () => {
  await action(async () => {
    const data = await client.createSession();
    await select(data.sessionId);
  });
  $("prompt").focus();
};
$("refresh").onclick = () =>
  action(async () => {
    if (sessionId) await select(sessionId);
    else await list();
    await refreshWorkbench();
  });
$("delete-session").onclick = () => {
  if (!confirm("이 대화와 저장된 실행 기록을 삭제할까요?")) return;
  action(async () => {
    await client.deleteSession(sessionId);
    sessionId = undefined; run.reset(); runInput.reset(); runDetails.select();
    sessionStorage.removeItem("pida-session");
    $("messages").replaceChildren();
    $("trace").replaceChildren();
    $("session-title").textContent = "새 대화를 시작하세요";
    $("status").textContent = "대기";
    const sessions = await list();
    if (sessions[0]) await select(sessions[0].sessionId);
    else emptyConversation();
  });
};
$("disconnect").onclick = () => {
  connected = false; selectionRequest++; run.reset(); runInput.reset(); runDetails.select();
  clearTimeout(sessionPoll);
  clearTimeout(chatgptPoll); chatgptLogin = undefined; chatgptState = { connected: false }; chatgptModels = []; clearChatGPTLogin();
  $("settings-dialog").close();
  setDrawer("sessions", false); setDrawer("inspector", false);
  clearWorkbench();
  studio.reset();
  agents.reset();
  composition.reset();
  token = "";
  $("provider-key").value = "";
  sessionId = undefined;
  remoteRunning = false;
  $("token").value = "";
  $("messages").replaceChildren();
  $("trace").replaceChildren();
  $("sessions").replaceChildren();
  controls();
};
$("cancel").onclick = async () => {
  const id = sessionId, ticket = run.ticket();
  run.cancel(); controls();
  try {
    await client.cancel(id);
    if (!run.current(ticket, { run: true })) return;
    $("status").textContent = "중단 요청을 전달했습니다. 최종 상태를 기다리고 있습니다.";
    if (!running) await select(id);
  } catch (e) { if (run.current(ticket, { run: true })) { run.cancelling = false; problem(e); } }
  finally { if (run.current(ticket)) controls(); }
};
$("form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending || studio.busy || configuring || !sessionId) return;
  if (run.running) { await runInput.submit(); scheduleSessionPoll(); return; }
  if (running || remoteRunning) return;
  const raw = $("prompt").value, prompt = raw.trim();
  if (!prompt) return;
  const id = sessionId;
  run.begin(); runInput.reset(); runDetails.select(id);
  const ticket = run.ticket();
  running = true; controls();
  $("error").textContent = ""; $("status").textContent = "실행 중";
  $("messages").querySelector(".empty")?.remove();
  message("user", prompt);
  const answer = message("assistant", "응답을 기다리고 있습니다…");
  let text = "", admitted = false;
  try {
    for await (const event of client.stream(id, prompt, { disconnectPolicy: "continue" })) {
      if (!run.current(ticket)) continue;
      if (event.type === "trace" && trace(event.trace) && event.trace.type === "run_started") {
        admitted = true;
        if ($("prompt").value === raw) $("prompt").value = "";
        scheduleSessionPoll();
      }
      if (event.type === "text_delta" && run.running) { text += event.delta; answer.textContent = text; }
      if (event.type === "result" && run.acceptResult(event.result)) {
        $("status").textContent = labels[event.result.status] ?? event.result.status;
        answer.textContent = event.result.text || errors[event.result.code] || (event.result.code ? explainError(event.result.code) : "") || "응답 없음";
        if (event.result.code) problem({ code: event.result.code, message: event.result.code });
        if (event.result.persistenceError && event.result.persistenceError !== event.result.code) answer.textContent += "\n\n" + explainError(event.result.persistenceError);
        runDetails.select(id, run.runId); controls();
      }
      $("messages").scrollTop = $("messages").scrollHeight;
    }
    if (!run.current(ticket)) return;
    await list(); await refreshWorkbench(); await studio.refresh();
  } catch (error) {
    if (!run.current(ticket)) return;
    problem(error); $("status").textContent = "연결 확인 필요"; remoteRunning = true;
    if (!admitted && !$("prompt").value) $("prompt").value = raw;
  } finally {
    if (run.current(ticket)) { running = false; controls(); scheduleSessionPoll(); $("prompt").focus(); }
  }
};
// Optional authenticated launch from the local CLI. Never persist the token in storage.
// Workspace-only provider settings. Generic embedded hosts may omit these endpoints.
let configuring = false;
const setupErrors = {
  PROVIDER_KEY_REQUIRED:
    "선택한 프로바이더의 API 키를 입력하거나 서버의 해당 환경변수를 설정해주세요.",
  PROVIDER_TEST_FAILED:
    "모델 응답을 받지 못했습니다. 주소·모델·키와 API 형식을 확인해주세요. 기존 설정은 유지됩니다.",
  MODEL_LIST_UNAVAILABLE:
    "모델 목록을 받지 못했습니다. 모델 이름을 직접 입력해도 됩니다.",
  PROVIDER_AUTH_FAILED: "서버가 인증을 거부했습니다. API 키를 확인해주세요.",
  PROVIDER_BUSY: "진행 중인 대화가 끝난 뒤 다시 적용해주세요.",
  SETUP_BUSY: "이전 연결 확인이 끝날 때까지 기다려주세요.",
  INVALID_PROVIDER:
    "주소·모델 이름·고급 설정을 확인해주세요. HTTP 주소는 연결 허용을 선택해야 합니다.",
  INVALID_PROVIDER_URL:
    "올바른 서버 주소를 입력해주세요. 주소에 키나 쿼리 문자열을 넣지 마세요.",
};
let providerCatalog = [], chatgptModels = [], chatgptState = { connected: false }, chatgptLogin, chatgptPoll, managedConnector;
const chatgptSelected = () => $("provider-preset").value === "openai" && $("openai-auth").value === "chatgpt";
function clearChatGPTLogin() {
  $("chatgpt-login-link").removeAttribute("href"); $("chatgpt-login-link").hidden = true;
  $("chatgpt-callback").value = ""; $("chatgpt-manual").hidden = true; $("chatgpt-cancel").hidden = true;
}
function chatgptStatus() {
  $("chatgpt-state").textContent = chatgptLogin?.status === "pending" ? "브라우저에서 ChatGPT 로그인과 구독 사용 권한을 확인해주세요." :
    chatgptState.code ? explainError(chatgptState.code) : chatgptState.connected ? "ChatGPT 인증 정보 저장됨 · 모델을 선택한 뒤 연결 확인 후 적용하세요." : "ChatGPT 로그인이 필요합니다.";
}
async function loadChatGPTModels(selected = "") {
  const result = await client.listProviderModels({ kind: "native", providerId: "openai", authMode: "chatgpt" });
  chatgptModels = result.models; showNativeModels(selected);
  if (!result.models.length) $("provider-feedback").textContent = "계정과 현재 Pi SDK가 함께 지원하는 모델이 없습니다.";
}
function displayChatGPTLogin(login) {
  chatgptLogin = login;
  if (login.authUrl) {
    const url = new URL(login.authUrl);
    if (url.origin !== "https://auth.openai.com") throw new Error("Unexpected login origin");
    $("chatgpt-login-link").href = url.href; $("chatgpt-login-link").hidden = false;
  }
  $("chatgpt-manual").hidden = !login.manualInput;
  $("chatgpt-cancel").hidden = login.status !== "pending";
  chatgptStatus(); providerControls();
}
function pollChatGPT() {
  clearTimeout(chatgptPoll);
  const id = chatgptLogin?.id;
  if (!id || chatgptLogin.status !== "pending" || !connected) return;
  chatgptPoll = setTimeout(async () => {
    try {
      const login = await client.getChatGPTLogin(id);
      if (!connected || chatgptLogin?.id !== id) return;
      displayChatGPTLogin(login);
      if (login.status !== "pending") {
        sessionStorage.removeItem("pida-chatgpt-login"); clearChatGPTLogin();
        chatgptState = (await client.getProviderSettings()).chatgpt ?? { connected: false }; chatgptStatus();
        if (login.status === "connected") {
          $("provider-feedback").textContent = "로그인했습니다. 계정의 모델 목록을 불러옵니다…";
          try { await loadChatGPTModels(); $("provider-feedback").textContent = "모델을 선택하고 ‘연결 확인 후 적용’을 누르세요."; }
          catch (error) { $("provider-feedback").textContent = explainError(error.code); }
        } else $("provider-feedback").textContent = explainError(login.code);
        configuring = false; controls(); return;
      }
    } catch (error) {
      $("provider-feedback").textContent = explainError(error.code);
      if (error.status === 404 || error.status === 401 || chatgptLogin?.status !== "pending") {
        sessionStorage.removeItem("pida-chatgpt-login"); chatgptLogin = undefined; clearChatGPTLogin(); configuring = false; controls(); return;
      }
    }
    pollChatGPT();
  }, 750);
}
$("chatgpt-login").onclick = async () => {
  if (configuring || running || pending || studio.busy) return;
  configuring = true; clearChatGPTLogin(); controls();
  try { const login = await client.startChatGPTLogin(); sessionStorage.setItem("pida-chatgpt-login", login.id); displayChatGPTLogin(login); pollChatGPT(); }
  catch (error) { $("provider-feedback").textContent = explainError(error.code); configuring = false; controls(); }
};
$("chatgpt-cancel").onclick = async () => {
  if (!chatgptLogin) return;
  try { await client.cancelChatGPTLogin(chatgptLogin.id); }
  catch (error) { $("provider-feedback").textContent = explainError(error.code); }
};
$("chatgpt-submit").onclick = async () => {
  if (!chatgptLogin?.manualInput) return;
  const value = $("chatgpt-callback").value.trim(); $("chatgpt-callback").value = "";
  try { displayChatGPTLogin(await client.submitChatGPTLogin(chatgptLogin.id, value)); }
  catch (error) { $("provider-feedback").textContent = explainError(error.code); }
};
$("chatgpt-logout").onclick = async () => {
  if (configuring || running || pending || studio.busy) return;
  configuring = true; controls();
  try { await client.disconnectChatGPT(); chatgptState = { connected: false }; chatgptModels = []; chatgptLogin = undefined; clearChatGPTLogin(); showNativeModels(); chatgptStatus(); $("provider-feedback").textContent = "이 Pida의 ChatGPT 연결을 해제했습니다. API 키로 자동 전환하지 않습니다."; }
  catch (error) { $("provider-feedback").textContent = explainError(error.code); }
  finally { configuring = false; controls(); }
};
$("openai-auth").onchange = async () => {
  $("provider-key").value = ""; $("provider-feedback").textContent = ""; showNativeModels(); chatgptStatus();
  if (chatgptSelected() && chatgptState.connected) {
    configuring = true; controls();
    try { await loadChatGPTModels(); } catch (error) { $("provider-feedback").textContent = explainError(error.code); }
    finally { configuring = false; }
  }
  controls();
};
const selectedNative = () => providerCatalog.find(p => p.id === $("provider-preset").value);
let endpointThinkingMap;
function thinkingControls(selected = $("provider-thinking").value || "off") {
  const native = selectedNative();
  const model = native?.models.find(m => m.id === $("native-model-select").value);
  const levels = native ? (model?.thinkingLevels?.length ? model.thinkingLevels : ["off"]) :
    $("provider-reasoning").checked ? ["off", "minimal", "low", "medium", "high", ...["xhigh", "max"].filter(level => typeof endpointThinkingMap?.[level] === "string")].filter(level => endpointThinkingMap?.[level] !== null) : ["off"];
  $("provider-thinking").replaceChildren();
  for (const value of levels) {
    const option = document.createElement("option"); option.value = value;
    option.textContent = value === "off" ? "사용 안 함" : value;
    $("provider-thinking").append(option);
  }
  $("provider-thinking").value = levels.includes(selected) ? selected : levels[0];
  $("provider-reasoning-row").hidden = !!native;
}
function resetEndpointCapabilities() {
  endpointThinkingMap = undefined;
  $("provider-reasoning").checked = false;
  thinkingControls("off");
}
function showNativeModels(selectedId = "") {
  const p = selectedNative();
  $("native-model-select").replaceChildren();
  if (!p) return;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "모델을 선택하세요";
  $("native-model-select").append(placeholder);
  for (const model of p.models.filter(m => !chatgptSelected() || chatgptModels.includes(m.id))) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name} · ${model.id}`;
    $("native-model-select").append(option);
  }
  $("native-model-select").value = selectedId;
  thinkingControls();
  $("provider-key").placeholder = `API 키 입력 또는 서버의 ${p.apiKeyEnv} 사용`;
  $("provider-key-state").textContent = p.keyConfigured ? "이 프로바이더의 저장된 키 사용 가능" : "";
  $("native-provider-note").textContent = chatgptSelected() ? "ChatGPT 구독 인증 · 계정의 모델 목록과 Pi SDK 지원 모델을 확인합니다. Pida 로그인 계정과는 별도입니다." : `${p.name} · API 키 인증. 서버 주소와 API 형식은 자동 설정됩니다. 기본 제공 모델 목록이며 계정별 이용 가능 여부는 연결 확인이 필요합니다.`;
}
function providerControls() {
  $("provider-form").hidden = !!managedConnector;
  $("provider-managed").hidden = !managedConnector;
  if (managedConnector) return;
  const mock = $("provider-preset").value === "mock";
  const native = !!selectedNative(), chatgpt = chatgptSelected(), loggingIn = chatgptLogin?.status === "pending";
  $("openai-auth-row").hidden = $("provider-preset").value !== "openai";
  $("chatgpt-auth-panel").hidden = !chatgpt;
  $("provider-key-row").hidden = chatgpt;
  $("chatgpt-login").disabled = configuring || running || pending || studio.busy;
  $("chatgpt-logout").disabled = configuring || running || pending || studio.busy || (!chatgptState.connected && !chatgptState.code);
  $("chatgpt-cancel").disabled = !loggingIn;
  $("chatgpt-submit").disabled = !loggingIn || !chatgptLogin.manualInput;
  $("endpoint-fields").hidden = mock;
  $("custom-connection-fields").hidden = native;
  $("native-provider-note").hidden = !native;
  $("native-model-select").hidden = !native;
  $("provider-model-label").htmlFor = native ? "native-model-select" : "provider-model";
  $("provider-model").hidden = native;
  $("provider-advanced").hidden = native;
  $("load-models").hidden = native && !chatgpt;
  for (const field of $("provider-form").querySelectorAll("input, select")) field.disabled = configuring;
  $("provider-key").disabled = configuring || chatgpt || (!native && $("provider-no-key").checked);
  $("chatgpt-callback").disabled = !loggingIn || !chatgptLogin.manualInput;
  $("provider-http-row").hidden = native || !$("provider-url").value.startsWith("http:");
  $("apply-provider").disabled = configuring || running || pending || studio.busy || (chatgpt && (!chatgptState.connected || !$("native-model-select").value));
  $("load-models").disabled = configuring || mock || (chatgpt && !chatgptState.connected);
}
function providerDraft() {
  if ($("provider-preset").value === "mock") return { kind: "mock" };
  const native = selectedNative();
  if (native) return { kind: "native", providerId: native.id,
    modelId: $("native-model-select").value, thinkingLevel: $("provider-thinking").value || "off",
    ...(chatgptSelected() ? { authMode: "chatgpt" } : { apiKey: $("provider-key").value }) };
  return {
    kind: "endpoint",
    baseUrl: $("provider-url").value.trim(),
    modelId: $("provider-model").value.trim(),
    apiKey: $("provider-key").value,
    authMode: $("provider-no-key").checked ? "none" : "api-key",
    api: $("provider-api").value,
    contextWindow: Number($("provider-context").value),
    maxTokens: Number($("provider-output").value),
    allowInsecureHttp: $("provider-http").checked,
    reasoning: $("provider-reasoning").checked,
    thinkingLevel: $("provider-thinking").value || "off",
  };
}
async function loadProviderSettings() {
  try {
    const { provider: p, keyConfigured, catalog = [], chatgpt, connector } = await client.getProviderSettings();
    managedConnector = connector?.managed ? connector : undefined;
    $("provider-settings").hidden = false;
    if (managedConnector) { $("provider-managed").textContent = `${connector.displayName ?? connector.id} · 전용 커넥터 사용 중 · 변경은 호스트 설정에서 합니다.`; providerControls(); return; }
    chatgptState = chatgpt ?? { connected: false }; chatgptModels = [];
    $("openai-auth").value = p.authMode === "chatgpt" ? "chatgpt" : "api-key"; chatgptStatus();
    providerCatalog = catalog;
    $("native-providers").replaceChildren();
    for (const item of catalog) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      $("native-providers").append(option);
    }
    $("provider-settings").hidden = false;
    $("provider-preset").value = p.kind === "mock" ? "mock" : p.kind === "native" ? p.providerId :
      p.baseUrl === "http://localhost:11434/v1" ? "ollama" :
      p.baseUrl === "http://localhost:1234/v1" ? "local" : "company";
    $("provider-url").value = p.baseUrl ?? "";
    $("provider-model").value = p.modelId ?? "";
    $("provider-key").value = "";
    $("provider-key").placeholder = "키를 붙여넣으세요";
    $("provider-no-key").checked = p.authMode === "none";
    $("provider-api").value = p.api ?? "openai-completions";
    $("provider-context").value = p.contextWindow ?? 8192;
    $("provider-output").value = p.maxTokens ?? 1024;
    $("provider-http").checked = p.allowInsecureHttp ?? false;
    $("provider-key-state").textContent = keyConfigured
      ? "저장된 키 사용 가능 · 비우면 같은 서버의 키 유지" : "";
    showNativeModels(p.modelId);
    endpointThinkingMap = p.thinkingLevelMap;
    $("provider-reasoning").checked = p.reasoning ?? false;
    thinkingControls(p.thinkingLevel ?? "off");
    const loginId = sessionStorage.getItem("pida-chatgpt-login");
    if (loginId) {
      try { const login = await client.getChatGPTLogin(loginId); if (login.status === "pending") { $("provider-preset").value = "openai"; $("openai-auth").value = "chatgpt"; configuring = true; displayChatGPTLogin(login); pollChatGPT(); } else sessionStorage.removeItem("pida-chatgpt-login"); }
      catch { sessionStorage.removeItem("pida-chatgpt-login"); }
    }
    if (chatgptSelected() && chatgptState.connected && chatgptLogin?.status !== "pending") {
      try { await loadChatGPTModels(p.modelId); } catch (error) { $("provider-feedback").textContent = explainError(error.code); }
    }
    providerControls();
  } catch {
    $("provider-settings").hidden = true;
  }
}
$("provider-preset").onchange = () => {
  const value = $("provider-preset").value;
  $("openai-auth").value = "api-key"; chatgptModels = []; chatgptStatus();
  const local = value === "local" || value === "ollama";
  $("provider-url").value = local ? (value === "ollama" ? "http://localhost:11434/v1" : "http://localhost:1234/v1") : "";
  $("provider-no-key").checked = local;
  $("provider-http").checked = local;
  $("provider-api").value = "openai-completions";
  $("provider-context").value = 8192;
  $("provider-output").value = 1024;
  $("provider-key").value = "";
  $("provider-key").placeholder = "키를 붙여넣으세요";
  $("provider-key-state").textContent = "";
  $("provider-model").value = "";
  $("provider-models").replaceChildren();
  $("provider-feedback").textContent = "";
  showNativeModels();
  resetEndpointCapabilities();
  providerControls();
};
$("provider-no-key").onchange = providerControls;
$("native-model-select").onchange = () => { thinkingControls("off"); providerControls(); };
$("provider-reasoning").onchange = () => thinkingControls();
$("provider-model").oninput = resetEndpointCapabilities;
$("provider-api").onchange = resetEndpointCapabilities;
$("provider-url").oninput = () => {
  $("provider-http").checked = false;
  resetEndpointCapabilities();
  providerControls();
};
$("load-models").onclick = async () => {
  if (configuring) return;
  configuring = true;
  providerControls();
  $("provider-feedback").textContent = "모델 목록을 불러오는 중…";
  try {
    if (chatgptSelected()) { await loadChatGPTModels($("native-model-select").value); $("provider-feedback").textContent = "계정의 모델 목록을 갱신했습니다."; return; }
    const { models } = await client.listProviderModels(providerDraft());
    $("provider-models").replaceChildren();
    for (const id of models) {
      const option = document.createElement("option");
      option.value = id;
      $("provider-models").append(option);
    }
    if (models.length === 1 && $("provider-model").value !== models[0]) {
      $("provider-model").value = models[0]; resetEndpointCapabilities();
    }
    $("provider-feedback").textContent = models.length
      ? `${models.length}개 모델을 찾았습니다. 모델 입력란에서 선택하세요.`
      : "목록이 비어 있습니다. 모델을 로드하거나 이름을 직접 입력하세요.";
  } catch (e) {
    $("provider-feedback").textContent =
      setupErrors[e.code] ??
      "목록을 불러오지 못했습니다. 모델 이름을 직접 입력하세요.";
  } finally {
    configuring = false;
    providerControls();
  }
};
$("provider-form").onsubmit = async (e) => {
  e.preventDefault();
  if (configuring || running || pending || studio.busy) return;
  configuring = true;
  controls();
  $("provider-feedback").textContent = "연결을 확인하고 있습니다…";
  try {
    await client.configureProvider(providerDraft());
    $("provider-key").value = "";
    const info = await client.getInfo();
    $("model").textContent =
      `${info.provider.mode === "mock" ? "데모 모델" : info.provider.mode === "endpoint" ? "사용자 지정" : info.provider.mode} · ${info.provider.model}`;
    $("mock-note").hidden = info.provider.mode !== "mock";
    await loadProviderSettings();
    await studio.connect(info);
    $("provider-feedback").textContent =
      "적용했습니다. 바로 대화를 시작하셔도 됩니다.";
  } catch (error) {
    $("provider-feedback").textContent =
      setupErrors[error.code] ??
      explainError(error.code);
  } finally {
    configuring = false;
    controls();
  }
};
let selectedFile;
function clearFile() {
  selectedFile = undefined;
  $("file-source").textContent = "";
  $("file-title").textContent = "선택한 파일 없음";
  $("artifact-preview").srcdoc = "";
  $("artifact-preview").hidden = true;
  $("file-empty").hidden = false;
  $("source-details").hidden = true;
  $("download-file").disabled = true;
}
function clearWorkbench() {
  clearFile();
  $("file-count").textContent = "0"; $("skill-count").textContent = "0";
  for (const id of ["workbench-files", "workbench-skills", "workbench-history"]) $(id).replaceChildren();
}
async function selectFile(path) {
  selectedFile = await client.readWorkspaceFile(path);
  $("file-title").textContent = path;
  $("file-source").textContent = selectedFile.content;
  $("file-empty").hidden = true;
  $("source-details").hidden = false;
  $("download-file").disabled = false;
  const html = /\.html?$/.test(path);
  $("source-details").open = !html;
  $("artifact-preview").hidden = !html;
  $("artifact-preview").srcdoc = html ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">` + selectedFile.content : "";
  for (const button of $("workbench-files").querySelectorAll("button")) button.setAttribute("aria-current", String(button.dataset.path === path));
}
async function refreshWorkbench() {
  try {
    const data = await client.getWorkbench();
    $("workbench").hidden = false; $("workbench-unavailable").hidden = true;
    $("file-count").textContent = data.files.length;
    $("skill-count").textContent = data.skills.length;
    $("workbench-status").textContent = `${data.engine} / ${data.files.length} files / ${data.skills.length} skills`;
    $("workbench-files").replaceChildren();
    for (const file of data.files) {
      const button = document.createElement("button"), icon = document.createElement("span"), name = document.createElement("span"), size = document.createElement("small");
      button.className = "file-item"; button.dataset.path = file.path; button.title = file.path;
      button.setAttribute("aria-label", file.path);
      button.setAttribute("aria-current", String(selectedFile?.path === file.path));
      icon.className = "file-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = file.path.split(".").pop().slice(0, 4).toUpperCase();
      name.className = "file-name"; name.textContent = file.path;
      size.textContent = file.bytes < 1024 ? `${file.bytes} B` : `${(file.bytes / 1024).toFixed(1)} K`;
      button.append(icon, name, size);
      button.onclick = () => action(() => selectFile(file.path));
      $("workbench-files").append(button);
    }
    if (!data.files.length) { const p = document.createElement("p"); p.className = "panel-empty"; p.textContent = "파일을 올리거나 챗에서 생성을 요청하세요."; $("workbench-files").append(p); }
    $("workbench-skills").replaceChildren();
    for (const skill of data.skills) { const li = document.createElement("li"), name = document.createElement("strong"), description = document.createElement("p"); name.textContent = skill.name; description.textContent = skill.description; li.append(name, description); $("workbench-skills").append(li); }
    if (!data.skills.length) $("workbench-skills").textContent = "검증 후 저장한 스킬이 여기에 쌓입니다.";
    $("workbench-history").replaceChildren();
    for (const h of data.history) { const li = document.createElement("li"), id = document.createElement("code"); id.textContent = h.id.slice(0, 8); li.append(id, ` · ${h.message}`); $("workbench-history").append(li); }
    if (selectedFile) {
      if (data.files.some(f => f.path === selectedFile.path)) await selectFile(selectedFile.path);
      else clearFile();
    }
  } catch (e) {
    if (e.status === 404 || e.status === 403) { clearWorkbench(); $("workbench").hidden = true; $("workbench-unavailable").hidden = false; }
    else throw e;
  }
}
$("refresh-workbench").onclick = () => action(refreshWorkbench);
$("upload-file").onchange = () => action(async () => {
  const file = $("upload-file").files[0];
  if (!file) return;
  if (file.size > 131072) throw new Error("파일은 128 KiB 이하여야 합니다.");
  await client.writeWorkspaceFile("uploads/" + file.name, await file.text());
  $("upload-file").value = "";
  await refreshWorkbench();
});
$("download-file").onclick = () => {
  if (!selectedFile) return;
  const url = URL.createObjectURL(new Blob([selectedFile.content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = selectedFile.path.split("/").pop(); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function openSettings() {
  if ($("provider-settings").hidden && !composition.available) return;
  void composition.refresh();
  $("provider-settings").open = true;
  if (!$("settings-dialog").open) $("settings-dialog").showModal();
}
$("open-settings").onclick = openSettings;
$("close-settings").onclick = () => $("settings-dialog").close();
function setDrawer(name, open) {
  document.body.dataset[name + "Open"] = String(open);
  $("toggle-" + name).setAttribute("aria-expanded", String(open));
  if (open) setDrawer(name === "sessions" ? "inspector" : "sessions", false);
}
for (const name of ["sessions", "inspector"]) {
  $("toggle-" + name).onclick = () => setDrawer(name, document.body.dataset[name + "Open"] !== "true");
  $("close-" + name).onclick = () => { setDrawer(name, false); $("toggle-" + name).focus(); };
}
const inspectorTabs = ["files", "runs", "tools"];
function inspectorTab(name, focus = false) {
  for (const key of inspectorTabs) {
    const active = key === name;
    $("tab-" + key).setAttribute("aria-selected", String(active));
    $("tab-" + key).tabIndex = active ? 0 : -1;
    $(key + "-panel").hidden = !active;
  }
  if (focus) $("tab-" + name).focus();
}
for (const [index, name] of inspectorTabs.entries()) {
  $("tab-" + name).onclick = () => inspectorTab(name);
  $("tab-" + name).onkeydown = e => {
    const next = e.key === "ArrowRight" ? (index + 1) % 3 : e.key === "ArrowLeft" ? (index + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : undefined;
    if (next !== undefined) { e.preventDefault(); inspectorTab(inspectorTabs[next], true); }
  };
}
$("prompt").onkeydown = e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.isComposing && !$("send").disabled) { e.preventDefault(); $("form").requestSubmit(); }
};
document.addEventListener("keydown", e => {
  if (e.isComposing || $("settings-dialog").open) return;
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN" && !$("new-session").disabled) { e.preventDefault(); $("new-session").click(); }
  if (e.key === "Escape") { setDrawer("sessions", false); setDrawer("inspector", false); }
});
let initialSetup = false;
function consumeLaunch() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const initial = fragment.get("token");
  initialSetup = fragment.get("setup") === "1";
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  if (initial && connected && initial === token) {
    if (initialSetup) openSettings();
    return;
  }
  if (initial) {
    $("token").value = initial;
    action(connect);
  }
}
controls();
consumeLaunch();
window.addEventListener("hashchange", consumeLaunch);

