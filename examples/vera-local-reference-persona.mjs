// Explicit app-owned reference identity. No fixture, canonical memory or auto-initialization.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createVeraDispatchPersonaProvider, veraDispatchCapabilities, validVeraDispatchDescription } from '../dist/vera-dispatch-provider.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function settings(host) {
  const executable = process.env.PIDA_PERSONA_BRIDGE_EXECUTABLE, configPath = process.env.PIDA_PERSONA_BRIDGE_CONFIG, store = process.env.PIDA_PERSONA_BRIDGE_STORE;
  let prefix; try { prefix = JSON.parse(process.env.PIDA_PERSONA_BRIDGE_PREFIX_ARGS ?? '[]'); } catch { throw Error('HOST_PERSONA_CONFIG_INVALID'); }
  if (![executable, configPath, store].every(p => typeof p === 'string' && isAbsolute(p)) || !Array.isArray(prefix)
    || prefix.length > 16 || !prefix.every(s => typeof s === 'string' && s.length < 4096 && !/[\x00\r\n]/.test(s))) throw Error('HOST_PERSONA_CONFIG_INVALID');
  const bytes = await readFile(configPath); if (bytes.length > 65536) throw Error('HOST_PERSONA_CONFIG_INVALID');
  const config = JSON.parse(bytes);
  if (config.schema_version !== 'vera-local-reference/0.1.0' || config.host_id !== host.hostId) throw Error('HOST_PERSONA_CONFIG_INVALID');
  // The parent verifies the complete packaged producer manifest. This identity also prevents
  // silently switching the configured executable, entry script, store or identity on resume.
  const commandFiles = [];
  for (const argument of [executable, ...prefix]) if (isAbsolute(argument)) {
    const entry = await stat(argument); if (entry.isFile()) commandFiles.push([resolve(argument), hash(await readFile(argument))]);
  }
  return { executable, prefix, configPath, store, config, identity: hash(JSON.stringify({ executable, prefix, commandFiles, config: hash(bytes), store })) };
}
export async function hostPersonaIdentity(host) { return (await settings(host)).identity; }
export async function createHostPersona(host) {
  const s = await settings(host);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|LANG|LC_ALL)$/i.test(key)));
  const child = spawn(s.executable, [...s.prefix, 'serve', '--config', s.configPath, '--store', s.store], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let ended = false, sequence = 0, buffered = '', closing;
  const pending = new Map();
  const rejectAll = code => { for (const p of pending.values()) { p.cleanup(); p.reject(Error(code)); } pending.clear(); };
  const closed = new Promise(resolve => child.once('close', code => { ended = true; rejectAll('HOST_PERSONA_PROCESS_CLOSED'); resolve(code); }));
  child.once('error', () => { ended = true; rejectAll('HOST_PERSONA_PROCESS_FAILED'); }); child.stderr.resume();
  child.stdin.on('error', () => rejectAll('HOST_PERSONA_PROCESS_FAILED'));
  child.stdout.setEncoding('utf8'); child.stdout.on('data', text => {
    buffered += text;
    if (Buffer.byteLength(buffered) > 1048576) { rejectAll('HOST_PERSONA_RESPONSE_INVALID'); child.kill(); return; }
    let index;
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
      try {
        const value = JSON.parse(line), p = pending.get(value.id);
        if (!p) continue;
        if (!value || Object.keys(value).length !== 2 || !('value' in value || 'error' in value)) throw Error();
        pending.delete(value.id); p.cleanup();
        value.error ? p.reject(Error(/^[A-Z][A-Z0-9_]{1,100}$/.test(value.error) ? value.error : 'HOST_PERSONA_REJECTED')) : p.resolve(value.value);
      } catch { rejectAll('HOST_PERSONA_RESPONSE_INVALID'); child.kill(); }
    }
  });
  const invoke = (action, request, signal) => new Promise((resolve, reject) => {
    if (ended || closing || signal.aborted) return reject(Error('HOST_PERSONA_UNAVAILABLE'));
    const id = ++sequence;
    const abort = () => { pending.delete(id); cleanup(); reject(Error('HOST_PERSONA_CANCELLED')); };
    const timer = setTimeout(() => { pending.delete(id); cleanup(); reject(Error('HOST_PERSONA_TIMEOUT')); child.kill(); }, 4000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    pending.set(id, { resolve, reject, cleanup }); signal.addEventListener('abort', abort, { once: true });
    child.stdin.write(JSON.stringify({ id, action, request }) + '\n', error => { if (error && pending.delete(id)) { cleanup(); reject(Error('HOST_PERSONA_PROCESS_FAILED')); } });
  });
  const close = () => closing ??= (async () => { child.stdin.end(); const timer = setTimeout(() => child.kill(), 3000); try { await closed; } finally { clearTimeout(timer); } })();
  try { if (!validVeraDispatchDescription(await invoke('describe', {}, AbortSignal.timeout(4000)))) throw Error('VERA_DISPATCH_PROFILE_UNSUPPORTED'); } catch (error) { await close(); throw error; }
  return { mode: 'vera-local-reference/0.1.0', close,
    async personaProvider(context) {
      const selections = new WeakMap();
      return { id: 'pida.vera-dispatch/0.1.0', agentId: context.agentId, authority: 'external',
        async resolveContext(request) {
          const scope = await host.taskScope(request.taskId, context.agentId);
          if (!scope.attemptId || !scope.organizationTaskId || scope.jobId !== request.taskId) throw Error('HOST_PERSONA_ORGANIZATION_REQUIRED');
          const provider = createVeraDispatchPersonaProvider({ protocol: 'vera-dispatch/0.1.0', requiredCapabilities: [...veraDispatchCapabilities],
            agentId: context.agentId, principalId: context.principal.id, providerPrincipal: s.config.principal, personaId: s.config.persona.persona_id,
            hostId: host.hostId, projectId: s.config.project_id, organizationSessionId: scope.organizationSessionId,
            agentInstanceId: context.agentId, role: context.role || 'host', memoryScope: s.config.memory_scope,
            port: { describe: r => invoke('describe', {}, r.signal), resolve: async r => {
              const value = await invoke('resolve', { protocol: r.protocol, requiredCapabilities: r.requiredCapabilities, renderer: 'vera-json/1',
                binding: { agent_instance_id: context.agentId, host_id: host.hostId, project_id: s.config.project_id,
                  organization_session_id: scope.organizationSessionId, task_id: r.taskId, attempt_id: scope.attemptId, run_id: r.runId, memory_scope: s.config.memory_scope } }, r.signal);
              if (value?.binding?.attempt_id !== scope.attemptId) throw Error('HOST_PERSONA_ATTEMPT_MISMATCH');
              return value;
            }, authorizeInput: r => invoke('authorize', { protocol: r.protocol, requestId: r.requestId, inputDigest: r.inputDigest,
              runId: r.runId, taskId: r.taskId, hostId: host.hostId, binding: r.binding, context: r.context }, r.signal) } });
          const snapshot = await provider.resolveContext(request); selections.set(snapshot, provider); return snapshot;
        }, async authorizeInput(request) { const provider = selections.get(request.snapshot); if (!provider) throw Error('HOST_PERSONA_SNAPSHOT_UNKNOWN'); await provider.authorizeInput(request); } };
    } };
}
