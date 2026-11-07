// Trusted parent-process entrypoint. The ready line is a private credential transport, NOT a log.
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { initWorkspace, readConfig, createWorkspace } from '../dist/workspace.js';
import { createCollaborationPolicyClient } from '../dist/collaboration-policy-client.js';
import { ChatGPTCredentialStore } from '../dist/chatgpt-auth.js';
import { validateNativeProvider } from '../dist/provider-catalog.js';
import { lotStatusTool } from '../dist/tools.js';
import { unlockWorkspaceState } from '../dist/workspace-unlock.js';
import { digest, sourceDigest, validateHostManifest, saveHostFile, acquireHostLock } from './host-workspace.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--workspace', '--host-id', '--workspace-mode', '--provider-workspace', '--persona-module'].includes(process.argv[i]) || !process.argv[i + 1] || args[process.argv[i].slice(2)] !== undefined) throw Error('INVALID_HOST_ARGUMENT');
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
let app, persona, shutdownPromise, releaseHostLock;
function shutdown() {
  return shutdownPromise ??= (async () => {
    // Stop accepting first. A rejected or stuck runtime must not retain its HTTP listener.
    const actions = [];
    if (app) {
      actions.push(new Promise((resolve, reject) => {
        if (!app.server.listening) return resolve();
        app.server.close(error => error ? reject(error) : resolve()); app.server.closeAllConnections();
      }));
      actions.push(Promise.resolve().then(() => app.close()));
    }
    actions.push(Promise.resolve().then(() => persona?.close?.()));
    let timer;
    try {
      const results = await Promise.race([Promise.allSettled(actions), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('HOST_SHUTDOWN_TIMEOUT')), 5000);
      })]);
      if (results.some(result => result.status === 'rejected')) throw Error('HOST_SHUTDOWN_FAILED');
    } finally { clearTimeout(timer); releaseHostLock?.(); }
  })();
}
function stop() {
  void shutdown().then(() => process.exit(0), error => {
    process.stderr.write(error.message === 'HOST_SHUTDOWN_TIMEOUT' ? 'HOST_SHUTDOWN_TIMEOUT\n' : 'HOST_SHUTDOWN_FAILED\n'); process.exit(1);
  });
}
try {
  if (!args.workspace || !args['host-id']) throw Error('HOST_ARGUMENT_REQUIRED');
  const directory = resolve(args.workspace), hostId = args['host-id'];
  const workspaceMode = args['workspace-mode'] ?? 'fresh';
  if (!['fresh', 'resume'].includes(workspaceMode)) throw Error('HOST_WORKSPACE_MODE_INVALID');
  const policy = createCollaborationPolicyClient({ hostId, authorizationUrl: process.env.PIDA_SCHUMPETER_AUTH_URL ?? '', token: () => process.env.PIDA_SCHUMPETER_AUTH_TOKEN ?? '' });
  const policyToken = process.env.PIDA_SCHUMPETER_AUTH_TOKEN;
  if (!policyToken || policyToken.length < 32 || /[\r\n]/.test(policyToken)) throw Error('HOST_POLICY_TOKEN_REQUIRED');
  if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())) throw Error('HOST_STATE_UNSAFE');
  if (workspaceMode === 'fresh' && existsSync(directory) && (await readdir(directory)).length) throw Error('HOST_WORKSPACE_NOT_EMPTY');
  if (workspaceMode === 'resume' && !existsSync(directory)) throw Error('HOST_MANIFEST_INVALID');
  let nativeCredentials, selectedProvider = { kind: 'mock' }, providerSourceDigest = '';
  if (args['provider-workspace']) {
    const providerDirectory = resolve(args['provider-workspace']);
    if (providerDirectory === directory) throw Error('HOST_PROVIDER_WORKSPACE_MUST_BE_DISTINCT');
    const approved = JSON.parse(await readFile(join(providerDirectory, 'pida.config.json'), 'utf8'));
    if (approved.provider?.kind !== 'native' || approved.provider.authMode !== 'chatgpt') throw Error('HOST_PROVIDER_PROFILE_UNSUPPORTED');
    selectedProvider = { ...approved.provider, thinkingLevel: 'low' }; validateNativeProvider(selectedProvider);
    providerSourceDigest = digest(JSON.stringify({ provider: selectedProvider, stateDir: approved.stateDir }));
    nativeCredentials = new ChatGPTCredentialStore(providerDirectory, approved.stateDir);
    if (!nativeCredentials.status().connected) throw Error('HOST_PROVIDER_CREDENTIAL_UNAVAILABLE');
  }
  const expectedManifest = configDigest => ({ schema_version: 'pida.local-host.workspace/1', host_id: hostId, principal_id: 'local-user', node_version: process.versions.node,
    workspace_directory: directory, source_digest: sourceDigest(fileURLToPath(new URL('../', import.meta.url))), config_digest: configDigest,
    policy_credential_digest: digest(policyToken), provider_workspace: args['provider-workspace'] ? resolve(args['provider-workspace']) : '',
    provider_source_digest: providerSourceDigest, persona_module: args['persona-module'] ? resolve(args['persona-module']) : '',
    persona_module_digest: personaModuleDigest });
  const personaModuleDigest = args['persona-module'] ? digest(await readFile(resolve(args['persona-module']))) : '';
  if (workspaceMode === 'resume') validateHostManifest(directory, expectedManifest(digest(await readFile(join(directory, 'pida.config.json')))));
  await mkdir(directory, { recursive: true }); releaseHostLock = acquireHostLock(directory);
  // Repeat validation under exclusive ownership; never rewrite mismatched profiles or their runtime state.
  if (workspaceMode === 'resume') {
    validateHostManifest(directory, expectedManifest(digest(await readFile(join(directory, 'pida.config.json')))));
    try { unlockWorkspaceState(join(directory, '.pida')); } catch { throw Error('HOST_RUNTIME_LOCK_UNVERIFIED'); }
  } else initWorkspace(directory);
  const apiToken = randomBytes(32).toString('hex'); process.env.PIDA_API_TOKEN = apiToken;
  const config = workspaceMode === 'resume' ? readConfig(directory) : { ...readConfig(directory), preset: 'headless', provider: selectedProvider, tools: { directory: 'tools', enabled: [] }, codingPacks: [],
    agents: { enabled: true, maxConcurrent: 2 }, workbench: { enabled: true }, permissions: ['pida:collaborate', 'workbench:read', 'workbench:write', 'workbench:history'],
    runtime: { maxRunMs: 20000, maxProviderRetries: 0, maxOutputRetries: 0, autoCompaction: false, maxTotalTokens: 16384 } };
  if (workspaceMode === 'fresh') await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config, null, 2) + '\n');
  if (args['persona-module']) {
    const module = await import(pathToFileURL(resolve(args['persona-module'])).href);
    if (typeof module.createHostPersona !== 'function') throw Error('HOST_PERSONA_MODULE_INVALID');
    persona = await module.createHostPersona({ hostId, workspaceDirectory: directory, async taskScope(taskId, agentId) {
      if (!app?.agents || agentId === 'main') throw Error('HOST_PERSONA_ORGANIZATION_REQUIRED');
      const principal = { id: 'local-user', permissions: [] }, job = app.agents.getJob(taskId, principal);
      if (job.agentId !== agentId) throw Error('HOST_PERSONA_TASK_MISMATCH');
      for (const org of app.agents.listOrganizations(principal)) {
        const view = await app.agents.getOrganization(org.id, principal);
        if (view.tasks.some(t => t.id === job.organizationTaskId && t.agentId === agentId)
          && view.attempts.some(a => a.id === job.attemptId && a.taskId === job.organizationTaskId && a.jobId === job.id))
          return { organizationSessionId: org.id, organizationTaskId: job.organizationTaskId, attemptId: job.attemptId, jobId: job.id };
      }
      throw Error('HOST_PERSONA_ORGANIZATION_REQUIRED');
    } });
    if (typeof persona?.personaProvider !== 'function' || typeof persona?.close !== 'function' || !/^[A-Za-z0-9._/-]{1,100}$/.test(persona.mode ?? '')) throw Error('HOST_PERSONA_MODULE_INVALID');
  }
  if (workspaceMode === 'fresh' && config.provider.kind === 'mock') {
    config.permissions.push('lots:read'); await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config, null, 2) + '\n');
  }
  app = await createWorkspace(directory, { collaboration: policy, nativeCredentials,
    ...(config.provider.kind === 'mock' ? { extensions: [{ id: 'host-synthetic-lot', scope: 'workspace', activate: () => ({ tools: [lotStatusTool] }) }] } : {}),
    ...(persona ? { personaProvider: persona.personaProvider } : {}) });
  if (workspaceMode === 'fresh') saveHostFile(join(directory, '.pida-host.json'), JSON.stringify(expectedManifest(digest(await readFile(join(directory, 'pida.config.json')))), null, 2) + '\n');
  saveHostFile(join(directory, '.env'), 'PIDA_API_TOKEN=' + apiToken + '\n');
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const capabilities = app.agents.collaborationCapabilities({ id: 'local-user', permissions: ['pida:agents'] });
  process.stdout.write(JSON.stringify({ type: 'pida-host-ready', protocol: 'pida.local-host/1', host_id: hostId,
    base_url: 'http://127.0.0.1:' + app.server.address().port, api_token: apiToken, principal_id: 'local-user', capabilities,
    provider_mode: config.provider.kind === 'mock' ? 'mock' : 'configured-native-chatgpt', persona_mode: persona?.mode ?? 'pida-local', workspace_mode: workspaceMode }) + '\n');
  process.stdin.resume(); process.stdin.once('end', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
} catch (error) {
  await shutdown().catch(() => {});
  const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code ?? error.message ?? '') ? error.code ?? error.message : 'PIDA_HOST_START_FAILED';
  process.stderr.write(code + '\n'); process.exit(1);
}
