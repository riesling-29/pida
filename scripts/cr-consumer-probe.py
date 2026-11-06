"""Opt-in synthetic local integration probe. No server, credentials or production data.

Imports verified copies of existing consumer source; writes only disposable Pida
test state. Persona's private validation methods are used solely by this probe,
not advertised as a supported remote API. Their public equivalent is a pending CR.
"""
import hashlib
import json
from pathlib import Path
import sys
import tempfile

mode, source, lock_path = sys.argv[1:4]
lock = json.loads(Path(lock_path).read_text())[mode]
with tempfile.TemporaryDirectory(prefix="pida-cr-consumer-") as folder:
    destination = Path(folder)
    for name, expected in lock['files'].items():
        path = Path(source) / name
        if path.is_symlink() or path.resolve() != path.absolute():
            raise ValueError('SOURCE_SYMLINK')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError('SOURCE_PIN_MISMATCH: ' + name)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    sys.path.insert(0, str(destination if mode == 'persona' else destination / 'src'))
    if mode == 'schumpeter':
        from schumpeter.hub_api import HubRequest, execute_hub
        from schumpeter.contracts import ContractError
        for line in sys.stdin:
            request = json.loads(line)
            try:
                result = execute_hub(HubRequest(action='ingest', store=destination / ('hub-' + str(request['id']) + '.sqlite3'),
                                               bundle=Path(request['bundle']), format='pida-native'))
                value = {'accepted': True, 'result': result}
            except ContractError as error:
                value = {'accepted': False, 'error': str(error)}
            print(json.dumps({'id': request['id'], 'value': value}), flush=True)
    else:
        from persona_substrate.contracts import ContractError, canonical
        from vera_persona.continuity_fixture import Fixture, PRINCIPAL, PERSONA, SCOPES, binding, descriptor, working
        now = [1000]
        fixture = Fixture(destination / 'state', lambda: now[0])
        memory, observation = fixture.observation(event='event:pida-cr-input')
        model = fixture.model([observation['id']])
        fixture.activate(model)
        for line in sys.stdin:
            request = json.loads(line)
            try:
                action = request['action']
                if action == 'resolve':
                    r = request['request']
                    persona = request.get('persona', PERSONA)
                    if persona != PERSONA:
                        fixture.p.create_persona(PRINCIPAL, descriptor(persona, persona.split(':')[1]), 'create-' + persona)
                    value = binding(r['runId'])
                    value.update(agent_instance_id='instance:main', task_id=r['taskId'])
                    b = fixture.p.bind(PRINCIPAL, persona, value, 'bind-' + r['runId'])
                    fixture.p.open_branch(PRINCIPAL, b['binding_id'], 'main', None, 'open-' + r['runId'])
                    fixture.p.advance_state(PRINCIPAL, b['binding_id'], 'main', None,
                                            working([memory['memory_id']] if persona == PERSONA else []), 'state-' + r['runId'])
                    c = fixture.p.project_vera_context(PRINCIPAL, b['binding_id'], {
                        'base': {'query': '', 'scopes': SCOPES, 'budget_bytes': 16000}, 'branch': 'main',
                        'model_refs': [dict(id=model['id'], revision=model['revision'], digest=model['digest'])] if persona == PERSONA else [],
                        'analysis_refs': [], 'renderer': request.get('renderer', 'vera-json/1')})
                    value = {'binding': b, 'context': c}
                elif action == 'authorize':
                    r = request['request']
                    # Read-only transactional equivalent of ConsumerAdapter's checks.
                    # Do not use RecordingConsumer or emit a fake use receipt.
                    with fixture.p._session(PRINCIPAL, r['binding']['binding_id'], 'context:consume') as (db, b, identity):
                        if canonical(b) != canonical(r['binding']) or b['run_id'] != r['runId'] or b['task_id'] != r['taskId']:
                            raise ContractError('CONTEXT_MISMATCH')
                        fixture.p._checked_context(db, b, r['context'])
                    value = {'authorized': True, 'requestId': r['requestId'], 'bindingId': b['binding_id'],
                             'contextDigest': r['context']['digest'], 'inputDigest': r['inputDigest']}
                elif action == 'revoke':
                    fixture.admin.revoke('grant:owner'); value = {'revoked': True}
                elif action == 'withdraw':
                    fixture.decision(model, 'withdraw', 2, 1); value = {'withdrawn': True}
                elif action == 'expire':
                    now[0] = 1300; value = {'expired': True}
                elif action == 'status':
                    with fixture.p.transaction() as db:
                        value = {'provider_use_receipts': len(fixture.p.records(db, 'receipt', PERSONA))}
                else:
                    raise ValueError('UNSUPPORTED_PROBE_ACTION')
                print(json.dumps({'id': request['id'], 'value': value}), flush=True)
            except ContractError as error:
                print(json.dumps({'id': request['id'], 'error': error.code}), flush=True)
