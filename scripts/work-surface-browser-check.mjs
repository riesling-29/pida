// Real Chromium + HTTP + Pi tools. Scripted model decisions; no live provider or Windows claim.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { PidaRuntime, PidaWorkbench, WorkSurface, workbenchPermissions } from '../dist/index.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
const root = mkdtempSync(join(tmpdir(), 'pida-work-browser-')), token = 'fixture-'.repeat(8);
const owner = { id: 'fixture', permissions: workbenchPermissions }, checks = [];
let browser, server, runtime, calls = 0;
try {
  const b = new PidaWorkbench(join(root, 'bench'));
  await b.uiTemplate(owner, 'sidebar', ''); await b.write(owner, 'a.txt', 'one\ntwo\n'); await b.write(owner, 'b.txt', 'other\n');
  const f = fauxProvider(); f.setResponses([() => { calls++; return answer(call('workspace_write', { path: 'a.txt', content: 'changed\n' }), { stopReason: 'toolUse' }); }, () => { calls++; return answer('done'); }]);
  runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), providerInfo: { mode: 'endpoint', model: 'scripted browser fixture' }, tools: b.tools(),
    storageDir: join(root, 'runtime'), workSurface: new WorkSurface(join(root, 'reviews'), b), inspectArtifacts: p => b.captureArtifacts(p) });
  server = createPidaServer({ runtime, workbench: b, serveDemo: true, authenticate: staticTokenAuth([{ token, principal: owner }]) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch({ headless: true, ...(process.env.PIDA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PIDA_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('PAGE_ERROR:', e.message); });
  page.on('response', response => { if (response.status() >= 400) console.error('HTTP:', response.status(), new URL(response.url()).pathname); });
  await page.goto(`http://127.0.0.1:${server.address().port}/#token=${token}`);
  await page.waitForFunction(() => !document.getElementById('mode-tabs').hidden, null, { timeout: 5000 }).catch(async error => {
    console.error('CONNECT_ERROR:', await page.locator('#error').textContent(), 'PAGE_ERRORS:', errors); throw error;
  });
  await page.locator('#mode-tabs [data-mode="studio"]').click();
  await page.locator('#studio-target-mode').selectOption('files');
  await page.locator('#studio-file').selectOption('a.txt');
  await page.waitForFunction(() => !document.getElementById('studio-bind-file').disabled);
  await page.locator('#studio-range-start').fill('2'); await page.locator('#studio-range-end').fill('2'); await page.locator('#studio-bind-file').click();
  await page.locator('#studio-file').selectOption('b.txt');
  assert.match(await page.locator('#studio-binding').textContent(), /a.txt:2–2/); checks.push('binding remains A while viewing B');
  await b.write(owner, 'a.txt', 'newer\nversion\n');
  await page.locator('#studio-prompt').fill('선택한 파일을 바꿔 주세요'); await page.locator('#studio-send').click();
  await page.waitForFunction(() => document.getElementById('studio-messages').textContent.includes('고정한 뒤 파일이 바뀌었습니다'));
  assert.equal(await page.locator('#studio-prompt').inputValue(), '선택한 파일을 바꿔 주세요'); assert.equal(calls, 0); checks.push('stale target retains draft and invokes zero model calls');
  await page.locator('#studio-file').selectOption('a.txt');
  await page.waitForFunction(() => document.getElementById('studio-source').textContent.includes('version'));
  await page.locator('#studio-bind-file').click(); await page.locator('#studio-send').click();
  await page.waitForFunction(() => document.getElementById('studio-common-review').textContent.includes('+changed'));
  assert.equal(calls, 2); checks.push('actual Pi writes target and server review contains interval diff');
  await page.reload();
  await page.locator('#token').fill(token); await page.locator('#connection-form').evaluate(form => form.requestSubmit());
  await page.locator('#mode-tabs [data-mode="studio"]').click();
  await page.waitForFunction(() => document.getElementById('studio-common-review').textContent.includes('+changed'));
  assert.equal(calls, 2); checks.push('reload reopens same review without replay');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator('#studio-prompt').isVisible(), true);
    assert.equal(await page.locator('#studio-binding').isVisible(), true);
    assert.equal(await page.locator('#studio-send').isVisible(), true);
    checks.push(`composer and binding reachable at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', checks, model: 'scripted Pi', platform: process.platform }, null, 2));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ status: 'PASS', checks, model: 'scripted Pi', platform: process.platform }, null, 2) + '\n');
} finally {
  await browser?.close(); await runtime?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
  rmSync(root, { recursive: true, force: true });
}
