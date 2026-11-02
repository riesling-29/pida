/** Explicit, owner-authorized command output. These reads do not consume the model's output cursor. */
export function createCommands({ container, list, read, cancel, recover, explain = code => code }) {
  const node = (tag, text = "", action) => {
    const element = document.createElement(tag); element.textContent = text;
    if (action) element.dataset.commandAction = action;
    return element;
  };
  const button = (text, action) => { const element = node("button", text, action); element.type = "button"; return element; };
  const labels = { running: "실행 중", stopping: "중단 요청 중", completed: "명령 종료", failed: "명령 실패", cancelled: "취소됨", timed_out: "실행 시간 초과", interrupted: "서버 실행 소유권 상실", unknown: "종료 상태 미확인" };
  const active = command => command && ["running", "stopping"].includes(command.status);
  const summary = node("summary", "실행 명령"), refresh = button("상태 새로고침", "refresh");
  const status = node("p"), capability = node("p"), selector = node("select", "", "select"), detail = node("section"), metadata = node("p"), commandText = node("pre"), output = node("pre"), outputInfo = node("p");
  const more = button("출력 이어 읽기", "more"), restart = button("출력 처음부터 읽기", "restart"), stop = button("명령 중단", "cancel"), recovery = node("div"), inspected = node("input", "", "inspected"), acknowledge = button("상태 확인 기록", "recover"), receipt = node("p");
  selector.setAttribute("aria-label", "명령 선택"); output.setAttribute("aria-label", "명령 출력"); status.setAttribute("role", "status"); receipt.setAttribute("role", "status");
  inspected.type = "checkbox";
  const inspectionLabel = node("label"); inspectionLabel.append(inspected, node("span", "실제 파일과 프로세스 상태를 확인했습니다."));
  recovery.append(node("p", "확인 전에는 프로젝트 변경이 제한됩니다. 상태 확인은 실행 성공·프로세스 종료 증명·파일 복원을 뜻하지 않습니다. 실행 효과 복구가 별도로 필요할 수 있습니다."), inspectionLabel, acknowledge);
  const actions = node("div"); actions.className = "command-actions"; actions.append(more, restart, stop);
  detail.append(commandText, metadata, output, outputInfo, actions, recovery, receipt);
  container.classList.add("command-panel"); container.replaceChildren(summary, refresh, status, capability, selector, detail);
  let identity, enabled = true, halted = false, generation = 0, requestSequence = 0, timer, loading = false, mutating = false, commands = [], permissions = {}, selectedId, offset = 0, text = "", displayTrimmed = false, gap = false, hasMore = false;
  const current = () => commands.find(command => command.id === selectedId);
  const stamp = value => value ? new Date(value).toLocaleTimeString("ko-KR", { hour12: false }) : "미기록";
  function resetOutput() { offset = 0; text = ""; gap = displayTrimmed = hasMore = false; commandText.textContent = ""; metadata.textContent = ""; output.textContent = ""; outputInfo.textContent = ""; inspected.checked = false; receipt.textContent = ""; }
  function controls() {
    const command = current(); detail.hidden = !command; selector.hidden = commands.length === 0;
    refresh.disabled = loading || mutating || !identity; selector.disabled = mutating;
    more.disabled = loading || mutating || !hasMore; restart.disabled = loading || mutating || !command;
    stop.hidden = !permissions.cancel; stop.disabled = mutating || !command || command.status !== "running";
    recovery.hidden = !command?.requiresRecovery;
    inspected.disabled = mutating || !permissions.recover; acknowledge.disabled = mutating || !permissions.recover || !inspected.checked || !command?.requiresRecovery || active(command);
    if (!command) return;
    commandText.textContent = command.commandPreview;
    metadata.textContent = `${labels[command.status] ?? "상태 미확인"}${command.exitCode !== null && command.exitCode !== undefined ? " · 종료 코드 " + command.exitCode : ""} · 시작 ${stamp(command.createdAt)} · 실행 기한 ${stamp(command.deadlineAt)} · ${command.backend}\n직접 프로세스 종료: ${command.directExited === true ? "확인" : command.directExited === false ? "아니오" : "미확인"} · 하위 프로세스 전체 종료: ${command.rangeExited === true ? "확인" : command.rangeExited === false ? "아니오" : "미확인"}${command.error ? " · " + command.error : ""}${command.recoveryAcknowledged ? " · 사용자 상태 확인 기록됨" : ""}`;
    metadata.dataset.status = command.status;
    if (!text) output.textContent = active(command) ? "아직 관측된 출력이 없습니다." : "관측된 출력 없음";
    if (command.requiresRecovery && !permissions.recover) receipt.textContent = "이 명령의 상태 확인을 기록할 권한이 없습니다. 호스트 관리자에게 요청하세요.";
  }
  function schedule() {
    clearTimeout(timer);
    if (identity && enabled && !halted && container.open) timer = setTimeout(() => void refreshState(), commands.some(active) || hasMore ? 1500 : 4000);
  }
  function presentList(data) {
    commands = data.commands ?? []; permissions = data.permissions ?? {};
    if (!commands.some(command => command.id === selectedId)) {
      selectedId = commands.find(active)?.id ?? commands.find(command => command.requiresRecovery)?.id ?? commands.at(-1)?.id; resetOutput();
    }
    selector.replaceChildren();
    for (const command of commands) { const option = node("option", `${labels[command.status] ?? command.status} · ${command.commandPreview}`); option.value = command.id; selector.append(option); }
    selector.value = selectedId ?? "";
    summary.textContent = `실행 명령 · ${commands.length}건${commands.some(active) ? " · 진행 중 " + commands.filter(active).length : ""}`;
    const caps = data.capabilities;
    capability.textContent = caps ? `${caps.backend} · 출력: stdout/stderr 합본 · PTY ${caps.pty ? "지원" : "미지원"} · 입력 ${caps.stdin ? "지원" : "미지원"} · 서버 재시작 후 프로세스 재개 ${caps.restartExecution ? "지원" : "미지원"}\n명령 시작은 모델 도구를 통해 요청합니다. 명령 종료는 작업 검증 완료와 별개입니다.` : "실행 기능 정보를 확인하지 못했습니다.";
    status.textContent = commands.length ? `서버 상태 확인 · ${stamp(new Date().toISOString())}` : "이 범위에서 시작된 명령이 없습니다. 명령을 실행하면 이곳에서 상태와 출력을 조회할 수 있습니다.";
  }
  async function refreshState() {
    if (!identity || !enabled || halted || !container.open || loading || mutating) return;
    if (document.hidden || container.closest?.("[hidden]")) { schedule(); return; }
    clearTimeout(timer); loading = true; const token = generation, request = ++requestSequence;
    const valid = () => token === generation && request === requestSequence;
    controls();
    try {
      const data = await list(identity); if (!valid()) return;
      presentList(data); controls();
      if (selectedId) {
        const commandId = selectedId, response = await read(identity, commandId, { offset, maxBytes: 8192 });
        if (!valid() || commandId !== selectedId) return;
        if (response.command?.id !== commandId) throw Object.assign(new Error("명령 응답이 일치하지 않습니다."), { code: "COMMAND_RESPONSE_MISMATCH" });
        const chunk = response.output;
        if (!chunk || !Number.isSafeInteger(chunk.nextOffset) || chunk.nextOffset < offset || !Number.isSafeInteger(chunk.offset) || chunk.offset < offset || typeof chunk.text !== "string") throw Object.assign(new Error("출력 범위를 확인하지 못했습니다."), { code: "COMMAND_RESPONSE_MISMATCH" });
        const index = commands.findIndex(command => command.id === commandId); commands[index] = response.command;
        if (chunk.lossy || chunk.offset > offset) { gap = true; text += "\n[이전 출력 일부를 조회할 수 없습니다.]\n"; }
        text += chunk.text; offset = chunk.nextOffset; hasMore = !chunk.eof && offset < chunk.totalBytes;
        if (text.length > 65536) { text = text.slice(-65536); displayTrimmed = true; }
        output.textContent = text || (active(response.command) ? "아직 관측된 출력이 없습니다." : "관측된 출력 없음");
        outputInfo.textContent = `합본 출력 · ${offset.toLocaleString()} / ${chunk.totalBytes.toLocaleString()} bytes${gap ? " · 서버 출력 누락 구간 있음" : ""}${displayTrimmed ? " · 화면은 최근 65,536자만 표시" : ""}${hasMore ? " · 이어 읽을 출력 있음" : ""}`;
      }
    } catch (error) {
      if (valid()) {
        status.textContent = `명령 조회 실패 · ${explain(error.code) || error.message || "연결을 확인하세요"}`;
        if (["COMMANDS_DISABLED", "RUN_NOT_FOUND"].includes(error.code) || error.status === 403) { clearTimeout(timer); halted = true; commands = []; resetOutput(); selector.replaceChildren(); summary.textContent = "실행 명령"; capability.textContent = ""; }
      }
    } finally { if (valid()) { loading = false; controls(); schedule(); } }
  }
  async function mutate(kind) {
    const command = current();
    if (!identity || !command || mutating || (kind === "recover" && (!inspected.checked || !permissions.recover)) || (kind === "cancel" && !permissions.cancel)) return;
    const token = generation, id = command.id; mutating = true; loading = false; ++requestSequence; clearTimeout(timer); controls(); receipt.textContent = "요청을 전달하고 있습니다…";
    try {
      const result = await (kind === "cancel" ? cancel(identity, id) : recover(identity, id, { inspected: true }));
      if (token !== generation || id !== selectedId) return;
      if (result.command?.id !== id) throw Object.assign(new Error(), { code: "COMMAND_RESPONSE_MISMATCH" });
      const index = commands.findIndex(item => item.id === id); commands[index] = result.command;
      inspected.checked = false;
      receipt.textContent = kind === "cancel" ? result.disposition === "already_finished" ? "명령은 이미 종료 상태입니다." : "중단을 요청했습니다. 실제 종료 상태를 다시 확인합니다. 파일 변경은 되돌리지 않습니다." : "사용자의 상태 확인을 기록했습니다. 명령 결과는 변경하지 않았습니다.";
    } catch (error) { if (token === generation) receipt.textContent = `요청 실패 · ${explain(error.code) || error.message}`; }
    finally { if (token === generation) { mutating = false; controls(); void refreshState(); } }
  }
  refresh.onclick = () => { halted = false; void refreshState(); };
  more.onclick = () => void refreshState();
  restart.onclick = () => { resetOutput(); void refreshState(); };
  selector.onchange = () => { selectedId = selector.value; ++requestSequence; loading = false; resetOutput(); controls(); void refreshState(); };
  stop.onclick = () => void mutate("cancel"); acknowledge.onclick = () => void mutate("recover"); inspected.onchange = controls;
  container.ontoggle = () => { if (container.open) void refreshState(); else clearTimeout(timer); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshState(); });
  return {
    select(nextIdentity, options = {}) {
      const nextEnabled = options.enabled !== false;
      if (identity === nextIdentity && nextEnabled === enabled) return;
      identity = nextIdentity; enabled = nextEnabled; halted = false; generation++; requestSequence++; clearTimeout(timer); commands = []; permissions = {}; selectedId = undefined; loading = mutating = false; resetOutput();
      container.open = false; container.hidden = !identity || !enabled; summary.textContent = "실행 명령"; status.textContent = "펼치면 명령 상태와 출력을 권한 확인 후 조회합니다."; capability.textContent = ""; selector.replaceChildren(); controls();
    },
  };
}
