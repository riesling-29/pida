import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkUi, uiCheckDefinition } from "../dist/ui-check.js";
import { PidaWorkbench, workbenchPermissions } from "../dist/workbench.js";

test("browser check definitions reject ambiguous actions, unsafe expansion and invalid viewports before launch", async () => {
  const signal = new AbortController().signal;
  for (const steps of [
    [{ click: "#x", fill: "#y", value: "bad" }], [{ evaluate: "process.exit()" }],
    [{ count: "*", equals: -1 }], [{ visible: "x".repeat(501) }], Array(21).fill({ visible: "body" }),
  ]) {
    assert.throws(() => uiCheckDefinition(steps), /INVALID_UI_CHECK/);
    assert.equal((await checkUi("<html></html>", steps, signal)).error, "INVALID_UI_CHECK");
  }
  assert.equal((await checkUi("<html></html>", [], signal, { viewport: { width: 10000, height: 600 } })).error, "INVALID_UI_CHECK");
  assert.equal((await checkUi("a".repeat(131073), [], signal)).error, "INVALID_UI_CHECK");
  assert.deepEqual(uiCheckDefinition([{ click: "#x", visibleText: "" }]).viewport, { width: 1280, height: 820 });
});

test("pre-cancelled browser verification does not launch or report success", async () => {
  const abort = new AbortController(); abort.abort();
  const result = await checkUi("<html></html>", [{ visible: "body" }], abort.signal);
  assert.equal(result.error, "UI_CHECK_CANCELLED"); assert.equal(result.ok, false);
  assert.deepEqual(result.checks, []);
});

test("browser evidence and recovery scopes include viewport; unavailable browser is never a pass", async t => {
  const root = await mkdtemp(join(tmpdir(), "pida-browser-contract-"));
  const previous = process.env.PIDA_BROWSER_EXECUTABLE;
  process.env.PIDA_BROWSER_EXECUTABLE = join(root, "missing-browser");
  t.after(async () => { if (previous === undefined) delete process.env.PIDA_BROWSER_EXECUTABLE; else process.env.PIDA_BROWSER_EXECUTABLE = previous; await rm(root, { recursive: true, force: true }); });
  const bench = new PidaWorkbench(root, true), principal = { id: "owner", permissions: workbenchPermissions };
  await bench.write(principal, "app/index.html", "<!doctype html><html><body><p>hello</p></body></html>");
  const tool = bench.tools().find(t => t.name === "ui_check");
  const desktop = { steps: [{ visibleText: "hello" }] }, mobile = { ...desktop, viewport: { width: 390, height: 844 } };
  const context = { principal, sessionId: "test", runId: "test", signal: new AbortController().signal };
  const a = await tool.execute(desktop, context), b = await tool.execute(mobile, context);
  assert.equal(a.error, "BROWSER_UNAVAILABLE"); assert.equal(b.error, "BROWSER_UNAVAILABLE");
  assert.equal(tool.evidence(a).verification.status, "UNAVAILABLE");
  assert.equal(tool.evidence(a).verification.independence, "agent-supplied-check");
  assert.notEqual(tool.evidence(a).verification.definition_digest, tool.evidence(b).verification.definition_digest);
  assert.notEqual(tool.classifyResult(a, desktop).recoveryKey, tool.classifyResult(b, mobile).recoveryKey);
  assert.equal(tool.classifyResult(a, desktop).recoveryKey, tool.classifyResult(a, { ...desktop, viewport: { width: 1280, height: 820 } }).recoveryKey);
});
