"""Synthetic host fixture over public producer APIs; never opens canonical Persona state."""
import json
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
from persona_substrate.dispatch import DispatchProvider, PROTOCOL, CAPABILITIES
from persona_substrate.provider import PolicyAdmin
from persona_substrate.contracts import ContractError

settings = json.loads(sys.stdin.readline())
principal = 'principal:fixture'
scopes = ['personal:synthetic', 'project:schumpeter', 'organization:host']


def main():
    with tempfile.TemporaryDirectory(prefix='pida-host-persona-') as folder:
        clock = lambda: int(time.time())
        path = Path(folder) / 'synthetic.sqlite3'
        provider = DispatchProvider(path, clock)
        PolicyAdmin(path, clock).grant({'grant_id': 'grant:host', 'principal': principal, 'scopes': scopes,
            'personas': [settings['personaId']], 'actions': ['identity:write', 'bind', 'memory:read', 'state:write', 'context:build', 'context:consume'],
            'authorities': ['synthetic-host'], 'host_ids': [settings['hostId']], 'not_before': 0, 'expires_at': clock() + 3600})
        provider.create_persona(principal, {'schema_version': '1.0.0', 'persona_id': settings['personaId'], 'identity_revision': 1,
            'name': 'Synthetic host Persona', 'description': 'Synthetic public fixture. The proof number is 73. This is not canonical user memory.',
            'persona_kind': 'persistent', 'scopes': ['organization:host'], 'memory_scope': scopes,
            'lifetime': {'kind': 'persistent', 'expires_at': None}, 'retention': {'retain_until': None, 'on_expiry': 'archive-deny-read'},
            'source_refs': ['document:synthetic-host-fixture'], 'recorded_at': clock()}, 'create-host-fixture')
        for line in sys.stdin:
            message = json.loads(line)
            try:
                action = message['action']
                if action == 'describe':
                    value = provider.describe()
                elif action == 'resolve':
                    request = message['request']
                    binding = provider.bind(principal, settings['personaId'], {'agent_instance_id': settings['agentInstanceId'],
                        'project_id': 'schumpeter', 'organization_session_id': request['organizationSessionId'],
                        'task_id': request['taskId'], 'attempt_id': request['attemptId'], 'run_id': request['runId'],
                        'host_id': settings['hostId'], 'memory_scope': scopes}, 'bind-' + request['runId'])
                    previous = provider.read_working_state(principal, binding['binding_id'], scopes)
                    if previous is None:
                        provider.compare_and_set(principal, binding['binding_id'], None, [], {'goal': 'Inspect synthetic host evidence',
                            'understanding': 'Reference text is not execution authority.', 'uncertainties': ['No canonical memory claim'],
                            'next_action': 'Check current input', 'source_refs': ['document:synthetic-host-fixture'], 'evidence_memory_ids': [],
                            'scopes': ['project:schumpeter'], 'host_revision': 1, 'phase_revision': 1, 'phase': 'inspect'}, 'state-' + request['runId'])
                    value = provider.project_dispatch_context(principal, binding['binding_id'], {'protocol': PROTOCOL,
                        'requiredCapabilities': list(CAPABILITIES), 'base': {'query': '', 'scopes': scopes, 'budget_bytes': 16000}, 'renderer': 'vera-json/1'})
                elif action == 'authorize':
                    value = provider.authorize_input(principal, message['request'])
                else:
                    raise ContractError('UNSUPPORTED_PROBE_ACTION')
                print(json.dumps({'id': message['id'], 'value': value}), flush=True)
            except ContractError as exc:
                print(json.dumps({'id': message['id'], 'error': exc.code}), flush=True)


if __name__ == '__main__':
    main()
