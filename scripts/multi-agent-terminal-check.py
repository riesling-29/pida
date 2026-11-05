"""Actual Linux PTY/CLI/Pi/HTTP integration. Disposable workspace, mock model."""
import argparse, fcntl, hashlib, json, os, pty, select, signal, socket, struct, subprocess, tempfile, termios, time, urllib.request
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    if args.output.exists():raise ValueError('OUTPUT_EXISTS')
    root=Path(__file__).resolve().parents[1];cli=root/'dist/cli.js';checks=[]
    def check(name,value):
        if not value:raise AssertionError(name)
        checks.append(name)
    with tempfile.TemporaryDirectory(prefix='.pida-test-multi-pty-',dir=root) as folder:
        workspace=Path(folder)/'workspace'
        subprocess.run(['node',str(cli),'init',str(workspace)],check=True,capture_output=True)
        path=workspace/'pida.config.json';config=json.loads(path.read_text())
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));config['port']=sock.getsockname()[1]
        path.write_text(json.dumps(config));token=next(s.split('=',1)[1].strip() for s in (workspace/'.env').read_text().splitlines() if s.startswith('PIDA_API_TOKEN='))
        origin='http://127.0.0.1:'+str(config['port'])
        def api(path,body=None):
            req=urllib.request.Request(origin+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
        child=None;master=None;slave=None;capture=bytearray()
        server=subprocess.Popen(['node',str(cli),'start',str(workspace)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        def pump():
            if master is None:return
            while select.select([master],[],[],0)[0]:
                try:data=os.read(master,65536)
                except OSError:break
                if not data:break
                capture.extend(data)
        def wait(predicate,seconds=12):
            end=time.monotonic()+seconds
            while time.monotonic()<end:
                pump()
                try:
                    if predicate():return
                except (OSError,KeyError):pass
                time.sleep(.03)
            raise AssertionError('condition timed out: '+capture[-1500:].decode(errors='replace'))
        def key(value):os.write(master,value);time.sleep(.06);pump()
        def launch():
            nonlocal child,master,slave
            master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',44,160,0,0));capture.clear()
            env={**os.environ,'TERM':'xterm-256color','COLORTERM':'truecolor'};env.pop('NO_COLOR',None)
            child=subprocess.Popen(['node',str(cli),'tui',str(workspace)],stdin=slave,stdout=slave,stderr=slave,env=env)
            wait(lambda:b'MULTI TUI' in capture)
        def detach():
            nonlocal master,slave
            key(b'\x04');wait(lambda:child.poll() is not None)
            check('clean exit and terminal buffer restoration',child.returncode==0 and b'\x1b[?1049l' in capture)
            check('terminal canonical input and echo restored',bool(termios.tcgetattr(slave)[3]&termios.ICANON) and bool(termios.tcgetattr(slave)[3]&termios.ECHO))
            check('no application token rendered',token.encode() not in capture)
            os.close(master);os.close(slave);master=slave=None
        try:
            wait(lambda:bool(api('/v1/info')))
            a=api('/v1/agents',{'name':'Code A'})['id'];b=api('/v1/agents',{'name':'Research B'})['id']
            for agent in [a,b]:api('/v1/agents/'+agent+'/pause',{})
            launch();check('default CLI opens green multi-agent TUI',b'\x1b[48;2;1;2;1m' in capture)
            check('opening workspace does not create unrelated main session',api('/v1/sessions')['sessions']==[])
            key(b'\x1bOR');key(b'\x1b[B');key(b'\r');wait(lambda:b'Code A' in capture)
            key('\x1b[200~LOT-001 한글 요청\x1b[201~'.encode());check('Korean paste remains an unsent draft',not api('/v1/agents/'+a+'/jobs')['jobs'])
            key(b'\x1b[17~');key(b'\r');wait(lambda:b'2/4 panels' in capture)
            key(b'\x1bOR');key(b'\x1b[B');key(b'\x1b[B');key(b'\r')
            key(b'\x1b[200~LOT-002\x1b[201~');key(b'\r');wait(lambda:len(api('/v1/agents/'+b+'/jobs')['jobs'])==1)
            key(b'\x1b[<0;5;5M');key(b'\x1b[<0;5;5m');key(b'\r');wait(lambda:len(api('/v1/agents/'+a+'/jobs')['jobs'])==1)
            aj=api('/v1/agents/'+a+'/jobs')['jobs'][0];bj=api('/v1/agents/'+b+'/jobs')['jobs'][0]
            check('two actual panel editors submit to different agents',aj['input']=='LOT-001 한글 요청' and bj['input']=='LOT-002')
            key(b'\x1bOQ');key(b'\x1b[B');key(b'\r');wait(lambda:'작업 2'.encode() in capture)
            key(b'\x1bOQ');key(b'\r');check('tab switch preserves jobs',len(api('/v1/agents/'+a+'/jobs')['jobs'])==1)
            key(b'\x1b[19~');key(b'\x1b[B');key(b'\x1b[B');key(b'\r');wait(lambda:api('/v1/agents/'+a+'/jobs/'+aj['id'])['status']=='cancelled')
            check('TUI cancel targets only displayed job',api('/v1/agents/'+b+'/jobs/'+bj['id'])['status']=='queued')
            detach();check('host and queued job survive detach',server.poll() is None and api('/v1/agents/'+b+'/jobs/'+bj['id'])['status']=='queued')
            layout_files=list((workspace/config['stateDir']/'tui-layouts').glob('*.json'));check('layout persisted without instructions or credentials',len(layout_files)==1 and 'LOT-' not in layout_files[0].read_text() and token not in layout_files[0].read_text())
            launch();wait(lambda:b'2/4 panels' in capture and b'Code A' in capture and b'Research B' in capture)
            check('new terminal restores tabs and bindings without replay',len(api('/v1/agents/'+a+'/jobs')['jobs'])==1 and len(api('/v1/agents/'+b+'/jobs')['jobs'])==1)
            api('/v1/agents/'+b+'/resume',{});wait(lambda:api('/v1/agents/'+b+'/jobs/'+bj['id'])['status']=='completed');wait(lambda:'실행 완료'.encode() in capture)
            check('separate HTTP client and TUI observe same real Pi mock-model result',api('/v1/agents/'+b+'/jobs/'+bj['id'])['runId'] is not None)
            # New-agent dialog uses the source catalogue and preserves all existing jobs.
            key(b'\x1bOR');key(b'\r');key(b'\x1b[200~Operator C\x1b[201~');key(b'\r');key(b'\r')
            wait(lambda:len(api('/v1/agents')['agents'])==3);check('TUI creates host-approved ordinary agent',any(p['name']=='Operator C' and p['personaSourceId']=='local' for p in api('/v1/agents')['agents']))
            fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,64,0,0));child.send_signal(signal.SIGWINCH);key(b'\x1bOP');wait(lambda:'작업 환경'.encode() in capture);key(b'\x1b')
            check('narrow terminal stays interactive',child.poll() is None);detach()
        finally:
            if child and child.poll() is None:
                child.terminate()
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:child.kill();child.wait()
            if master is not None:os.close(master)
            if slave is not None:os.close(slave)
            server.terminate()
            try:server.communicate(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.communicate()
    files=['src/agent-tui.ts','src/agent-workspace-controller.ts','src/workspace-layout.ts','src/cli.ts','src/agent-supervisor.ts','src/http.ts','scripts/multi-agent-terminal-check.py']
    report={'version':json.loads((root/'package.json').read_text())['version'],'environment':'Linux PTY / '+subprocess.check_output(['node','--version'],text=True).strip(),'model':'mock; actual Pi/HTTP/CLI','checks':checks,'source_sha256':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files},'unverified':['Windows Terminal / PowerShell / IME','live LLM','company gateway','browser interaction']}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':len(checks),'output':str(args.output)}))
if __name__=='__main__':main()
