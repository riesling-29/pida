import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { initWorkspace, readConfig, createWorkspace, checkWorkspace } from '../dist/workspace.js';

test('project CLI grants explicit file/shell capabilities, survives workspace load and disables cleanly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pida-project-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'agent'), project = join(directory, 'repo');
  await mkdir(project); initWorkspace(workspace);
  const config = readConfig(workspace); config.tools.enabled = [];
  await writeFile(join(workspace, 'pida.config.json'), JSON.stringify(config));
  const envBefore = await readFile(join(workspace, '.env'), 'utf8');
  const cli = (...args) => execFileSync(process.execPath, ['dist/cli.js', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  cli('project', 'enable', project, workspace);
  assert.equal(readConfig(workspace).project.trustedHost, false);
  assert.ok(readConfig(workspace).permissions.includes('project:write'));
  let app = await createWorkspace(workspace);
  const principal = { id: 'local-user', permissions: readConfig(workspace).permissions };
  let info = app.runtime.getInfo(principal);
  assert.ok(info.tools.some(t => t.name === 'project_edit' && t.permitted));
  assert.ok(!info.tools.some(t => t.name === 'project_shell'));
  await app.runtime.close();
  cli('project', 'enable', project, workspace, '--trusted-host');
  app = await createWorkspace(workspace);
  info = app.runtime.getInfo({ ...principal, permissions: readConfig(workspace).permissions });
  assert.ok(info.tools.some(t => t.name === 'project_shell' && t.permitted));
  await app.runtime.close();
  cli('project', 'disable', workspace);
  assert.equal(readConfig(workspace).project, undefined);
  assert.ok(!readConfig(workspace).permissions.some(p => p.startsWith('project:')));
  assert.equal(await readFile(join(workspace, '.env'), 'utf8'), envBefore);
});
test('doctor diagnoses missing company header references without printing credentials', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'pida-header-doctor-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  initWorkspace(workspace);
  const config = readConfig(workspace); config.tools.enabled = [];
  config.provider = { kind: 'endpoint', api: 'openai-completions', baseUrl: 'https://example.invalid/v1', modelId: 'fixture',
    apiKeyEnv: 'PIDA_TEST_NO_KEY', authMode: 'none', contextWindow: 8192, maxTokens: 1024, headersEnv: { 'X-Company': 'PIDA_TEST_MISSING_HEADER_8C31' } };
  await writeFile(join(workspace, 'pida.config.json'), JSON.stringify(config));
  const report = checkWorkspace(workspace);
  assert.equal(report.ok, false); assert.match(report.problems.join(' '), /header environment/);
  assert.ok(!JSON.stringify(report).includes('PIDA_TEST_MISSING_HEADER_8C31'));
});

test('terminal model configuration preserves same-target company options and drops them for a new destination', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'pida-terminal-config-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  initWorkspace(workspace);
  const config = readConfig(workspace);
  const headersEnv = { 'Authorization': 'PIDA_TEST_CUSTOM_AUTH' };
  const compat = { maxTokensField: 'max_tokens', supportsUsageInStreaming: false };
  config.provider = { kind: 'endpoint', api: 'openai-completions', baseUrl: 'https://example.invalid/v1',
    modelId: 'first', apiKeyEnv: 'PIDA_LLM_API_KEY', authMode: 'none', contextWindow: 8192, maxTokens: 1024, headersEnv, compat };
  await writeFile(join(workspace, 'pida.config.json'), JSON.stringify(config));
  // Exercise the actual prompt/save path; only emulate the terminal capability flag.
  async function configure(url, model) {
    const answers = ['', '', url, model, '', '', ''];
    const child = spawn(process.execPath, ['--import', 'data:text/javascript,Object.defineProperty(process.stdin,"isTTY",{value:true})',
      'dist/cli.js', 'configure', workspace, '--terminal'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', pending = '', index = 0;
    child.stdout.on('data', chunk => {
      output += chunk; pending += chunk;
      while (pending.includes(']: ') && index < answers.length) {
        pending = pending.slice(pending.indexOf(']: ') + 3);
        child.stdin.write(answers[index++] + '\n');
      }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    const timeout = setTimeout(() => child.kill(), 10000);
    const code = await new Promise((accept, reject) => { child.on('error', reject); child.on('close', accept); });
    clearTimeout(timeout);
    assert.equal(code, 0, output);
    assert.equal(index, answers.length, output);
  }
  await configure('https://example.invalid/v1/', 'second');
  let provider = readConfig(workspace).provider;
  assert.equal(provider.modelId, 'second'); assert.equal(provider.authMode, 'none');
  assert.deepEqual(provider.headersEnv, headersEnv); assert.deepEqual(provider.compat, compat);
  await configure('https://other.invalid/v1', 'third');
  provider = readConfig(workspace).provider;
  assert.equal(provider.headersEnv, undefined); assert.equal(provider.compat, undefined);
  assert.equal(provider.authMode, undefined);
});
