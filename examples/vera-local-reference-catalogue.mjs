// Trusted immutable catalogue; native AgentProfile.personaSourceId selects one existing factory.
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from '../dist/private-state.js';
import { referenceHostSettings, createHostPersona as createReference } from './vera-local-reference-persona.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('HOST_PERSONA_CATALOGUE_INVALID'); };
const closed = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const token = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const identityPath = p => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
const freeze = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; };
async function settings(host) {
  const path = process.env.PIDA_PERSONA_CATALOGUE;
  if (!token(path, 4096) || !isAbsolute(path)) fail();
  const bytes = await readFile(path); if (bytes.length > 262144) fail();
  let value; try { value = JSON.parse(bytes); } catch { fail(); }
  if (!closed(value, ['schema_version', 'host_id', 'sources']) || value.schema_version !== 'pida.persona-catalogue/1'
    || value.host_id !== host.hostId || !token(value.host_id, 128) || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 32) fail();
  const unique = Object.fromEntries(['id','profile_id','persona_id','store_instance_id','config','store'].map(k => [k,new Set()])), sources = [];
  for (const entry of value.sources) {
    if (!closed(entry, ['id','label','profile_id','persona_id','principal_ids','bridge','config_sha256','store_instance_id','bridge_identity'])
      || !token(entry.id,64) || !/^[a-z][a-z0-9._-]{0,63}$/.test(entry.id) || ['local','workspace'].includes(entry.id)
      || !token(entry.label,100) || !entry.label.trim() || !token(entry.profile_id,36) || entry.profile_id.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entry.profile_id ?? '')
      || !token(entry.persona_id,256) || !token(entry.store_instance_id,38) || !/^store:[a-f0-9]{32}$/.test(entry.store_instance_id ?? '')
      || !digest(entry.config_sha256) || !digest(entry.bridge_identity)
      || !Array.isArray(entry.principal_ids) || !entry.principal_ids.length || entry.principal_ids.length > 1000
      || entry.principal_ids.some(id => !token(id,256) || !id.trim()) || new Set(entry.principal_ids).size !== entry.principal_ids.length
      || !closed(entry.bridge,['executable','prefix_args','config','store'])
      || !['executable','config','store'].every(k => token(entry.bridge[k],4096) && isAbsolute(entry.bridge[k]))
      || !Array.isArray(entry.bridge.prefix_args) || entry.bridge.prefix_args.length > 16 || entry.bridge.prefix_args.some(x => typeof x !== 'string' || x.length >= 4096 || /[\x00\r\n]/.test(x))) fail();
    const bridge = { executable: resolve(entry.bridge.executable), prefix_args: entry.bridge.prefix_args.map(x => isAbsolute(x) ? resolve(x) : x), config: resolve(entry.bridge.config), store: resolve(entry.bridge.store) };
    const normalized = { ...entry, principal_ids: [...entry.principal_ids].sort(), bridge };
    for (const key of Object.keys(unique)) {
      const id = ['config','store'].includes(key) ? identityPath(bridge[key]) : normalized[key];
      if (unique[key].has(id)) fail(); unique[key].add(id);
    }
    sources.push(normalized);
  }
  sources.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Verify all profiles before starting even the first producer process.
  for (const entry of sources) {
    const selected = await referenceHostSettings(host, entry.bridge);
    if (selected.configSha256 !== entry.config_sha256 || selected.storeIdentity.store_instance_id !== entry.store_instance_id
      || selected.config.persona?.persona_id !== entry.persona_id || selected.identity !== entry.bridge_identity) fail();
  }
  const normalized = freeze({ schema_version: value.schema_version, host_id: value.host_id, sources });
  const reference_helper_sha256 = sha(await readFile(new URL('./vera-local-reference-persona.mjs',import.meta.url)));
  return { catalogue: normalized, identity: sha(canonical({ catalogue: normalized, reference_helper_sha256 })) };
}
export async function hostPersonaIdentity(host) { return (await settings(host)).identity; }
export async function createHostPersona(host) {
  const selected = await settings(host);
  if (host.personaIdentity !== undefined && host.personaIdentity !== selected.identity) throw Error('HOST_PERSONA_IDENTITY_CHANGED');
  const bridges = [], sources = [];
  const close = async () => { const results = await Promise.allSettled(bridges.map(b => b.close())); if (results.some(r => r.status === 'rejected')) throw Error('HOST_PERSONA_CLOSE_FAILED'); };
  try {
    for (const entry of selected.catalogue.sources) {
      const bridge = await createReference({ ...host, personaIdentity: entry.bridge_identity }, entry.bridge); bridges.push(bridge);
      sources.push(Object.freeze({ id: entry.id, label: entry.label, principalIds: entry.principal_ids,
        async create(context) {
          if (!entry.principal_ids.includes(context.principal?.id)) throw Error('HOST_PERSONA_SOURCE_FORBIDDEN');
          return bridge.personaProvider(context);
        } }));
    }
    return { mode: 'vera-local-reference-catalogue/1', personaSources: Object.freeze(sources), close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
