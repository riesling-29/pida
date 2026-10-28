import type { ObservationBundle, ResultManifest } from "./execution-contract.js";
export type { ObservationBundle, ResultManifest } from "./execution-contract.js";
import type {
  RunResult,
  StreamEvent,
  TraceEvent,
  SessionSummary,
  RuntimeInfo,
} from "./protocol.js";
export type {
  RunResult,
  StreamEvent,
  TraceEvent,
  RunStatus,
  SessionSummary,
  RuntimeInfo,
} from "./protocol.js";

export class PidaClientError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export interface ClientOptions {
  baseUrl: string;
  /** Pida application token, never the upstream LLM key. */
  token: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
}
export interface ChatGPTLoginStatus {
  id: string; status: "pending" | "connected" | "failed" | "cancelled"; expiresAt: number;
  authUrl?: string; manualInput?: boolean; code?: string;
}
/** Browser/Node fetch SDK. Native apps may use the same documented HTTP/SSE contract. */
export class PidaClient {
  private readonly options: ClientOptions;
  constructor(options: ClientOptions) {
    this.options = { ...options, baseUrl: options.baseUrl.replace(/\/$/, "") };
  }
  private async request(
    path: string,
    method = "GET",
    body?: object,
    signal?: AbortSignal,
  ) {
    const response = await (this.options.fetch ?? globalThis.fetch)(
      this.options.baseUrl + path,
      {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${await this.options.token()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new PidaClientError(error.error ?? "HTTP_ERROR", response.status);
    }
    return response;
  }
  private path(id: string) {
    return `/v1/sessions/${encodeURIComponent(id)}`;
  }
  async getWorkbench(): Promise<{ enabled: boolean; engine: string; revision?: string; canCheckpoint?: boolean; files: { path: string; bytes: number }[]; skills: { name: string; description: string }[]; history: { id: string; message: string }[] }> {
    return (await this.request("/v1/workbench")).json();
  }
  async readWorkspaceFile(path: string): Promise<{ path: string; content: string }> {
    return (await this.request("/v1/workbench/file?path=" + encodeURIComponent(path))).json();
  }
  async captureCheckpoint(): Promise<{ checkpoint: string; revision: string }> { return (await this.request("/v1/workbench/checkpoint", "POST", {})).json(); }
  async getChanges(base: string, head: string): Promise<{ base: string; head: string; files: string[]; diff: string; truncated: boolean }> {
    return (await this.request("/v1/workbench/changes?base=" + encodeURIComponent(base) + "&head=" + encodeURIComponent(head))).json();
  }
  async restoreCheckpoint(checkpoint: string, expectedRevision: string): Promise<{ checkpoint: string; before: string; revision: string }> {
    return (await this.request("/v1/workbench/restore", "POST", { checkpoint, expectedRevision })).json();
  }
  async writeWorkspaceFile(path: string, content: string): Promise<{ checkpoint: string }> {
    return (await this.request("/v1/workbench/file", "POST", { path, content })).json();
  }
  async getProviderSettings(): Promise<{
    provider: Record<string, unknown>;
    keyConfigured: boolean;
    chatgpt?: { connected: boolean; code?: string };
    catalog: Array<{ id: string; name: string; baseUrl?: string; apiKeyEnv: string;
      auth: "api-key"; authModes?: string[]; source: string; keyConfigured: boolean;
      models: Array<{ id: string; name: string; api: string; contextWindow: number; maxTokens: number }> }>;

  }> {
    return (await this.request("/v1/provider")).json();
  }
  async listProviderModels(
    draft: Record<string, unknown>,
  ): Promise<{ models: string[] }> {
    return (await this.request("/v1/provider/models", "POST", draft)).json();
  }
  async startChatGPTLogin(): Promise<ChatGPTLoginStatus> { return (await this.request("/v1/provider/chatgpt/login", "POST", {})).json(); }
  async getChatGPTLogin(id: string): Promise<ChatGPTLoginStatus> { return (await this.request("/v1/provider/chatgpt/login/" + encodeURIComponent(id))).json(); }
  async submitChatGPTLogin(id: string, value: string): Promise<ChatGPTLoginStatus> { return (await this.request("/v1/provider/chatgpt/login/" + encodeURIComponent(id) + "/input", "POST", { value })).json(); }
  async cancelChatGPTLogin(id: string): Promise<ChatGPTLoginStatus> { return (await this.request("/v1/provider/chatgpt/login/" + encodeURIComponent(id), "DELETE")).json(); }
  async disconnectChatGPT(): Promise<{ connected: false }> { return (await this.request("/v1/provider/chatgpt/logout", "POST", {})).json(); }
  async testProvider(
    draft: Record<string, unknown>,
  ): Promise<{ ok: boolean; scope: string }> {
    return (await this.request("/v1/provider/test", "POST", draft)).json();
  }
  async configureProvider(
    draft: Record<string, unknown>,
  ): Promise<{ applied: boolean }> {
    return (await this.request("/v1/provider", "POST", draft)).json();
  }
  async listSessions(): Promise<{ sessions: SessionSummary[] }> {
    return (await this.request("/v1/sessions")).json();
  }
  async getInfo(): Promise<RuntimeInfo> {
    return (await this.request("/v1/info")).json();
  }
  async createSession(): Promise<{ sessionId: string }> {
    return (await this.request("/v1/sessions", "POST", {})).json();
  }
  async getSession(id: string): Promise<{
    sessionId: string;
    title: string;
    lastStatus?: SessionSummary["lastStatus"];
    running: boolean;
    runs: number;
    tools: string[];
    context?: { tokens: number | null; contextWindow: number; percent: number | null };
    autoCompaction: boolean;
    messages: { role: string; text: string }[];
  }> {
    return (await this.request(this.path(id))).json();
  }
  async getTrace(id: string): Promise<{ events: TraceEvent[] }> {
    return (await this.request(this.path(id) + "/trace")).json();
  }
  async listRuns(id: string): Promise<{ runs: string[] }> { return (await this.request(this.path(id) + "/runs")).json(); }
  async exportRun(id: string, runId: string): Promise<ObservationBundle> { return (await this.request(this.path(id) + "/runs/" + encodeURIComponent(runId) + "/export")).json(); }
  async getManifest(id: string, runId: string): Promise<ResultManifest> { return (await this.request(this.path(id) + "/runs/" + encodeURIComponent(runId) + "/manifest")).json(); }
  async exportRunJsonl(id: string, runId: string): Promise<{ jsonl: string; complete: boolean }> {
    const response = await this.request(this.path(id) + "/runs/" + encodeURIComponent(runId) + "/export?format=jsonl");
    return { jsonl: await response.text(), complete: response.headers.get("X-Pida-Complete") === "true" };
  }
  async getRecovery(id: string): Promise<{ sessionId: string; autoReplay: false; pendingEffects: { id: string; runId: string; toolCallId: string; toolName: string; state: string }[] }> { return (await this.request(this.path(id) + "/recovery")).json(); }
  async compactSession(id: string, handoff = false): Promise<{ sessionId: string; compacted: boolean }> {
    return (await this.request(this.path(id) + (handoff ? "/handoff" : "/compact"), "POST", {})).json();
  }
  async cancel(id: string): Promise<void> {
    await this.request(this.path(id) + "/cancel", "POST", {});
  }
  async deleteSession(id: string): Promise<void> {
    await this.request(this.path(id), "DELETE");
  }
  async *stream(
    id: string,
    prompt: string,
    options: { signal?: AbortSignal; taskId?: string } = {},
  ): AsyncGenerator<StreamEvent> {
    const response = await this.request(
      this.path(id) + "/runs",
      "POST",
      { prompt, ...(options.taskId !== undefined ? { taskId: options.taskId } : {}) },
      options.signal,
    );
    if (!response.body) throw new PidaClientError("MISSING_STREAM", 502);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      settled = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 2_097_152)
          throw new PidaClientError("STREAM_FRAME_TOO_LARGE", 502);
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data) as StreamEvent;
          if (event.type === "result") settled = true;
          yield event;
        }
      }
      if (!settled) throw new PidaClientError("STREAM_INTERRUPTED", 502);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async run(
    id: string,
    prompt: string,
    options: {
      signal?: AbortSignal;
      taskId?: string;
      onEvent?: (event: StreamEvent) => void;
    } = {},
  ): Promise<RunResult> {
    let result: RunResult | undefined;
    for await (const event of this.stream(id, prompt, options)) {
      options.onEvent?.(event);
      if (event.type === "result") result = event.result;
    }
    if (!result) throw new PidaClientError("STREAM_INTERRUPTED", 502);
    return result;
  }
}


