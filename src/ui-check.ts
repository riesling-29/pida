import { randomBytes, createHash } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { uiFrame, uiFramePolicy } from "./ui-frame.js";

const object = (properties: Record<string, any>) => Type.Object(properties, { additionalProperties: false });
const selector = Type.String({ minLength: 1, maxLength: 500 });
const text = Type.String({ maxLength: 500 });
const expectedText = { visibleText: Type.Optional(text) };
export const uiCheckParameters = object({
  steps: Type.Optional(Type.Array(Type.Union([
    object({ click: selector, ...expectedText }),
    object({ fill: selector, value: text, ...expectedText }),
    object({ select: selector, value: text, ...expectedText }),
    object({ visible: selector, ...expectedText }),
    object({ count: selector, equals: Type.Integer({ minimum: 0, maximum: 1000 }), ...expectedText }),
    object({ visibleText: Type.String({ minLength: 1, maxLength: 500 }) }),
  ]), { maxItems: 20 })),
  viewport: Type.Optional(object({
    width: Type.Integer({ minimum: 320, maximum: 1920 }),
    height: Type.Integer({ minimum: 320, maximum: 1200 }),
  })),
});
export type UiCheckStep = ({ click: string } | { fill: string; value: string } | { select: string; value: string }
  | { visible: string } | { count: string; equals: number } | { visibleText: string }) & { visibleText?: string };
export type UiCheckViewport = { width: number; height: number };
export function uiCheckDefinition(steps: UiCheckStep[] = [], viewport: UiCheckViewport = { width: 1280, height: 820 }) {
  if (!Value.Check(uiCheckParameters, { steps, viewport })) throw new Error("INVALID_UI_CHECK");
  return { steps, viewport };
}

/** Fresh browser per check; no profile, credentials, arbitrary evaluator, or network access. */
export async function checkUi(html: string, steps: UiCheckStep[], signal: AbortSignal,
  options: { viewport?: UiCheckViewport; timeoutMs?: number } = {}) {
  const started = Date.now(), revision = createHash("sha256").update(html).digest("hex");
  let definition: ReturnType<typeof uiCheckDefinition>;
  try {
    definition = uiCheckDefinition(steps, options.viewport);
    if (Buffer.byteLength(html) > 131072) throw new Error("INVALID_UI_CHECK");
  } catch { return { ok: false, error: "INVALID_UI_CHECK", revision, checks: [], errors: [] }; }
  const viewport = `${definition.viewport.width}x${definition.viewport.height}`;
  const checks: (UiCheckStep & { ok: boolean })[] = [], errors: string[] = [];
  let browser: import("playwright").Browser | undefined;
  let failedStep: number | undefined, timedOut = false, finished = false;
  const timeoutMs = Math.min(30000, Math.max(100, Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 15000));
  const failure = (error: string) => ({ ok: false, error, revision, scope: "isolated-browser", viewport,
    checks, errors, ...(failedStep === undefined ? {} : { failedStep }), elapsedMs: Date.now() - started,
    hint: error === "BROWSER_UNAVAILABLE"
      ? "Install the optional playwright package and Chromium, or set the server-only PIDA_BROWSER_EXECUTABLE to a compatible browser."
      : "Only the recorded steps were attempted. Check the failed step and script errors; no source was changed." });
  if (signal.aborted) return failure("UI_CHECK_CANCELLED");

  // Launch is included in the deadline. If it completes after cancellation, close that late browser too.
  let interrupt!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => { interrupt = () => {
    void browser?.close().catch(() => {});
    reject(new Error("UI_CHECK_INTERRUPTED"));
  }; });
  signal.addEventListener("abort", interrupt, { once: true });
  const timer = setTimeout(() => { timedOut = true; interrupt(); }, timeoutMs);
  const run = async () => {
    const { chromium } = await import("playwright");
    if (finished || signal.aborted || timedOut) throw new Error("UI_CHECK_INTERRUPTED");
    browser = await chromium.launch({ headless: true, timeout: Math.min(10000, timeoutMs),
      ...(process.env.PIDA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIDA_BROWSER_EXECUTABLE } : {}) });
    if (finished || signal.aborted || timedOut) { await browser.close().catch(() => {}); throw new Error("UI_CHECK_INTERRUPTED"); }
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", viewport: definition.viewport });
    const nonce = randomBytes(24).toString("base64");
    await context.route("**/*", async route => {
      if (route.request().url() === "http://pida-check.invalid/") await route.fulfill({ contentType: "text/html",
        body: '<style>html,body{margin:0;width:100%;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style><iframe id="app" sandbox="allow-scripts" src="/frame"></iframe>' });
      else if (route.request().url() === "http://pida-check.invalid/frame") await route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": uiFramePolicy(nonce) }, body: uiFrame(nonce) });
      else await route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    page.on("pageerror", error => { if (errors.length < 20) errors.push(error.message.slice(0, 500)); });
    await page.goto("http://pida-check.invalid/");
    await page.evaluate(html => {
      window.addEventListener("message", event => { if (event.source === document.querySelector("iframe")?.contentWindow && event.data?.type === "pida:rendered") document.body.dataset.rendered = "yes"; });
      document.querySelector("iframe")!.contentWindow!.postMessage({ type: "pida:render", html }, "*");
    }, html);
    await page.waitForSelector('body[data-rendered="yes"]');
    const frame = page.frameLocator("#app");
    for (const [index, step] of definition.steps.entries()) {
      failedStep = index;
      try {
        if ("click" in step) await frame.locator(step.click).click();
        else if ("fill" in step) await frame.locator(step.fill).fill(step.value);
        else if ("select" in step) await frame.locator(step.select).selectOption(step.value);
        else if ("visible" in step) await frame.locator(step.visible).waitFor({ state: "visible" });
        else if ("count" in step) {
          // Count is a snapshot assertion, not a claim about visibility. Add :visible when required.
          const count = await frame.locator(step.count).count();
          if (count !== step.equals) throw new Error("UI_CHECK_COUNT_MISMATCH");
        }
        if (step.visibleText) await frame.getByText(step.visibleText, { exact: false }).first().waitFor({ state: "visible" });
        if (finished || signal.aborted || timedOut) throw new Error("UI_CHECK_INTERRUPTED");
        checks.push({ ...step, ok: true });
      } catch { if (!finished) checks.push({ ...step, ok: false }); throw new Error("UI_CHECK_STEP_FAILED"); }
    }
    failedStep = undefined;
    const visibleText = (await frame.locator("body").innerText()).slice(0, 4000);
    if (finished || signal.aborted || timedOut) throw new Error("UI_CHECK_INTERRUPTED");
    return { ok: errors.length === 0, ...(errors.length ? { error: "UI_CHECK_FAILED" } : {}), revision, scope: "isolated-browser", viewport,
      checks, errors, visibleText, elapsedMs: Date.now() - started };
  };
  try { return await Promise.race([run(), interrupted]); }
  catch { return failure(signal.aborted ? "UI_CHECK_CANCELLED" : timedOut ? "UI_CHECK_TIMEOUT" : browser ? "UI_CHECK_FAILED" : "BROWSER_UNAVAILABLE"); }
  finally {
    finished = true; clearTimeout(timer); signal.removeEventListener("abort", interrupt);
    // Do not let an unresponsive page hold the request beyond the execution deadline.
    if (browser) { let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([browser.close().catch(() => {}), new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 1000); })]);
      clearTimeout(cleanupTimer);
    }
  }
}
