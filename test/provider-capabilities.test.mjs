import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PidaRuntime, endpointProvider, lotStatusTool } from "../dist/index.js";
import { ModelAttemptUsage } from "../dist/model-observation.js";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

const base = { id: "fixture", api: "openai-completions", baseUrl: "https://endpoint.test/v1", modelId: "fixture-model", apiKeyEnv: "FIXTURE_KEY", authMode: "none", contextWindow: 32000, maxTokens: 2048 };
const owner = { id: "owner", permissions: ["lots:read"] };
const report = (api, events) => { const usage = new ModelAttemptUsage(); for (const event of events) usage.accept(api, event); return usage.snapshot(); };
const sse = event => `data: ${JSON.stringify(event)}\n\n`;
function chat(res, delta, finish_reason = null) { res.write(sse({ id: "chat-fixture", model: base.modelId, choices: [{ index: 0, delta, finish_reason }] })); }
async function server(t, handler) {
  const calls = [], http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const call = { path: req.url, body: JSON.parse(raw) }; calls.push(call);
    res.writeHead(200, { "content-type": "text/event-stream" }); handler(call, res, calls.length);
  });
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  t.after(async () => { http.closeAllConnections(); await new Promise(done => http.close(done)); });
  return { calls, baseUrl: `http://127.0.0.1:${http.address().port}/v1` };
}

test("endpoint capability defaults remain compatible; explicit unsupported reasoning and malformed declarations fail", async () => {
  const plain = endpointProvider(base)().provider.getModels()[0];
  assert.equal(plain.reasoning, false); assert.deepEqual(plain.input, ["text"]);
  for (const invalid of [{ thinkingLevel: "low" }, { reasoning: true, thinkingLevel: "xhigh" }, { reasoning: true, thinkingLevel: "high", thinkingLevelMap: { high: null } }, { reasoning: true, thinkingLevelMap: { invented: "high" } }, { input: ["image"] }, { input: ["text", "text"] }])
    assert.throws(() => endpointProvider({ ...base, ...invalid }), /UNSUPPORTED|capability/);
  const map = { high: "intensive", xhigh: null }, input = ["text", "image"];
  const factory = endpointProvider({ ...base, reasoning: true, input, thinkingLevel: "high", thinkingLevelMap: map });
  map.high = "changed"; input.pop();
  const binding = factory(), model = binding.provider.getModels()[0];
  assert.equal(binding.thinkingLevel, "high"); assert.equal(model.thinkingLevelMap.high, "intensive"); assert.deepEqual(model.input, ["text", "image"]);
  assert.ok(!getSupportedThinkingLevels(model).includes("xhigh"));
  const runtime = new PidaRuntime({ provider: () => ({ ...binding, thinkingLevel: "xhigh" }) });
  await assert.rejects(runtime.createSession(owner), /PROVIDER_THINKING_UNSUPPORTED/); await runtime.close();
});

test("usage distinguishes missing, explicit zero, partial cache metadata and contradictory counts", () => {
  assert.equal(report("openai-completions", []).usage_status, "unknown");
  const zero = report("openai-completions", [{ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }]);
  assert.equal(zero.tokens, 0); assert.equal(zero.output_tokens, 0); assert.equal(zero.cache_read_tokens, null);
  const partial = report("openai-completions", [{ usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } } }]);
  assert.equal(partial.input_tokens, 10); assert.equal(partial.cache_read_tokens, 3); assert.equal(partial.cache_write_tokens, null); assert.equal(partial.uncached_input_tokens, null); assert.equal(partial.reasoning_tokens, 2);
  for (const usage of [{ prompt_tokens: 10, completion_tokens: 4, total_tokens: 13 }, { prompt_tokens: 2, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 3 } }, { prompt_tokens: "10", completion_tokens: 1 }, { prompt_tokens: 2, completion_tokens: 1, completion_tokens_details: { reasoning_tokens: 2 } }]) {
    const observed = report("openai-completions", [{ usage }]); assert.equal(observed.usage_status, "invalid"); assert.equal(observed.tokens, null);
  }
  const anthropic = report("anthropic-messages", [{ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } }, { type: "message_delta", usage: { output_tokens: 4 } }]);
  assert.equal(anthropic.tokens, 14); assert.equal(anthropic.input_tokens, 10); assert.equal(anthropic.uncached_input_tokens, 5);
  assert.equal(report("company-private-protocol", [{ usage: { prompt_tokens: 100 } }]).usage_status, "unknown");
});

