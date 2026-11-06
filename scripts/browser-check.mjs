// Optional browser acceptance check. Install Playwright separately; it is not a runtime dependency.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import {
  initWorkspace,
  createWorkspace,
  workspaceEnvironment,
} from "../dist/workspace.js";
const { chromium } = await import(
  process.env.PIDA_PLAYWRIGHT_MODULE ?? "playwright"
);
const directory = await mkdtemp(
  fileURLToPath(new URL("../.pida-test-browser-", import.meta.url)),
);
let app, browser, endpoint;
try {
  initWorkspace(directory);
  const portProbe = createServer().listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = portProbe.address().port;
  await new Promise((ok) => portProbe.close(ok));
  const configPath = join(directory, "pida.config.json"),
    config = JSON.parse(await readFile(configPath, "utf8"));
  config.port = port;
  await writeFile(configPath, JSON.stringify(config));
  const start = async () => {
    app = await createWorkspace(directory);
    app.server.listen(port, "127.0.0.1");
    await once(app.server, "listening");
  };
  const stop = async () => {
    app.server.closeAllConnections();
    await new Promise((ok) => app.server.close(ok));
    await app.runtime.close();
  };
  await start();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PIDA_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PIDA_BROWSER_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage({
    viewport: { width: 1365, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const token = workspaceEnvironment(directory).PIDA_API_TOKEN,
    base = `http://127.0.0.1:${port}`;
  await page.goto(`${base}/#token=${encodeURIComponent(token)}`);
  await page.locator("#mode-tabs").waitFor({ state: "visible" });
  await page.locator('#mode-tabs [data-mode="workspace"]').click();
  await page.locator("#workspace").waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(
    await page.evaluate(
      (secret) =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].some(
          (value) => value.includes(secret),
        ),
      token,
    ),
    false,
  );
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await page.locator("#prompt").fill("LOT-002의 현재 상태를 알려주세요");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "완료",
  );
  assert.match(await page.locator("#messages").textContent(), /processing/);
  assert.ok((await page.locator("#trace li").count()) >= 6);
  const sessionId = await page.evaluate(() =>
    sessionStorage.getItem("pida-session"),
  );
  await page.reload();
  await page.locator("#connection").waitFor({ state: "visible" });
  await page.locator("#token").fill(token);
  await page.locator("#token").press("Enter");
  await page.locator('#mode-tabs [data-mode="workspace"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("processing"),
  );
  await stop();
  await start();
  await page.reload();
  await page.locator("#token").fill(token);
  await page.locator("#token").press("Enter");
  await page.locator('#mode-tabs [data-mode="workspace"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("processing"),
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("pida-session")),
    sessionId,
  );
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await page.waitForFunction(
    (id) => sessionStorage.getItem("pida-session") !== id,
    sessionId,
  );
  await page.locator(".session-item").filter({ hasText: "LOT-002" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("processing"),
  );
  await page.screenshot({
    path: process.env.PIDA_DESKTOP_SCREENSHOT ?? "/tmp/pida-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: process.env.PIDA_MOBILE_SCREENSHOT ?? "/tmp/pida-mobile.png",
    fullPage: true,
  });
  // Make the approved sample tool cooperative but slow so cancel is tested deterministically.
  await stop();
  await writeFile(
    join(directory, "tools", "slow.mjs"),
    `
    import { lotStatusTool } from 'pida-core';
    export default { ...lotStatusTool, async execute(args, ctx) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
      }); return lotStatusTool.execute(args, ctx);
    }};
  `,
  );
  config.tools.enabled = ["slow.mjs"];
  await writeFile(configPath, JSON.stringify(config));
  await start();
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.reload();
  await page.locator("#token").fill(token);
  await page.locator("#token").press("Enter");
  await page.locator('#mode-tabs [data-mode="workspace"]').click();
  await page.locator("#prompt").fill("LOT-001");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#trace li")]
      .at(-1)
      ?.getAttribute("title") === "tool_started",
  );
  await page.getByRole("button", { name: "중단", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "중단됨",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "대화 삭제", exact: true }).click();
  await page.waitForFunction(
    (id) => sessionStorage.getItem("pida-session") !== id,
    sessionId,
  );
  assert.equal(
    app.runtime
      .listSessions({ id: "local-user", permissions: [] })
      .some((s) => s.sessionId === sessionId),
    false,
  );
  endpoint = createHttpServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "browser-model" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    if (payload.model === "bad-model") {
      res.writeHead(401);
      res.end("denied");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content: "OK" }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "browser", object: "chat.completion.chunk", created: 1, model: payload.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  await page.goto(`${base}/#token=${encodeURIComponent(token)}&setup=1`);
  await page.locator("#provider-preset").waitFor({ state: "visible" });
  await page.locator("#provider-preset").selectOption("local");
  await page
    .locator("#provider-url")
    .fill(`http://127.0.0.1:${endpoint.address().port}/v1`);
  await page.locator("#provider-http").check();
  await page
    .getByRole("button", { name: "모델 목록 불러오기", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#provider-model").value === "browser-model",
  );
  await page
    .getByRole("button", { name: "연결 확인 후 적용", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#provider-feedback")
      .textContent.includes("적용했습니다"),
  );
  assert.equal(
    app.runtime.getInfo({ id: "local-user", permissions: [] }).provider.model,
    "browser-model",
  );
  await page.locator("#close-settings").click();
  await page.locator('#mode-tabs [data-mode="workspace"]').click();
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await page.locator("#prompt").fill("hello");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "완료",
  );
  assert.match(await page.locator("#messages").textContent(), /OK/);
  await page.locator("#workspace-handoff").click();
  await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("이어받았습니다"));
  assert.match(await page.locator("#workspace-context").textContent(), /자동 압축 켜짐/);
  await page.locator("#open-settings").click();
  await page.locator("#provider-model").fill("bad-model");
  await page
    .getByRole("button", { name: "연결 확인 후 적용", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#provider-feedback")
      .textContent.includes("기존 설정은 유지"),
  );
  assert.equal(
    JSON.parse(await readFile(configPath, "utf8")).provider.modelId,
    "browser-model",
  );
  await page.locator("#provider-model").fill("browser-model");
  await page.locator("#provider-no-key").uncheck();
  await page.locator("#provider-key").fill("synthetic-browser-key");
  await page
    .getByRole("button", { name: "연결 확인 후 적용", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#provider-feedback")
      .textContent.includes("적용했습니다"),
  );
  assert.equal(await page.locator("#provider-key").inputValue(), "");
  assert.ok(
    !(await page.locator("body").textContent()).includes(
      "synthetic-browser-key",
    ),
  );
  await page.screenshot({
    path: "/tmp/pida-provider-settings.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator("#close-settings").click();
  await page.locator("#mode-disconnect").click();
  await page.locator("#connection").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  await stop();
  console.log(
    "PASS: authenticated launch, Korean request, tool result/trace, refresh login, restart/resume, selection, mobile overflow, cancellation, deletion, logout, model discovery, keyless/authenticated live provider apply and failure rollback; no page errors.",
  );
} finally {
  await browser?.close();
  if (endpoint?.listening) {
    endpoint.closeAllConnections();
    await new Promise((ok) => endpoint.close(ok));
  }
  if (app?.server.listening) {
    app.server.closeAllConnections();
    await new Promise((ok) => app.server.close(ok));
    await app.runtime.close();
  }
  await rm(directory, { recursive: true, force: true });
}

