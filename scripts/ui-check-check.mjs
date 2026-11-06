import assert from 'node:assert/strict';
import { checkUi } from '../dist/ui-check.js';
const html = '<!doctype html><html><body><button id="analysis">분석</button><main id="content">홈</main><script>document.querySelector("#analysis").addEventListener("click",()=>document.querySelector("#content").textContent="분석 화면");</script></body></html>';
const signal = new AbortController().signal;
const result = await checkUi(html, [{ click: '#analysis', visibleText: '분석 화면' }], signal);
if (result.error === 'BROWSER_UNAVAILABLE') { console.error('BLOCKED: Chromium is unavailable. Install the optional browser or set PIDA_BROWSER_EXECUTABLE. No browser test passed.'); process.exit(2); }
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.checks.length, 1);
const bad = await checkUi(html.replace('</script>', 'throw new Error("synthetic-ui-error");</script>'), [], signal);
assert.equal(bad.ok, false); assert.match(bad.errors.join(' '), /synthetic-ui-error/);
const blocked = await checkUi(html.replace('document.querySelector("#content").textContent="분석 화면"', 'fetch("https://example.com/").then(()=>document.querySelector("#content").textContent="unexpected network").catch(()=>document.querySelector("#content").textContent="network blocked")'), [{ click: '#analysis', visibleText: 'network blocked' }], signal);
assert.equal(blocked.ok, true, JSON.stringify(blocked));
const dashboard = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>#mobile{display:none}@media(max-width:480px){#mobile{display:block}#desktop{display:none}}</style></head><body>
<section id="alerts"><h2>점검 알림</h2><button id="open-a">설비 A</button><button id="open-b">설비 B</button></section>
<div id="detail" hidden>설비 상세<select id="status"><option>점검</option><option>가동</option></select></div>
<input id="search"><ul id="equipment"><li>설비 A</li><li>설비 B</li></ul><p id="mobile">모바일 화면</p><p id="desktop">데스크톱 화면</p>
<script>
document.querySelector('#open-a').addEventListener('click',()=>document.querySelector('#detail').hidden=false);
document.querySelector('#status').addEventListener('change',event=>{if(event.target.value==='가동')document.querySelector('#open-a').remove()});
document.querySelector('#search').addEventListener('input',event=>document.querySelectorAll('#equipment li').forEach(li=>li.hidden=!li.textContent.includes(event.target.value)));
</script></body></html>`;
const steps = [
  { visible: '#alerts', visibleText: '점검 알림' }, { count: '#alerts button:visible', equals: 2 },
  { fill: '#search', value: '설비 A' }, { count: '#equipment li:visible', equals: 1 },
  { click: '#open-a', visibleText: '설비 상세' }, { select: '#status', value: '가동' },
  { count: '#alerts button', equals: 1 }, { visibleText: '모바일 화면' },
];
const mobile = await checkUi(dashboard, steps, signal, { viewport: { width: 390, height: 844 } });
assert.equal(mobile.ok, true, JSON.stringify(mobile)); assert.equal(mobile.viewport, '390x844'); assert.equal(mobile.checks.length, 8);
const failed = await checkUi(dashboard, [{ visible: '#alerts' }, { count: '#alerts button', equals: 3 }], signal);
assert.equal(failed.ok, false); assert.equal(failed.failedStep, 1); assert.deepEqual(failed.checks.map(c=>c.ok), [true, false]);
const hidden = await checkUi(dashboard, [{ visible: '#detail' }], signal);
assert.equal(hidden.error, 'UI_CHECK_FAILED'); assert.equal(hidden.failedStep, 0);
const timeout = await checkUi(dashboard, [{ visible: '#never-created' }], signal, { timeoutMs: 1200 });
assert.equal(timeout.error, 'UI_CHECK_TIMEOUT'); assert.equal(timeout.ok, false); assert.ok(timeout.elapsedMs < 5000);
const cancelled = new AbortController(), timer = setTimeout(()=>cancelled.abort(), 1200);
const stopped = await checkUi(dashboard, [{ visible: '#never-created' }], cancelled.signal); clearTimeout(timer);
assert.equal(stopped.error, 'UI_CHECK_CANCELLED'); assert.equal(stopped.ok, false);
console.log('PASS: real Chromium service renderer, menu click, script errors, network denial, mobile viewport, panel visibility, search fill/filter, select/status/count, failure scope, timeout and cancellation.');
