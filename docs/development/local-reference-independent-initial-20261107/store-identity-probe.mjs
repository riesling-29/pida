import { mkdtemp, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hostPersonaIdentity, createHostPersona } from '../pida-reference-host-review-20261107/examples/vera-local-reference-persona.mjs';

const root = await mkdtemp('D:/ChantaResearchGroup/pida-reference-host-review-evidence-20261107/store-replacement-');
const configPath = join(root, 'reference.json'), store = join(root, 'store');
const executable = 'C:/Users/migeo/AppData/Local/Programs/Python/Python311/python.exe';
const entry = 'D:/ChantaResearchGroup/Vera-reference-review-runtime-r3-20261107/scripts/local_persona_bridge.py';
const config = {schema_version:'vera-local-reference/0.1.0',principal:'principal:review',host_id:'host:review',project_id:'review',memory_scope:['project:review'],persona:{persona_id:'persona:review',name:'Reference',description:'Review-only configured reference',source_refs:['document:review']},grant_expires_at:Math.floor(Date.now()/1000)+600};
await writeFile(configPath, JSON.stringify(config));
Object.assign(process.env, {PIDA_PERSONA_BRIDGE_EXECUTABLE:executable,PIDA_PERSONA_BRIDGE_PREFIX_ARGS:JSON.stringify(['-I','-B',entry]),PIDA_PERSONA_BRIDGE_CONFIG:configPath,PIDA_PERSONA_BRIDGE_STORE:store});
const init=()=>execFileSync(executable,['-I','-B',entry,'init','--config',configPath,'--store',store]);
const host={hostId:config.host_id,taskScope:async jobId=>({jobId,attemptId:'attempt:review',organizationTaskId:'orgtask:review',organizationSessionId:'org:review'})};
const principal={id:'owner:review',permissions:[]};
const request={principal,agentId:'agent:review',sessionId:'session:review',taskId:'job:review',runId:'run:review',signal:AbortSignal.timeout(4000)};
async function bindingId(){const bridge=await createHostPersona(host);try{const p=await bridge.personaProvider({principal,agentId:request.agentId});return (await p.resolveContext({...request,signal:AbortSignal.timeout(4000)})).descriptor.personaBinding.externalContext.bindingId;}finally{await bridge.close();}}
init();
const before={identity:await hostPersonaIdentity(host),bindingId:await bindingId()};
await rename(store,join(root,'original-store-preserved'));
init();
const after={identity:await hostPersonaIdentity(host),bindingId:await bindingId()};
console.log(JSON.stringify({before,after,identityChanged:before.identity!==after.identity,bindingChanged:before.bindingId!==after.bindingId,originalStorePreserved:true},null,2));