test("Pi Chat Completions preserves parallel tool reasoning across restart and reports private attempt metadata", async t => {
  const state = await mkdtemp(join(tmpdir(), "pida-wire-")); t.after(() => rm(state, { recursive: true, force: true }));
  const fixture = await server(t, (_call, res, n) => {
    if (n === 1) {
      chat(res, { role: "assistant", reasoning_content: "PRIVATE_REASONING" });
      chat(res, { tool_calls: [1, 2].map(i => ({ index: i - 1, id: `call-${i}`, type: "function", function: { name: "get_lot_status", arguments: '{"lotId":"LOT-001"}' } })) });
      chat(res, {}, "tool_calls");
    } else { chat(res, { role: "assistant", content: "OK" }); chat(res, {}, "stop"); }
    res.write(sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 }, completion_tokens_details: { reasoning_tokens: 2 } } }));
    res.end("data: [DONE]\n\n");
  });
  const selected = { ...base, baseUrl: fixture.baseUrl, allowInsecureHttp: true, reasoning: true, thinkingLevel: "high", thinkingLevelMap: { high: "intensive" } };
  let runtime = new PidaRuntime({ provider: endpointProvider(selected), tools: [lotStatusTool], storageDir: state, systemPrompt: "PRIVATE_SYSTEM" });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  const result = await runtime.run(sessionId, owner, "PRIVATE_PROMPT"); assert.equal(result.status, "completed");
  assert.equal(fixture.calls[0].body.reasoning_effort, "intensive");
  assert.equal(fixture.calls[1].body.messages.filter(m => m.role === "tool").length, 2);
  assert.equal(fixture.calls[1].body.messages.find(m => m.reasoning_content)?.reasoning_content, "PRIVATE_REASONING");
  const bundle = runtime.exportRun(sessionId, result.runId, owner), requests = bundle.events.filter(e => e.activity === "model_request"), responses = bundle.events.filter(e => e.activity === "model_response");
  assert.equal(requests.length, 2); assert.equal(responses.length, 2);
  assert.notEqual(requests[0].payload.request_id, requests[1].payload.request_id);
  assert.equal(requests[0].payload.effective_config_digest, requests[1].payload.effective_config_digest);
  for (let i = 0; i < 2; i++) {
    assert.equal(responses[i].payload.request_id, requests[i].payload.request_id);
    assert.equal(responses[i].payload.tokens, 14); assert.equal(responses[i].payload.cache_read_tokens, 3); assert.equal(responses[i].payload.uncached_input_tokens, 6);
    assert.equal(responses[i].payload.usage_status, "reported"); assert.ok(responses[i].payload.first_output_ms >= 0); assert.ok(responses[i].payload.duration_ms >= responses[i].payload.first_output_ms);
  }
  assert.ok(!JSON.stringify(bundle).includes("PRIVATE_")); assert.ok(!JSON.stringify(bundle).includes(fixture.baseUrl));
  await runtime.close();
  runtime = new PidaRuntime({ provider: endpointProvider(selected), tools: [lotStatusTool], storageDir: state, systemPrompt: "PRIVATE_SYSTEM" });
  const continued = await runtime.run(sessionId, owner, "continue"); assert.equal(continued.status, "completed");
  assert.equal(fixture.calls[2].body.messages.filter(m => m.role === "tool").length, 2);
  assert.equal(fixture.calls[2].body.messages.find(m => m.reasoning_content)?.reasoning_content, "PRIVATE_REASONING");
  const resumedRequest = runtime.exportRun(sessionId, continued.runId, owner).events.find(e => e.activity === "model_request");
  assert.equal(resumedRequest.payload.effective_config_digest, requests[0].payload.effective_config_digest);
  assert.equal(resumedRequest.payload.fingerprint_scope, requests[0].payload.fingerprint_scope);
});

