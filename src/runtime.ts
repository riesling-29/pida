import { randomUUID } from "node:crypto";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import type { ProviderFactory } from "./providers.js";
import type {
  RunStatus,
  RunResult,
  TraceEvent,
  StreamEvent,
} from "./protocol.js";
export type {
  RunStatus,
  RunResult,
  TraceEvent,
  StreamEvent,
} from "./protocol.js";

export interface Principal {
  id: string;
  permissions: readonly string[];
}
export interface ToolContext {
  principal: Principal;
  sessionId: string;
  runId: string;
  signal: AbortSignal;
}
export interface BusinessTool<T extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: T;
  permission: string;
  execute(args: Static<T>, context: ToolContext): Promise<unknown>;
}
export function defineBusinessTool<T extends TSchema>(
  tool: BusinessTool<T>,
): BusinessTool<T> {
  return tool;
}
export interface AuthorizationRequest {
  principal: Principal;
  toolName: string;
  args: unknown;
  sessionId: string;
  signal: AbortSignal;
}
export class PidaError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export interface RuntimeOptions {
  provider: ProviderFactory;
  tools?: readonly BusinessTool<any>[];
  /** Additional deny-capable host policy, after the permission check. */
  authorize?: (request: AuthorizationRequest) => boolean | Promise<boolean>;
  systemPrompt?: string;
  maxSessions?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  maxRunMs?: number;
  maxTraceEvents?: number;
  maxRunsPerSession?: number;
}
interface ActiveRun {
  id: string;
  principal: Principal;
  abort: AbortController;
  status?: RunStatus;
  code?: string;
  toolCalls: number;
  turns: number;
}
interface SessionRecord {
  id: string;
  owner: string;
  pi: AgentSession;
  traces: TraceEvent[];
  nextSequence: number;
  active?: ActiveRun;
  runs: number;
  finished?: Promise<void>;
  deleting?: boolean;
}
function positive(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error("Limits must be positive integers");
  return n;
}
function principalCopy(p: Principal): Principal {
  if (
    !p?.id ||
    !Array.isArray(p.permissions) ||
    !p.permissions.every((s) => typeof s === "string")
  )
    throw new PidaError("UNAUTHORIZED", 401);
  return Object.freeze({
    id: p.id,
    permissions: Object.freeze([...p.permissions]),
  });
}
function loader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** Trusted host SDK. The HTTP layer, not browser input, supplies authenticated principals. */
export class PidaRuntime {
  private readonly sessions = new Map<string, SessionRecord>();
  private pendingSessions = 0;
  private closed = false;
  private readonly limits;
  private readonly options: RuntimeOptions;
  constructor(options: RuntimeOptions) {
    this.options = { ...options, tools: [...(options.tools ?? [])] };
    const names = new Set<string>();
    for (const tool of this.options.tools!) {
      if (
        !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) ||
        !tool.permission ||
        names.has(tool.name) ||
        [
          "read",
          "write",
          "edit",
          "bash",
          "grep",
          "find",
          "ls",
          "powershell",
          "codemode",
          "tool_search",
        ].includes(tool.name)
      )
        throw new Error(
          "Invalid, duplicate, or reserved business tool name/permission",
        );
      names.add(tool.name);
    }
    this.limits = {
      sessions: positive(options.maxSessions, 100),
      turns: positive(options.maxTurns, 8),
      toolCalls: positive(options.maxToolCalls, 16),
      runMs: positive(options.maxRunMs, 60_000),
      traces: positive(options.maxTraceEvents, 1000),
      runs: positive(options.maxRunsPerSession, 100),
    };
  }
  async createSession(principal: Principal): Promise<{ sessionId: string }> {
    const p = principalCopy(principal);
    if (this.closed) throw new PidaError("RUNTIME_CLOSED", 503);
    if (this.sessions.size + this.pendingSessions >= this.limits.sessions)
      throw new PidaError("SESSION_LIMIT", 429);
    this.pendingSessions++;
    try {
      const binding = await this.options.provider();
      const models = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      models.registerNativeProvider(binding.provider);
      await models.getAvailable(binding.provider.id);
      const model = models.getModel(binding.provider.id, binding.modelId);
      if (!model) throw new Error("Configured model not found");
      const manager = SessionManager.inMemory();
      const id = manager.getSessionId();
      let record: SessionRecord;
      const customTools: ToolDefinition[] = this.options.tools!.map((tool) => ({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        executionMode: "sequential",
        execute: async (_callId, args, signal) => {
          const run = record.active;
          if (!run) throw new Error("NO_ACTIVE_RUN");
          const combined = signal
            ? AbortSignal.any([signal, run.abort.signal])
            : run.abort.signal;
          combined.throwIfAborted();
          if (++run.toolCalls > this.limits.toolCalls) {
            run.status = "limited";
            run.code = "TOOL_LIMIT";
            run.abort.abort();
            throw new Error("TOOL_LIMIT");
          }
          try {
            const allowed =
              run.principal.permissions.includes(tool.permission) &&
              (!this.options.authorize ||
                (await this.options.authorize({
                  principal: run.principal,
                  toolName: tool.name,
                  args,
                  sessionId: id,
                  signal: combined,
                })));
            combined.throwIfAborted();
            if (!allowed) {
              run.status = "failed";
              run.code = "TOOL_FORBIDDEN";
              throw new Error("TOOL_FORBIDDEN");
            }
            const value = await tool.execute(args, {
              principal: run.principal,
              sessionId: id,
              runId: run.id,
              signal: combined,
            });
            combined.throwIfAborted();
            const text = JSON.stringify(value ?? null);
            if (text.length > 32_768) throw new Error("TOOL_RESULT_TOO_LARGE");
            return { content: [{ type: "text" as const, text }], details: {} };
          } catch {
            if (!run.status) {
              run.status = "failed";
              run.code = "TOOL_FAILED";
            }
            throw new Error(run.code ?? "TOOL_FAILED");
          }
        },
      }));
      const { session } = await createAgentSession({
        modelRuntime: models,
        model,
        thinkingLevel: "off",
        resourceLoader: loader(
          this.options.systemPrompt ??
            "You are a business assistant. Use only provided business tools. Report missing evidence and tool errors honestly.",
        ),
        sessionManager: manager,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false, provider: { maxRetries: 0 } },
          cacheWarming: "off",
          httpIdleTimeoutMs: this.limits.runMs,
        }),
        tools: customTools.map((t) => t.name),
        noTools: "builtin",
        customTools,
      });
      if (this.closed) {
        session.dispose();
        throw new PidaError("RUNTIME_CLOSED", 503);
      }
      record = {
        id,
        owner: p.id,
        pi: session,
        traces: [],
        nextSequence: 1,
        runs: 0,
      };
      const piPrepareRequest = session.agent.prepareRequest;
      session.agent.prepareRequest = async (request, signal) => {
        record.active?.abort.signal.throwIfAborted();
        const result = await piPrepareRequest?.(request, signal);
        record.active?.abort.signal.throwIfAborted();
        return result ?? undefined;
      };
      const piFinishTurn = session.agent.finishTurn;
      session.agent.finishTurn = async (turn, signal) => {
        const decision = await piFinishTurn?.(turn, signal);
        const run = record.active;
        if (run?.status) return { action: "end" };
        if (
          run &&
          run.turns >= this.limits.turns &&
          turn.message.content.some((b) => b.type === "toolCall")
        ) {
          run.status = "limited";
          run.code = "TURN_LIMIT";
          return { action: "end" };
        }
        return decision ?? undefined;
      };
      this.sessions.set(id, record);
      return { sessionId: id };
    } finally {
      this.pendingSessions--;
    }
  }
  private owned(id: string, principal: Principal): SessionRecord {
    const p = principalCopy(principal),
      record = this.sessions.get(id);
    if (!record || record.owner !== p.id)
      throw new PidaError("SESSION_NOT_FOUND", 404);
    return record;
  }
  getSession(id: string, principal: Principal) {
    const s = this.owned(id, principal);
    return {
      sessionId: id,
      running: !!s.active,
      runs: s.runs,
      tools: s.pi.getActiveToolNames(),
      messages: s.pi.messages.flatMap((m) => {
        if (m.role !== "user" && m.role !== "assistant") return [];
        return [
          {
            role: m.role,
            text:
              typeof m.content === "string"
                ? m.content
                : m.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join(""),
          },
        ];
      }),
    };
  }
  getTrace(id: string, principal: Principal): TraceEvent[] {
    return structuredClone(this.owned(id, principal).traces);
  }

  async run(
    id: string,
    principal: Principal,
    prompt: string,
    onEvent?: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    const record = this.owned(id, principal);
    if (this.closed) throw new PidaError("RUNTIME_CLOSED", 503);
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 16_000)
      throw new PidaError("INVALID_PROMPT", 400);
    if (record.deleting) throw new PidaError("SESSION_NOT_FOUND", 404);
    if (record.active) throw new PidaError("SESSION_BUSY", 409);
    if (record.runs >= this.limits.runs)
      throw new PidaError("SESSION_RUN_LIMIT", 429);
    if (signal?.aborted) throw new PidaError("REQUEST_ABORTED", 400);
    const run: ActiveRun = {
      id: randomUUID(),
      principal: principalCopy(principal),
      abort: new AbortController(),
      toolCalls: 0,
      turns: 0,
    };
    const priorMessages = record.pi.messages.length;
    record.active = run;
    record.runs++;
    let finish!: () => void;
    record.finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stop = (status: RunStatus, code: string) => {
      run.status = status;
      run.code = code;
      run.abort.abort();
      record.pi.agent.abort();
    };
    const emit = (event: StreamEvent) => {
      try {
        onEvent?.(event);
      } catch {
        stop("cancelled", "CONSUMER_DISCONNECTED");
      }
    };
    const trace = (type: string, extra: Partial<TraceEvent> = {}) => {
      const event: TraceEvent = {
        sequence: record.nextSequence++,
        timestamp: new Date().toISOString(),
        sessionId: id,
        runId: run.id,
        type,
        ...extra,
      };
      record.traces.push(event);
      if (record.traces.length > this.limits.traces) record.traces.shift();
      emit({ type: "trace", trace: { ...event } });
    };
    const externalAbort = () => stop("cancelled", "CANCELLED");
    signal?.addEventListener("abort", externalAbort, { once: true });
    const timer = setTimeout(
      () => stop("limited", "RUN_TIMEOUT"),
      this.limits.runMs,
    );
    const unsubscribe = record.pi.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      )
        emit({ type: "text_delta", delta: event.assistantMessageEvent.delta });
      if (event.type === "turn_start") {
        run.turns++;
        trace("turn_started");
      }
      if (event.type === "tool_execution_start")
        trace("tool_started", { toolName: event.toolName });
      if (event.type === "tool_execution_end") {
        trace(event.isError ? "tool_failed" : "tool_completed", {
          toolName: event.toolName,
        });
        if (event.isError && !run.status) {
          run.status = "failed";
          run.code = "TOOL_FAILED";
        }
      }
      if (
        event.type === "message_end" &&
        event.message.role === "assistant" &&
        ["error", "aborted"].includes(event.message.stopReason)
      ) {
        if (!run.status) {
          run.status = "failed";
          run.code = "PROVIDER_FAILED";
        }
      }
    });
    trace("run_started");
    try {
      if (!run.abort.signal.aborted)
        await record.pi.prompt(prompt, { expandPromptTemplates: false });
    } catch {
      if (!run.status) {
        run.status = "failed";
        run.code = "RUN_FAILED";
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", externalAbort);
      unsubscribe();
    }
    const lastAssistant = record.pi.messages
      .slice(priorMessages)
      .reverse()
      .find((m) => m.role === "assistant");
    const text =
      lastAssistant?.role === "assistant"
        ? lastAssistant.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
        : "";
    const result: RunResult = {
      runId: run.id,
      sessionId: id,
      status: run.status ?? "completed",
      text,
      ...(run.code ? { code: run.code } : {}),
    };
    trace("run_finished", { status: result.status, code: result.code });
    record.active = undefined;
    finish();
    emit({ type: "result", result });
    return result;
  }
  async cancel(id: string, principal: Principal): Promise<void> {
    const record = this.owned(id, principal);
    if (record.active) {
      record.active.status = "cancelled";
      record.active.code = "CANCELLED";
      record.active.abort.abort();
      await record.pi.abort();
      await record.finished;
    }
  }
  async deleteSession(id: string, principal: Principal): Promise<void> {
    const record = this.owned(id, principal);
    record.deleting = true;
    await this.cancel(id, principal);
    record.pi.dispose();
    this.sessions.delete(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.sessions.values()].map((r) =>
        this.deleteSession(r.id, { id: r.owner, permissions: [] }),
      ),
    );
  }
}
