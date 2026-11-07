// Optional trusted host module: exact public producer, disposable SYNTHETIC per-agent memory only.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createVeraDispatchPersonaProvider, veraDispatchCapabilities } from '../dist/vera-dispatch-provider.js';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function createHostPersona(host) {
  const source = process.env.PIDA_VERA_SOURCE, python = process.env.PIDA_VERA_PYTHON;
  if (!source || !python) throw Error('HOST_PERSONA_SOURCE_REQUIRED');
  const lock = JSON.parse(await readFile(join(root, 'fixtures/vera-dispatch/producer-source-lock.json'), 'utf8'));
  for (const [path, expected] of Object.entries(lock.files)) if (createHash('sha256').update(await readFile(join(resolve(source), path))).digest('hex') !== expected) throw Error('HOST_PERSONA_SOURCE_MISMATCH');
  const processes = new Set();
  return { mode: 'vera-dispatch-synthetic/0.1.0',
    async personaProvider(context) {
      const personaId = 'persona:synthetic-host:' + context.agentId, scopes = ['personal:synthetic', 'project:schumpeter', 'organization:host'];
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|LANG|LC_ALL)$/i.test(key)));
      const child = spawn(python, ['-I', '-B', join(root, 'scripts/vera-dispatch-host-probe.py'), resolve(source)], { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let id = 0, ended = false; const pending = new Map();
      const closed = new Promise(resolve => child.once('close', code => { ended = true; for (const p of pending.values()) { p.cleanup(); p.reject(Error('HOST_PERSONA_PROCESS_CLOSED')); } pending.clear(); resolve(code); }));
      child.stderr.resume(); child.once('error', () => { for (const p of pending.values()) { p.cleanup(); p.reject(Error('HOST_PERSONA_PROCESS_FAILED')); } pending.clear(); });
      createInterface({ input: child.stdout }).on('line', line => {
        try { const r = JSON.parse(line), p = pending.get(r.id); if (!p) return; pending.delete(r.id); p.cleanup(); r.error ? p.reject(Error(r.error)) : p.resolve(r.value); }
        catch { child.kill(); }
      });
      child.stdin.write(JSON.stringify({ hostId: host.hostId, personaId, agentInstanceId: context.agentId }) + '\n');
      const invoke = (value, signal) => new Promise((resolve, reject) => {
        if (ended || signal.aborted) return reject(Error('HOST_PERSONA_UNAVAILABLE'));
        const key = ++id, abort = () => { pending.delete(key); cleanup(); reject(Error('HOST_PERSONA_CANCELLED')); };
        const timer = setTimeout(() => { pending.delete(key); cleanup(); reject(Error('HOST_PERSONA_TIMEOUT')); child.kill(); }, 4000);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        pending.set(key, { resolve, reject, cleanup }); signal.addEventListener('abort', abort, { once: true }); child.stdin.write(JSON.stringify({ id: key, ...value }) + '\n');
      });
      const handle = { async close() { child.stdin.end(); const timer = setTimeout(() => child.kill(), 3000); await closed; clearTimeout(timer); } }; processes.add(handle);
      const selections = new WeakMap();
      return { id: 'pida.vera-dispatch/0.1.0', agentId: context.agentId, authority: 'external', async resolveContext(request) {
        const scope = await host.taskScope(request.taskId, context.agentId);
        const provider = createVeraDispatchPersonaProvider({ protocol: 'vera-dispatch/0.1.0', requiredCapabilities: [...veraDispatchCapabilities], agentId: context.agentId,
          principalId: context.principal.id, providerPrincipal: 'principal:fixture', personaId, hostId: host.hostId, projectId: 'schumpeter',
          organizationSessionId: scope.organizationSessionId, agentInstanceId: context.agentId, role: context.role || 'host', memoryScope: scopes,
          port: { describe: r => invoke({ action: 'describe' }, r.signal),
            resolve: r => invoke({ action: 'resolve', request: { runId: r.runId, taskId: r.taskId, organizationSessionId: scope.organizationSessionId } }, r.signal),
            authorizeInput: r => invoke({ action: 'authorize', request: { protocol: r.protocol, requestId: r.requestId, inputDigest: r.inputDigest,
              runId: r.runId, taskId: r.taskId, hostId: host.hostId, binding: r.binding, context: r.context } }, r.signal) } });
        const snapshot = await provider.resolveContext(request); selections.set(snapshot, provider); return snapshot;
      }, async authorizeInput(request) { const provider = selections.get(request.snapshot); if (!provider) throw Error('HOST_PERSONA_SNAPSHOT_UNKNOWN'); await provider.authorizeInput(request); } };
    },
    async close() { await Promise.all([...processes].map(p => p.close())); processes.clear(); },
  };
}
