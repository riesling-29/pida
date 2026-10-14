import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { PidaRuntime, endpointProvider, lotStatusTool } from "../dist/index.js";

const config = {
  id: "company",
  api: "openai-completions",
  baseUrl: "https://company.example.test/v1",
  modelId: "company-model",
  apiKeyEnv: "TEST_COMPANY_KEY",
  contextWindow: 32000,
  maxTokens: 2048,
};
test("endpoint validation rejects insecure URLs, URL credentials and missing keys", () => {
  assert.throws(
    () => endpointProvider({ ...config, baseUrl: "http://company.test/v1" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      endpointProvider({
        ...config,
        baseUrl: "https://key:secret@company.test/v1",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      endpointProvider({
        ...config,
        baseUrl: "https://company.test/v1?key=secret",
      }),
    /HTTPS/,
  );
  assert.throws(
    () => endpointProvider({ ...config, apiKeyEnv: "!read-secret" }),
    /Invalid/,
  );
  assert.throws(() => endpointProvider(config, {})(), /Missing/);
});
test("real Pi OpenAI adapter calls local protocol stub, executes tool, replays history and rotates key", async (t) => {
  const calls = [];
  let requestNumber = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    calls.push({ path: req.url, auth: req.headers.authorization, payload });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta, finish_reason = null) =>
      res.write(
        `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 1, model: "company-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    requestNumber++;
    if (requestNumber === 1) {
      send({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call-lot",
            type: "function",
            function: {
              name: "get_lot_status",
              arguments: '{"lotId":"LOT-001"}',
            },
          },
        ],
      });
      send({}, "tool_calls");
    } else {
      send({ role: "assistant", content: "Stub: inspection waiting." });
      send({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const env = { TEST_COMPANY_KEY: "synthetic-key-one" };
  const runtime = new PidaRuntime({
    provider: endpointProvider(
      {
        ...config,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        allowInsecureHttp: true,
      },
      env,
    ),
    tools: [lotStatusTool],
  });
  t.after(async () => {
    await runtime.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const principal = { id: "tester", permissions: ["lots:read"] },
    { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "LOT-001");
  assert.equal(result.status, "completed");
  assert.match(result.text, /waiting/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/chat/completions");
  assert.equal(calls[0].auth, "Bearer synthetic-key-one");
  assert.equal(calls[0].payload.model, "company-model");
  assert.deepEqual(
    calls[0].payload.tools.map((t) => t.function.name),
    ["get_lot_status"],
  );
  assert.ok(
    calls[1].payload.messages.some(
      (m) => m.role === "tool" && m.content.includes("inspection"),
    ),
  );
  env.TEST_COMPANY_KEY = "synthetic-key-two";
  assert.equal(
    (await runtime.run(sessionId, principal, "continue")).status,
    "completed",
  );
  assert.equal(calls[2].auth, "Bearer synthetic-key-two");
  assert.equal(
    calls[2].payload.messages.filter((m) => m.role === "user").length,
    2,
  );
});
