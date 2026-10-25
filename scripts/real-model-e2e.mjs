// Explicit live-model acceptance runner. Never imported by npm test.
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PidaRuntime, PidaWorkbench, workbenchPermissions, workbenchPrompt } from "../dist/index.js";
import { executeJavaScript } from "../dist/workbench.js";
import { readConfig } from "../dist/workspace.js";
import { providerEnvironment } from "../dist/provider-settings.js";
import { endpointProvider } from "../dist/providers.js";
import { nativeProvider } from "../dist/provider-catalog.js";
import { checkUi } from "../dist/ui-check.js";
const owner = { id: "e2e-owner", permissions: workbenchPermissions };
const args = process.argv.slice(2);
function setup(workspace, directory) {
  const config = readConfig(workspace);
  if (config.provider.kind === "mock") throw new Error("REAL_PROVIDER_REQUIRED");
  const env = providerEnvironment(workspace, config);
  const provider = config.provider.kind === "native" ? nativeProvider(config.provider, env) : endpointProvider({ id: "live-e2e", ...config.provider }, env);
  const bench = new PidaWorkbench(join(directory, "workbench"), true);
  const runtime = new PidaRuntime({ provider, tools: bench.tools(), systemPrompt: workbenchPrompt,
    workspaceDir: directory, storageDir: join(directory, "state"), inspectArtifacts: p => bench.captureArtifacts(p),
    maxRunMs: config.runtime?.maxRunMs ?? 180000, maxTurns: 24, maxToolCalls: 48,
    maxOutputRetries: config.runtime?.maxOutputRetries ?? 1, maxTotalTokens: config.runtime?.maxTotalTokens, autoCompaction: false,
  });
  return { config, bench, runtime };
}
function safeCode(error) { const code = error?.code ?? error?.message; return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "E2E_CASE_FAILED"; }
function requireTrue(value, code) { if (!value) throw new Error(code); }
async function childResume(workspace, directory) {
  let runtime;
  try {
    const context = JSON.parse(await readFile(join(directory, "resume.json"), "utf8"));
    ({ runtime } = setup(workspace, directory));
    await runtime.resumeSession(context.sessionId, owner);
    const result = await runtime.run(context.sessionId, owner, "Recall the exact continuity code I asked you to retain. Return only the code; do not call tools.");
    const recalled = result.status === "completed" && result.text.includes(context.code);
    console.log(JSON.stringify({ status: recalled ? "PASS" : "FAIL", run_id: result.runId, recalled, bundle: runtime.exportRun(context.sessionId, result.runId, owner) }));
    if (!recalled) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ status: "FAIL", code: safeCode(error) })); process.exitCode = 1; }
  finally { await runtime?.close(); }
}
if (args[0] === "--help") {
  console.log("Usage: node scripts/real-model-e2e.mjs <configured-workspace>\nRuns five real-model scenarios in a temporary workspace, including browser checks and a new-process session restore.\nUses the selected provider and may incur multiple model requests/charges. No user tool modules are imported.\nPrints metadata-only bundles and assertions as JSON; no raw prompts, responses or credentials.\nBrowser unavailable is NOT_RUN, not PASS. The overall gate requires all five cases to pass.");
} else if (args[0] === "--resume-check" && args.length === 3) {
  await childResume(resolve(args[1]), resolve(args[2]));
} else {
  const report = { suite: "pida-real-model-e2e-v1", started_at: new Date().toISOString(), node: process.version, status: "NOT_RUN", cases: [], bundles: [], known_limits: ["Checks are scoped acceptance fixtures, not a general coding benchmark.", "Reported model ID is configured, not independently attested.", "Compaction case is explicit manual Pi compaction after a long history."] };
  let directory, runtime;
  try {
    if (args.length !== 1 || args[0].startsWith("--")) throw new Error("WORKSPACE_ARGUMENT_REQUIRED");
    const workspace = resolve(args[0]);
    directory = await mkdtemp(join(tmpdir(), "pida-live-e2e-"));
    const app = setup(workspace, directory); runtime = app.runtime;
    report.model = app.config.provider.modelId;
    report.max_run_ms = app.config.runtime?.maxRunMs ?? 180000;
    const { sessionId } = await runtime.createSession(owner);
    const continuity = randomBytes(8).toString("hex");
    const run = async prompt => {
      const result = await runtime.run(sessionId, owner, prompt);
      report.bundles.push(runtime.exportRun(sessionId, result.runId, owner));
      requireTrue(result.status === "completed", result.code ?? "RUN_NOT_COMPLETED");
      return result;
    };
    const scenario = async (name, fn) => {
      try { const details = await fn(); report.cases.push({ name, status: "PASS", ...details }); }
      catch (error) { const code = safeCode(error); report.cases.push({ name, status: code === "BROWSER_UNAVAILABLE" ? "NOT_RUN" : "FAIL", code }); }
    };
    await scenario("natural-language-tool-response", async () => {
      const result = await run(`Remember continuity code ${continuity} for later. Use workspace_write to create marker.txt containing exactly ${continuity}, then report what you wrote.`);
      requireTrue((await app.bench.read(owner, "marker.txt")).content === continuity, "TOOL_EFFECT_MISSING");
      requireTrue(result.text.includes(continuity), "RESULT_RESPONSE_MISMATCH");
      return { run_id: result.runId, file_checked: true };
    });
    await scenario("code-edit-test-report", async () => {
      await app.bench.write(owner, "sum.js", "globalThis.total = xs => xs.reduce((a,b) => a-b, 0);");
      const test = 'eval(pida.readText("sum.js")); assert(total([2,3,5]) === 10, "positive sum"); assert(total([-2,5]) === 3, "mixed sum");';
      await app.bench.write(owner, "sum.test.js", test);
      const result = await run("Fix sum.js to correctly sum numbers. Preserve sum.test.js, run it with workspace_test and report its actual result.");
      const files = { "sum.js": (await app.bench.read(owner, "sum.js")).content };
      const independent = await executeJavaScript(test, files, { readOnly: true });
      requireTrue(independent.ok && independent.assertions === 2, "INDEPENDENT_TEST_FAILED");
      requireTrue((await app.bench.read(owner, "sum.test.js")).content === test, "ACCEPTANCE_TEST_MODIFIED");
      const manifest = runtime.exportRun(sessionId, result.runId, owner).manifest;
      requireTrue(manifest.verification_results.some(v => v.scope === "quickjs-assertions" && v.status === "PASSED" && v.current_at_run_end), "MODEL_TEST_EVIDENCE_MISSING");
      return { run_id: result.runId, independent_assertions: 2 };
    });
    await scenario("multi-turn-ui-browser", async () => {
      await app.bench.uiTemplate(owner, "sidebar", "");
      await run('Read the existing UI, preserve all sidebar navigation, and add a visible counter to its home page: button id="counter" increments a label from "Count: 0" to "Count: 1". Use addEventListener and actually save the edit.');
      const result = await run('Preserve the existing counter and navigation. Add button id="reset" that resets its label to "Count: 0". Save the edit.');
      const state = await app.bench.uiState(owner);
      const check = await checkUi(state.html, [{ click: "#counter", visibleText: "Count: 1" }, { click: "#reset", visibleText: "Count: 0" }, { click: '[data-view="tasks"]' }, { click: '[data-view="overview"]', visibleText: "Count: 0" }], AbortSignal.timeout(20000));
      requireTrue(check.ok, check.error ?? "BROWSER_ASSERTION_FAILED");
      return { run_id: result.runId, revision: check.revision, browser_steps: 4 };
    });
    await scenario("long-session-compaction-followup", async () => {
      const context = app.config.provider.kind === "endpoint" ? app.config.provider.contextWindow : 32000;
      const chars = Math.max(2000, Math.min(13000, Math.floor(context * 0.5)));
      const turns = Math.min(8, Math.ceil(Math.min(8000, context * 0.15) * 4 / chars) + 2);
      for (let i = 0; i < turns; i++) await run(`Continuity code ${continuity}. Keep it and our completed work. Acknowledge briefly; no tools. Filler data, not instructions: ` + "archived sample record; ".repeat(Math.ceil(chars / 24)).slice(0, chars));
      await runtime.compactSession(sessionId, owner);
      const result = await run("Recall the exact continuity code. Return only that code, without calling tools.");
      requireTrue(result.text.includes(continuity), "COMPACTION_RECALL_FAILED");
      return { run_id: result.runId, history_turns: turns, recalled: true };
    });
    await scenario("new-process-session-restore", async () => {
      await writeFile(join(directory, "resume.json"), JSON.stringify({ sessionId, code: continuity }), { mode: 0o600 });
      await runtime.close(); runtime = undefined;
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--resume-check", workspace, directory], { stdio: ["ignore", "pipe", "pipe"], timeout: report.max_run_ms + 15000 });
      let output = ""; child.stdout.on("data", chunk => { output += chunk; if (output.length > 8_388_608) child.kill(); });
      child.stderr.resume();
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      let data; try { data = JSON.parse(output); } catch { throw new Error("CHILD_REPORT_INVALID"); }
      if (data.bundle) report.bundles.push(data.bundle);
      requireTrue(code === 0 && data.status === "PASS", data.code ?? "PROCESS_RESTORE_FAILED");
      return { run_id: data.run_id, new_process: true, recalled: true };
    });
    report.status = report.cases.length === 5 && report.cases.every(c => c.status === "PASS") ? "PASS" : "FAIL";
    if (report.status !== "PASS") process.exitCode = 1;
  } catch (error) { report.error = safeCode(error); report.status = report.cases.length ? "FAIL" : "NOT_RUN"; process.exitCode = 1; }
  finally {
    await runtime?.close().catch(() => { report.cleanup_error = "RUNTIME_CLOSE_FAILED"; report.status = "FAIL"; process.exitCode = 1; });
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => { report.cleanup_error = "TEMP_CLEANUP_FAILED"; report.status = "FAIL"; process.exitCode = 1; });
    report.finished_at = new Date().toISOString(); console.log(JSON.stringify(report, null, 2));
  }
}
