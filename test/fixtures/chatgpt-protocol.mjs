// Synthetic OpenAI protocol only. This fixture never forwards non-loopback requests.
import assert from "node:assert/strict";
import { nativeProviderCatalog } from "../../dist/provider-catalog.js";
export const modelId = nativeProviderCatalog().find(p => p.id === "openai").models.find(m => m.id === "gpt-6.1-sol")?.id ?? nativeProviderCatalog().find(p => p.id === "openai").models[0].id;
export function responseEvents(tool = false) {
  const item = tool ? { id: "fc_fixture", type: "function_call", call_id: "call_fixture", name: "get_lot_status", namespace: "pida", arguments: '{"lotId":"LOT-002"}', status: "completed" } :
    { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
  const response = { id: "resp_fixture", object: "response", created_at: 1, model: modelId, status: "completed", output: [item], usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } };
  const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", ...(tool ? { arguments: "" } : { content: [] }) } },
    ...(tool ? [{ type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments }] : [
      { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "OK" },
      { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: "OK" }]),
    { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response }];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}
export function protocolFixture(localFetch = globalThis.fetch) {
  const f = { requests: [], tokens: [], grant: true, refreshFails: false, responseFails: false, useTool: false, version: 0, modelId };
  f.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.hostname === "127.0.0.1" && url.protocol === "http:") return localFetch(input, init);
    if (url.href === "https://auth.openai.com/api/accounts/oauth/token") {
      const body = new URLSearchParams(await req.text()); f.tokens.push(Object.fromEntries(body));
      if (body.get("grant_type") === "refresh_token" && f.refreshFails) return Response.json({ error: "invalid_grant", error_description: "fixture secret details" }, { status: 400 });
      f.version++;
      return Response.json({ access_token: `oauth-fixture-access-${f.version}`, refresh_token: `oauth-fixture-refresh-${f.version}`, expires_in: 3600, id_token: "synthetic-id-token", scope: `openid profile email offline_access resource.invoke${f.grant ? " chatgpt.tokens.use.direct" : ""}` });
    }
    assert.equal(url.origin, "https://api.openai.com", "never contact a live service");
    assert.match(req.headers.get("authorization") ?? "", /^Bearer oauth-fixture-access-/);
    if (url.pathname === "/v1/models") return Response.json({ models: [
      { slug: modelId, display_name: "Fixture model", visibility: "list" }, { slug: "unsupported-future-model", visibility: "list" }, { slug: "hidden", visibility: "hidden" },
    ] });
    assert.equal(url.pathname, "/v1/responses");
    const body = JSON.parse(await req.text()); f.requests.push(body);
    assert.equal(body.store, false); assert.equal(body.stream, true);
    for (const key of ["max_output_tokens", "temperature", "previous_response_id", "prompt_cache_retention"]) assert.ok(!(key in body));
    assert.ok(body.input.every(m => m.role !== "system"));
    if (body.tools?.length) {
      assert.equal(body.tools[0].type, "namespace"); assert.equal(body.tools[0].name, "pida");
      assert.ok(body.tools[0].tools.some(t => t.name === "get_lot_status"));
    }
    if (f.responseFails) return Response.json({ error: { code: "subscription_sharing_user_not_eligible", message: "synthetic denied" } }, { status: 403 });
    const tool = f.useTool && !!body.tools?.length; if (tool) f.useTool = false;
    return responseEvents(tool);
  };
  return f;
}
export async function waitForLogin(settings, id, owner, predicate = x => x.status !== "pending") {
  const end = Date.now() + 5000;
  for (;;) {
    const value = settings.getChatGPTLogin(id, owner); if (predicate(value)) return value;
    if (Date.now() > end) throw new Error("Login fixture timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
export function callbackURL(login) {
  const auth = new URL(login.authUrl), callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({ state: auth.searchParams.get("state"), code: "fixture-code", client_id: "fixture-client" }).toString(); return callback;
}