/** Stable, credential-free explanations shared by both bundled chat surfaces. */
export function explainError(code?: string): string {
  const messages: Record<string, string> = {
    CHATGPT_LOGIN_REQUIRED: "ChatGPT로 로그인한 뒤 모델을 선택해주세요.",
    CHATGPT_LOGIN_FAILED: "ChatGPT 로그인을 완료하지 못했습니다. 로그인과 구독 사용 권한을 확인하고 다시 시도하세요. 기존 설정은 유지됩니다.",
    CHATGPT_LOGIN_CANCELLED: "ChatGPT 로그인을 취소했습니다. 기존 연결은 유지됩니다.",
    CHATGPT_LOGIN_TIMEOUT: "ChatGPT 로그인 대기 시간이 지났습니다. 다시 시작해주세요.",
    CHATGPT_LOGIN_PORT_BUSY: "로그인용 1455 포트를 다른 Pi/Codex 로그인이 사용 중입니다. 해당 로그인을 끝내거나 취소한 뒤 다시 시도하세요.",
    CHATGPT_PLAN_NOT_AUTHORIZED: "ChatGPT 구독 사용 권한이 승인되지 않았습니다. 로그인할 때 해당 권한을 확인해주세요.",
    CHATGPT_AUTH_FAILED: "ChatGPT 계정 인증 또는 모델 접근이 거부됐습니다. 계정의 권한을 확인하고 다시 로그인해주세요.",
    CHATGPT_CONNECTION_FAILED: "ChatGPT 연결 또는 인증 갱신에 실패했습니다. 연결 상태를 확인하고 필요하면 다시 로그인해주세요.",
    CHATGPT_STORAGE_FAILED: "ChatGPT 인증 정보를 읽거나 저장하지 못했습니다. 서버의 저장 경로와 접근 권한을 확인해주세요.",
    CHATGPT_MODEL_UNAVAILABLE: "선택한 모델이 계정 또는 현재 Pi SDK에서 지원되지 않습니다. 모델 목록을 다시 불러오세요.",
    CHATGPT_LOGIN_NOT_FOUND: "로그인 요청이 만료됐거나 서버가 재시작됐습니다. 다시 로그인해주세요.",
    CHATGPT_LOGIN_NOT_WAITING: "이 로그인 요청은 주소 입력을 기다리고 있지 않습니다. 현재 로그인 상태를 확인하세요.",
    PROVIDER_BUSY: "진행 중인 작업이 끝난 뒤 모델 연결을 변경해주세요.",
    SETUP_BUSY: "이전 모델 연결 작업이나 로그인이 끝난 뒤 다시 시도해주세요.",
    OUTPUT_LIMIT: "출력 한도로 수정 명령이 중단됐습니다. 이미 저장된 변경은 유지됩니다. 요청을 나누거나 출력 한도와 실행 시간을 조정하세요.",
    EMPTY_RESPONSE: "모델이 표시할 답변을 보내지 않았습니다. 출력 한도와 모델의 추론 설정을 확인하세요.",
    RUN_TIMEOUT: "실행 시간이 초과됐습니다. 저장된 변경을 확인하고 이어서 요청하거나 실행 시간을 늘리세요.",
    UI_REVISION_CONFLICT: "화면이 다른 작업에서 변경됐습니다. 현재 화면을 다시 읽고 수정하도록 요청하세요.",
    WORKSPACE_REVISION_CONFLICT: "파일이 다른 작업에서 변경됐습니다. 새로고침 후 변경 내역을 다시 확인하세요.",
    INVALID_CHECKPOINT: "이 작업 공간에서 사용할 수 없는 변경 기준입니다. 실행 기록을 새로고침하세요.",
    GIT_OPERATION_FAILED: "파일 변경 이력을 처리하지 못했습니다. 현재 파일과 Git 이력 상태를 확인하세요.",
    COMPACTION_FAILED: "대화 압축에 실패했습니다. 기존 대화는 유지됩니다. 모델 상태와 출력 한도를 확인하세요.",
    HANDOFF_TOO_LARGE: "인계할 맥락이 아직 큽니다. 작업을 정리한 뒤 다시 시도하세요. 기존 대화는 유지됩니다.",
    NOTHING_TO_COMPACT: "아직 압축할 대화가 없습니다.",
    PROVIDER_TEST_OUTPUT_LIMIT: "서버에는 연결됐지만 연결 테스트 응답이 출력 한도에 도달했습니다.",
    PROVIDER_TEST_TIMEOUT: "연결 테스트가 시간 내에 끝나지 않았습니다. 모델 로딩 상태를 확인하세요.",
    TOOL_FAILED: "도구 실행에 실패했습니다. 현재 파일과 실행 기록을 확인하고 다시 요청하세요.",
    EFFECT_STATE_UNKNOWN: "이전 변경의 적용 여부를 확인할 수 없어 추가 변경을 막았습니다. 실행 기록과 실제 대상을 확인한 뒤 복구하세요.",
    TOOL_REPLAY_BLOCKED: "같은 실행에서 이미 적용한 변경의 중복 호출을 막았습니다. 현재 상태를 읽고 남은 작업을 요청하세요.",
    EFFECT_PERSISTENCE_FAILED: "변경 실행 기록을 저장하지 못했습니다. 저장소와 실제 변경 상태를 확인하세요.",
    TOKEN_BUDGET: "이 실행의 토큰 예산에 도달했습니다. 현재 변경을 확인하고 요청을 나누세요.",
    COST_BUDGET: "이 실행의 설정된 비용 예산에 도달했습니다.",
    USAGE_UNAVAILABLE: "사용량을 확인할 수 없어 설정된 실행 예산을 적용할 수 없습니다.",
    WORKSPACE_OPERATION_FAILED: "작업 공간의 도구 실행에 실패했습니다. 현재 파일과 실행 기록을 확인하세요.",
    TEST_FAILED: "테스트가 실패했습니다. 실패 내용을 확인하고 수정한 뒤 같은 테스트를 다시 실행하세요.",
    UI_EDIT_MATCH_REQUIRED: "수정할 문구가 없거나 여러 곳에 있습니다. 현재 화면을 다시 읽고 수정 위치를 지정하도록 요청하세요.",
    PERSISTENCE_FAILED: "실행 상태를 저장하지 못했습니다. 현재 변경을 확인하고 저장소 문제를 해결한 뒤 재개하세요.",
    SESSION_RUN_LIMIT: "이 대화의 실행 횟수 한도에 도달했습니다. ‘요약해서 이어가기’를 사용하세요.",
    CANCELLED: "작업을 중단했습니다. 이미 저장된 변경은 유지됩니다.",
  };
  return messages[code ?? ""] ?? `작업을 완료하지 못했습니다 (${code ?? "UNKNOWN_ERROR"}).`;
}
