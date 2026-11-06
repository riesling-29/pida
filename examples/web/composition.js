const stateLabels = { connected: "연결됨", backoff: "재연결 대기", disconnected: "연결 끊김", failed: "연결 실패", closed: "종료됨", "schema-changed": "도구 정의 변경 · 재시작 필요" };
const scopeLabel = scope => scope === "agent" ? "에이전트별" : "작업 공간 공유";
const revision = value => value === "unversioned" ? "미지정" : String(value ?? "").slice(0, 12);

export function renderCompositionReport(document, root, report) {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const table = (labels, rows) => {
    const wrap = node("div", undefined, "composition-table"), element = node("table"), head = node("thead"), header = node("tr"), body = node("tbody");
    for (const label of labels) header.append(node("th", label));
    head.append(header);
    for (const values of rows) { const row = node("tr"); for (const value of values) row.append(node("td", value)); body.append(row); }
    element.append(head, body); wrap.append(element); return wrap;
  };
  root.replaceChildren();
  root.append(node("p", report.restartRequired
    ? "설정 또는 도구 정의가 바뀌었습니다. 실행 중인 서버를 다시 시작해야 반영됩니다."
    : "현재 서버에 적용된 구성입니다.", report.restartRequired ? "notice" : "muted"));
  root.append(node("p", `설정 revision ${revision(report.configuredRevision)}`, "composition-revision"));
  for (const runtime of report.active) {
    const section = node("section", undefined, "composition-runtime");
    section.append(node("h3", `${runtime.target === "main" ? "기본 작업 공간" : "에이전트 " + runtime.agentId.slice(0, 8)} · ${runtime.preset}`));
    const services = Object.entries(runtime.services).filter(([, enabled]) => enabled).map(([name]) => ({ web: "Web", workbench: "화면 편집", project: "프로젝트", agents: "상주 에이전트" }[name] ?? name));
    section.append(node("p", `적용 revision ${revision(runtime.revision)} · ${services.join(" / ") || "기본 런타임"}`, "muted"));
    const tools = node("details"), summary = node("summary", `도구 ${runtime.tools.length}개 · 권한과 출처`);
    tools.append(summary, table(["도구", "권한", "출처 / 범위"], runtime.tools.map(tool => [tool.name, `${tool.permitted ? "허용" : "권한 없음"} · ${tool.permission}`, `${tool.source} / ${scopeLabel(tool.scope)}`])));
    section.append(tools);
    if (runtime.extensions.length) section.append(table(["확장", "범위", "revision"], runtime.extensions.map(extension => [extension.id, scopeLabel(extension.scope), revision(extension.revision)])));
    root.append(section);
  }
  const mcp = node("section", undefined, "composition-runtime");
  mcp.append(node("h3", "MCP 연결"));
  if (!report.mcp.length) mcp.append(node("p", "설정된 MCP 서버가 없습니다.", "muted"));
  for (const server of report.mcp) {
    const line = node("p", `${server.id} · ${stateLabels[server.status] ?? "상태 확인 필요"}`);
    line.dataset.status = server.status; mcp.append(line);
    mcp.append(node("p", `${server.transport} · 도구 ${server.toolCount}개 · 연결 세대 ${server.generation} · 재연결 ${server.reconnectAttempts}/${server.maxReconnectAttempts}${server.code ? " · " + server.code : ""}`, "muted"));
  }
  mcp.append(node("p", "새로고침은 상태만 조회합니다. 구성 변경과 수동 재연결은 서버 설정을 확인한 뒤 재시작하세요.", "muted"));
  root.append(mcp);
}

export function createComposition({ client, document = globalThis.document }) {
  const panel = document.getElementById("composition-settings"), content = document.getElementById("composition-content"), status = document.getElementById("composition-status"), refreshButton = document.getElementById("composition-refresh");
  let generation = 0, available = false;
  async function refresh() {
    const current = ++generation;
    refreshButton.disabled = true; status.textContent = "적용 구성을 확인하고 있습니다…";
    try {
      const report = await client.getComposition();
      if (current !== generation) return;
      available = true; panel.hidden = false;
      renderCompositionReport(document, content, report);
      status.textContent = report.restartRequired ? "재시작 후 반영" : "조회 완료";
    } catch (error) {
      if (current !== generation) return;
      content.replaceChildren();
      available = ![401, 403, 404].includes(error.status); panel.hidden = !available;
      status.textContent = error.status === 403 ? "호스트 설정 관리 권한이 필요합니다." : error.status === 404 ? "이 서버는 구성 조회를 제공하지 않습니다." : "구성을 불러오지 못했습니다. 다시 조회하세요.";
    } finally { if (current === generation) refreshButton.disabled = false; }
  }
  refreshButton.onclick = () => { void refresh(); };
  return {
    refresh,
    get available() { return available; },
    reset() { generation++; available = false; panel.hidden = true; content.replaceChildren(); status.textContent = ""; refreshButton.disabled = false; },
  };
}
