import type { ProgramRegistry } from "./program-registry.js";
import type { AgentSupervisor } from "./agent-supervisor.js";
import type { AgentMemoryStore } from "./agent-memory.js";
import type { ProjectView } from "./project-view.js";
import type { ProviderConnectorManifest } from "./provider-connector.js";
import type { PidaWorkbench } from "./workbench.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { uiFrame, uiFramePolicy } from "./ui-frame.js";
import { readFile } from "node:fs/promises";
import type { ProviderSettings } from "./provider-settings.js";
import { PidaError, type PidaRuntime, type Principal } from "./runtime.js";

export interface HttpOptions {
  runtime: PidaRuntime;
  workbench?: PidaWorkbench;
  agents?: AgentSupervisor;
  agentMemory?: (agentId: string) => AgentMemoryStore;
  agentWorkbench?: (agentId: string) => PidaWorkbench;
  projectView?: ProjectView;
  programs?: ProgramRegistry;
  connector?: ProviderConnectorManifest;
  /** Optional local workspace administration; never enable for arbitrary tenant users. */
  providerSettings?: ProviderSettings;
  /** Verify a bearer token with the host identity service. Never trust body claims. */
  authenticate: (
    token: string,
  ) => Principal | undefined | Promise<Principal | undefined>;
  allowedOrigin?: string;
  /** Explicitly opt in to serving the bundled demo at /. */
  serveDemo?: boolean;
}
export function staticTokenAuth(
  entries: readonly { token: string; principal: Principal }[],
) {
  const records = entries.map(({ token, principal }) => {
    if (token.length < 32)
      throw new Error("API tokens must contain at least 32 characters");
    return {
      digest: createHash("sha256").update(token).digest(),
      principal: structuredClone(principal),
    };
  });
  return (token: string): Principal | undefined => {
    const digest = createHash("sha256").update(token).digest();
    const found = records.find((r) => timingSafeEqual(r.digest, digest));
    return found ? structuredClone(found.principal) : undefined;
  };
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage, limit = 32_768): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new PidaError("JSON_REQUIRED", 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new PidaError("BODY_TOO_LARGE", 413);
    chunks.push(Buffer.from(chunk));
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PidaError("INVALID_JSON", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PidaError("INVALID_BODY", 400);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new PidaError("UNKNOWN_FIELD", 400);
}

export function createPidaServer(options: HttpOptions) {
  const { runtime } = options;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      if (req.headers.origin && req.headers.origin !== options.allowedOrigin)
        throw new PidaError("ORIGIN_FORBIDDEN", 403);
      if (req.headers.origin && options.allowedOrigin) {
        res.setHeader("Access-Control-Allow-Origin", options.allowedOrigin);
        res.setHeader("Vary", "Origin");
      }
      if (
        req.method === "OPTIONS" &&
        req.headers.origin === options.allowedOrigin &&
        options.allowedOrigin
      ) {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, DELETE",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        });
        res.end();
        return;
      }
      const path = new URL(req.url ?? "/", "http://pida.invalid").pathname;
      if (req.method === "GET" && path === "/health") {
        json(res, 200, { status: "ok" });
        return;
      }
      if (
        options.serveDemo &&
        req.method === "GET" && path === "/studio-frame.html"
      ) {
        const nonce = randomBytes(24).toString("base64");
        res.setHeader("Content-Security-Policy", uiFramePolicy(nonce));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(uiFrame(nonce)); return;
      }
      if (
        options.serveDemo &&
        req.method === "GET" &&
        ["/", "/app.js", "/studio.js", "/agents.js", "/run-state.js", "/run-input.js", "/run-details.js", "/style.css", "/pida-client.js"].includes(path)
      ) {
        const file = path === "/" ? "index.html" : path.slice(1);
        const contents = await readFile(
          new URL(
            path === "/pida-client.js"
              ? "./client.js"
              : `../examples/web/${file}`,
            import.meta.url,
          ),
        );
        res.writeHead(200, {
          "Content-Type":
            path === "/"
              ? "text/html; charset=utf-8"
              : path.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/css; charset=utf-8",
        });
        res.end(contents);
        return;
      }
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ") || auth.length > 4096)
        throw new PidaError("UNAUTHORIZED", 401);
      const principal = await options.authenticate(auth.slice(7));
      if (!principal) throw new PidaError("UNAUTHORIZED", 401);
      if (path === "/v1/programs" && req.method === "GET") {
        json(res, 200, options.programs?.list(principal) ?? { enabled: [] }); return;
      }
      if (path === "/v1/programs/draft" && req.method === "POST") {
        if (!options.programs) throw new PidaError("PROGRAMS_UNAVAILABLE", 404);
        const input = await body(req); keys(input, ["candidateId", "sourceDigest"]);
        if (typeof input.candidateId !== "string" || typeof input.sourceDigest !== "string") throw new PidaError("INVALID_BODY", 400);
        json(res, 200, options.programs.draft(principal, input.candidateId, input.sourceDigest)); return;
      }
      if (path === "/v1/project" || path.startsWith("/v1/project/")) {
        if (!options.projectView) throw new PidaError("PROJECT_DISABLED", 404);
        if (req.method !== "GET") throw new PidaError("METHOD_NOT_ALLOWED", 405);
        const query = new URL(req.url!, "http://pida.invalid").searchParams;
        if (path === "/v1/project") json(res, 200, { enabled: true, ...await options.projectView.list(principal, query.get("path") ?? ".") });
        else if (path === "/v1/project/file") json(res, 200, await options.projectView.read(principal, query.get("path") ?? ""));
        else if (path === "/v1/project/changes") json(res, 200, await options.projectView.changes(principal));
        else throw new PidaError("NOT_FOUND", 404);
        return;
      }
      if (path === "/v1/agents" || path.startsWith("/v1/agents/")) {
        if (!principal.permissions.includes("pida:agents")) throw new PidaError("FORBIDDEN", 403);
        const agents = options.agents;
        if (!agents) throw new PidaError("AGENTS_DISABLED", 404);
        if (path === "/v1/agents" && req.method === "GET") { json(res, 200, { agents: agents.list(principal) }); return; }
        if (path === "/v1/agents" && req.method === "POST") {
          const input = await body(req); keys(input, ["name", "role", "persona"]);
          const agent = await agents.register(principal, input as any);
          if (agent.persona && options.agentMemory) options.agentMemory(agent.id).revisePersona({ expectedRevision: null, text: agent.persona, sourceRefs: ["owner:registration"] });
          json(res, 201, agent); return;
        }
        const route = /^\/v1\/agents\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
        if (!route) throw new PidaError("NOT_FOUND", 404);
        const agentId = route[1]!, action = route[2];
        const agent = agents.get(agentId, principal);
        if (!action && req.method === "GET") { json(res, 200, agent); return; }
        if (action === "jobs" && req.method === "GET") { json(res, 200, { jobs: agents.jobs(agentId, principal) }); return; }
        if (action === "jobs" && req.method === "POST") {
          const input = await body(req); keys(input, ["input", "requestId", "parentJobId"]);
          json(res, 202, await agents.enqueue(agentId, principal, input as any)); return;
        }
        if ((action === "pause" || action === "resume") && req.method === "POST") {
          keys(await body(req), []);
          if (action === "pause") await agents.pause(agentId, principal); else await agents.resume(agentId, principal);
          json(res, 200, agents.get(agentId, principal)); return;
        }
        const jobRoute = /^jobs\/([a-f0-9-]{36})(?:\/(cancel|steer|follow-up|export|recovery|tools))?$/.exec(action ?? "");
        if (jobRoute) {
          const job = agents.getJob(jobRoute[1]!, principal);
          if (job.agentId !== agentId) throw new PidaError("NOT_FOUND", 404);
          if (!jobRoute[2] && req.method === "GET") { json(res, 200, job); return; }
          if (jobRoute[2] === "tools" && req.method === "GET") {
            if (!job.sessionId) throw new PidaError("RUN_NOT_FOUND", 404);
            const target = await agents.getRuntime(agentId, principal);
            await target.resumeSession(job.sessionId, principal);
            const detail = target.getSessionTools(job.sessionId, principal);
            json(res, 200, { ...detail, items: detail.items.filter(item => item.runId === job.runId) }); return;
          }
          if (jobRoute[2] === "cancel" && req.method === "POST") { keys(await body(req), []); await agents.cancel(job.id, principal); json(res, 200, agents.getJob(job.id, principal)); return; }
          if ((jobRoute[2] === "steer" || jobRoute[2] === "follow-up") && req.method === "POST") {
            const input = await body(req); keys(input, ["text", "expectedRunId"]);
            if (typeof input.text !== "string" || typeof input.expectedRunId !== "string" || !job.sessionId || job.status !== "running") throw new PidaError("RUN_NOT_ACTIVE", 409);
            const target = await agents.getRuntime(agentId, principal);
            json(res, 200, await (jobRoute[2] === "steer" ? target.steer(job.sessionId, principal, input.text, input.expectedRunId) : target.followUp(job.sessionId, principal, input.text, input.expectedRunId))); return;
          }
          if (jobRoute[2] === "export" && req.method === "GET") {
            if (!job.sessionId || !job.runId) throw new PidaError("RUN_NOT_FOUND", 404);
            json(res, 200, (await agents.getRuntime(agentId, principal)).exportRun(job.sessionId, job.runId, principal)); return;
          }
          if (jobRoute[2] === "recovery" && req.method === "GET") {
            if (!job.sessionId) { json(res, 200, { sessionId: null, autoReplay: false, pendingEffects: [] }); return; }
            json(res, 200, (await agents.getRuntime(agentId, principal)).getRecovery(job.sessionId, principal)); return;
          }
        }
        if (action === "reconcile" && req.method === "POST") {
          const input = await body(req); keys(input, ["inspected", "effects", "note"]);
          await agents.reconcile(agentId, principal, input as any); json(res, 200, agents.get(agentId, principal)); return;
        }
        if (action === "memory" || action?.startsWith("memory/")) {
          const store = options.agentMemory?.(agentId);
          if (!store) throw new PidaError("MEMORY_UNAVAILABLE", 404);
          if (action === "memory" && req.method === "GET") {
            if (!principal.permissions.includes("agent:memory:read")) throw new PidaError("FORBIDDEN", 403);
            json(res, 200, store.view()); return;
          }
          if (req.method !== "POST") throw new PidaError("METHOD_NOT_ALLOWED", 405);
          if (!principal.permissions.includes("agent:memory:write")) throw new PidaError("FORBIDDEN", 403);
          const input = await body(req, 131_072);
          if (action === "memory/persona") json(res, 200, store.revisePersona(input as any));
          else if (action === "memory/experiences") { keys(input, ["kind", "text", "sourceRefs", "supersedes"]); json(res, 201, store.remember({ ...input, authority: "owner" } as any)); }
          else if (action === "memory/retract") json(res, 200, store.retractExperience(input as any));
          else if (action === "memory/states") json(res, 201, store.transition(input as any));
          else throw new PidaError("NOT_FOUND", 404);
          return;
        }
        if ((action === "workbench" || action === "workbench/file") && req.method === "GET") {
          const area = options.agentWorkbench?.(agentId);
          if (!area) throw new PidaError("WORKBENCH_UNAVAILABLE", 404);
          json(res, 200, action === "workbench" ? await area.status(principal) : await area.read(principal, new URL(req.url!, "http://pida.invalid").searchParams.get("path") ?? "")); return;
        }
        throw new PidaError("NOT_FOUND", 404);
      }
      if (options.workbench && path === "/v1/studio" && req.method === "GET") {
        json(res, 200, await options.workbench.uiState(principal)); return;
      }
      if (options.workbench && path === "/v1/studio/template" && req.method === "POST") {
        const input = await body(req); keys(input, ["templateId", "expectedRevision"]);
        if (typeof input.templateId !== "string" || typeof input.expectedRevision !== "string") throw new PidaError("INVALID_BODY", 400);
        json(res, 200, await options.workbench.uiTemplate(principal, input.templateId, input.expectedRevision)); return;
      }
      if (path.startsWith("/v1/workbench") && options.workbench) {
        if (path === "/v1/workbench/checkpoint" && req.method === "POST") {
          keys(await body(req), []);
          json(res, 200, await options.workbench.captureCheckpoint(principal)); return;
        }
        if (path === "/v1/workbench/changes" && req.method === "GET") {
          const params = new URL(req.url!, "http://pida.invalid").searchParams;
          json(res, 200, await options.workbench.changes(principal, params.get("base") ?? "", params.get("head") ?? "")); return;
        }
        if (path === "/v1/workbench/restore" && req.method === "POST") {
          const input = await body(req); keys(input, ["checkpoint", "expectedRevision"]);
          if (typeof input.checkpoint !== "string" || typeof input.expectedRevision !== "string") throw new PidaError("INVALID_BODY", 400);
          json(res, 200, await options.workbench.restoreCheckpoint(principal, input.checkpoint, input.expectedRevision, () => {
            const sessions = runtime.listSessions(principal);
            if (sessions.some(s => s.running)) throw new PidaError("SESSION_BUSY", 409);
            if (sessions.some(s => runtime.getRecovery(s.sessionId, principal).pendingEffects.length)) throw new PidaError("EFFECT_STATE_UNKNOWN", 409);
          })); return;
        }
        if (path === "/v1/workbench" && req.method === "GET") {
          json(res, 200, await options.workbench.status(principal)); return;
        }
        if (path === "/v1/workbench/file" && req.method === "GET") {
          const name = new URL(req.url!, "http://pida.invalid").searchParams.get("path");
          if (!name) throw new PidaError("INVALID_PATH", 400);
          json(res, 200, await options.workbench.read(principal, name)); return;
        }
        if (path === "/v1/workbench/file" && req.method === "POST") {
          const input = await body(req, 800_000); keys(input, ["path", "content"]);
          if (typeof input.path !== "string" || typeof input.content !== "string") throw new PidaError("INVALID_BODY", 400);
          json(res, 200, await options.workbench.write(principal, input.path, input.content)); return;
        }
      }
      if (path.startsWith("/v1/provider") && options.providerSettings) {
        if (!principal.permissions.includes("pida:configure"))
          throw new PidaError("FORBIDDEN", 403);
        if (options.connector && !(path === "/v1/provider" && req.method === "GET")) throw new PidaError("PROVIDER_HOST_MANAGED", 409);
        if (path === "/v1/provider/chatgpt/login" && req.method === "POST") {
          keys(await body(req), []);
          json(res, 200, options.providerSettings.startChatGPT(principal.id)); return;
        }
        if (path === "/v1/provider/chatgpt/logout" && req.method === "POST") {
          keys(await body(req), []);
          json(res, 200, await options.providerSettings.logoutChatGPT()); return;
        }
        const login = /^\/v1\/provider\/chatgpt\/login\/([a-f0-9-]{36})(\/input)?$/.exec(path);
        if (login && req.method === "GET" && !login[2]) {
          json(res, 200, options.providerSettings.getChatGPTLogin(login[1]!, principal.id)); return;
        }
        if (login && req.method === "DELETE" && !login[2]) {
          json(res, 200, await options.providerSettings.cancelChatGPT(login[1]!, principal.id)); return;
        }
        if (login && req.method === "POST" && login[2]) {
          const input = await body(req, 12_000); keys(input, ["value"]);
          if (typeof input.value !== "string") throw new PidaError("INVALID_BODY", 400);
          json(res, 200, options.providerSettings.inputChatGPT(login[1]!, principal.id, input.value)); return;
        }
        if (path === "/v1/provider" && req.method === "GET") {
          json(res, 200, { ...options.providerSettings.get(), ...(options.connector ? { connector: { ...options.connector, managed: true } } : {}) });
          return;
        }
        if (
          req.method === "POST" &&
          ["/v1/provider/models", "/v1/provider/test", "/v1/provider"].includes(
            path,
          )
        ) {
          const input = await body(req);
          const result = path.endsWith("/models")
            ? await options.providerSettings.models(input)
            : path.endsWith("/test")
              ? await options.providerSettings.test(input)
              : await options.providerSettings.apply(input);
          json(res, 200, result);
          return;
        }
      }
      if (path === "/v1/info" && req.method === "GET") {
        json(res, 200, runtime.getInfo(principal));
        return;
      }
      if (path === "/v1/sessions" && req.method === "GET") {
        json(res, 200, { sessions: runtime.listSessions(principal) });
        return;
      }
      if (path === "/v1/sessions" && req.method === "POST") {
        keys(await body(req), []);
        json(res, 201, await runtime.createSession(principal));
        return;
      }
      const artifactRoute = path.match(/^\/v1\/sessions\/([a-f0-9-]{36})\/runs\/([a-f0-9-]{36})\/(export|manifest)$/);
      if (artifactRoute && req.method === "GET") {
        const bundle = runtime.exportRun(artifactRoute[1]!, artifactRoute[2]!, principal);
        if (artifactRoute[3] === "manifest") {
          if (!bundle.manifest) throw new PidaError("MANIFEST_NOT_FOUND", 404);
          json(res, 200, bundle.manifest);
        } else if (new URL(req.url!, "http://pida.invalid").searchParams.get("format") === "jsonl") {
          res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Pida-Complete": String(bundle.complete) });
          res.end(bundle.events.map(e => JSON.stringify(e)).join("\n") + (bundle.events.length ? "\n" : ""));
        } else json(res, 200, bundle);
        return;
      }
      const match = path.match(
        /^\/v1\/sessions\/([a-f0-9-]{36})(?:\/(runs|cancel|trace|tools|compact|handoff|recovery|steer|follow-up))?$/,
      );
      if (!match) throw new PidaError("NOT_FOUND", 404);
      const id = match[1]!,
        action = match[2];
      if ((action === "steer" || action === "follow-up") && req.method === "POST") {
        const input = await body(req); keys(input, ["text", "expectedRunId"]);
        if (typeof input.text !== "string" || typeof input.expectedRunId !== "string") throw new PidaError("INVALID_BODY", 400);
        json(res, 200, await (action === "steer" ? runtime.steer(id, principal, input.text, input.expectedRunId) : runtime.followUp(id, principal, input.text, input.expectedRunId))); return;
      }
      if (action === "runs" && req.method === "GET") { json(res, 200, { runs: runtime.listRuns(id, principal) }); return; }
      if (action === "recovery" && req.method === "POST") {
        if (!principal.permissions.includes("pida:recover")) throw new PidaError("FORBIDDEN", 403);
        const input = await body(req); keys(input, ["inspected", "effects"]);
        if (input.inspected !== true || !Array.isArray(input.effects) || input.effects.length > 100 || input.effects.some(e => !e || typeof e.id !== "string" || !["applied", "not_applied"].includes(e.state))) throw new PidaError("INVALID_BODY", 400);
        await runtime.resumeSession(id, principal);
        for (const effect of input.effects) runtime.reconcileEffect(id, principal, effect.id, effect.state);
        json(res, 200, runtime.getRecovery(id, principal)); return;
      }
      if (action === "recovery" && req.method === "GET") { json(res, 200, runtime.getRecovery(id, principal)); return; }
      if (!action && req.method === "GET") {
        await runtime.resumeSession(id, principal);
        json(res, 200, runtime.getSession(id, principal));
        return;
      }
      if (!action && req.method === "DELETE") {
        await runtime.deleteSession(id, principal);
        res.writeHead(204);
        res.end();
        return;
      }
      if (action === "trace" && req.method === "GET") {
        await runtime.resumeSession(id, principal);
        const cursor = new URL(req.url!, "http://pida.invalid").searchParams.get("afterSequence");
        if (cursor !== null && !/^\d+$/.test(cursor)) throw new PidaError("INVALID_CURSOR", 400);
        json(res, 200, runtime.getTracePage(id, principal, cursor === null ? 0 : Number(cursor)));
        return;
      }
      if (action === "tools" && req.method === "GET") {
        await runtime.resumeSession(id, principal);
        json(res, 200, runtime.getSessionTools(id, principal)); return;
      }
      if ((action === "compact" || action === "handoff") && req.method === "POST") {
        keys(await body(req), []);
        json(res, 200, await runtime.compactSession(id, principal, action === "handoff")); return;
      }
      if (action === "cancel" && req.method === "POST") {
        keys(await body(req), []);
        await runtime.cancel(id, principal);
        json(res, 200, { cancelled: true });
        return;
      }
      if (action === "runs" && req.method === "POST") {
        const input = await body(req);
        keys(input, ["prompt", "taskId", "disconnectPolicy"]);
        if (typeof input.prompt !== "string")
          throw new PidaError("INVALID_PROMPT", 400);
        if (input.taskId !== undefined && typeof input.taskId !== "string") throw new PidaError("INVALID_TASK_ID", 400);
        if (input.disconnectPolicy !== undefined && !["cancel", "continue"].includes(input.disconnectPolicy as string))
          throw new PidaError("INVALID_DISCONNECT_POLICY", 400);
        const keepRunning = input.disconnectPolicy === "continue";
        const controller = new AbortController();
        const disconnected = () => {
          if (!keepRunning && !res.writableEnded) controller.abort();
        };
        res.on("close", disconnected);
        try {
          await runtime.run(
            id,
            principal,
            input.prompt,
            (event) => {
              if (res.destroyed || res.writableLength > 1_048_576) {
                res.destroy();
                if (keepRunning) return;
                controller.abort();
                throw new Error("STREAM_CLOSED");
              }
              if (!res.headersSent)
                res.writeHead(200, {
                  "Content-Type": "text/event-stream; charset=utf-8",
                  "X-Accel-Buffering": "no",
                });
              res.write(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              );
            },
            controller.signal,
            { taskId: input.taskId as string | undefined },
          );
          if (!res.destroyed) res.end();
        } finally {
          res.off("close", disconnected);
        }
        return;
      }
      throw new PidaError("METHOD_NOT_ALLOWED", 405);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      const safe =
        error instanceof PidaError
          ? error
          : new PidaError("INTERNAL_ERROR", 500);
      json(res, safe.status, { error: safe.code });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  return server;
}

