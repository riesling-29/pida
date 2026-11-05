/** Display-only labels for TUI; stored/API enum values are unchanged. */

export const statusDisplayNames: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  completed: "실행 완료",
  failed: "실행 실패",
  cancelled: "요청으로 중단됨",
  interrupted: "서버 종료로 끊김 · 확인 필요",
  limited: "실행 한도 도달",
};

/** Single-session status line when verification is not yet composed elsewhere. */
export const sessionStatusDisplayNames: Record<string, string> = {
  ...statusDisplayNames,
  completed: "실행 완료 · 독립 검증 미확인",
};

export const traceEventDisplayNames: Record<string, string> = {
  run_started: "실행 시작",
  run_context_loaded: "실행 맥락 불러옴",
  turn_started: "모델 응답 대기",
  turn_finished: "모델 응답 끝",
  model_request: "모델 요청",
  model_response: "모델 응답 수신",
  tool_started: "도구 실행 시작",
  tool_completed: "도구 실행 완료",
  tool_failed: "도구 실행 실패",
  run_finished: "실행 종료",
  run_interrupted: "서버 종료로 끊김",
  retry_scheduled: "모델 재시도 대기",
  retry_finished: "모델 재시도 결과",
  summarization_retry_scheduled: "압축 재시도 대기",
  summarization_retry_attempt_start: "압축 재시도 시작",
  summarization_retry_finished: "압축 재시도 결과",
  compaction_started: "대화 압축 시작",
  auto_compaction_start: "대화 압축 시작",
  compaction_completed: "대화 압축 완료",
  compaction_failed: "대화 압축 실패",
  output_retry: "출력 한도 후 재시도",
};

export function displayStatus(value: string | undefined): string {
  if (!value) return "";
  return statusDisplayNames[value] ?? value;
}

export function displayTraceEvent(type: string): string {
  return traceEventDisplayNames[type] ?? type;
}

export function verificationStatusLabel(status: string | undefined): string {
  if (!status || status === "UNKNOWN") return "독립 검증 미확인 · UNKNOWN";
  if (status === "PASS" || status === "PASSED") return "검증 통과";
  if (status === "FAIL" || status === "FAILED") return "검증 실패";
  return status;
}

export function verificationCheckStatusLabel(status: string): string {
  if (status === "PASSED") return "검증 통과";
  if (status === "FAILED") return "검증 실패";
  return status;
}

export function formatTraceActivityLine(
  timestamp: string,
  event: { type: string; toolName?: string; code?: string; status?: string },
  formatTime: (iso: string) => string,
): string {
  const typeLabel = displayTraceEvent(event.type);
  const statusRaw = event.code ?? event.status;
  const statusLabel = statusRaw ? displayStatus(statusRaw) : "";
  let line = `${formatTime(timestamp)} ${typeLabel}`;
  if (event.toolName) line += ` · ${event.toolName}`;
  if (statusLabel) line += ` · ${statusLabel}`;
  const raw = [event.type, statusRaw].filter(Boolean).join(" ");
  if (raw) line += ` · ${raw}`;
  return line;
}
