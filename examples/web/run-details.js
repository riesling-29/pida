/** Explicit owner-authorized read; raw tool output never enters the live trace. */
export function createRunDetails({ container, load, explain }) {
  const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
  const summary = node("summary", "명령·도구 결과 보기"), refresh = node("button", "결과 새로고침"), status = node("p", ""), list = node("div", "");
  refresh.type = "button"; refresh.className = "quiet";
  container.classList.add("run-details"); container.replaceChildren(summary, refresh, status, list);
  let identity, selectedRun, generation = 0, loaded = false, loading = false;
  const bounded = (value, limit = 65536) => typeof value === "string" ? value.slice(0, limit) + (value.length > limit ? "\n[화면 표시 제한]" : "") : "";
  async function read() {
    if (!identity || loading) return;
    const ticket = generation; loading = true; refresh.disabled = true; status.textContent = "저장된 도구 결과를 조회하고 있습니다…";
    try {
      const data = await load();
      if (ticket !== generation) return;
      const items = (data.items ?? []).filter(item => !selectedRun || !item.runId || item.runId === selectedRun);
      list.replaceChildren();
      for (const item of items) {
        const failed = item.status === "failed" || (Number.isFinite(item.exitCode) && item.exitCode !== 0);
        const shownStatus = failed ? "failed" : item.status;
        const row = node("details", ""), title = node("summary", `${item.toolName} · ${{ running: "실행 중", completed: "도구 완료", failed: "도구 실패", unknown: "상태 미확인" }[shownStatus] ?? "상태 미확인"}${item.exitCode != null ? " · 종료 코드 " + item.exitCode : ""}`);
        row.dataset.status = shownStatus; row.append(title);
        if (!item.runId) row.append(node("p", "이 기록의 실행 ID 연결은 확인되지 않았습니다."));
        if (item.command) row.append(node("pre", bounded(item.command, 8192)));
        if (item.cwd) row.append(node("p", "실행 디렉터리 · " + bounded(item.cwd, 2048)));
        row.append(node("pre", bounded(item.output) || (item.status === "running" ? "아직 저장된 결과가 없습니다." : "저장된 출력 없음")));
        if (item.stderr) { row.append(node("p", "표준 오류 출력")); row.append(node("pre", bounded(item.stderr))); }
        if (item.truncated) row.append(node("p", "일부 출력만 포함된 결과입니다."));
        for (const [label, refs] of [["산출물", item.artifactRefs], ["검증 근거", item.evidenceRefs]]) if (refs?.length) row.append(node("p", `${label} · ${refs.map(ref => bounded(ref, 2048)).join(" · ")}`));
        list.append(row);
      }
      status.textContent = `${items.length}개 도구 기록${data.truncated ? " · 일부만 반환됨" : ""}. 현재 권한으로 읽을 수 있는 보존된 Pi 컨텍스트입니다. 압축된 과거 결과는 없을 수 있습니다. 도구 완료는 작업 전체의 검증 완료를 뜻하지 않습니다.`;
      loaded = true;
    } catch (error) {
      if (ticket === generation) status.textContent = `상세 조회 실패 · ${explain(error.code) || error.message || "연결을 확인하세요"}`;
    } finally {
      if (ticket === generation) { loading = false; refresh.disabled = false; }
    }
  }
  refresh.onclick = () => void read();
  container.ontoggle = () => { if (container.open && !loaded) void read(); };
  return {
    select(nextIdentity, runId) {
      if (identity === nextIdentity && selectedRun === runId) return;
      identity = nextIdentity; selectedRun = runId; generation++; loaded = loading = false;
      container.open = false; container.hidden = !identity; refresh.disabled = false;
      status.textContent = "펼치면 저장된 명령·결과를 권한 확인 후 조회합니다."; list.replaceChildren();
    },
  };
}
