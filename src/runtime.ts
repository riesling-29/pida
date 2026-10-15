import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { SessionStore, type SavedSession } from "./storage.js";
import type { SessionSummary, RuntimeInfo } from "./protocol.js";
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
  SessionSummary,
  RuntimeInfo,
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
  /** Dedicated private directory. One runtime/process at a time; unset keeps memory-only behavior. */
  storageDir?: string;
  /** Safe display labels only: never endpoint URLs or credentials. */
  providerInfo?: { mode: string; model: string };
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
  saved: SavedSession;
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
  private readonly store?: SessionStore;
  private readonly loading = new Map<string, Promise<{ sessionId: string }>>();
  private readonly creating = new Set<Promise<{ sessionId: string }>>();
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
    if (options.storageDir) this.store = new SessionStore(options.storageDir);
  }
  async createSession(principal: Principal): Promise<{ sessionId: string }> {
    const task = this.openSession(principal);
    this.creating.add(task);
    try {
      return await task;
    } finally {
      this.creating.delete(task);
    }
  }
  private async openSession(
    principal: Principal,
    saved?: SavedSession,
  ): Promise<{ sessionId: string }> {
    const p = principalCopy(principal);
    if (this.closed) throw new PidaError("RUNTIME_CLOSED", 503);
    if (
      !saved &&
      (this.store?.list().length ?? this.sessions.size) +
        this.pendingSessions >=
        this.limits.sessions
    )
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
      let manager: SessionManager;
      if (this.store) {
        const file = saved && join(this.store.piDirectory, saved.piFile);
        if (file && existsSync(file))
          manager = SessionManager.open(file, this.store.piDirectory);
        else {
          if (saved?.hasTranscript)
            throw new PidaError("SESSION_FILE_MISSING", 500);
          manager = SessionManager.create(
            process.cwd(),
            this.store.piDirectory,
            saved ? { id: saved.sessionId } : undefined,
          );
        }
      } else manager = SessionManager.inMemory();
      const id = manager.getSessionId();
      if (saved && id !== saved.sessionId)
        throw new PidaError("SESSION_FILE_MISMATCH", 500);
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
        traces: saved?.traces.slice(-this.limits.traces) ?? [],
        nextSequence: saved?.nextSequence ?? 1,
        runs: saved?.runs ?? 0,
        saved: saved ?? {
          version: 1,
          sessionId: id,
          owner: p.id,
          piFile: manager.getSessionFile()
            ? basename(manager.getSessionFile()!)
            : "memory.jsonl",
          title: "새 대화",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          running: false,
          runs: 0,
          nextSequence: 1,
          traces: [],
        },
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
      record.saved.piFile = manager.getSessionFile()
        ? basename(manager.getSessionFile()!)
        : "memory.jsonl";
      try {
        this.persist(record);
      } catch (error) {
        session.dispose();
        throw error;
      }
      this.sessions.set(id, record);
      return { sessionId: id };
    } finally {
      this.pendingSessions--;
    }
  }
  private persist(record: SessionRecord): void {
    record.saved.runs = record.runs;
    record.saved.running = !!record.active;
    record.saved.nextSequence = record.nextSequence;
    record.saved.traces = record.traces;
    if (this.store) {
      record.saved.hasTranscript = existsSync(
        join(this.store.piDirectory, record.saved.piFile),
      );
      this.store.save(record.saved);
    }
  }
  /** Restore a saved Pi session lazily. Ownership is verified before reading its transcript. */
  async resumeSession(
    id: string,
    principal: Principal,
  ): Promise<{ sessionId: string }> {
    const p = principalCopy(principal);
    if (this.closed) throw new PidaError("RUNTIME_CLOSED", 503);
    if (this.sessions.has(id)) {
      this.owned(id, p);
      return { sessionId: id };
    }
    const saved = this.store?.get(id);
    if (!saved || saved.owner !== p.id)
      throw new PidaError("SESSION_NOT_FOUND", 404);
    let task = this.loading.get(id);
    if (!task) {
      task = this.openSession(p, saved);
      this.loading.set(id, task);
    }
    try {
      return await task;
    } finally {
      this.loading.delete(id);
    }
  }
  listSessions(principal: Principal): SessionSummary[] {
    const p = principalCopy(principal);
    const all = new Map(
      (this.store?.list() ?? []).map((s) => [s.sessionId, s]),
    );
    for (const r of this.sessions.values())
      all.set(r.id, { ...r.saved, running: !!r.active, runs: r.runs });
    return [...all.values()]
      .filter((s) => s.owner === p.id)
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        running: s.running,
        runs: s.runs,
        lastStatus: s.lastStatus,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getInfo(principal: Principal): RuntimeInfo {
    const p = principalCopy(principal);
    return {
      persistence: !!this.store,
      provider: this.options.providerInfo,
      tools: this.options.tools!.map((t) => ({
        name: t.name,
        description: t.description,
        permitted: p.permissions.includes(t.permission),
      })),
    };
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
      title: s.saved.title,
      lastStatus: s.saved.lastStatus,
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
    if (!this.sessions.has(id)) await this.resumeSession(id, principal);
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
    record.saved.title =
      record.runs === 1 ? prompt.trim().slice(0, 80) : record.saved.title;
    record.saved.updatedAt = new Date().toISOString();
    try {
      this.persist(record);
    } catch {
      record.active = undefined;
      record.runs--;
      throw new PidaError("PERSISTENCE_FAILED", 500);
    }
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
    const trace = (
      type: string,
      extra: Partial<TraceEvent> = {},
      publish = true,
    ) => {
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
      if (publish) emit({ type: "trace", trace: { ...event } });
      return event;
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
    const finalTrace = trace(
      "run_finished",
      { status: result.status, code: result.code },
      false,
    );
    record.active = undefined;
    record.saved.lastStatus = result.status;
    record.saved.updatedAt = new Date().toISOString();
    try {
      this.persist(record);
    } catch {
      result.status = "failed";
      result.code = "PERSISTENCE_FAILED";
      finalTrace.status = "failed";
      finalTrace.code = "PERSISTENCE_FAILED";
      record.saved.lastStatus = "failed";
    }
    finish();
    emit({ type: "trace", trace: { ...finalTrace } });
    emit({ type: "result", result });
    return result;
  }
  async cancel(id: string, principal: Principal): Promise<void> {
    if (!this.sessions.has(id)) await this.resumeSession(id, principal);
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
    // Deleting an unloaded session needs no provider credentials.
    if (!this.sessions.has(id) && !this.loading.has(id)) {
      const p = principalCopy(principal),
        saved = this.store?.get(id);
      if (!saved || saved.owner !== p.id)
        throw new PidaError("SESSION_NOT_FOUND", 404);
      this.store!.remove(id);
      return;
    }
    if (this.loading.has(id)) await this.resumeSession(id, principal);
    const record = this.owned(id, principal);
    record.deleting = true;
    await this.cancel(id, principal);
    record.pi.dispose();
    this.store?.remove(id);
    this.sessions.delete(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.creating, ...this.loading.values()]);
    try {
      await Promise.all(
        [...this.sessions.values()].map(async (r) => {
          await this.cancel(r.id, { id: r.owner, permissions: [] });
          r.pi.dispose();
        }),
      );
      this.sessions.clear();
    } finally {
      this.store?.close();
    }
  }
}
