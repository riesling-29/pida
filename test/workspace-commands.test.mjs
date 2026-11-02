// Workspace composition + actual Pi / QuickJS / local-process integration; model decisions are scripted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from '@earendil-works/pi-ai/providers/faux';
import { initWorkspace, readConfig, createWorkspace } from '../dist/workspace.js';
import { createPiProcessExecutor } from '../dist/process-executor.js';

const permissionList = ['project:read', 'project:write', 'project:execute', 'programs:compose', 'fixture:write', 'pida:recover'];
const quote = value => process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
const nodeCommand = file => (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' ' + quote(file);
const tool = (name, args) => answer(call(name, args), { stopReason: 'toolUse' });
const valueOf = context => JSON.parse(context.messages.findLast(message => message.role === 'toolResult').content.filter(block => block.type === 'text').map(block => block.text).join(''));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, timeoutMs = 5000) { const end = Date.now() + timeoutMs; while (!await check()) { if (Date.now() > end) throw new Error('Workspace condition timed out'); await delay(15); } }
async function assertStopped(project) { const path = join(project, 'heartbeat'); const before = await readFile(path, 'utf8'); await delay(120); assert.equal(await readFile(path, 'utf8'), before, 'command heartbeat stopped after executor termination'); }

async function fixture(t, { compose = false, extensions = [], commandExecutor } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'pida-workspace-commands-')), workspace = join(parent, 'workspace'), project = join(parent, 'project');
  await mkdir(project); initWorkspace(workspace);
  const config = { ...readConfig(workspace), preset: 'coding', workbench: { enabled: false }, codingPacks: [],
    tools: { directory: 'tools', enabled: [] }, permissions: permissionList,
    project: { enabled: true, root: project, trustedHost: true, timeoutSeconds: 15 },
    ...(compose ? { codemode: { enabled: true, tools: ['project_read'], timeoutMs: 5000 } } : {}),
  };
  await writeFile(join(workspace, 'pida.config.json'), JSON.stringify(config));
  const app = await createWorkspace(workspace, { extensions, ...(commandExecutor ? { commandExecutor } : {}) });
  t.after(async () => { await app.close(); await rm(parent, { recursive: true, force: true }); });
  const principal = { id: 'local-user', permissions: config.permissions };
  const model = fauxProvider({ tokensPerSecond: 100000 });
  const provider = () => ({ provider: model.provider, modelId: model.getModel().id });
  app.runtime.configureProvider(provider);
  const { sessionId } = await app.runtime.createSession(principal);
  return { app, config, workspace, project, principal, sessionId, model, provider };
}

async function startLong(f) {
  const entry = join(f.project, 'long.mjs'), pidFile = join(f.project, 'long.pid');
  await writeFile(entry, "import{writeFileSync,appendFileSync}from'node:fs';appendFileSync('starts','1');writeFileSync('long.pid',String(process.pid));let tick=0;writeFileSync('heartbeat',String(tick));console.log('COMMAND_READY');setInterval(()=>writeFileSync('heartbeat',String(++tick)),20);");
  f.model.setResponses([tool('project_command_start', { command: nodeCommand(entry), deadlineMs: 12000 }), answer('Command admitted; inspect its handle for completion.')]);
  const result = await f.app.runtime.run(f.sessionId, f.principal, 'Start the long project command.');
  assert.equal(result.status, 'completed', JSON.stringify(result));
  await eventually(() => existsSync(pidFile) && existsSync(join(f.project,'heartbeat')) && f.app.commands.list(f.principal,f.sessionId)[0]?.totalBytes > 0);
  const command = f.app.commands.list(f.principal, f.sessionId)[0], pid = Number(await readFile(pidFile, 'utf8'));
  assert.equal(command.status, 'running'); assert.ok(Number.isSafeInteger(pid) && pid > 0);
  await eventually(async () => Number(await readFile(join(f.project,'heartbeat'),'utf8')) > 1);
  return { command, pid };
}

