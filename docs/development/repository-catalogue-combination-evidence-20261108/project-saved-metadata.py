from pathlib import Path
import hashlib,json,shutil,zipfile

root=Path(__file__).resolve().parents[1]
temp=root/'.pida-test-repository-catalogue-20261108'
dest=root/'docs/development/repository-catalogue-combination-evidence-20261108'
dest.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
def write(path,value): path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
shutil.copyfile(temp/'probe.mjs',dest/'probe.mjs')
for name,source in {'windows-result.json':'windows-r2/result.json','linux-result.json':'linux-result.json','windows-before.json':'windows-before.json','windows-after.json':'windows-after.json','linux-before.json':'linux-before.json','linux-after.json':'linux-after.json'}.items():
    raw=(temp/source).read_bytes()
    value=json.loads(raw.decode('utf-16' if raw.startswith(b'\xff\xfe') else 'utf-8-sig'))
    write(dest/name,value)
originals=['windows.log','windows-r2.log','linux.log','windows/result.json']
with zipfile.ZipFile(dest/'original-logs.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
    for name in originals:z.writestr(name,(temp/name).read_bytes())
write(dest/'original-logs-index.json',{'files':{n:sha((temp/n).read_bytes()) for n in originals},'note':'Initial Windows passed before SDK parent PATH/HOME isolation was explicitly aligned to stock child environment. Windows-r2 and Linux use final probe; no product change.'})

# Read only exact fresh synthetic run metadata; never copy supervisor input/activity or contexts.
base=Path('C:/Users/migeo/AppData/Local/Temp/pd-repocat-DBR5xo')
result=json.loads((dest/'windows-result.json').read_text(encoding='utf-8'))
safe=dest/'metadata-only';safe.mkdir(exist_ok=True)
event_names=set('capture_mode data_scope payload.api payload.attempt payload.authorization payload.cache_read_tokens payload.cache_write_tokens payload.code payload.context_window payload.duration_ms payload.effective_config_digest payload.fingerprint_scope payload.first_output_ms payload.inclusion_scope payload.input_digest payload.input_digest_scheme payload.input_tokens payload.model payload.model_max_tokens payload.output_tokens payload.provider_generation payload.request_id payload.status payload.stop_reason payload.system_digest payload.thinking_level payload.tokens payload.tool_call_id payload.tool_name payload.tools_digest payload.turn_id payload.turn_index payload.uncached_input_tokens payload.usage_status payload_digest sequence_number source_event_id source_id'.split())
object_names=set('agent_id index reported_status request_id run_id session_id task_id tool_call_id tool_name turn_id'.split())
manifest_keys=set('schema_version task_id run_id session_id agent_id reported_status reported_by verification_status artifact_refs current_artifact_refs evidence_refs verification_results runtime_version known_limits'.split())
rows=[]
for kind in ['stock','sdk']:
    state_path=base/kind/'workspace/.pida/agents-service/supervisor.json'
    state=json.loads(state_path.read_text(encoding='utf-8'))
    for record in result[kind]['records']:
        job=next(j for j in state['jobs'] if j['id']==record['job_id'])
        assert job['agentId']==record['agent_id'] and job['runId']==record['run_id'] and job['attemptId']==record['attempt_id']
        org=next(o for o in state['organization']['sessions'] if o['id']==record['org_id'])
        task=next(t for t in state['organization']['tasks'] if t['id']==job['organizationTaskId'])
        attempt=next(a for a in state['organization']['attempts'] if a['id']==job['attemptId'])
        assert attempt['jobId']==job['id'] and attempt['taskId']==task['id']
        assert task['orgId']==org['id'] and task['agentId']==job['agentId'] and job['attemptId'] in task['attempts']
        runtime=base/kind/'workspace/.pida/agents-service/agents'/job['agentId']/'runtime/observations'/job['sessionId']
        files={}
        for suffix in ['ocel.json','ocel.meta.json','manifest.json']:
            path=runtime/(job['runId']+'.'+suffix);raw=path.read_bytes();v=json.loads(raw)
            assert not any(x in raw for x in [b'COMBINED_A_ONLY',b'COMBINED_B_ONLY',b'synthetic-combination-sdk-token',b'synthetic-combination-policy-token'])
            if suffix=='ocel.json':
                assert set(v)=={'events','objects','eventTypes','objectTypes'}
                for e in v['events']:
                    assert set(e)=={'id','type','time','attributes','relationships'}
                    assert all(set(a)=={'name','value'} and a['name'] in event_names and isinstance(a['value'],(str,int,float,bool)) for a in e['attributes'])
                for o in v['objects']:
                    assert set(o)=={'id','type','attributes','relationships'}
                    assert all(set(a)=={'name','value','time'} and a['name'] in object_names for a in o['attributes'])
                for t in v['eventTypes']: assert all(a['name'] in event_names for a in t['attributes'])
                for t in v['objectTypes']: assert all(a['name'] in object_names for a in t['attributes'])
            elif suffix=='ocel.meta.json': assert set(v)=={'mapping','sourceDigest','digest','complete','knownLimits'}
            else:
                assert set(v)-{'code'}==manifest_keys and v['run_id']==job['runId']
                assert v.get('code') in [None,'PROGRAM_EXIT_FAILED']
                assert all(v[k]==[] for k in ['artifact_refs','current_artifact_refs','evidence_refs','verification_results'])
                assert 'HOST_PROJECT_ARTIFACTS_NOT_CAPTURED' in v['known_limits']
            name=kind+'-'+record['source_id']+'.'+suffix
            (safe/name).write_bytes(raw);files[name]=sha(raw)
        rows.append({**record,'provenance':'actual stock mock host' if kind=='stock' else 'public SDK with scripted provider and simulated 15-token response usage','organization_task_id':task['id'],'session_id':job['sessionId'],'status':job['status'],'code':job.get('code'),'native_organization_status':org['status'],'source_state_sha256':sha(state_path.read_bytes()),'files':files})
write(safe/'handoff.json',{'schema':'pida.synthetic-combination.metadata-handoff/1','source_commit':result['source_commit'],'manifest_sha256':result['manifest_sha256'],'sidecar_sha256':'8f4bd65fe7a74ac6944059bc97158b13f98fd473b95240352cd2e0ff49d8e579','persona_source':'f6edd022d4389237fcee5d6c0a4db8a0d0b13399','persona_runtime_digest':'0f85831175f24aea7237a6a003bdb14972a32cf13a7e76394c3fa9898b3763d6','records':rows,'privacy':{'only_saved_ocel_and_manifest':True,'descriptor_or_prompt_or_tool_bodies':False,'marker_scan_pass':True,'closed_attribute_allowlist':True},'limits':['HOST_PROJECT_ARTIFACTS_NOT_CAPTURED','Native run task_id is job identity; separate organization_task_id supplied by exact supervisor join.','Failed baseline and separate repair belong to distinct native organizations; no within-run recovery claim.','Stock provider is mock; SDK provider usage is simulated, not observed external billing.','Only per-run observation order; no cross-run causality or aggregate efficiency claim.','Live project file hash is separate from empty native ResultManifest artifacts.']})
write(dest/'evidence-index.json',{'files':{str(p.relative_to(dest)).replace('\\','/'):sha(p.read_bytes()) for p in sorted(dest.rglob('*')) if p.is_file() and p.name!='evidence-index.json'}})
print(json.dumps({'files':len(list(dest.rglob('*'))),'safe_runs':len(rows),'evidence_index_sha256':sha((dest/'evidence-index.json').read_bytes())}))
