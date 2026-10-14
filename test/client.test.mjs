import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PidaClient } from "../dist/client.js";
import { PidaRuntime, mockProvider, lotStatusTool } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";

test("portable client SDK drives real HTTP runtime without implementing an agent harness", async (t) => {
  const token = "synthetic-client-token".repeat(2);
  const runtime = new PidaRuntime({
    provider: mockProvider,
    tools: [lotStatusTool],
  });
  const server = createPidaServer({
    runtime,
    authenticate: staticTokenAuth([
      { token, principal: { id: "client-user", permissions: ["lots:read"] } },
    ]),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await runtime.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const client = new PidaClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    token: () => token,
  });
  const { sessionId } = await client.createSession();
  const events = [];
  const result = await client.run(sessionId, "LOT-001", {
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.status, "completed");
  assert.match(result.text, /inspection/);
  assert.ok(events.some((e) => e.type === "text_delta"));
  assert.equal((await client.getSession(sessionId)).runs, 1);
  assert.ok((await client.getTrace(sessionId)).events.length);
  await client.cancel(sessionId);
  await client.deleteSession(sessionId);
  await assert.rejects(() => client.getSession(sessionId), {
    code: "SESSION_NOT_FOUND",
    status: 404,
  });
});
test("client parser handles split UTF-8/frame chunks and fails on truncated streams", async () => {
  const encoder = new TextEncoder();
  const events = [
    { type: "text_delta", delta: "한글" },
    {
      type: "result",
      result: { status: "completed", text: "한글", runId: "r", sessionId: "s" },
    },
  ];
  const bytes = encoder.encode(
    events
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
  );
  const client = new PidaClient({
    baseUrl: "https://pida.test",
    token: () => "synthetic",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      ),
  });
  assert.equal((await client.run("s", "x")).text, "한글");
  const broken = new PidaClient({
    baseUrl: "https://pida.test",
    token: () => "synthetic",
    fetch: async () =>
      new Response(
        'event: text_delta\ndata: {"type":"text_delta","delta":"partial"}\n\n',
      ),
  });
  await assert.rejects(() => broken.run("s", "x"), {
    code: "STREAM_INTERRUPTED",
  });
});