test('workspace codemode configuration reaches main and agent inventory and nested authorized project reads', async t => {
  const f = await fixture(t, { compose: true });
  await writeFile(join(f.project, 'readme.txt'), 'WORKSPACE_READ_EVIDENCE');
  const profile = f.app.agents.register(f.principal, { name: 'reader' });
  const agent = await f.app.agents.getRuntime(profile.id, f.principal);
  agent.configureProvider(f.provider);
  const inventory = f.app.getComposition();
  for (const agentId of ['main', profile.id]) {
    const active = inventory.active.find(item => item.agentId === agentId);
    assert.ok(active.tools.some(item => item.name === 'program_compose' && item.permitted));
    assert.ok(active.tools.some(item => item.name === 'project_read' && item.permitted));
  }
  for (const runtime of [f.app.runtime, agent]) {
    let observed;
    f.model.setResponses([tool('program_compose', { code: "const result = await tools.project_read({path:'readme.txt'}); return { names: ALL_TOOLS.map(t => t.name), result };" }), context => { observed = valueOf(context); return answer('Read the configured project.'); }]);
    const { sessionId } = await runtime.createSession(f.principal);
    const result = await runtime.run(sessionId, f.principal, 'Read through the configured composition.');
    assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(observed.ok, true);
    assert.deepEqual(observed.value.names, ['project_read']); assert.equal(observed.value.result.ok, true);
    assert.match(observed.value.result.output, /WORKSPACE_READ_EVIDENCE/);
    const trace = runtime.getTrace(sessionId, f.principal), root = trace.find(e => e.type === 'tool_started' && e.toolName === 'program_compose');
    assert.ok(trace.some(e => e.type === 'tool_completed' && e.toolName === 'project_read' && e.parentToolCallId === root.toolCallId));
    const denied = { ...f.principal, permissions: ['programs:compose'] };
    f.model.setResponses([tool('program_compose', { code: "return await tools.project_read({path:'readme.txt'});" }), answer('No authorized read.')]);
    const refused = await runtime.run(sessionId, denied, 'Read without the nested grant.');
    assert.equal(refused.status, 'failed'); assert.equal(runtime.getRecovery(sessionId, f.principal).pendingEffects.length, 0);
  }
});

test('active workspace command blocks foreign runs and every host write before effects, while read/wait/cancel and explicit recovery work', async t => {
  let extensionWrites = 0;
  const f = await fixture(t, { extensions: [{ id: 'write-canary', scope: 'workspace', activate() { return { tools: [{ name: 'host_write', description: 'fixture changing tool', permission: 'fixture:write', effect: 'write', parameters: Type.Object({}), async execute() { extensionWrites++; return {}; } }] }; } }] });
  assert.ok(!f.app.runtime.getInfo(f.principal).tools.some(item => item.name === 'program_compose'), 'composition is opt-in');
  const { command, pid } = await startLong(f), other = await f.app.runtime.createSession(f.principal);
  const calls = f.model.state.callCount;
  await assert.rejects(f.app.runtime.run(other.sessionId, f.principal, 'Do other work.'), { code: 'PROJECT_COMMAND_ACTIVE' });
  assert.equal(f.model.state.callCount, calls, 'blocked work never reaches the model');
  assert.throws(() => f.app.runtime.configureProvider(f.provider), { code: 'PROVIDER_BUSY' });
  await assert.rejects(f.app.runtime.deleteSession(f.sessionId, f.principal), { code: 'PROJECT_COMMAND_ACTIVE' });
  await assert.rejects(f.app.runtime.compactSession(f.sessionId, f.principal, true), { code: 'PROJECT_COMMAND_ACTIVE' });
  for (const [name, args] of [['project_write', { path: 'blocked.txt', content: 'must not write' }], ['host_write', {}]]) {
    f.model.setResponses([tool(name, args), answer('Must not conceal rejected mutation.')]);
    const rejected = await f.app.runtime.run(f.sessionId, f.principal, `Try ${name}.`);
    assert.equal(rejected.status, 'failed'); assert.equal(f.app.runtime.getRecovery(f.sessionId, f.principal).pendingEffects.length, 0);
    assert.equal(rejected.recovery, undefined, 'pre-execution rejection must not create an uncertain effect');
  }
  assert.equal(existsSync(join(f.project, 'blocked.txt')), false); assert.equal(extensionWrites, 0);
  const observed = [];
  f.model.setResponses([
    tool('project_command_read', { id: command.id }),
    context => { observed.push(valueOf(context)); return tool('project_command_wait', { id: command.id, waitTimeoutMs: 10 }); },
    context => { observed.push(valueOf(context)); return tool('project_command_cancel', { id: command.id }); },
    context => { observed.push(valueOf(context)); return answer('Cancellation requested; verify actual exit.'); },
  ]);
  const result = await f.app.runtime.run(f.sessionId, f.principal, 'Read, wait briefly, then cancel the same command.');
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.match(observed[0].output.text, /COMMAND_READY/); assert.equal(observed[1].waitExpired, true);
  assert.equal(observed[2].disposition, 'requested'); assert.equal(observed[2].command.status, 'stopping');
  const final = await f.app.commands.wait(f.principal, f.sessionId, command.id, 5000);
  assert.equal(final.command.status, 'cancelled'); assert.equal(final.command.requiresRecovery, true); await assertStopped(f.project);
  await assert.rejects(f.app.runtime.run(f.sessionId, f.principal, 'Continue before inspection.'), { code: 'COMMAND_RECOVERY_REQUIRED' });
  assert.throws(() => f.app.commands.acknowledgeRecovery({ ...f.principal, permissions: ['project:execute'] }, f.sessionId, command.id), { code: 'FORBIDDEN' });
  f.app.commands.acknowledgeRecovery(f.principal, f.sessionId, command.id);
  f.model.setResponses([answer('Continue after host inspection.')]);
  assert.equal((await f.app.runtime.run(f.sessionId, f.principal, 'Continue.')).status, 'completed');
});

