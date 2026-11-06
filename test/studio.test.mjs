import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions, workbenchPrompt, mockProvider } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { templateHtml, uiTemplates } from "../dist/ui-templates.js";
const owner = { id: "owner", permissions: workbenchPermissions };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pida-studio-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workbench = new PidaWorkbench(dir);
  const invoke = (name, args, principal = owner) => workbench.tools().find(tool => tool.name === name).execute(args, { principal, sessionId: "test", runId: "test", signal: new AbortController().signal });
  return { dir, workbench, invoke };
}
test("templates persist per user; restarts restore the same service document; stale replacement is rejected", async t => {
  const { dir, workbench } = await fixture(t);
  assert.equal((await workbench.uiState(owner)).html, "");
  let revision = "";
  for (const template of uiTemplates) {
    const result = await workbench.uiTemplate(owner, template.id, revision);
    revision = result.revision;
    const saved = await new PidaWorkbench(dir).uiState(owner);
    assert.equal(saved.html, templateHtml(template.id)); assert.equal(saved.revision, revision);
  }
  await assert.rejects(workbench.uiTemplate(owner, "sidebar", ""), /UI_REVISION_CONFLICT/);
  assert.equal((await workbench.uiState(owner)).revision, revision);
  assert.equal((await workbench.uiState({ ...owner, id: "other" })).html, "");
  await assert.rejects(workbench.uiTemplate({ id: "owner", permissions: ["workbench:read"] }, "sidebar", revision), /FORBIDDEN/);
  await assert.rejects(workbench.uiTemplate(owner, "unknown", revision), /UI_TEMPLATE_NOT_FOUND/);
});
test("actual Pi loop reads chosen template and applies requested UI; a follow-up preserves the previous change", async t => {
  const { workbench } = await fixture(t);
  await workbench.uiTemplate(owner, "three-column", "");
  const toolResult = context => JSON.parse(context.messages.filter(m => m.role === "toolResult").at(-1).content.filter(c => c.type === "text").map(c => c.text).join(""));
  const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
  const f = fauxProvider();
  f.setResponses([
    tool("ui_read", {}),
    context => { const current = toolResult(context); assert.match(current.html, /three-column/); return tool("ui_apply", { html: current.html.replace("</main>", '<section id="equipment">설비 현황</section></main>'), expectedRevision: current.revision }); },
    context => { assert.equal(toolResult(context).ok, true); return answer("설비 현황을 추가했습니다."); },
    tool("ui_read", {}),
    context => { const current = toolResult(context); assert.match(current.html, /id="equipment"/); return tool("ui_patch", { edits: [{ oldText: "</main>", newText: '<section id="todo"><label><input type="checkbox">데이터 점검</label></section></main>' }], expectedRevision: current.revision }); },
    answer("할 일을 추가했습니다."),
  ]);
  const runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: workbench.tools(), systemPrompt: workbenchPrompt });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(owner);
  assert.equal((await runtime.run(sessionId, owner, "설비 현황을 추가해줘")).status, "completed");
  assert.equal((await runtime.run(sessionId, owner, "할 일도 붙여줘")).status, "completed");
  const saved = await workbench.uiState(owner);
  assert.match(saved.html, /id="equipment"/); assert.match(saved.html, /id="todo"/);
  assert.equal((await workbench.read(owner, "app/index.html")).content, saved.html);
});
test("UI apply rejects malformed, oversized and conflicting updates without changing the service; Git can restore", async t => {
  const { workbench, invoke } = await fixture(t);
  const original = await workbench.uiTemplate(owner, "sidebar", "");
  const initial = await workbench.uiState(owner);
  for (const html of ["<h1>fragment</h1>", "<html><body>" + "x".repeat(131072) + "</body></html>"]) {
    const result = await invoke("ui_apply", { html, expectedRevision: original.revision });
    assert.equal(result.ok, false); assert.equal((await workbench.uiState(owner)).revision, original.revision);
  }
  assert.equal((await invoke("ui_patch", { expectedRevision: original.revision, edits: [{ oldText: "missing marker", newText: "change" }] })).error, "UI_EDIT_MATCH_REQUIRED");
  assert.equal((await workbench.uiState(owner)).revision, original.revision);
  await workbench.uiTemplate(owner, "top-nav", original.revision);
  assert.equal((await invoke("ui_apply", { html: initial.html, expectedRevision: original.revision })).error, "UI_REVISION_CONFLICT");
  assert.equal((await invoke("workspace_restore", { checkpoint: original.checkpoint })).ok, true);
  assert.equal((await workbench.uiState(owner)).html, initial.html);
});
test("studio HTTP preserves authentication/ownership and uses a credential-free nonce-sandboxed renderer", async t => {
  const { workbench } = await fixture(t);
  const runtime = new PidaRuntime({ provider: mockProvider }); t.after(() => runtime.close());
  const token = "t".repeat(32), readToken = "r".repeat(32);
  const server = createPidaServer({ runtime, workbench, serveDemo: true, authenticate: staticTokenAuth([{ token, principal: owner }, { token: readToken, principal: { id: owner.id, permissions: ["workbench:read"] } }]) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  assert.equal((await fetch(base + "/v1/studio")).status, 401);
  assert.equal((await fetch(base + "/v1/studio/template", { method: "POST", headers, body: JSON.stringify({ templateId: "sidebar", expectedRevision: "", admin: true }) })).status, 400);
  assert.equal((await fetch(base + "/v1/studio/template", { method: "POST", headers: { ...headers, Authorization: `Bearer ${readToken}` }, body: JSON.stringify({ templateId: "sidebar", expectedRevision: "" }) })).status, 403);
  assert.equal((await fetch(base + "/v1/studio/template", { method: "POST", headers, body: JSON.stringify({ templateId: "sidebar", expectedRevision: "" }) })).status, 200);
  const current = await (await fetch(base + "/v1/studio", { headers })).json();
  assert.equal(current.html, templateHtml("sidebar"));
  const frame = await fetch(base + "/studio-frame.html"), markup = await frame.text();
  assert.match(frame.headers.get("content-security-policy"), /sandbox allow-scripts/);
  assert.doesNotMatch(frame.headers.get("content-security-policy"), /allow-same-origin|unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(frame.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.match(markup, /event.source !== parent/); assert.ok(!markup.includes(token)); assert.ok(!markup.includes(current.html));
  assert.notEqual(frame.headers.get("content-security-policy"), (await fetch(base + "/studio-frame.html")).headers.get("content-security-policy"));
  assert.equal((await fetch(base + "/studio.js")).status, 200);
});
