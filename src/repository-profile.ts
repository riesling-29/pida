import { isAbsolute } from 'node:path';
import type { ProgramManifest } from './program-proxy.js';
import { canonical } from './private-state.js';

/** Public attestation from a trusted managed host, never a model-selected tool grant. */
export interface RepositoryProfileCapability {
  schema_version: 'pida.repository-profile.capabilities/1'; id: 'repository-fixed-node/1'; digest: string; root_selection_id: string;
  scope: 'shared-host-project'; project_permissions: ['project:read', 'project:write']; trusted_host_shell: false;
  program: { id: string; permission: string; tool_name: string; approval_digest: string; timeout_ms: number; effect: 'write' };
  single_writer: 'managed-host-run-lease/1'; file_capture_scope: 'selected-project-file-at-capture-time'; sandbox: 'none';
}
const hash = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
export function validateRepositoryProfileCapability(value: unknown): Readonly<RepositoryProfileCapability> {
  const v = value as RepositoryProfileCapability;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 11 || !hash(v.digest)
    || typeof v.root_selection_id !== 'string' || v.root_selection_id.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.root_selection_id)
    || !v.program || typeof v.program !== 'object' || Array.isArray(v.program) || Object.keys(v.program).length !== 6
    || typeof v.program.id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(v.program.id) || !hash(v.program.approval_digest)
    || !Number.isSafeInteger(v.program.timeout_ms) || v.program.timeout_ms < 100 || v.program.timeout_ms > 30000) throw Error('REPOSITORY_CAPABILITY_INVALID');
  const expected: RepositoryProfileCapability = { schema_version: 'pida.repository-profile.capabilities/1', id: 'repository-fixed-node/1', digest: v.digest,
    root_selection_id: v.root_selection_id, scope: 'shared-host-project', project_permissions: ['project:read','project:write'], trusted_host_shell: false,
    program: { id: v.program.id, permission: `program:${v.program.id}`, tool_name: `program_${v.program.id}`, approval_digest: v.program.approval_digest, timeout_ms: v.program.timeout_ms, effect: 'write' },
    single_writer: 'managed-host-run-lease/1', file_capture_scope: 'selected-project-file-at-capture-time', sandbox: 'none' };
  if (canonical(v) !== canonical(expected)) throw Error('REPOSITORY_CAPABILITY_INVALID');
  Object.freeze(expected.program); Object.freeze(expected.project_permissions); return Object.freeze(expected);
}

/** Restriction of the existing ProgramManifest contract; it creates no new execution backend. */
export function validateRepositoryProgramManifest(m: ProgramManifest): void {
  const arg = m.args?.[0];
  if (m.command !== '$node' || !Array.isArray(m.args) || m.args.length !== 1 || typeof arg !== 'string' || !arg || arg.length > 2000
    || /[\x00-\x1f\x7f]/.test(arg) || isAbsolute(arg) || arg.includes(':') || arg.split(/[\\/]/).some(p => p === '..' || p === '')
    || (m.entrypoint !== undefined && m.entrypoint !== arg) || m.inputMode !== 'none' || m.outputMode !== 'text' || m.effect !== 'write'
    || !Number.isSafeInteger(m.timeoutMs) || m.timeoutMs! < 100 || m.timeoutMs! > 30000
    || canonical(m.inputSchema) !== canonical({ type: 'object', properties: {}, additionalProperties: false }))
    throw Error('REPOSITORY_PROGRAM_INVALID');
}
