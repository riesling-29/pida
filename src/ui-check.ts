import { randomBytes, createHash } from "node:crypto";
import { uiFrame, uiFramePolicy } from "./ui-frame.js";

/** Fresh browser per check, no credentials/profile, all external requests denied. */
export async function checkUi(html: string, steps: { click: string; visibleText?: string }[], signal: AbortSignal) {
  const revision = createHash("sha256").update(html).digest("hex");
  let browser: import("playwright").Browser | undefined;
  const errors: string[] = [];
  const timeout = AbortSignal.timeout(15000);
  const abort = AbortSignal.any([signal, timeout]);
  const stop = () => { void browser?.close(); };
  abort.addEventListener("abort", stop, { once: true });
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, timeout: 10000,
      ...(process.env.PIDA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIDA_BROWSER_EXECUTABLE } : {}) });
    if (abort.aborted) return { ok: false, error: "UI_CHECK_CANCELLED", revision };
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", viewport: { width: 1280, height: 820 } });
    const nonce = randomBytes(24).toString("base64");
    await context.route("**/*", async route => {
      if (route.request().url() === "http://pida-check.invalid/") await route.fulfill({ contentType: "text/html", body: '<iframe id="app" sandbox="allow-scripts" src="/frame" style="width:1280px;height:820px"></iframe>' });
      else if (route.request().url() === "http://pida-check.invalid/frame") await route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": uiFramePolicy(nonce) }, body: uiFrame(nonce) });
      else await route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    page.on("pageerror", error => { if (errors.length < 20) errors.push(error.message.slice(0, 500)); });
    await page.goto("http://pida-check.invalid/");
    await page.evaluate(html => {
      window.addEventListener("message", event => { if (event.data?.type === "pida:rendered") document.body.dataset.rendered = "yes"; });
      document.querySelector("iframe")!.contentWindow!.postMessage({ type: "pida:render", html }, "*");
    }, html);
    await page.waitForSelector('body[data-rendered="yes"]');
    const frame = page.frameLocator("#app");
    const checks = [];
    for (const step of steps) {
      await frame.locator(step.click).click();
      if (step.visibleText) await frame.getByText(step.visibleText, { exact: false }).first().waitFor({ state: "visible" });
      checks.push({ ...step, ok: true });
    }
    const text = await frame.locator("body").innerText();
    return { ok: errors.length === 0, revision, scope: "isolated-browser", viewport: "1280x820", checks, errors, visibleText: text.slice(0, 4000) };
  } catch {
    return { ok: false, revision, error: abort.aborted ? "UI_CHECK_CANCELLED" : browser ? "UI_CHECK_FAILED" : "BROWSER_UNAVAILABLE", errors,
      hint: browser ? "Check the selector, expected visible text, and script errors. No source was changed." : "Install the optional playwright package and run npx playwright install chromium on the server." };
  } finally {
    abort.removeEventListener("abort", stop); await browser?.close().catch(() => {});
  }
}
