// Trusted parent-process entrypoint. The ready line is a private credential transport, NOT a log.
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { initWorkspace, readConfig, createWorkspace } from '../dist/workspace.js';
import { createCollaborationPolicyClient } from '../dist/collaboration-policy-client.js';
import { ChatGPTCredentialStore } from '../dist/chatgpt-auth.js';
import { validateNativeProvider } from '../dist/provider-catalog.js';
import { lotStatusTool } from '../dist/tools.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--workspace', '--host-id', '--provider-workspace', '--persona-module'].includes(process.argv[i]) || !process.argv[i + 1]) throw Error('INVALID_HOST_ARGUMENT');
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
let app, persona, shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  if (app) { await app.close(); app.server.closeAllConnections(); if (app.server.listening) await new Promise(r => app.server.close(r)); }
  await persona?.close?.();
}
try {
  if (!args.workspace || !args['host-id']) throw Error('HOST_ARGUMENT_REQUIRED');
  const directory = resolve(args.workspace), hostId = args['host-id'];
  const policy = createCollaborationPolicyClient({ hostId, authorizationUrl: process.env.PIDA_SCHUMPETER_AUTH_URL ?? '', token: () => process.env.PIDA_SCHUMPETER_AUTH_TOKEN ?? '' });
  const policyToken = process.env.PIDA_SCHUMPETER_AUTH_TOKEN;
  if (!policyToken || policyToken.length < 32 || /[\r\n]/.test(policyToken)) throw Error('HOST_POLICY_TOKEN_REQUIRED');
  if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory() || (await readdir(directory)).length)) throw Error('HOST_WORKSPACE_NOT_EMPTY');
  await mkdir(directory, { recursive: true }); initWorkspace(directory);
  const apiToken = randomBytes(32).toString('hex'); process.env.PIDA_API_TOKEN = apiToken;
  await writeFile(join(directory, '.env'), 'PIDA_API_TOKEN=' + apiToken + '\n', { mode: 0o600 });
  const config = { ...readConfig(directory), preset: 'headless', provider: { kind: 'mock' }, tools: { directory: 'tools', enabled: [] }, codingPacks: [],
    agents: { enabled: true, maxConcurrent: 2 }, workbench: { enabled: true }, permissions: ['pida:collaborate', 'workbench:read', 'workbench:write', 'workbench:history'],
    runtime: { maxRunMs: 20000, maxProviderRetries: 0, maxOutputRetries: 0, autoCompaction: false, maxTotalTokens: 16384 } };
  let nativeCredentials;
  if (args['provider-workspace']) {
    const providerDirectory = resolve(args['provider-workspace']);
    if (providerDirectory === directory) throw Error('HOST_PROVIDER_WORKSPACE_MUST_BE_DISTINCT');
    const approved = JSON.parse(await readFile(join(providerDirectory, 'pida.config.json'), 'utf8'));
    if (approved.provider?.kind !== 'native' || approved.provider.authMode !== 'chatgpt') throw Error('HOST_PROVIDER_PROFILE_UNSUPPORTED');
    config.provider = { ...approved.provider, thinkingLevel: 'low' }; validateNativeProvider(config.provider);
    nativeCredentials = new ChatGPTCredentialStore(providerDirectory, approved.stateDir);
    if (!nativeCredentials.status().connected) throw Error('HOST_PROVIDER_CREDENTIAL_UNAVAILABLE');
  }
  await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config, null, 2) + '\n');
  if (args['persona-module']) {
    const module = await import(pathToFileURL(resolve(args['persona-module'])).href);
    if (typeof module.createHostPersona !== 'function') throw Error('HOST_PERSONA_MODULE_INVALID');
    persona = await module.createHostPersona({ hostId, workspaceDirectory: directory, async taskScope(taskId, agentId) {
      if (!app?.agents || agentId === 'main') return { organizationSessionId: 'host-session:main' };
      const principal = { id: 'local-user', permissions: [] }, job = app.agents.getJob(taskId, principal);
      if (job.agentId !== agentId) throw Error('HOST_PERSONA_TASK_MISMATCH');
      for (const org of app.agents.listOrganizations(principal)) {
        const view = await app.agents.getOrganization(org.id, principal);
        if (view.tasks.some(t => t.id === job.organizationTaskId)) return { organizationSessionId: org.id };
      }
      return { organizationSessionId: 'host-session:standalone' };
    } });
    if (typeof persona?.personaProvider !== 'function' || typeof persona?.close !== 'function' || !/^[A-Za-z0-9._/-]{1,100}$/.test(persona.mode ?? '')) throw Error('HOST_PERSONA_MODULE_INVALID');
  }
  if (config.provider.kind === 'mock') {
    config.permissions.push('lots:read'); await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config, null, 2) + '\n');
  }
  app = await createWorkspace(directory, { collaboration: policy, nativeCredentials,
    ...(config.provider.kind === 'mock' ? { extensions: [{ id: 'host-synthetic-lot', scope: 'workspace', activate: () => ({ tools: [lotStatusTool] }) }] } : {}),
    ...(persona ? { personaProvider: persona.personaProvider } : {}) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const capabilities = app.agents.collaborationCapabilities({ id: 'local-user', permissions: ['pida:agents'] });
  process.stdout.write(JSON.stringify({ type: 'pida-host-ready', protocol: 'pida.local-host/1', host_id: hostId,
    base_url: 'http://127.0.0.1:' + app.server.address().port, api_token: apiToken, principal_id: 'local-user', capabilities,
    provider_mode: config.provider.kind === 'mock' ? 'mock' : 'configured-native-chatgpt', persona_mode: persona?.mode ?? 'pida-local' }) + '\n');
  process.stdin.resume(); process.stdin.once('end', () => { void shutdown().catch(() => { process.exitCode = 1; }); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().catch(() => { process.exitCode = 1; }); });
} catch (error) {
  await shutdown().catch(() => {});
  const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code ?? error.message ?? '') ? error.code ?? error.message : 'PIDA_HOST_START_FAILED';
  process.stderr.write(code + '\n'); process.exitCode = 1;
}
