// Trusted release metadata. A sidecar is authoritative only inside an externally verified full inventory.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from '../dist/private-state.js';
import { validateRepositoryProfileCapability } from '../dist/repository-profile.js';
import { resolveExecutionPolicy } from '../dist/execution-policy.js';
export const capabilityPath = 'managed-host-capabilities.json';
const fail = () => { throw Error('MANAGED_CAPABILITIES_INVALID'); };
export function repositoryDescriptor() {
  return { schema_version: 'pida.repository-profile/1', id: 'repository-fixed-node/1', module: 'pida/examples/repository-profile.mjs',
    environment_key: 'PIDA_REPOSITORY_PROFILE', ready_protocol: 'pida.local-host/3', workspace_schema: 'pida.local-host.workspace/3',
    admission_capabilities: 'pida.organization.admission.capabilities/3' };
}
export function createManagedCapabilities(source, mode) {
  if (typeof source !== 'string' || !/^[a-f0-9]{40}$/.test(source) || !['policy/1','catalogue/1','repository/1'].includes(mode)) fail();
  return { schema_version: mode === 'repository/1' ? 'pida.managed-host.capabilities/2' : 'pida.managed-host.capabilities/1', source_commit: source,
    entrypoint: 'pida/examples/schumpeter-host.mjs', ready_protocol: 'pida.local-host/2', workspace_schema: 'pida.local-host.workspace/2',
    execution_policy: { schema_version: 'pida.execution-policy/1', profiles: ['smoke/1','work/1'].map(resolveExecutionPolicy) },
    admission_capabilities: 'pida.organization.admission.capabilities/2',
    persona_catalogue: mode !== 'policy/1' ? { schema_version: 'pida.persona-catalogue/1', mode: 'vera-local-reference-catalogue/1',
      module: 'pida/examples/vera-local-reference-catalogue.mjs', environment_key: 'PIDA_PERSONA_CATALOGUE' } : null,
    ...(mode === 'repository/1' ? { repository_profile: repositoryDescriptor() } : {}) };
}
export function validateManagedCapabilities(value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== (value.schema_version === 'pida.managed-host.capabilities/2' ? 9 : 8)) fail();
  const expected = createManagedCapabilities(source, value.schema_version === 'pida.managed-host.capabilities/2' ? 'repository/1' : value.persona_catalogue === null ? 'policy/1' : 'catalogue/1');
  if (canonical(value) !== canonical(expected)) fail();
  return expected;
}
export function validateManagedCapabilityFiles(root, value, source, manifest) {
  const expected = validateManagedCapabilities(value,source);
  const regular = (name, maximum) => { const path=join(root,name), stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(maximum&&stat.size>maximum))fail();return path; };
  const required = [capabilityPath, expected.entrypoint, 'pida/dist/execution-policy.js', 'pida/fixtures/execution-policy/profiles-v1.json',
    ...(expected.repository_profile ? [expected.repository_profile.module, 'pida/dist/repository-profile.js', 'pida/fixtures/repository-profile/managed-descriptor-v1.json', 'pida/fixtures/repository-profile/capability-v1.json'] : []),
    ...(expected.persona_catalogue ? [expected.persona_catalogue.module, 'pida/examples/vera-local-reference-persona.mjs', 'pida/fixtures/vera-dispatch/local-reference-source-lock.json'] : [])];
  if (manifest !== undefined) {
    if (manifest.source_commit !== source || manifest.source?.source_commit !== source || !Array.isArray(manifest.files)) fail();
    for (const name of required) {
      const entries = manifest.files.filter(entry => entry.path === name);
      if (entries.length !== 1 || entries[0].symlink !== undefined || typeof entries[0].sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entries[0].sha256)) fail();
    }
    regular(capabilityPath,16384);
  }
  regular(expected.entrypoint); regular('pida/dist/execution-policy.js');
  const golden=JSON.parse(readFileSync(regular('pida/fixtures/execution-policy/profiles-v1.json',16384),'utf8'));
  if(canonical(golden)!==canonical({schema_version:'pida.execution-policy.catalogue/1',profiles:expected.execution_policy.profiles}))fail();
  if(expected.persona_catalogue){regular(expected.persona_catalogue.module);regular('pida/examples/vera-local-reference-persona.mjs');regular('pida/fixtures/vera-dispatch/local-reference-source-lock.json');}
  if(expected.repository_profile){
    regular(expected.repository_profile.module); regular('pida/dist/repository-profile.js');
    const descriptor=JSON.parse(readFileSync(regular('pida/fixtures/repository-profile/managed-descriptor-v1.json',16384),'utf8'));
    if(canonical(descriptor)!==canonical(expected.repository_profile))fail();
    // This public sample proves only the declared closed shape, never a real root or approval.
    validateRepositoryProfileCapability(JSON.parse(readFileSync(regular('pida/fixtures/repository-profile/capability-v1.json',16384),'utf8')));
  }
  return expected;
}
