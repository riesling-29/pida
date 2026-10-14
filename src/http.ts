import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PidaError, type PidaRuntime, type Principal } from "./runtime.js";

export interface HttpOptions {
  runtime: PidaRuntime;
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
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new PidaError("JSON_REQUIRED", 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new PidaError("BODY_TOO_LARGE", 413);
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
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
        req.method === "GET" &&
        ["/", "/app.js", "/style.css", "/pida-client.js"].includes(path)
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
      if (path === "/v1/sessions" && req.method === "POST") {
        keys(await body(req), []);
        json(res, 201, await runtime.createSession(principal));
        return;
      }
      const match = path.match(
        /^\/v1\/sessions\/([a-f0-9-]{36})(?:\/(runs|cancel|trace))?$/,
      );
      if (!match) throw new PidaError("NOT_FOUND", 404);
      const id = match[1]!,
        action = match[2];
      if (!action && req.method === "GET") {
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
        json(res, 200, { events: runtime.getTrace(id, principal) });
        return;
      }
      if (action === "cancel" && req.method === "POST") {
        keys(await body(req), []);
        await runtime.cancel(id, principal);
        json(res, 200, { cancelled: true });
        return;
      }
      if (action === "runs" && req.method === "POST") {
        const input = await body(req);
        keys(input, ["prompt"]);
        if (typeof input.prompt !== "string")
          throw new PidaError("INVALID_PROMPT", 400);
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
