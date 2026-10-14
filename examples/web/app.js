import { PidaClient } from "/pida-client.js";
const $ = (id) => document.getElementById(id);
let sessionId,
  token = "",
  running = false;
const client = new PidaClient({ baseUrl: location.origin, token: () => token });
function controls() {
  $("send").disabled = !sessionId || running;
  $("cancel").disabled = !running;
  $("connect").disabled = running;
  $("disconnect").disabled = !sessionId || running;
}
function problem(e) {
  $("error").textContent = e.message;
}
$("connect").onclick = async () => {
  $("error").textContent = "";
  try {
    if (sessionId) await client.deleteSession(sessionId);
    token = $("token").value;
    sessionId = undefined;
    const data = await client.createSession();
    sessionId = data.sessionId;
    $("session").textContent = `SESSION / ${sessionId}`;
    $("messages").replaceChildren();
    $("trace").replaceChildren();
  } catch (e) {
    problem(e);
  } finally {
    controls();
  }
};
$("disconnect").onclick = async () => {
  try {
    await client.deleteSession(sessionId);
    sessionId = undefined;
    token = "";
    $("token").value = "";
    $("session").textContent = "연결된 세션 없음";
    controls();
  } catch (e) {
    problem(e);
  }
};
$("cancel").onclick = async () => {
  try {
    await client.cancel(sessionId);
  } catch (e) {
    problem(e);
  }
};
function message(role, text) {
  const box = document.createElement("article"),
    label = document.createElement("strong"),
    content = document.createElement("p");
  box.className = role;
  label.textContent = role === "user" ? "YOU" : "PIDA";
  content.textContent = text;
  box.append(label, content);
  $("messages").append(box);
  return content;
}
$("form").onsubmit = async (event) => {
  event.preventDefault();
  if (running || !sessionId) return;
  const prompt = $("prompt").value;
  if (!prompt.trim()) return;
  running = true;
  controls();
  $("error").textContent = "";
  $("status").textContent = "실행 중";
  message("user", prompt);
  const answer = message("assistant", "");
  let gotResult = false;
  try {
    for await (const e of client.stream(sessionId, prompt)) {
      if (e.type === "text_delta") answer.textContent += e.delta;
      if (e.type === "trace") {
        const li = document.createElement("li");
        li.textContent = `${e.trace.sequence.toString().padStart(2, "0")}  ${e.trace.type}${e.trace.toolName ? ` / ${e.trace.toolName}` : ""}`;
        $("trace").append(li);
      }
      if (e.type === "result") {
        gotResult = true;
        $("status").textContent = e.result.status;
        answer.textContent = e.result.text || e.result.code || "(응답 없음)";
      }
    }
    if (!gotResult)
      throw new Error(
        "연결이 종료되었습니다. 실행 결과를 확인하지 못했습니다.",
      );
  } catch (e) {
    problem(e);
    $("status").textContent = "오류";
  } finally {
    running = false;
    controls();
  }
};
