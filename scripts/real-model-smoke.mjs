// Opt-in live-model smoke: never part of npm test and never imports workspace tool modules.
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Type } from "typebox";
import { PidaRuntime } from "../dist/runtime.js";
import { endpointProvider } from "../dist/providers.js";
import { nativeProvider } from "../dist/provider-catalog.js";
import { readConfig } from "../dist/workspace.js";
import { providerEnvironment } from "../dist/provider-settings.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: node scripts/real-model-smoke.mjs <workspace-directory>\nUses the explicitly selected non-mock provider; may incur provider charges.\nRuns only a synthetic read-only tool request and session restart/recall in a temporary workspace.\nDoes not import user tools or modify the selected workspace. Not the full PIDA-02 E2E suite.");
} else {
  const report = {
    suite: "pida-real-model-smoke-v1",
    started_at: new Date().toISOString(),
    node: process.version,
    status: "NOT_RUN",
    cases: [],
    known_limits: [
      "Read-only synthetic tool data; model responses are live only when a case executes.",
      "Does not verify code edits, browser UI, long-session compaction or forced process crashes.",
      "Restart case closes and reopens the runtime; it is not a separate-process crash test.",
      "Token usage, pricing and actual backend model identity are not independently verified.",
    ],
  };
  let directory, runtime;
  try {
    if (args.length !== 1 || args[0].startsWith("--")) throw new Error("WORKSPACE_ARGUMENT_REQUIRED");
    const workspace = resolve(args[0]);
    const config = readConfig(workspace);
    if (config.provider.kind === "mock") throw new Error("REAL_PROVIDER_REQUIRED");
    const env = providerEnvironment(workspace, config);
    const provider = config.provider.kind === "native"
      ? nativeProvider(config.provider, env)
      : endpointProvider({ id: "live-smoke", ...config.provider }, env);
    report.runtime_version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
    report.provider_kind = config.provider.kind;
    report.requested_model = config.provider.modelId;
    report.requested_limits = {
      context_window: config.provider.kind === "endpoint" ? config.provider.contextWindow : undefined,
      max_tokens: config.provider.kind === "endpoint" ? config.provider.maxTokens : undefined,
      max_run_ms: config.runtime?.maxRunMs ?? 180000,
    };
    directory = await mkdtemp(join(tmpdir(), "pida-live-smoke-"));
    const code = randomBytes(6).toString("hex");
    const owner = { id: "smoke-user", permissions: ["probe:read"] };
    const create = () => new PidaRuntime({
      provider, storageDir: join(directory, "state"), workspaceDir: directory,
      maxRunMs: config.runtime?.maxRunMs ?? 180000,
      maxTurns: 8, maxToolCalls: 4, maxOutputRetries: config.runtime?.maxOutputRetries ?? 1,
      autoCompaction: false,
      systemPrompt: "Use the registered read-only probe when requested. Report its values accurately. Never invent a probe result.",
      tools: [{
        name: "get_runtime_probe", permission: "probe:read",
        description: "Return a synthetic diagnostic code and state; no external changes.",
        parameters: Type.Object({}),
        async execute() { return { code, state: "ready" }; },
      }],
    });
    runtime = create();
    const { sessionId } = await runtime.createSession(owner);
    report.status = "RUNNING";
    const first = await runtime.run(sessionId, owner, "Call get_runtime_probe and reply with its exact code and state.");
    const toolExecuted = runtime.getTrace(sessionId, owner).some(e => e.runId === first.runId && e.type === "tool_completed" && e.toolName === "get_runtime_probe");
    const firstPassed = first.status === "completed" && toolExecuted && first.text.includes(code) && first.text.includes("ready");
    report.cases.push({ name: "natural-language-tool-response", status: firstPassed ? "PASS" : "FAIL", run_id: first.runId, reported_status: first.status, code: first.code, tool_executed: toolExecuted });
    if (!firstPassed) throw new Error("LIVE_TOOL_ASSERTION_FAILED");
    await runtime.close();
    runtime = create();
    await runtime.resumeSession(sessionId, owner);
    const second = await runtime.run(sessionId, owner, "Recall the exact diagnostic code from our previous exchange. Return only that code. Do not call a tool.");
    const calledAgain = runtime.getTrace(sessionId, owner).some(e => e.runId === second.runId && e.type === "tool_started");
    const secondPassed = second.status === "completed" && second.text.includes(code) && !calledAgain;
    report.cases.push({ name: "runtime-reopen-session-recall", status: secondPassed ? "PASS" : "FAIL", run_id: second.runId, reported_status: second.status, code: second.code, tool_called_again: calledAgain });
    if (!secondPassed) throw new Error("LIVE_RECALL_ASSERTION_FAILED");
    report.status = "PASS";
  } catch (error) {
    report.status = report.status === "RUNNING" || report.cases.length ? "FAIL" : "NOT_RUN";
    // Do not print provider errors, prompts, URLs, credentials or transcript content.
    const code = error?.code ?? error?.message;
    report.error = typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "LIVE_SMOKE_SETUP_OR_EXECUTION_FAILED";
    process.exitCode = 1;
  } finally {
    try { await runtime?.close(); }
    catch { report.cleanup_error = "RUNTIME_CLOSE_FAILED"; report.status = "FAIL"; process.exitCode = 1; }
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => { report.cleanup_error = "TEMP_CLEANUP_FAILED"; report.status = "FAIL"; process.exitCode = 1; });
    report.finished_at = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
  }
}
