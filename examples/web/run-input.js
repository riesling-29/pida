import { submitQueuedInput } from "/run-state.js";

/** The receipt confirms admission to Pi's live queue, never durable execution. */
export function createRunInput({ client, run, textarea, selector, section, note, receipt, changed, explain }) {
  let sending = false, capabilities = {}, serial = 0;
  const labels = { steer: "추가 지시", followUp: "다음 요청" };
  function sync(value = capabilities) {
    capabilities = value;
    section.hidden = !run.running;
    const steering = capabilities.steering === true, followUp = capabilities.followUp === true;
    for (const option of selector.options) option.disabled = option.value === "steer" ? !steering : !followUp;
    if ((steering || followUp) && selector.selectedOptions[0]?.disabled) selector.value = steering ? "steer" : "followUp";
    selector.disabled = sending || run.cancelling || !run.runId || !(steering || followUp);
    const queue = run.pendingInput;
    note.textContent = run.cancelling ? "중단 요청 중 · 추가 입력을 받지 않습니다."
      : !(steering || followUp) ? "이 호스트는 실행 중 입력을 제공하지 않습니다."
      : !run.runId ? "실행 식별자를 기다리고 있습니다."
      : `추가 지시는 다음 도구 경계에, 다음 요청은 현재 작업 뒤에 전달합니다. ${queue ? `대기: 추가 지시 ${queue.steering ?? 0} · 다음 요청 ${queue.followUp ?? 0}. ` : ""}실행 중 입력은 서버 재시작 시 유지되지 않습니다.`;
  }
  selector.onchange = () => changed();
  return {
    get sending() { return sending; },
    get canSubmit() { return run.running && !!run.runId && !run.cancelling && !sending && capabilities[selector.value === "steer" ? "steering" : "followUp"] === true; },
    get label() { return labels[selector.value] ?? labels.steer; },
    sync,
    reset() { serial++; sending = false; receipt.textContent = ""; sync(); },
    async submit() {
      if (!this.canSubmit || !textarea.value.trim()) return;
      const raw = textarea.value, text = raw.trim(), mode = selector.value, request = ++serial;
      sending = true; receipt.textContent = `${labels[mode]}를 보내고 있습니다…`; changed();
      try {
        const response = await submitQueuedInput({ client, state: run, mode, text });
        if (request !== serial) return;
        if (!response.current) { receipt.textContent = "접수 응답 이후 실행 상태가 바뀌었습니다. 입력을 보존했습니다. 실행 기록을 확인하세요."; return; }
        // A user may already be writing another request while this receipt is in flight.
        if (textarea.value === raw) textarea.value = "";
        receipt.textContent = `${labels[mode]} 접수됨 · ${response.receipt.disposition === "queued" ? "전달 대기" : "호스트에 전달됨"} · 실행 완료를 뜻하지 않습니다. 서버 재시작 시 유지되지 않습니다.`;
      } catch (error) {
        if (request === serial) receipt.textContent = `접수하지 못했습니다 · ${explain(error.code) || error.message || "요청 실패"}. 입력을 보존했습니다.`;
      } finally {
        if (request === serial) { sending = false; sync(); changed(); }
      }
    },
  };
}
