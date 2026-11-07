// Host-wide observation UI. Its private host credential is NOT organization-scoped.
import { PidaClient, PidaClientError } from '../dist/client.js';
import { mkdirSync, lstatSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
export const observationTuiProfile = Object.freeze({ protocol: 'pida.host-observation-tui/1', scope: 'host-wide', input: 'disabled',
  authority: 'private host credential; UI write guard is not server-side token scoping', detach: 'closes this client only' });
export async function connectObservationTui(environment, fetchImplementation = fetch) {
  let endpoint;
  try { endpoint = new URL(environment.PIDA_TUI_BASE_URL); } catch { throw Error('TUI_ENDPOINT_INVALID'); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw Error('TUI_ENDPOINT_INVALID');
  const hostId = environment.PIDA_TUI_HOST_ID, token = environment.PIDA_TUI_TOKEN;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(hostId ?? '') || !/^[\x21-\x7e]{32,256}$/.test(token ?? '')) throw Error('TUI_IDENTITY_REQUIRED');
  const lifetime = new AbortController();
  const client = new PidaClient({ baseUrl: endpoint.origin, token: () => token, fetch: async (url, init = {}) => {
    // This protects this UI's behavior, not the authority of its private credential.
    if ((init.method ?? 'GET') !== 'GET') throw new PidaClientError('HOST_OBSERVATION_ONLY_USE_SCHUMPETER_TASK_CONTROLS', 403);
    const target = new URL(url);
    if (target.origin !== endpoint.origin || !target.pathname.startsWith('/v1/') || target.username || target.password) throw Error('TUI_ENDPOINT_INVALID');
    return fetchImplementation(url, { ...init, redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000), ...(init.signal ? [init.signal] : [])]) });
  } });
  try {
    const capabilities = await client.getCollaborationCapabilities();
    if (capabilities.schema_version !== 'pida.collaboration.capabilities/1' || capabilities.host_id !== hostId || capabilities.enabled !== true) throw Error('TUI_HOST_MISMATCH');
    const info = await client.getInfo();
    return { client, hostId, info, profile: observationTuiProfile, close: () => lifetime.abort() };
  } catch (error) { lifetime.abort(); throw error; }
}
export function observationLayoutStore(directory, hostId) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw Error('TUI_LAYOUT_DIRECTORY_REQUIRED');
  const root = resolve(directory);
  for (let path = root; ; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('TUI_LAYOUT_UNSAFE');
    if (path === dirname(path)) break;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const pathFor = scope => {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw Error('TUI_LAYOUT_SCOPE_INVALID');
    const path = join(root, createHash('sha256').update(JSON.stringify([hostId, scope])).digest('hex') + '.json');
    if (existsSync(path)) { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 64000) throw Error('TUI_LAYOUT_UNSAFE'); }
    return path;
  };
  return { loadLayout(scope) { const path = pathFor(scope); return existsSync(path) ? readFileSync(path, 'utf8') : undefined; },
    saveLayout(scope, json) { if (typeof json !== 'string' || Buffer.byteLength(json) > 64000) throw Error('TUI_LAYOUT_INVALID'); JSON.parse(json);
      const path = pathFor(scope), temporary = path + '.' + randomUUID() + '.tmp';
      try { writeFileSync(temporary, json, { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); } finally { rmSync(temporary, { force: true }); } } };
}
async function main() {
  if (process.argv.length !== 2) throw Error('TUI_PRIVATE_ENV_ONLY');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('TUI_TERMINAL_REQUIRED');
  const connection = await connectObservationTui(process.env);
  try {
    const layouts = observationLayoutStore(process.env.PIDA_TUI_LAYOUT_DIRECTORY, connection.hostId);
    const { runAgentTerminal } = await import('../dist/agent-tui.js');
    await runAgentTerminal({ client: connection.client, ...layouts,
      workspace: 'HOST-WIDE OBSERVATION ONLY · ' + connection.hostId + ' · Use Schumpeter for tasks; Ctrl+D detaches',
      openWeb: async () => { throw Error('HOST_OBSERVATION_ONLY: use Schumpeter organization task controls'); } });
  } finally { connection.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  // Never echo URLs, credentials, provider errors or remote response bodies.
  process.stderr.write('PIDA_OBSERVATION_TUI_FAILED: check host connection and private launch configuration\n'); process.exitCode = 1;
});
