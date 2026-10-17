import { PidaClient } from "/pida-client.js";
const $ = (id) => document.getElementById(id);
let token = "",
  sessionId,
  connected = false,
  pending = false,
  running = false,
  remoteRunning = false;
const client = new PidaClient({ baseUrl: location.origin, token: () => token });
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
    errors[error.code] ?? error.message ?? "요청을 처리하지 못했습니다.";
}
function controls() {
  const busy = pending || running;
  $("send").disabled = !sessionId || busy || remoteRunning;
  $("cancel").disabled = pending || !(running || remoteRunning);
  $("connect").disabled = busy;
  $("new-session").disabled = !connected || busy || remoteRunning;
  $("delete-session").disabled = !sessionId || busy || remoteRunning;
  $("refresh").disabled = !connected || busy;
  $("disconnect").disabled = !connected || busy || remoteRunning;
  $("prompt").disabled = !sessionId || busy || remoteRunning;
  for (const button of $("sessions").querySelectorAll("button"))
    button.disabled = busy || remoteRunning;
  $("connection").hidden = connected;
  $("workspace").hidden = !connected;
  providerControls();
}
async function action(fn) {
  if (pending || running) return;
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
  label.textContent = role === "user" ? "나" : "Pida";
  content.textContent = text;
  article.append(label, content);
  $("messages").append(article);
  return content;
}
function trace(event) {
  const li = document.createElement("li");
  li.textContent = `${event.sequence} · ${event.type}${event.toolName ? ` · ${event.toolName}` : ""}${event.status ? ` · ${labels[event.status] ?? event.status}` : ""}`;
  $("trace").append(li);
  while ($("trace").children.length > 1000) $("trace").firstChild.remove();
}
async function list() {
  const { sessions } = await client.listSessions();
  $("sessions").replaceChildren();
  for (const s of sessions) {
    const button = document.createElement("button"),
      title = document.createElement("span"),
      detail = document.createElement("small");
    button.className = "session-item";
    button.setAttribute("aria-current", String(s.sessionId === sessionId));
    title.textContent = s.title;
    detail.textContent = `${new Date(s.updatedAt).toLocaleString()} · ${s.running ? "실행 중" : (labels[s.lastStatus] ?? "대기")}`;
    button.append(title, detail);
    button.onclick = () => action(() => select(s.sessionId));
    $("sessions").append(button);
  }
  if (!sessions.length)
    $("sessions").textContent = "아직 대화가 없습니다. 새 대화로 시작하세요.";
  return sessions;
}
async function select(id) {
  const data = await client.getSession(id);
  sessionId = id;
  remoteRunning = data.running;
  sessionStorage.setItem("pida-session", id);
  $("session-title").textContent = data.title ?? "대화";
  $("messages").replaceChildren();
  for (const m of data.messages) message(m.role, m.text);
  if (!data.messages.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "무엇을 도와드릴까요? 아래에 요청을 입력하세요.";
    $("messages").append(p);
  }
  $("trace").replaceChildren();
  for (const event of (await client.getTrace(id)).events) trace(event);
  $("status").textContent = data.running
    ? "실행 중 · 새로고침으로 확인"
    : (labels[data.lastStatus] ?? "대기");
  await list();
  controls();
  $("messages").scrollTop = $("messages").scrollHeight;
}
async function connect() {
  token = $("token").value;
  const info = await client.getInfo();
  $("model").textContent = info.provider
    ? `${info.provider.mode === "mock" ? "데모 모델" : info.provider.mode === "endpoint" ? "사용자 지정" : info.provider.mode} · ${info.provider.model}`
    : "호스트 설정 모델";
  $("storage").textContent = info.persistence
    ? "대화 자동 저장"
    : "임시 대화 · 서버 종료 시 삭제";
  $("mock-note").hidden = info.provider?.mode !== "mock";
  $("tools").replaceChildren();
  for (const tool of info.tools) {
    const item = document.createElement("li");
    item.textContent = `${tool.name}${tool.permitted ? "" : " · 권한 없음"}`;
    item.title = tool.description;
    $("tools").append(item);
  }
  if (!info.tools.length) $("tools").textContent = "등록된 도구 없음";
  await loadProviderSettings();
  await refreshWorkbench();
  if (
    new URLSearchParams(location.hash.slice(1)).get("setup") === "1" ||
    initialSetup
  )
    $("provider-settings").open = true;
  connected = true;
  sessionId = undefined;
  remoteRunning = false;
  $("token").value = "";
  const sessions = await list();
  const saved = sessionStorage.getItem("pida-session");
  const recent = sessions.find((s) => s.sessionId === saved) ?? sessions[0];
  if (recent) await select(recent.sessionId);
}
$("connection-form").onsubmit = (e) => {
  e.preventDefault();
  action(connect);
};
$("new-session").onclick = () =>
  action(async () => {
    const data = await client.createSession();
    await select(data.sessionId);
  });
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
    sessionId = undefined;
    sessionStorage.removeItem("pida-session");
    $("messages").replaceChildren();
    $("trace").replaceChildren();
    $("session-title").textContent = "새 대화를 시작하세요";
    $("status").textContent = "대기";
    const sessions = await list();
    if (sessions[0]) await select(sessions[0].sessionId);
  });
};
$("disconnect").onclick = () => {
  connected = false;
  clearWorkbench();
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
  $("cancel").disabled = true;
  try {
    await client.cancel(sessionId);
    if (!running) await select(sessionId);
  } catch (e) {
    problem(e);
  } finally {
    controls();
  }
};
$("form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending || running || remoteRunning || !sessionId) return;
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  running = true;
  controls();
  $("error").textContent = "";
  $("status").textContent = "실행 중";
  $("messages").querySelector(".empty")?.remove();
  message("user", prompt);
  const answer = message("assistant", "응답을 기다리고 있습니다…");
  let text = "";
  try {
    for await (const event of client.stream(sessionId, prompt)) {
      if (event.type === "text_delta") {
        text += event.delta;
        answer.textContent = text;
      }
      if (event.type === "trace") trace(event.trace);
      if (event.type === "result") {
        $("status").textContent =
          labels[event.result.status] ?? event.result.status;
        answer.textContent =
          event.result.text ||
          errors[event.result.code] ||
          event.result.code ||
          "응답 없음";
        if (event.result.code)
          problem({ code: event.result.code, message: event.result.code });
        if (event.result.status === "completed") $("prompt").value = "";
      }
      $("messages").scrollTop = $("messages").scrollHeight;
    }
    await list();
    await refreshWorkbench();
  } catch (error) {
    problem(error);
    $("status").textContent = "연결 확인 필요";
  } finally {
    running = false;
    controls();
    $("prompt").focus();
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
let providerCatalog = [];
const selectedNative = () => providerCatalog.find(p => p.id === $("provider-preset").value);
function showNativeModels(selectedId = "") {
  const p = selectedNative();
  $("native-model-select").replaceChildren();
  if (!p) return;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "모델을 선택하세요";
  $("native-model-select").append(placeholder);
  for (const model of p.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name} · ${model.id}`;
    $("native-model-select").append(option);
  }
  $("native-model-select").value = selectedId;
  $("provider-key").placeholder = `API 키 입력 또는 서버의 ${p.apiKeyEnv} 사용`;
  $("provider-key-state").textContent = p.keyConfigured ? "이 프로바이더의 저장된 키 사용 가능" : "";
  $("native-provider-note").textContent = `${p.name} · API 키 인증. 서버 주소와 API 형식은 자동 설정됩니다. 기본 제공 모델 목록입니다. 계정별 이용 가능 여부는 연결 확인이 필요합니다. 구독 계정 OAuth 로그인은 아직 지원하지 않습니다.`;
}
function providerControls() {
  const mock = $("provider-preset").value === "mock";
  const native = !!selectedNative();
  $("endpoint-fields").hidden = mock;
  $("custom-connection-fields").hidden = native;
  $("native-provider-note").hidden = !native;
  $("native-model-select").hidden = !native;
  $("provider-model-label").htmlFor = native ? "native-model-select" : "provider-model";
  $("provider-model").hidden = native;
  $("provider-advanced").hidden = native;
  $("load-models").hidden = native;
  for (const field of $("provider-form").querySelectorAll("input, select")) field.disabled = configuring;
  $("provider-key").disabled = configuring || (!native && $("provider-no-key").checked);
  $("provider-http-row").hidden = native || !$("provider-url").value.startsWith("http:");
  $("apply-provider").disabled = configuring || running || pending;
  $("load-models").disabled = configuring || mock;
}
function providerDraft() {
  if ($("provider-preset").value === "mock") return { kind: "mock" };
  const native = selectedNative();
  if (native) return { kind: "native", providerId: native.id,
    modelId: $("native-model-select").value, apiKey: $("provider-key").value };
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
  };
}
async function loadProviderSettings() {
  try {
    const { provider: p, keyConfigured, catalog = [] } = await client.getProviderSettings();
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
    providerControls();
  } catch {
    $("provider-settings").hidden = true;
  }
}
$("provider-preset").onchange = () => {
  const value = $("provider-preset").value;
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
  providerControls();
};
$("provider-no-key").onchange = providerControls;
$("provider-url").oninput = () => {
  $("provider-http").checked = false;
  providerControls();
};
$("load-models").onclick = async () => {
  if (configuring) return;
  configuring = true;
  providerControls();
  $("provider-feedback").textContent = "모델 목록을 불러오는 중…";
  try {
    const { models } = await client.listProviderModels(providerDraft());
    $("provider-models").replaceChildren();
    for (const id of models) {
      const option = document.createElement("option");
      option.value = id;
      $("provider-models").append(option);
    }
    if (models.length === 1) $("provider-model").value = models[0];
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
  if (configuring || running || pending) return;
  configuring = true;
  providerControls();
  $("provider-feedback").textContent = "연결을 확인하고 있습니다…";
  try {
    await client.configureProvider(providerDraft());
    $("provider-key").value = "";
    const info = await client.getInfo();
    $("model").textContent =
      `${info.provider.mode === "mock" ? "데모 모델" : info.provider.mode === "endpoint" ? "사용자 지정" : info.provider.mode} · ${info.provider.model}`;
    $("mock-note").hidden = info.provider.mode !== "mock";
    await loadProviderSettings();
    $("provider-feedback").textContent =
      "적용했습니다. 바로 대화를 시작하셔도 됩니다.";
  } catch (error) {
    $("provider-feedback").textContent =
      setupErrors[error.code] ??
      "설정을 적용하지 못했습니다. 기존 연결을 확인해주세요.";
  } finally {
    configuring = false;
    providerControls();
  }
};
let selectedFile;
function clearWorkbench() {
  selectedFile = undefined;
  $("file-source").textContent = "";
  $("file-title").textContent = "파일을 선택하세요";
  $("artifact-preview").srcdoc = "";
  $("artifact-preview").hidden = true;
  $("download-file").disabled = true;
  for (const id of ["workbench-files", "workbench-skills", "workbench-history"]) $(id).replaceChildren();
}
async function refreshWorkbench() {
  try {
    const data = await client.getWorkbench();
    $("workbench").hidden = false;
    $("workbench-status").textContent = `${data.engine} · ${data.files.length}개 파일 · ${data.skills.length}개 스킬`;
    $("workbench-files").replaceChildren();
    for (const file of data.files) {
      const button = document.createElement("button");
      button.className = "file-item secondary";
      button.textContent = `${file.path} · ${file.bytes} B`;
      button.onclick = () => action(async () => {
        selectedFile = await client.readWorkspaceFile(file.path);
        $("file-title").textContent = file.path;
        $("file-source").textContent = selectedFile.content;
        $("download-file").disabled = false;
        const html = /\.html?$/.test(file.path);
        $("artifact-preview").hidden = !html;
        $("artifact-preview").srcdoc = html ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">` + selectedFile.content : "";
      });
      $("workbench-files").append(button);
    }
    $("workbench-skills").replaceChildren();
    for (const skill of data.skills) { const li = document.createElement("li"); li.textContent = `${skill.name} — ${skill.description}`; $("workbench-skills").append(li); }
    $("workbench-history").replaceChildren();
    for (const h of data.history) { const li = document.createElement("li"); li.textContent = `${h.id.slice(0, 8)} · ${h.message}`; $("workbench-history").append(li); }
  } catch (e) {
    if (e.status === 404 || e.status === 403) $("workbench").hidden = true;
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
let initialSetup = false;
function consumeLaunch() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const initial = fragment.get("token");
  initialSetup = fragment.get("setup") === "1";
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  if (initial && connected && initial === token) {
    if (initialSetup) $("provider-settings").open = true;
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
