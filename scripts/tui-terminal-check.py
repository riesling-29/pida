"""Linux PTY smoke of the packaged CLI, real Pi TUI and local mock-model host.

Uses a disposable generated workspace. No real credentials/model or browser.
Run after npm run build. Does not stop or unlock a user's existing workspace.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import signal
import socket
import struct
import subprocess
import tempfile
import termios
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('OUTPUT_EXISTS')
    root = Path(__file__).resolve().parents[1]
    checks = []
    cli = root/'dist/cli.js'

    def check(name, value):
        if not value:
            raise AssertionError(name)
        checks.append({'name': name, 'status': 'PASS'})

    # Source-checkout self imports in the generated sample tool need the package ancestor.
    with tempfile.TemporaryDirectory(prefix='.pida-test-tui-pty-', dir=root) as folder:
        workspace = Path(folder)/'workspace'
        subprocess.run(['node', str(cli), 'init', str(workspace)], check=True, capture_output=True)
        config_file = workspace/'pida.config.json'
        config = json.loads(config_file.read_text())
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            config['port'] = sock.getsockname()[1]
        config_file.write_text(json.dumps(config))
        token = next(row.split('=', 1)[1].strip() for row in (workspace/'.env').read_text().splitlines() if row.startswith('PIDA_API_TOKEN='))
        origin = 'http://127.0.0.1:'+str(config['port'])
        def get(path):
            request = urllib.request.Request(origin+path, headers={'Authorization': 'Bearer '+token})
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.load(response)
        def wait_for(predicate, pump=lambda: None, seconds=10):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                pump()
                try:
                    if predicate():
                        return
                except (OSError, KeyError):
                    pass
                time.sleep(.03)
            raise AssertionError('condition timed out')
        server=subprocess.Popen(['node',str(cli),'start',str(workspace)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'PIDA_API_TOKEN':token})
        child=None; master=None
        try:
            wait_for(lambda: bool(get('/v1/info')))
            master,slave=pty.openpty()
            fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,112,0,0))
            initial=termios.tcgetattr(slave)
            env={**os.environ,'TERM':'xterm-256color','NO_COLOR':'1','PIDA_API_TOKEN':token}
            child=subprocess.Popen(['node',str(cli),'tui',str(workspace),'--new'],stdin=slave,stdout=slave,stderr=slave,env=env)
            capture=bytearray()
            def pump():
                while select.select([master],[],[],0)[0]:
                    try:
                        data=os.read(master,65536)
                    except OSError:
                        break
                    if not data:
                        break
                    capture.extend(data)
            wait_for(lambda: b'\x1b[?1049h' in capture,pump)
            wait_for(lambda: len(get('/v1/sessions')['sessions'])==1,pump)
            session_id=get('/v1/sessions')['sessions'][0]['sessionId']
            check('CLI attaches to local host and enters alternate-screen Pi renderer',child.poll() is None)
            # Complete paste must stay a draft until a separate Enter.
            os.write(master,'\x1b[200~LOT-001 한글 확인\x1b[201~'.encode())
            time.sleep(.1);pump()
            check('bracketed Korean paste does not submit automatically',get('/v1/sessions/'+session_id)['runs']==0)
            os.write(master,b'\r')
            wait_for(lambda:get('/v1/sessions/'+session_id)['runs']==1 and not get('/v1/sessions/'+session_id)['running'],pump)
            state=get('/v1/sessions/'+session_id)
            check('real terminal request executes actual Pi mock-model tool loop',state['lastStatus']=='completed' and any('LOT-001' in m['text'] for m in state['messages']))
            fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,64,0,0))
            child.send_signal(signal.SIGWINCH)
            os.write(master,b'/help\r');time.sleep(.25);pump()
            check('resize and help remain interactive',child.poll() is None and '/steer'.encode() in capture)
            os.write(master,b'\x1bOQ');time.sleep(.1);os.write(master,b'\x1b');time.sleep(.1);pump()
            check('session selector opens without spawning another run',get('/v1/sessions/'+session_id)['runs']==1)
            os.write(master,b'\x04')
            wait_for(lambda:child.poll() is not None,pump)
            pump()
            check('Ctrl+D cleanly detaches and restores terminal buffer',child.returncode==0 and b'\x1b[?1049l' in capture)
            restored=termios.tcgetattr(slave)
            check('terminal canonical input and echo restored',(initial[3]&(termios.ICANON|termios.ECHO))==(restored[3]&(termios.ICANON|termios.ECHO)))
            check('independent host survives TUI exit',server.poll() is None and get('/v1/sessions/'+session_id)['runs']==1)
            check('application credential never printed in TUI',token.encode() not in capture)
            os.close(slave)
            slave=None
            # A new terminal process resumes the exact same saved host session.
            os.close(master);master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
            child=subprocess.Popen(['node',str(cli),'tui',str(workspace),'--session',session_id],stdin=slave,stdout=slave,stderr=slave,env=env)
            capture.clear();wait_for(lambda:b'\x1b[?1049h' in capture,pump)
            wait_for(lambda:b'LOT-001' in capture,pump)
            os.write(master,b'\x04');wait_for(lambda:child.poll() is not None,pump)
            check('new terminal process resumes history without replay',child.returncode==0 and len(get('/v1/sessions')['sessions'])==1 and get('/v1/sessions/'+session_id)['runs']==1)
            os.close(slave)
            slave=None
        finally:
            if child and child.poll() is None:
                child.terminate()
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:child.kill();child.wait()
            if master is not None:os.close(master)
            if 'slave' in locals() and slave is not None:os.close(slave)
            server.terminate()
            try:server.communicate(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.communicate()
    files=['package.json','src/tui.ts','src/tui-controller.ts','src/cli.ts','src/client.ts','src/runtime.ts','src/http.ts','examples/web/app.js','scripts/tui-terminal-check.py']
    report={'profile':'pida-tui-pty/1','version':json.loads((root/'package.json').read_text())['version'],'platform':'Linux PTY',
            'node':subprocess.check_output(['node','--version'],text=True).strip(),'checks':checks,
            'source_sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files},
            'limits':['Actual Pi, HTTP, CLI, editor and PTY; mock model decisions.','No browser engine, live LLM, company gateway or Windows-terminal/IME validation.']}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':'PASS','checks':len(checks),'output':str(args.output)}))

if __name__=='__main__':main()