test("a stream without usage remains unknown and cannot pass a token-budget gate", async t => {
  const fixture = await server(t, (_call, res) => { chat(res, { role: "assistant", content: "OK" }); chat(res, {}, "stop"); res.end("data: [DONE]\n\n"); });
  const runtime = new PidaRuntime({ provider: endpointProvider({ ...base, baseUrl: fixture.baseUrl, allowInsecureHttp: true }), maxTotalTokens: 100 });
  t.after(() => runtime.close()); const { sessionId } = await runtime.createSession(owner), result = await runtime.run(sessionId, owner, "hello");
  assert.equal(result.code, "USAGE_UNAVAILABLE");
  const observed = runtime.exportRun(sessionId, result.runId, owner).events.find(e => e.activity === "model_response").payload;
  assert.equal(observed.usage_status, "unknown"); assert.equal(observed.tokens, null); assert.equal(observed.cache_read_tokens, null);
});

test("Pi Responses → Chat → Responses keeps native reasoning opaque across API switches", async t => {
  const state = await mkdtemp(join(tmpdir(), "pida-route-")); t.after(() => rm(state, { recursive: true, force: true }));
  const fixture = await server(t, (call, res, n) => {
    if (call.path.endsWith("chat/completions")) { chat(res, { role: "assistant", content: "Chat OK" }); chat(res, {}, "stop"); res.end("data: [DONE]\n\n"); return; }
    const reasoning = { id: `rs_${n}`, type: "reasoning", summary: [], encrypted_content: `PRIVATE_CIPHER_${n}` };
    const item = { id: `msg_${n}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Responses OK", annotations: [] }] };
    const response = { id: `resp_${n}`, object: "response", created_at: 1, model: base.modelId, status: "completed", output: [reasoning, item], usage: { input_tokens: 6, output_tokens: 4, total_tokens: 10, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } } };
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: reasoning },
      { type: "response.output_item.done", output_index: 0, item: reasoning },
      { type: "response.output_item.added", output_index: 1, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.content_part.added", item_id: item.id, output_index: 1, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 1, content_index: 0, delta: "Responses OK" },
      { type: "response.output_text.done", item_id: item.id, output_index: 1, content_index: 0, text: "Responses OK" },
      { type: "response.output_item.done", output_index: 1, item }, { type: "response.completed", response },
    ]) res.write(`event: ${event.type}\n${sse(event)}`);
    res.end();
  });
  const config = { ...base, api: "openai-responses", baseUrl: fixture.baseUrl, allowInsecureHttp: true, reasoning: true, thinkingLevel: "low" };
  const runtime = new PidaRuntime({ provider: endpointProvider(config), storageDir: state }); t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  const initial = await runtime.run(sessionId, owner, "First API"); assert.equal(initial.status, "completed");
  const firstEvent = runtime.exportRun(sessionId, initial.runId, owner).events.find(e => e.activity === "model_response");
  assert.equal(firstEvent.payload.tokens, 10); assert.equal(firstEvent.payload.cache_read_tokens, 2); assert.equal(firstEvent.payload.reasoning_tokens, 1);
  runtime.configureProvider(endpointProvider({ ...config, api: "openai-completions" }));
  assert.equal((await runtime.run(sessionId, owner, "Second API")).status, "completed");
  assert.ok(!JSON.stringify(fixture.calls[1].body).includes("PRIVATE_CIPHER"));
  runtime.configureProvider(endpointProvider(config));
  assert.equal((await runtime.run(sessionId, owner, "First API again")).status, "completed");
  assert.equal(fixture.calls[2].body.input.find(item => item.id === "rs_1")?.encrypted_content, "PRIVATE_CIPHER_1");
  assert.ok(!JSON.stringify(runtime.exportRun(sessionId, initial.runId, owner)).includes("PRIVATE_CIPHER"));
});