test('workspace runtime cancellation stops its managed command and retains stopping until the actual executor settles', async t => {
  const underlying = createPiProcessExecutor(process.platform === 'win32' ? 'powershell' : 'bash');
  const exited = Promise.withResolvers(), release = Promise.withResolvers();
  const executor = { capabilities: underlying.capabilities, async execute(request) { const result = await underlying.execute(request); exited.resolve(); await release.promise; return result; } };
  t.after(() => release.resolve());
  const f = await fixture(t, { commandExecutor: executor }), { command, pid } = await startLong(f);
  const waiting = Promise.withResolvers();
  f.model.setResponses([tool('project_command_wait', { id: command.id, waitTimeoutMs: 10000 }), answer('Must not report success after cancellation.')]);
  const run = f.app.runtime.run(f.sessionId, f.principal, 'Wait for this command.', event => { if (event.type === 'trace' && event.trace.type === 'tool_started' && event.trace.toolName === 'project_command_wait') waiting.resolve(); });
  await waiting.promise;
  await f.app.runtime.cancel(f.sessionId, f.principal);
  assert.equal((await run).status, 'cancelled');
  await exited.promise; await assertStopped(f.project);
  assert.equal(f.app.commands.read(f.principal, f.sessionId, command.id).command.status, 'stopping');
  release.resolve();
  assert.equal((await f.app.commands.wait(f.principal, f.sessionId, command.id, 5000)).command.status, 'cancelled');
});

test('supervisor job cancellation propagates its external signal to the agent command and stops the actual process', async t => {
  const underlying = createPiProcessExecutor(process.platform === 'win32' ? 'powershell' : 'bash');
  let cancellationReceived = false;
  const executor = { capabilities: underlying.capabilities, async execute(request) {
    request.signal.addEventListener('abort', () => { cancellationReceived = true; }, { once: true });
    return underlying.execute(request);
  } };
  const f = await fixture(t, { commandExecutor: executor }), entry = join(f.project, 'agent-long.mjs');
  await writeFile(entry, "import{writeFileSync}from'node:fs';let tick=0;writeFileSync('heartbeat',String(tick));console.log('AGENT_COMMAND_READY');setInterval(()=>writeFileSync('heartbeat',String(++tick)),20);");
  const profile = f.app.agents.register(f.principal, { name: 'command-owner' });
  const runtime = await f.app.agents.getRuntime(profile.id, f.principal);
  runtime.configureProvider(f.provider);
  let commandId;
  f.model.setResponses([
    tool('project_command_start', { command: nodeCommand(entry), deadlineMs: 12000 }),
    context => { commandId = valueOf(context).command.id; return tool('project_command_wait', { id: commandId, waitTimeoutMs: 10000 }); },
    answer('Must not report success after cancellation.'),
  ]);
  const job = f.app.agents.enqueue(profile.id, f.principal, { input: 'Start and wait for the long project command.', requestId: 'cancel-agent-command' });
  await eventually(() => f.app.agents.getJob(job.id, f.principal).currentTool === 'project_command_wait');
  await eventually(async () => existsSync(join(f.project, 'heartbeat')) && Number(await readFile(join(f.project, 'heartbeat'), 'utf8')) > 1);
  const active = f.app.agents.getJob(job.id, f.principal);
  assert.equal(f.app.commands.read(f.principal, active.sessionId, commandId).command.status, 'running');
  const cancelled = await f.app.agents.cancel(job.id, f.principal);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result.status, 'cancelled');
  assert.equal(cancellationReceived, true, 'AgentSupervisor cancellation must reach the owned process signal');
  const final = await f.app.commands.wait(f.principal, active.sessionId, commandId, 5000);
  assert.equal(final.command.status, 'cancelled'); assert.equal(final.command.requiresRecovery, true);
  await assertStopped(f.project);
});

test('whole-workspace close joins a live real command and restart preserves its uncertain handle without replay', async t => {
  const f = await fixture(t), { command, pid } = await startLong(f);
  await Promise.all([f.app.close(), f.app.close()]); await assertStopped(f.project);
  const reopened = await createWorkspace(f.workspace); t.after(() => reopened.close());
  const restored = reopened.commands.read(f.principal, f.sessionId, command.id).command;
  assert.equal(restored.status, 'cancelled'); assert.equal(restored.requiresRecovery, true);
  assert.equal(Number(await readFile(join(f.project, 'long.pid'), 'utf8')), pid);
  assert.equal(await readFile(join(f.project, 'starts'), 'utf8'), '1');
  await assert.rejects(reopened.runtime.run(f.sessionId, f.principal, 'Resume without host inspection.'), { code: 'COMMAND_RECOVERY_REQUIRED' });
});
