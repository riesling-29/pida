"""Actual read-only pinned Hub/PIX consumer check of Pida-owned synthetic bytes.

No external checkout, live service or canonical data is changed. This is file
integration, not a runtime execution adapter or enterprise acceptance test.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--pix-source', type=Path, required=True)
    parser.add_argument('--workspace-bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    lock = json.loads((root/'fixtures/pix-profiles/schumpeter-source-lock.json').read_text())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        raise ValueError('OUTPUT_EXISTS')
    checks, positives, negatives = [], [], []

    def check(name, condition):
        if not condition:
            raise ValueError(name)
        checks.append({'name': name, 'status': 'PASS'})

    with tempfile.TemporaryDirectory(prefix='pida-current-hub-') as folder:
        temp = Path(folder)
        for name, digest in lock['files'].items():
            source = args.source/name
            if source.is_symlink() or source.resolve() != source.absolute():
                raise ValueError('SOURCE_SYMLINK')
            raw = source.read_bytes()
            if sha(raw) != digest:
                raise ValueError('SOURCE_PIN_MISMATCH')
            target = temp/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
        # Reuse the verified source-snapshot boundary from the Pida worker.
        import importlib.util
        spec = importlib.util.spec_from_file_location('pida_worker', root/'scripts/pix-worker.py')
        worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
        verified_args = argparse.Namespace(source=str(args.pix_source.resolve()), source_commit=worker.SOURCE_COMMIT, source_digest=worker.SOURCE_DIGEST)
        engine, snapshot = worker.verify_source(verified_args)
        try:
            sys.path.insert(0, str(temp/'src'))
            from schumpeter.hub_api import HubRequest, execute_hub
            from schumpeter.source_profiles import PIDA_CURRENT_PROFILE
            from schumpeter.contracts import ContractError
            from schumpeter.store import HubStore
            from schumpeter.product_runner import build_identity
            inputs = [root/'fixtures/current-producer/context-mcp-retry.json', args.workspace_bundle.resolve(),
                      *sorted((root/'fixtures/cr-integration/evidence').glob('*-bundle.json'))]
            for i, path in enumerate(inputs):
                raw = path.read_bytes(); original = json.loads(raw)
                captured = temp/f'capture-{i}.json'; captured.write_bytes(raw)
                store = temp/f'hub-{i}'
                result = execute_hub(HubRequest('run', store, bundle=captured, format='pida-native', source_profile=PIDA_CURRENT_PROFILE.id))
                replay = execute_hub(HubRequest('ingest', store, bundle=captured, format='pida-native', source_profile=PIDA_CURRENT_PROFILE.id))
                rows = {(r['source_id'],r['source_event_id']):r for r in HubStore(store).observations()}
                criteria = {r['criterion_id']:r['verdict'] for r in result['audit']['criteria']}
                check(f'{i}: actual latest-profile ingestion', result['ingest']['counts']['ACCEPTED'] == len(original['events']))
                check(f'{i}: stable replay identities', replay['ingest']['counts']['DUPLICATE'] == len(original['events']))
                check(f'{i}: exact metadata retained', all(rows[(e['source_id'],e['source_event_id'])]['source_payload']==e['payload'] for e in original['events']))
                check(f'{i}: model/runtime completion does not become task acceptance', criteria['task_outcome']=='UNKNOWN' and result['audit']['decision']=='REQUEST_EVIDENCE')
                positives.append({'fixture': path.name, 'sha256':sha(raw), 'producer_version':original['manifest']['runtime_version'],
                    'event_count':len(original['events']), 'ingest':result['ingest']['counts'], 'replay':replay['ingest']['counts'],
                    'metadata_equal':True, 'mapping_profile':result['snapshot']['mapping_profile'], 'mapping_digest':result['snapshot']['mapping_digest'],
                    'decision':result['audit']['decision'], 'criteria':criteria, 'adapter':result['producer'],
                    'consumer_reported_pix_identity':{k:v for k,v in result['snapshot']['pix_identity'].items() if k!='import_path'}})
            for name, expected in [('invalid-context-descriptor.json','PIDA_CONTEXT_DESCRIPTOR_INVALID'),('conflicting-event-id.json','PIDA_EVENT_ID_CONFLICT')]:
                path = root/'fixtures/current-producer'/name
                try:
                    execute_hub(HubRequest('ingest',temp/name,bundle=path,format='pida-native',source_profile=PIDA_CURRENT_PROFILE.id))
                except ContractError as exc:
                    check(name+': rejects invalid producer bytes',str(exc)==expected)
                    negatives.append({'fixture':name,'sha256':sha(path.read_bytes()),'reason':str(exc)})
                else:
                    raise ValueError('INVALID_CAPTURE_ACCEPTED')
            try:
                execute_hub(HubRequest('ingest',temp/'legacy',bundle=inputs[0],format='pida-native'))
            except ContractError as exc:
                check('legacy profile remains explicit and does not silently accept latest fields',str(exc)=='PIDA_FORBIDDEN_PAYLOAD_FIELD')
            else:
                raise ValueError('LEGACY_PROFILE_SILENTLY_CHANGED')
            report = {'profile':'pida-0.8.6-actual-hub-file-integration/1','consumer_commit':lock['commit'], 'consumer_build':build_identity(),
                'consumer_source_files':lock['files'],'source_profile':PIDA_CURRENT_PROFILE.id,'pix_engine':engine,
                'checks':checks,'positive_cases':positives,'negative_cases':negatives,
                'probe_sha256':sha(Path(__file__).read_bytes()),'worker_sha256':sha((root/'scripts/pix-worker.py').read_bytes()),
                'limits':['Synthetic file import and actual local Hub/PIX only.','Two current 0.8.6 captures plus seven historical 0.8.5 Persona captures.',
                          'No live LLM, provider service, private data, enterprise issuer or federation execution.','Task acceptance remains UNKNOWN.',
                          'PIX build authority is the hash-verified pix_engine pin; consumer-reported installed-package/Git metadata is advisory.']}
        finally:
            snapshot.cleanup()
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':'PASS','checks':len(checks),'captures':len(positives),'events':sum(p['event_count'] for p in positives),'consumer':lock['commit']}))


if __name__ == '__main__':
    main()
