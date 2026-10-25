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
  async getWorkbench(): Promise<{ enabled: boolean; engine: string; files: { path: string; bytes: number }[]; skills: { name: string; description: string }[]; history: { id: string; message: string }[] }> {
    return (await this.request("/v1/workbench")).json();
  }
  async readWorkspaceFile(path: string): Promise<{ path: string; content: string }> {
    return (await this.request("/v1/workbench/file?path=" + encodeURIComponent(path))).json();
  }
  async writeWorkspaceFile(path: string, content: string): Promise<{ checkpoint: string }> {
    return (await this.request("/v1/workbench/file", "POST", { path, content })).json();
  }
  async getProviderSettings(): Promise<{
    provider: Record<string, unknown>;
    keyConfigured: boolean;
    catalog: Array<{ id: string; name: string; baseUrl?: string; apiKeyEnv: string;
      auth: "api-key"; source: string; keyConfigured: boolean;
      models: Array<{ id: string; name: string; api: string; contextWindow: number; maxTokens: number }> }>;

  }> {
    return (await this.request("/v1/provider")).json();
  }
  async listProviderModels(
    draft: Record<string, unknown>,
  ): Promise<{ models: string[] }> {
    return (await this.request("/v1/provider/models", "POST", draft)).json();
  }
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
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<StreamEvent> {
    const response = await this.request(
      this.path(id) + "/runs",
      "POST",
      { prompt },
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
    OUTPUT_LIMIT: "출력 한도로 수정 명령이 중단됐습니다. 이미 저장된 변경은 유지됩니다. 요청을 나누거나 출력 한도와 실행 시간을 조정하세요.",
    EMPTY_RESPONSE: "모델이 표시할 답변을 보내지 않았습니다. 출력 한도와 모델의 추론 설정을 확인하세요.",
    RUN_TIMEOUT: "실행 시간이 초과됐습니다. 저장된 변경을 확인하고 이어서 요청하거나 실행 시간을 늘리세요.",
    UI_REVISION_CONFLICT: "화면이 다른 작업에서 변경됐습니다. 현재 화면을 다시 읽고 수정하도록 요청하세요.",
    COMPACTION_FAILED: "대화 압축에 실패했습니다. 기존 대화는 유지됩니다. 모델 상태와 출력 한도를 확인하세요.",
    HANDOFF_TOO_LARGE: "인계할 맥락이 아직 큽니다. 작업을 정리한 뒤 다시 시도하세요. 기존 대화는 유지됩니다.",
    NOTHING_TO_COMPACT: "아직 압축할 대화가 없습니다.",
    PROVIDER_TEST_OUTPUT_LIMIT: "서버에는 연결됐지만 연결 테스트 응답이 출력 한도에 도달했습니다.",
    PROVIDER_TEST_TIMEOUT: "연결 테스트가 시간 내에 끝나지 않았습니다. 모델 로딩 상태를 확인하세요.",
    TOOL_FAILED: "도구 실행에 실패했습니다. 현재 파일과 실행 기록을 확인하고 다시 요청하세요.",
    WORKSPACE_OPERATION_FAILED: "작업 공간의 도구 실행에 실패했습니다. 현재 파일과 실행 기록을 확인하세요.",
    TEST_FAILED: "테스트가 실패했습니다. 실패 내용을 확인하고 수정한 뒤 같은 테스트를 다시 실행하세요.",
    UI_EDIT_MATCH_REQUIRED: "수정할 문구가 없거나 여러 곳에 있습니다. 현재 화면을 다시 읽고 수정 위치를 지정하도록 요청하세요.",
    PERSISTENCE_FAILED: "실행 상태를 저장하지 못했습니다. 현재 변경을 확인하고 저장소 문제를 해결한 뒤 재개하세요.",
    SESSION_RUN_LIMIT: "이 대화의 실행 횟수 한도에 도달했습니다. ‘요약해서 이어가기’를 사용하세요.",
    CANCELLED: "작업을 중단했습니다. 이미 저장된 변경은 유지됩니다.",
  };
  return messages[code ?? ""] ?? `작업을 완료하지 못했습니다 (${code ?? "UNKNOWN_ERROR"}).`;
}
