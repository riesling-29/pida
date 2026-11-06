// Real browser, Pi OAuth callback, Pida HTTP and tools; OpenAI token/inference responses are synthetic.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { chromium } from "playwright";
import { initWorkspace, createWorkspace, workspaceEnvironment } from "../dist/workspace.js";
import { ProviderSettings } from "../dist/provider-settings.js";
import { createPidaServer, staticTokenAuth } from "../dist/http.js";
import { protocolFixture, modelId, callbackURL } from "../test/fixtures/chatgpt-protocol.mjs";
const directory = await mkdtemp(fileURLToPath(new URL("../.pida-test-chatgpt-browser-", import.meta.url))), originalFetch = globalThis.fetch;
let app, settings, server, browser;
try {
  initWorkspace(directory); app = await createWorkspace(directory); settings = new ProviderSettings(directory, app.runtime);
  const protocol = protocolFixture(originalFetch); globalThis.fetch = protocol.fetch;
  const token = workspaceEnvironment(directory).PIDA_API_TOKEN;
  const options = { runtime: app.runtime, workbench: app.workbench, providerSettings: settings, serveDemo: true, authenticate: staticTokenAuth([{ token, principal: { id: "local-user", permissions: [...app.config.permissions, "pida:configure"] } }]) };
  server = createPidaServer(options); server.listen(0, "127.0.0.1"); await once(server, "listening"); options.allowedOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PIDA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIDA_BROWSER_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }), errors = [];
  page.setDefaultTimeout(15000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${options.allowedOrigin}/#token=${token}`); await page.locator("#mode-tabs").waitFor({ state: "visible" });
  await page.locator("#open-settings").click(); await page.locator("#provider-preset").selectOption("openai"); await page.locator("#openai-auth").selectOption("chatgpt");
  assert.equal(await page.locator("#provider-key-row").isVisible(), false); assert.equal(await page.locator("#apply-provider").isDisabled(), true);
  await page.locator("#chatgpt-login").click(); await page.locator("#chatgpt-login-link").waitFor();
  assert.equal(await page.locator("#provider-preset").isDisabled(), true);
  // Reload while the upstream callback waits: tab-local ID restores a cancellable flow.
  await page.reload(); await page.locator("#token").fill(token); await page.locator("#connect").click();
  await page.locator("#mode-tabs").waitFor({ state: "visible" }); await page.locator("#open-settings").click(); await page.locator("#chatgpt-login-link").waitFor();
  const authUrl = await page.locator("#chatgpt-login-link").getAttribute("href");
  await fetch(callbackURL({ authUrl }));
  await page.waitForFunction(() => document.querySelector("#provider-feedback").textContent.includes("모델을 선택하고"));
  assert.equal(await page.locator("#native-model-select option").count(), 2);
  assert.equal(await page.locator("#chatgpt-login-link").getAttribute("href"), null);
  assert.equal(await page.evaluate(() => JSON.stringify([...Object.values(localStorage), ...Object.values(sessionStorage)]).includes("oauth-fixture")), false);
  await page.locator("#native-model-select").selectOption(modelId); await page.locator("#apply-provider").click();
  await page.waitForFunction(() => document.querySelector("#provider-feedback").textContent.includes("적용했습니다"));
  assert.match(await page.locator("#model").textContent(), /ChatGPT/);
  if (process.env.PIDA_SCREENSHOT_DIR) { await mkdir(process.env.PIDA_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.PIDA_SCREENSHOT_DIR, "chatgpt-settings.png"), animations: "disabled" }); }
  // Later login cancellation must keep the applied account usable.
  await page.locator("#chatgpt-login").click(); await page.locator("#chatgpt-login-link").waitFor(); await page.locator("#chatgpt-cancel").click();
  await page.waitForFunction(() => document.querySelector("#provider-feedback").textContent.includes("취소했습니다"));
  assert.match(await page.locator("#chatgpt-state").textContent(), /저장됨/);
  await page.locator("#chatgpt-logout").click();
  await page.waitForFunction(() => document.querySelector("#provider-feedback").textContent.includes("연결을 해제했습니다"));
  assert.equal(await page.locator("#apply-provider").isDisabled(), true);
  await page.locator("#openai-auth").selectOption("api-key"); assert.equal(await page.locator("#provider-key-row").isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator("#openai-auth").selectOption("chatgpt");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.deepEqual(errors, []);
  console.log("PASS: ChatGPT auth selection, real upstream callback with synthetic exchange, pending-login reload, account catalog, apply, cancel preserves connection, local logout/no fallback, secret-free browser storage and mobile width. No live OpenAI calls.");
} finally {
  await browser?.close(); await settings?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await app?.runtime.close(); globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true });
}
