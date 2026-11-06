// Actual browser + actual Pi/workbench/API. Model decisions are scripted, not real-model acceptance.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Type } from "typebox";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions, workbenchPrompt } from "../dist/index.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { ProjectView } from "../dist/project-view.js";
import { createProjectTools } from "../dist/project-tools.js";
import { createProgramRegistry } from "../dist/program-registry.js";
const { chromium } = await import("playwright");
const directory = await mkdtemp(join(tmpdir(), "pida-studio-browser-"));
const owner = { id: "studio-browser", permissions: [...workbenchPermissions, "project:read", "pida:agents"] }, token = "b".repeat(32);
const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
const lastTool = context => JSON.parse(context.messages.filter(m => m.role === "toolResult").at(-1).content.filter(b => b.type === "text").map(b => b.text).join(""));
let browser, runtime, server;
const toolGate = Promise.withResolvers(), modelGate = Promise.withResolvers();
try {
  const projectRoot = join(directory, "project"), privateRoot = join(projectRoot, "private-host"), run = promisify(execFile);
  const packageSource = JSON.stringify({ name: "pida-fixture", type: "module", scripts: { check: "node src/main.js" } }, null, 2) + "\n";
  await mkdir(join(projectRoot, "src"), { recursive: true }); await mkdir(privateRoot);
  await Promise.all([writeFile(join(projectRoot, "README.md"), "# Project fixture\n"), writeFile(join(projectRoot, "src", "main.js"), "export const value = 1;\n"), writeFile(join(privateRoot, "secret.txt"), "protected-project-canary"), writeFile(join(projectRoot, "pida.config.json"), "{\"private\":true}\n")]);
  await Promise.all([writeFile(join(projectRoot, "package.json"), packageSource), writeFile(join(projectRoot, "pyproject.toml"), '[project.scripts]\nfixture = "fixture:main"\n'), writeFile(join(privateRoot, "package.json"), '{"scripts":{"private":"never-run"}}')]);
  await run("git", ["init", "-q"], { cwd: projectRoot });
  await run("git", ["add", "README.md", "src/main.js", "package.json", "pyproject.toml"], { cwd: projectRoot });
  await run("git", ["-c", "user.name=Pida fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture baseline"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "src", "main.js"), "export const value = 2;\n");
  const projectConfig = { enabled: true, root: projectRoot, trustedHost: false };
  const protectedPaths = [privateRoot, join(projectRoot, "pida.config.json"), join(directory, "state"), join(directory, "workbench")];
  const projectView = new ProjectView(projectConfig, { protectedPaths }), projectTools = createProjectTools(projectConfig, { protectedPaths });
  const programs = await createProgramRegistry(directory, [], { projectRoot, protectedPaths });
  const bench = new PidaWorkbench(join(directory, "workbench"), true), f = fauxProvider({ tokensPerSecond: 100000 });
  const progressProbe = { name: "coding_guide", description: "Controlled read-only fixture", parameters: Type.Object({}), permission: "workbench:read", effect: "read", async execute() { await toolGate.promise; return { note: "private-tool-output-canary" }; } };
  runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), providerInfo: { mode: "endpoint", model: "Scripted browser acceptance" }, tools: [...bench.tools(), progressProbe, ...projectTools.tools, ...programs.tools], systemPrompt: workbenchPrompt, storageDir: join(directory, "state"), inspectArtifacts: p => bench.captureArtifacts(p) });
  const httpOptions = { runtime, workbench: bench, projectView, programs, serveDemo: true, authenticate: staticTokenAuth([{ token, principal: owner }]) };
  server = createPidaServer(httpOptions);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  httpOptions.allowedOrigin = url;
  // Independent real HTTP preflight remains usable when this environment has no browser binary.
  const api = (path, options = {}) => fetch(url + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const projectListing = await (await api("/v1/project")).json();
  assert(projectListing.files.some(file => file.path === "src" && file.type === "directory"));
  assert(!projectListing.files.some(file => /private-host|pida.config/.test(file.path)));
  assert.equal((await api("/v1/project/file?path=private-host%2Fsecret.txt")).status, 403);
  assert.match((await (await api("/v1/project/file?path=src%2Fmain.js")).json()).content, /value = 2/);
  assert.match((await (await api("/v1/project/changes")).json()).diff, /\+export const value = 2/);
  const disabledAgents = await api("/v1/agents"); assert.equal(disabledAgents.status, 404); assert.equal((await disabledAgents.json()).error, "AGENTS_DISABLED");
  const catalog = await (await api("/v1/programs")).json();
  const ready = catalog.catalog.candidates.find(candidate => candidate.kind === "npm-script"), adapter = catalog.catalog.candidates.find(candidate => candidate.kind === "python-entrypoint");
  assert.equal(ready.status, "ready"); assert.equal(adapter.status, "adapter-required"); assert.deepEqual(catalog.enabled, []);
  assert(!catalog.catalog.candidates.some(candidate => candidate.path.includes("private-host")));
  const draftBody = JSON.stringify({ candidateId: ready.id, sourceDigest: ready.sourceDigest });
  const draft = await api("/v1/programs/draft", { method: "POST", body: draftBody }); assert.equal(draft.status, 200);
  assert.equal((await draft.json()).manifest.inputMode, "none");
  await writeFile(join(projectRoot, "package.json"), packageSource + "\n");
  const staleDraft = await api("/v1/programs/draft", { method: "POST", body: draftBody }); assert.equal(staleDraft.status, 409); assert.equal((await staleDraft.json()).error, "PROGRAM_SOURCE_CHANGED");
  await writeFile(join(projectRoot, "package.json"), packageSource);
  if (process.env.PIDA_CHECK_API_ONLY === "1") {
    console.log("PASS: actual ProjectView HTTP listing/file/diff, protected paths, unavailable agents API, program discovery/reviewable draft/source conflict. Browser intentionally not executed.");
  } else {
  browser = await chromium.launch({ headless: true, ...(process.env.PIDA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIDA_BROWSER_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const diagnostic = [];
  page.on("console", message => { if (message.type() === "error") diagnostic.push(message.text()); });
  page.on("response", response => diagnostic.push(`${response.status()} ${new URL(response.url()).pathname}`));
  page.on("requestfailed", request => diagnostic.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await page.goto(`${url}/#token=${token}`);
  await page.locator("#mode-tabs").waitFor({ state: "visible" }).catch(async error => { console.error({ pageErrors: errors, diagnostic, connectionError: await page.locator("#error").textContent() }); throw error; });
  await page.locator('[data-mode="agents"]').click();
  await page.waitForFunction(() => document.querySelector("#agents-status").textContent.includes("상주 에이전트가 연결되지"));
  assert.equal(await page.locator("#agent-create-form button").isDisabled(), true);
  await page.locator('[data-mode="studio"]').click();
  // File work starts without a UI template and uses the registered Pi tools.
  await page.locator("#studio-target-mode").selectOption("files");
  f.setResponses([
    tool("coding_guide", {}),
    async () => { await modelGate.promise; return tool("workspace_write", { path: "sum.js", content: "globalThis.sum = xs => xs.reduce((a,b) => a+b, 0);\n" }); },
    tool("workspace_write", { path: "sum.test.js", content: 'eval(pida.readText("sum.js")); assert(sum([2,3]) === 5);' }),
    tool("workspace_test", { path: "sum.test.js" }), answer("두 파일을 저장하고 합계 검사를 실행했습니다."),
  ]);
  await page.locator("#studio-prompt").fill("합계 함수와 테스트를 만들고 실제로 검사해줘."); await page.locator("#studio-send").click();
  await page.waitForFunction(() => document.querySelector("#studio-run-status").textContent.includes("실행 중 · coding_guide"));
  assert.match(await page.locator("#studio-activity-list").textContent(), /도구 실행 · coding_guide/);
  toolGate.resolve();
  await page.waitForFunction(() => document.querySelector("#studio-run-status").textContent.includes("모델 응답을 기다리고"));
  assert.match(await page.locator("#studio-activity-list").textContent(), /도구 완료 · coding_guide/);
  assert.doesNotMatch(await page.locator("#studio-activity-list").textContent(), /private-tool-output-canary/);
  await page.waitForFunction(() => /경과 [1-9]/.test(document.querySelector("#studio-activity-clock").textContent));
  // Reconnect while the model is still waiting: execution and the before-checkpoint survive the UI.
  const pendingSession = await page.evaluate(() => sessionStorage.getItem("pida-studio-session"));
  await page.reload(); await page.locator("#token").fill(token); await page.locator("#connect").click();
  await page.waitForFunction(() => document.querySelector("#studio-activity-list").textContent.includes("도구 완료 · coding_guide"));
  assert.match(await page.locator("#studio-run-status").textContent(), /모델 응답을 기다리고/);
  assert.equal(runtime.getSession(pendingSession, owner).running, true);
  modelGate.resolve();
  await page.waitForFunction(() => document.querySelector("#studio-verification").textContent.includes("현재 파일과 일치"));
  assert.match(await page.locator("#studio-outcome").textContent(), /실행 완료/);
  await page.locator("#studio-tab-changes").click(); assert.match(await page.locator("#studio-change-summary").textContent(), /2개 파일/);
  assert.match(await page.locator("#studio-diff").textContent(), /globalThis.sum/);
  await page.locator("#studio-tab-files").click(); await page.locator("#studio-file").selectOption("sum.js");
  await page.waitForFunction(() => document.querySelector("#studio-source").textContent.includes("globalThis.sum"));
  assert.match(await page.locator("#studio-target").textContent(), /sum.js/);
  // Pick a real starting template, then change it through the actual UI conversation.
  await page.locator("#studio-target-mode").selectOption("ui"); await page.locator("#choose-template").click();
  await page.locator(".template-card").first().click(); await page.locator("#apply-template").click();
  await page.waitForFunction(() => document.querySelector("#studio-sync").textContent.includes("미리보기 로드됨"));
  const original = await bench.uiState(owner);
  f.setResponses([tool("ui_read", {}), ctx => tool("ui_patch", { expectedRevision: lastTool(ctx).revision, edits: [{ oldText: "</main>", newText: '<section id="newpanel">검증된 작업 패널</section></main>' }] }), tool("ui_check", { steps: [{ click: '[data-view="tasks"]', visibleText: "검증된 작업 패널" }] }), answer("패널을 추가하고 메뉴 이동 후 표시를 검사했습니다.")]);
  await page.locator("#studio-prompt").fill("작업 패널을 붙이고 메뉴를 바꿔도 보이는지 검사해줘."); await page.locator("#studio-send").click();
  await page.waitForFunction(() => document.querySelector("#studio-verification").textContent.includes("브라우저 검사: 통과 · 현재 파일과 일치"));
  assert.equal(await page.frameLocator("#studio-frame").locator("#newpanel").innerText(), "검증된 작업 패널");
  await page.locator("#studio-tab-changes").click(); assert.match(await page.locator("#studio-diff").textContent(), /newpanel/);
  assert.equal(await page.locator("#studio-tab-preview").getAttribute("aria-selected"), "false");
  assert.equal(await page.locator("#studio-tab-changes").getAttribute("aria-selected"), "true");
  // Host page never renders model/source markup as executable HTML.
  assert.equal(await page.locator("#newpanel").count(), 0);
  const screenshots = process.env.PIDA_SCREENSHOT_DIR;
  if (screenshots) { await mkdir(screenshots, { recursive: true }); await page.screenshot({ path: join(screenshots, "changes-desktop.png"), fullPage: true, animations: "disabled" }); }
  // Refresh/login restores the actual run evidence and checkpoint comparison.
  await page.reload(); await page.locator("#token").fill(token); await page.locator("#connect").click();
  await page.waitForFunction(() => document.querySelector("#studio-verification").textContent.includes("브라우저 검사: 통과 · 현재 파일과 일치"));
  assert.equal(await page.locator("#studio-change-count").textContent(), "1");
  page.once("dialog", dialog => dialog.accept()); await page.locator("#studio-restore").click();
  await page.waitForFunction(() => document.querySelector("#studio-run-status").textContent.includes("요청 전 파일로 복원했습니다"));
  assert.equal((await bench.uiState(owner)).html, original.html);
  assert.match(await page.locator("#studio-verification").textContent(), /현재 파일에 유효한 검증으로 볼 수 없음/);
  assert.equal(await page.locator("#studio-restore").isDisabled(), true);
  // The selected host project uses its real filesystem/diff APIs, not the workbench's files.
  await page.locator("#studio-target-mode").selectOption("project");
  assert.equal(await page.locator("#studio-project-panel").isVisible(), true);
  assert.equal(await page.locator("#studio-panel-files").isVisible(), true);
  await page.waitForFunction(() => [...document.querySelector("#studio-file").options].some(option => option.value === "src"));
  assert.doesNotMatch(await page.locator("#studio-file").textContent(), /private-host|pida.config/);
  await page.locator("#studio-file").selectOption("src");
  await page.waitForFunction(() => document.querySelector("#studio-source").textContent.includes("export const value = 2"));
  await page.locator("#studio-tab-changes").click();
  assert.match(await page.locator("#studio-diff").textContent(), /\+export const value = 2/);
  await page.locator("#studio-tab-files").click(); await page.locator("#studio-file").selectOption("..");
  await page.waitForFunction(() => [...document.querySelector("#studio-file").options].some(option => option.value === "README.md"));
  await page.locator("#studio-programs summary").click();
  await page.waitForFunction(() => document.querySelector("#studio-programs-status").textContent.includes("개 후보"));
  await page.locator("#studio-program-candidate").selectOption(ready.id); await page.locator("#studio-program-draft").click();
  await page.waitForFunction(() => document.querySelector("#studio-program-manifest").textContent.includes('"inputMode": "none"'));
  assert.match(await page.locator("#studio-program-download").getAttribute("href"), /^blob:/);
  assert.deepEqual((await (await api("/v1/programs")).json()).enabled, []);
  await page.locator("#studio-program-candidate").selectOption(adapter.id); assert.equal(await page.locator("#studio-program-draft").isDisabled(), true);
  assert.match(await page.locator("#studio-program-source").textContent(), /별도 어댑터 필요/);
  await page.locator("#studio-programs summary").click();
  f.setResponses([ctx => {
    const input = ctx.messages.filter(m => m.role === "user").at(-1).content;
    const text = typeof input === "string" ? input : input.filter(b => b.type === "text").map(b => b.text).join("");
    assert.match(text, /operator-configured host project/);
    assert.doesNotMatch(text, /No general shell/);
    return tool("project_ls", { path: "." });
  }, answer("프로젝트 파일 목록을 확인했습니다.")]);
  await page.locator("#studio-prompt").fill("프로젝트 파일 목록을 확인해줘."); await page.locator("#studio-send").click();
  await page.waitForFunction(() => document.querySelector("#studio-outcome").textContent.includes("실행 완료"));
  assert.equal(await page.locator("#studio-restore").isDisabled(), true);
  assert.match(await page.locator("#studio-evidence-scope").textContent(), /프로젝트 저장소 변경은.*범위에 포함되지/);
  assert.match(await page.locator("#studio-activity-list").textContent(), /도구 완료 · project_ls/);
  await page.locator("#studio-target-mode").selectOption("ui");
  // A failed real tool call is visible as failure, independently of the model's prose.
  await bench.write(owner, "fail.test.js", 'assert(false, "expected fixture failure");');
  f.setResponses([tool("workspace_test", { path: "fail.test.js" }), answer("검사 실패를 확인했습니다.")]);
  await page.locator("#studio-prompt").fill("실패하는 검사를 실행해줘."); await page.locator("#studio-send").click();
  await page.waitForFunction(() => document.querySelector("#studio-outcome").textContent.includes("실행 실패"));
  assert.match(await page.locator("#studio-activity-list").textContent(), /도구 실패 · workspace_test/);
  assert.match(await page.locator("#studio-run-status").textContent(), /실행 실패/);
  // A cancelled request can leave saved changes; the result must expose them.
  f.setResponses([tool("ui_read", {}), ctx => tool("ui_patch", { expectedRevision: lastTool(ctx).revision, edits: [{ oldText: "</main>", newText: '<p id="partial">중단 전 저장됨</p></main>' }] }), async (_ctx, options) => { if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true })); return answer("", { stopReason: "aborted" }); }]);
  await page.locator("#studio-prompt").fill("부분 변경 후 기다려줘."); await page.locator("#studio-send").click();
  await page.frameLocator("#studio-frame").locator("#partial").waitFor(); await page.locator("#studio-cancel").click();
  await page.waitForFunction(() => document.querySelector("#studio-outcome").textContent.includes("중단됨"));
  assert.match(await page.locator("#studio-run-status").textContent(), /중단됨/);
  assert.match(await page.locator("#studio-activity-list").textContent(), /중단됨/);
  await page.locator("#studio-tab-changes").click(); assert.match(await page.locator("#studio-diff").textContent(), /중단 전 저장됨/);
  assert.match(await page.locator("#studio-verification").textContent(), /검증 결과 없음/);
  // Independent later edits disable restoration against the old inspected revision.
  await bench.write(owner, "later.txt", "preserve later work"); await page.locator("#studio-refresh").click();
  await page.waitForFunction(() => document.querySelector("#studio-change-summary").textContent.includes("이후 변경 있음"));
  assert.equal(await page.locator("#studio-restore").isDisabled(), true);
  await page.locator("#studio-tab-preview").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#studio-tab-files").getAttribute("aria-selected"), "true");
  // Korean composition must not submit early.
  await page.locator("#studio-prompt").fill("조합 중"); const messageCount = await page.locator("#studio-messages article").count();
  await page.locator("#studio-prompt").dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  assert.equal(await page.locator("#studio-messages article").count(), messageCount);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#studio-tab-preview").click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  if (screenshots) await page.screenshot({ path: join(screenshots, "studio-mobile.png"), fullPage: true, animations: "disabled" });
  // A newer run from another client must not inherit this tab's old before/after pair.
  f.setResponses([answer("외부 요청을 확인했습니다.")]);
  const studioSession = await page.evaluate(() => sessionStorage.getItem("pida-studio-session"));
  await runtime.run(studioSession, owner, "다른 클라이언트의 요청");
  await page.locator("#studio-refresh").click();
  await page.waitForFunction(() => document.querySelector("#studio-outcome").textContent.includes("실행 완료"));
  assert.equal(await page.locator("#studio-change-count").textContent(), "0");
  assert.match(await page.locator("#studio-evidence-scope").textContent(), /요청 전 변경 기준이 없어/);
  assert.equal(await page.locator("#studio-restore").isDisabled(), true);
  await page.locator("#mode-disconnect").click(); assert.equal(await page.locator("#studio-source").textContent(), "");
  assert.equal(await page.locator("#studio-diff").textContent(), ""); assert.deepEqual(errors, []);
  assert.equal(await page.locator("#studio-activity-list li").count(), 0);
  console.log("PASS: actual Web UI progress through tool execution/model wait, elapsed clock, live reconnect, tool failure/cancellation; file/code work, source/diff, revision-bound evidence, guarded restore, stale evidence, keyboard/IME, mobile width and logout. Model scripted; browser/Pi/tools real.");
  }
} finally { toolGate.resolve(); modelGate.resolve(); await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
