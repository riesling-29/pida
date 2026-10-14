import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PidaRuntime, mockProvider, lotStatusTool } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";

const token = "a".repeat(40),
  other = "b".repeat(40); // Synthetic test-only credentials.
async function fixture(t, options = {}) {
  const runtime = new PidaRuntime({
    provider: mockProvider,
    tools: [lotStatusTool],
    ...options,
  });
  const server = createPidaServer({
    runtime,
    serveDemo: true,
    allowedOrigin: "https://app.example.test",
    authenticate: staticTokenAuth([
      { token, principal: { id: "alice", permissions: ["lots:read"] } },
      { token: other, principal: { id: "bob", permissions: [] } },
    ]),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const request = (path, method = "GET", data, key = token, headers = {}) =>
    fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const create = async () =>
    (await (await request("/v1/sessions", "POST", {})).json()).sessionId;
  return { base, request, create, runtime };
}
test("HTTP create → SSE actual tool execution → history/trace → delete", async (t) => {
  const { request, create } = await fixture(t);
  const id = await create();
  assert.ok(id);
  const response = await request(`/v1/sessions/${id}/runs`, "POST", {
    prompt: "LOT-002",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const frames = (await response.text())
    .trim()
    .split("\n\n")
    .map((frame) =>
      JSON.parse(
        frame
          .split("\n")
          .find((x) => x.startsWith("data: "))
          .slice(6),
      ),
    );
  assert.ok(frames.some((e) => e.type === "text_delta"));
  assert.equal(frames.at(-1).result.status, "completed");
  assert.match(frames.at(-1).result.text, /processing/);
  assert.equal((await (await request(`/v1/sessions/${id}`)).json()).runs, 1);
  assert.ok(
    (await (await request(`/v1/sessions/${id}/trace`)).json()).events.length,
  );
  assert.equal((await request(`/v1/sessions/${id}`, "DELETE")).status, 204);
  assert.equal((await request(`/v1/sessions/${id}`)).status, 404);
});
test("authentication, session isolation, browser origins and body claims are enforced", async (t) => {
  const { request, create } = await fixture(t);
  const id = await create();
  assert.equal(
    (await request("/v1/sessions", "POST", {}, "wrong")).status,
    401,
  );
  assert.equal(
    (await request(`/v1/sessions/${id}`, "GET", undefined, other)).status,
    404,
  );
  assert.equal(
    (await request(`/v1/sessions/${id}/trace`, "GET", undefined, other)).status,
    404,
  );
  assert.equal(
    (await request(`/v1/sessions/${id}/cancel`, "POST", {}, other)).status,
    404,
  );
  assert.equal(
    (
      await request("/v1/sessions", "POST", {}, token, {
        Origin: "https://evil.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/v1/sessions", "POST", {
        principal: { id: "admin" },
        tools: ["bash"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/v1/sessions/${id}/runs`, "POST", {
        prompt: "x",
        provider: "evil",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(`/v1/sessions/${id}/runs`, "POST", { prompt: "" })).status,
    400,
  );
  const allowed = await request(`/v1/sessions/${id}`, "GET", undefined, token, {
    Origin: "https://app.example.test",
  });
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://app.example.test",
  );
});
test("request size and content type are bounded; demo assets have CSP and no embedded token", async (t) => {
  const { base, request } = await fixture(t);
  const oversized = await request("/v1/sessions", "POST", {
    x: "x".repeat(40_000),
  });
  assert.equal(oversized.status, 413);
  assert.equal(
    (
      await request("/v1/sessions", "POST", {}, token, {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.ok(!(await page.text()).includes(token));
  for (const path of ["/app.js", "/style.css", "/pida-client.js"])
    assert.equal((await fetch(base + path)).status, 200);
});
test("HTTP cancellation during SSE and busy conflicts", async (t) => {
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const { request, create } = await fixture(t, {
    tools: [
      {
        ...lotStatusTool,
        execute: async (_args, { signal }) => {
          started();
          await new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
          return {};
        },
      },
    ],
  });
  const id = await create();
  const response = await request(`/v1/sessions/${id}/runs`, "POST", {
    prompt: "LOT-001",
  });
  await entered;
  const conflict = await request(`/v1/sessions/${id}/runs`, "POST", {
    prompt: "second",
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    (await request(`/v1/sessions/${id}/cancel`, "POST", {})).status,
    200,
  );
  const text = await response.text();
  assert.match(text, /"status":"cancelled"/);
});
