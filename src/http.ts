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
        ["/", "/app.js", "/studio.js", "/style.css", "/pida-client.js"].includes(path)
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
      if (options.workbench && path === "/v1/studio" && req.method === "GET") {
        json(res, 200, await options.workbench.uiState(principal)); return;
      }
      if (options.workbench && path === "/v1/studio/template" && req.method === "POST") {
        const input = await body(req); keys(input, ["templateId", "expectedRevision"]);
        if (typeof input.templateId !== "string" || typeof input.expectedRevision !== "string") throw new PidaError("INVALID_BODY", 400);
        json(res, 200, await options.workbench.uiTemplate(principal, input.templateId, input.expectedRevision)); return;
      }
      if (path.startsWith("/v1/workbench") && options.workbench) {
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
        if (path === "/v1/provider" && req.method === "GET") {
          json(res, 200, options.providerSettings.get());
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
        /^\/v1\/sessions\/([a-f0-9-]{36})(?:\/(runs|cancel|trace|compact|handoff|recovery))?$/,
      );
      if (!match) throw new PidaError("NOT_FOUND", 404);
      const id = match[1]!,
        action = match[2];
      if (action === "runs" && req.method === "GET") { json(res, 200, { runs: runtime.listRuns(id, principal) }); return; }
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
        json(res, 200, { events: runtime.getTrace(id, principal) });
        return;
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
        keys(input, ["prompt", "taskId"]);
        if (typeof input.prompt !== "string")
          throw new PidaError("INVALID_PROMPT", 400);
        if (input.taskId !== undefined && typeof input.taskId !== "string") throw new PidaError("INVALID_TASK_ID", 400);
        const controller = new AbortController();
        const disconnected = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", disconnected);
        try {
          await runtime.run(
            id,
            principal,
            input.prompt,
            (event) => {
              if (res.destroyed || res.writableLength > 1_048_576) {
                controller.abort();
                res.destroy();
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
          res.end();
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

