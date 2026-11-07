// Trusted release metadata. A sidecar is authoritative only inside an externally verified full inventory.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from '../dist/private-state.js';
import { resolveExecutionPolicy } from '../dist/execution-policy.js';
export const capabilityPath = 'managed-host-capabilities.json';
const fail = () => { throw Error('MANAGED_CAPABILITIES_INVALID'); };
export function createManagedCapabilities(source, mode) {
  if (typeof source !== 'string' || !/^[a-f0-9]{40}$/.test(source) || !['policy/1','catalogue/1'].includes(mode)) fail();
  return { schema_version: 'pida.managed-host.capabilities/1', source_commit: source,
    entrypoint: 'pida/examples/schumpeter-host.mjs', ready_protocol: 'pida.local-host/2', workspace_schema: 'pida.local-host.workspace/2',
    execution_policy: { schema_version: 'pida.execution-policy/1', profiles: ['smoke/1','work/1'].map(resolveExecutionPolicy) },
    admission_capabilities: 'pida.organization.admission.capabilities/2',
    persona_catalogue: mode === 'catalogue/1' ? { schema_version: 'pida.persona-catalogue/1', mode: 'vera-local-reference-catalogue/1',
      module: 'pida/examples/vera-local-reference-catalogue.mjs', environment_key: 'PIDA_PERSONA_CATALOGUE' } : null };
}
export function validateManagedCapabilities(value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 8) fail();
  const expected = createManagedCapabilities(source, value.persona_catalogue === null ? 'policy/1' : 'catalogue/1');
  if (canonical(value) !== canonical(expected)) fail();
  return expected;
}
export function validateManagedCapabilityFiles(root, value, source) {
  const expected = validateManagedCapabilities(value,source);
  const regular = (name, maximum) => { const path=join(root,name), stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(maximum&&stat.size>maximum))fail();return path; };
  regular(expected.entrypoint); regular('pida/dist/execution-policy.js');
  const golden=JSON.parse(readFileSync(regular('pida/fixtures/execution-policy/profiles-v1.json',16384),'utf8'));
  if(canonical(golden)!==canonical({schema_version:'pida.execution-policy.catalogue/1',profiles:expected.execution_policy.profiles}))fail();
  if(expected.persona_catalogue){regular(expected.persona_catalogue.module);regular('pida/examples/vera-local-reference-persona.mjs');regular('pida/fixtures/vera-dispatch/local-reference-source-lock.json');}
  return expected;
}
