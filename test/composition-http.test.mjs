import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PidaRuntime, mockProvider } from '../dist/index.js';
import { PidaClient } from '../dist/client.js';
import { createPidaServer, staticTokenAuth } from '../dist/http.js';
import { createWorkspace, initWorkspace, readConfig, workspaceEnvironment } from '../dist/workspace.js';
import { createComposition, renderCompositionReport } from '../examples/web/composition.js';

function snapshot() {
  const runtime = agentId => ({ agentId, target: agentId === 'main' ? 'main' : 'agent', revision: 'a'.repeat(64), preset: 'coding',
    services: { web: true, workbench: true, project: false, agents: true },
    tools: [{ name: 'lookup', permission: 'company:read', source: 'managed-mcp', scope: 'workspace', permitted: true }],
    extensions: [{ id: 'managed-mcp', scope: 'workspace', revision: 'private factory secret', tools: ['lookup'] }],
    systemPrompt: 'PRIVATE_PROMPT', sourcePath: '/private/company/connector.js' });
  return { configuredRevision: 'b'.repeat(64), restartRequired: true, active: ['main', 'owned-agent', 'other-agent'].map(runtime),
    mcp: [{ id: 'company', transport: 'stdio', state: 'disconnected', generation: 1, reconnectAttempts: 1, maxReconnectAttempts: 3, restartRequired: false,
      tools: [{ name: 'lookup', inputSchema: { secret: 'PRIVATE_SCHEMA' }, description: 'PRIVATE_DESCRIPTION' }],
      command: '/private/bin/mcp', env: { TOKEN: 'PRIVATE_ENV' }, instructions: { text: 'PRIVATE_INSTRUCTIONS' } }],
  };
}

test('composition API requires host settings authority, filters agent ownership and exposes only its redacted DTO', async t => {
  const runtime = new PidaRuntime({ provider: mockProvider }); t.after(() => runtime.close());
  const admin = 'a'.repeat(32), reader = 'r'.repeat(32), other = 'o'.repeat(32); let reads = 0;
  const server = createPidaServer({ runtime, serveDemo: true,
    agents: { list: principal => principal.id === 'alice' ? [{ id: 'owned-agent' }] : [{ id: 'other-agent' }] },
    getComposition: () => { reads++; return snapshot(); },
    authenticate: staticTokenAuth([
      { token: admin, principal: { id: 'alice', permissions: ['pida:configure'] } },
      { token: reader, principal: { id: 'alice', permissions: ['company:read'] } },
      { token: other, principal: { id: 'bob', permissions: ['pida:configure', 'company:read'] } },
    ]),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = token => new PidaClient({ baseUrl, token: () => token });
  assert.equal((await fetch(baseUrl + '/v1/composition')).status, 401);
  await assert.rejects(client(reader).getComposition(), { code: 'FORBIDDEN', status: 403 });
  assert.equal((await fetch(baseUrl + '/v1/composition', { method: 'POST', headers: { Authorization: `Bearer ${admin}` } })).status, 405);
  assert.equal(reads, 0);
  const alice = await client(admin).getComposition(), bob = await client(other).getComposition();
  assert.deepEqual(alice.active.map(item => item.agentId), ['main', 'owned-agent']);
  assert.deepEqual(bob.active.map(item => item.agentId), ['main', 'other-agent']);
  assert.equal(alice.active[0].tools[0].permitted, false);
  assert.equal(bob.active[0].tools[0].permitted, true);
  assert.equal(alice.mcp[0].status, 'backoff');
  assert.doesNotMatch(JSON.stringify(alice), /PRIVATE_|private factory|\/private\//);
  assert.equal(alice.active[0].extensions[0].revision.length, 64);
  assert.equal((await fetch(baseUrl + '/composition.js')).status, 200);
});

test('ordinary workspace configuration is exposed through the real HTTP client without a model request', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pida-composition-http-'));
  t.after(() => rm(directory, { recursive: true, force: true })); initWorkspace(directory);
  const config = { ...readConfig(directory), preset: 'personal', workbench: { enabled: false }, tools: { directory: 'tools', enabled: [] } };
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  const app = await createWorkspace(directory);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await app.close(); });
  const client = new PidaClient({ baseUrl: `http://127.0.0.1:${app.server.address().port}`, token: () => workspaceEnvironment(directory).PIDA_API_TOKEN });
  const report = await client.getComposition();
  assert.equal(report.active[0].preset, 'personal'); assert.equal(report.active[0].services.workbench, false);
  assert.equal(report.restartRequired, false); assert.equal(report.active[0].agentId, 'main');
  config.workbench.enabled = true;
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
  const pending = await client.getComposition();
  assert.equal(pending.restartRequired, true); assert.equal(pending.active[0].services.workbench, false);
  app.runtime.configureProvider(mockProvider, { mode: 'mock', model: 'mock' });
  const afterProviderChange = await client.getComposition();
  assert.equal(afterProviderChange.restartRequired, true);
  assert.notEqual(afterProviderChange.active[0].revision, afterProviderChange.configuredRevision);
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { throw new Error('HTML interpolation is forbidden'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
}
function documentFixture() {
  const elements = new Map(['composition-settings', 'composition-content', 'composition-status', 'composition-refresh'].map(id => [id, new Element('div')]));
  return { createElement: tag => new Element(tag), getElementById: id => elements.get(id) };
}
const report = () => ({ configuredRevision: 'a'.repeat(64), restartRequired: true,
  active: [{ agentId: 'main', preset: 'personal', target: 'main', revision: 'b'.repeat(64), services: {},
    tools: [{ name: '<img src=x onerror=alert(1)>', permission: 'lookup:read', permitted: false, source: 'host', scope: 'agent' }],
    extensions: [{ id: 'host', scope: 'agent', revision: 'c'.repeat(64), tools: [] }] }],
  mcp: [{ id: 'fixture', transport: 'stdio', status: 'schema-changed', generation: 2, reconnectAttempts: 1, maxReconnectAttempts: 3, toolCount: 1, restartRequired: true }],
});

test('composition renderer uses text, shows permission/restart state, and ignores a response arriving after disconnect', async () => {
  const document = documentFixture(), content = document.getElementById('composition-content');
  renderCompositionReport(document, content, report());
  assert.match(content.textContent, /권한 없음/);
  assert.match(content.textContent, /도구 정의 변경 · 재시작 필요/);
  assert.match(content.textContent, /<img src=x onerror=alert\(1\)>/);
  let resolve, calls = 0;
  const view = createComposition({ document, client: { getComposition() { calls++; return new Promise(done => { resolve = done; }); } } });
  const first = view.refresh(); view.reset(); resolve(report()); await first;
  assert.equal(view.available, false); assert.equal(content.textContent, '');
  assert.equal(document.getElementById('composition-settings').hidden, true);
  document.getElementById('composition-refresh').onclick(); resolve(report());
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 2); assert.equal(view.available, true);
  assert.equal(document.getElementById('composition-refresh').disabled, false);
  assert.match(content.textContent, /현재 서버|서버를 다시 시작/);
});
