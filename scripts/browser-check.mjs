// Optional browser acceptance check. Install Playwright separately; it is not a runtime dependency.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createServer } from "node:net";
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
let app, browser;
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
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("processing"),
  );
  await stop();
  await start();
  await page.reload();
  await page.locator("#token").fill(token);
  await page.locator("#token").press("Enter");
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
  await page.locator("#prompt").fill("LOT-001");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#trace li")]
      .at(-1)
      ?.textContent.includes("tool_started"),
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
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.locator("#connection").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  await stop();
  console.log(
    "PASS: authenticated launch, Korean request, tool result/trace, refresh login, restart/resume, selection, mobile overflow, cancellation, deletion, logout; no page errors.",
  );
} finally {
  await browser?.close();
  if (app?.server.listening) {
    app.server.closeAllConnections();
    await new Promise((ok) => app.server.close(ok));
    await app.runtime.close();
  }
  await rm(directory, { recursive: true, force: true });
}
