"""Synthetic authoritative-policy fixture; parent control pipe is trusted, HTTP body is not."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import sys
import threading
import time

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

state = {'grant': None, 'mode': 'normal', 'calls': [], 'reservation': None, 'reservation_state': 'reserved'}
lock = threading.Lock()
token = os.environ['POLICY_FIXTURE_TOKEN']


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if (self.path != '/v1/pida-authorization' or self.headers.get('Origin')
                or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token)):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > 131072:
                raise ValueError()
            request = json.loads(self.rfile.read(length))
            with lock:
                grant, mode = state['grant'], state['mode']
                reservation, reservation_state = state['reservation'], state['reservation_state']
                state['calls'].append(request['phase'])
            v2 = request['schema_version'] == 'schumpeter.pida.authorization.request/2'
            admission = request['admission'] if v2 else None
            envelope = admission['envelope'] if v2 else request['envelope']
            unsigned = {k: v for k, v in envelope.items() if k != 'payload_digest'}
            digest = hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            allowed = bool(grant and request['schema_version'] in ['schumpeter.pida.authorization.request/1', 'schumpeter.pida.authorization.request/2']
                           and request['host_id'] == grant['host_id'] and request['principal_id'] == grant['principal_id']
                           and envelope['recipient'] == grant['recipient'] and envelope['sender_binding_id'] == grant['sender_binding_id']
                           and all(envelope[k] == grant[k] for k in ['room_id', 'room_revision', 'contract_id', 'contract_revision'])
                           and envelope['payload_digest'] == digest)
            value = {'schema_version': 'schumpeter.pida.authorization.response/1', 'request_id': request['request_id'], 'authorized': allowed, 'phase': request['phase'],
                     'principal_id': request['principal_id'], 'host_id': request['host_id'], 'payload_digest': envelope['payload_digest'],
                     'room_revision': envelope['room_revision'], 'contract_revision': envelope['contract_revision'], 'recipient': envelope['recipient']}
            if v2:
                canonical_digest = lambda item: hashlib.sha256(json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                allowed = bool(allowed and reservation == admission and reservation_state in ['reserved', 'observed']
                               and request['phase'] in ['admit', 'read', 'dispatch']
                               and admission['definition_digest'] == canonical_digest(admission['definition'])
                               and admission['admission_digest'] == canonical_digest({k: v for k, v in admission.items() if k != 'admission_digest'}))
                value.update({'schema_version': 'schumpeter.pida.authorization.response/2', 'authorized': allowed,
                              'admission_digest': admission['admission_digest'], 'definition_digest': admission['definition_digest'],
                              'reservation_id': admission['reservation_id'], 'reservation_state': reservation_state if reservation else None})
                if mode == 'definition':
                    value['definition_digest'] = '0' * 64
                if mode == 'reservation':
                    value['reservation_id'] = 'wrong-reservation'
                if mode == 'reservation-state':
                    value['reservation_state'] = 'existing'
            if mode == 'delay':
                time.sleep(0.3)
            if mode == 'nonce':
                value['request_id'] = 'wrong'
            if mode == 'phase':
                value['phase'] = 'wrong'
            if mode == 'owner':
                value['principal_id'] = 'foreign'
            if mode == 'host':
                value['host_id'] = 'foreign'
            if mode == 'stale':
                value['contract_revision'] += 1
            if mode == 'recipient':
                value['recipient'] = {**value['recipient'], 'organization_id': 'foreign'}
            if mode == 'redirect':
                self.send_response(307)
                self.send_header('Location', '/unexpected')
                self.end_headers()
                return
            encoded = b'not-json' if mode == 'malformed' else (b'x' * 9000 if mode == 'oversize' else json.dumps(value).encode())
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
        except (ValueError, KeyError, TypeError):
            self.send_error(400)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
print(json.dumps({'type': 'ready', 'port': server.server_port}), flush=True)
try:
    for line in sys.stdin:
        command = json.loads(line)
        with lock:
            if 'grant' in command:
                state['grant'] = command['grant']
            if 'mode' in command:
                state['mode'] = command['mode']
            if 'reservation' in command:
                state['reservation'] = command['reservation']
            if 'reservation_state' in command:
                state['reservation_state'] = command['reservation_state']
            value = {'id': command['id'], 'calls': list(state['calls'])}
        print(json.dumps(value), flush=True)
finally:
    server.shutdown()
    server.server_close()
