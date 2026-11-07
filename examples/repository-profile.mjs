// Trusted immutable repository binding. It does not sandbox the approved program.
import { readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { isAbsolute, resolve, relative, sep, dirname, basename, join } from 'node:path';
import { canonical, sha256 } from '../dist/private-state.js';
import { inspectProgramProxy } from '../dist/program-proxy.js';
import { validateRepositoryProfileCapability, validateRepositoryProgramManifest } from '../dist/repository-profile.js';
const fail = code => { throw Error(code ?? 'HOST_REPOSITORY_PROFILE_INVALID'); };
const closed = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const text = (v,max) => typeof v === 'string' && !!v.length && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const hash = v => text(v,64) && /^[a-f0-9]{64}$/.test(v);
const uuid = v => text(v,36) && v.length === 36 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const inside = (root,path) => { const r=relative(root,path);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep)); };
const overlap = (a,b) => inside(a,b)||inside(b,a);
function exact(path,directory=false,max=65536) {
  if(!text(path,4096)||!isAbsolute(path))fail();
  const full=resolve(path),stat=lstatSync(full,{bigint:true});
  if(full!==realpathSync(full)||stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1n||stat.size>BigInt(max)))fail('HOST_REPOSITORY_PATH_INVALID');
  return {path:full,stat};
}
// Resolve existing ancestors too: a not-yet-created host path can sit below a junction.
function protectedIdentity(path) {
  let current=resolve(path);const suffix=[];
  while(!existsSync(current)) { const parent=dirname(current);if(parent===current)fail('HOST_REPOSITORY_PATH_INVALID');suffix.unshift(basename(current));current=parent; }
  return join(realpathSync(current),...suffix);
}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
/** protectedPaths and runtimeBinding are trusted embedder inputs, never extra JSON fields. */
export function readRepositoryProfile({hostId,executionPolicyId,workspaceDirectory,runtimeDirectory,protectedPaths=[],runtimeBinding}, selectedPath=process.env.PIDA_REPOSITORY_PROFILE) {
  if(executionPolicyId!=='work/1')fail('HOST_REPOSITORY_WORK_POLICY_REQUIRED');
  const file=exact(selectedPath).path;let value;try{value=JSON.parse(readFileSync(file,'utf8'));}catch{fail();}
  if(!closed(value,['schema_version','id','host_id','runtime','root','program','digest'])||value.schema_version!=='pida.repository-profile/1'||value.id!=='repository-fixed-node/1'
    ||value.host_id!==hostId||!text(hostId,128)||!closed(value.runtime,['source_commit','manifest_sha256'])||!text(value.runtime.source_commit,40)||!/^[a-f0-9]{40}$/.test(value.runtime.source_commit)||!hash(value.runtime.manifest_sha256)
    ||!closed(value.root,['selection_id','path','device','inode'])||!uuid(value.root.selection_id)||![value.root.device,value.root.inode].every(v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,39})$/.test(v))
    ||!closed(value.program,['id','manifest_path','approval','approval_id','approval_receipt_sha256'])||!text(value.program.id,40)||!/^[a-z][a-z0-9_]{0,39}$/.test(value.program.id)
    ||!uuid(value.program.approval_id)||!hash(value.program.approval_receipt_sha256)||!closed(value.program.approval,['manifestDigest','commandDigest','entrypointDigest'])||!Object.values(value.program.approval).every(hash)||!hash(value.digest))fail();
  const {digest,...body}=value;if(sha256(canonical(body))!==digest)fail('HOST_REPOSITORY_DIGEST_MISMATCH');
  if(runtimeBinding!==undefined&&canonical(value.runtime)!==canonical(runtimeBinding))fail('HOST_REPOSITORY_RUNTIME_MISMATCH');
  const root=exact(value.root.path,true),manifest=exact(value.program.manifest_path).path;
  if(root.stat.dev.toString()!==value.root.device||root.stat.ino.toString()!==value.root.inode)fail('HOST_REPOSITORY_ROOT_CHANGED');
  const protectedRoots=[workspaceDirectory,runtimeDirectory,process.execPath,file,manifest,...protectedPaths].filter(Boolean).map(protectedIdentity);
  if(protectedRoots.some(path=>overlap(root.path,path)))fail('HOST_REPOSITORY_PROTECTED_PATH');
  const inspected=inspectProgramProxy(root.path,manifest),m=inspected.manifest;
  try { validateRepositoryProgramManifest(m); } catch { fail('HOST_REPOSITORY_PROGRAM_MISMATCH'); }
  if(m.id!==value.program.id||canonical(inspected.approval)!==canonical(value.program.approval))fail('HOST_REPOSITORY_PROGRAM_MISMATCH');
  const capability=validateRepositoryProfileCapability({schema_version:'pida.repository-profile.capabilities/1',id:value.id,digest,root_selection_id:value.root.selection_id,scope:'shared-host-project',project_permissions:['project:read','project:write'],trusted_host_shell:false,
    program:{id:m.id,permission:'program:'+m.id,tool_name:'program_'+m.id,approval_digest:sha256(canonical(inspected.approval)),timeout_ms:m.timeoutMs,effect:'write'},single_writer:'managed-host-run-lease/1',file_capture_scope:'selected-project-file-at-capture-time',sandbox:'none'});
  return freeze({profile:value,capability,project:{enabled:true,root:root.path,trustedHost:false},programs:[{id:m.id,enabled:true,root:root.path,manifest,approval:inspected.approval}],permissions:['project:read','project:write','program:'+m.id]});
}
