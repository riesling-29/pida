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
    messages: { role: string; text: string }[];
  }> {
    return (await this.request(this.path(id))).json();
  }
  async getTrace(id: string): Promise<{ events: TraceEvent[] }> {
    return (await this.request(this.path(id) + "/trace")).json();
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
