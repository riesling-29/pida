// Actual browser + Pi/workbench, with explicitly scripted model decisions.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions } from "../dist/index.js";
const directory = await mkdtemp(join(tmpdir(), "pida-ui-readiness-"));
let runtime;
try {
  const owner = { id: "browser-fixture", permissions: workbenchPermissions };
  const bench = new PidaWorkbench(directory, true);
  await bench.uiTemplate(owner, "sidebar", "");
  const initial = await bench.uiState(owner);
  const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
  const f = fauxProvider({ tokensPerSecond: 100000 });
  f.setResponses([tool("ui_patch", { expectedRevision: initial.revision, edits: [
    { oldText: '<section data-page="overview">', newText: '<section data-page="overview"><button id="counter">Increment</button><span id="count">Count: 0</span>' },
    { oldText: "</script>", newText: 'let count=0; document.querySelector("#counter").addEventListener("click",()=>{document.querySelector("#count").textContent="Count: "+(++count)});</script>' },
  ] }), answer("Counter added.")]);
  runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: bench.tools(), inspectArtifacts: p => bench.captureArtifacts(p) });
  const { sessionId } = await runtime.createSession(owner);
  assert.equal((await runtime.run(sessionId, owner, "Add a counter; retain navigation.")).status, "completed");
  const current = await bench.uiState(owner);
  f.setResponses([
    tool("ui_patch", { expectedRevision: current.revision, edits: [
      { oldText: '<span id="count">', newText: '<button id="reset">Reset</button><span id="count">' },
      { oldText: "</script>", newText: 'document.querySelector("#reset").addEventListener("click",()=>{count=0;document.querySelector("#count").textContent="Count: 0"});</script>' },
    ] }),
    tool("ui_check", { steps: [
      { click: "#counter", visibleText: "Count: 1" }, { click: "#reset", visibleText: "Count: 0" },
      { click: '[data-view="tasks"]', visibleText: "작업 목록" }, { click: '[data-view="notes"]', visibleText: "작업 메모" },
      { click: '[data-view="overview"]', visibleText: "Count: 0" },
    ] }), answer("Scoped browser checks completed."),
  ]);
  const result = await runtime.run(sessionId, owner, "Add reset; preserve counter and navigation; check it.");
  assert.equal(result.status, "completed", result.code);
  const manifest = runtime.exportRun(sessionId, result.runId, owner).manifest;
  const verification = manifest.verification_results.find(v => v.scope === "isolated-browser");
  assert.equal(verification.status, "PASSED"); assert.equal(verification.current_at_run_end, true);
  const saved = await bench.uiState(owner);
  assert.ok(manifest.artifact_refs.some(a => a.path === "app/index.html" && a.sha256 === saved.revision));
  assert.equal(manifest.verification_status, "UNKNOWN");
  console.log("PASS: two Pi-driven UI edits, counter/reset, all three original navigation views, and revision-bound browser evidence. Model decisions scripted; browser real.");
} finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
