#!/usr/bin/python3
import hashlib, json, os, pathlib, shutil, subprocess, tempfile

ROOT = pathlib.Path('/mnt/d/ChantaResearchGroup/pida/.pida-test-runtime-distribution-20261107/git-linux')
EVIDENCE = pathlib.Path(__file__).resolve().parent
sha = lambda content: hashlib.sha256(content).hexdigest()

def inventory(root):
    entries = []
    for file in sorted(root.rglob('*')):
        assert not file.is_symlink(), str(file)
        if file.is_file():
            entries.append({'path': str(file.relative_to(root)), 'bytes': file.stat().st_size, 'sha256': sha(file.read_bytes())})
    return entries

before = inventory(ROOT)
commands = []
with tempfile.TemporaryDirectory(prefix='pida-git-linux-') as temp:
    base = pathlib.Path(temp)
    relocated = base / 'relocated dependency with spaces'
    shutil.copytree(ROOT, relocated)
    files = base / 'files'
    home = base / 'synthetic-home'
    files.mkdir(); home.mkdir()
    sentinel = '# synthetic configuration must remain unchanged\n[probe]\nvalue = untouched\n'
    (home / '.gitconfig').write_text(sentinel)
    env = {'PATH': str(relocated / 'bin'), 'HOME': str(home), 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0', 'LC_ALL': 'C.UTF-8'}
    assert shutil.which('git', path=env['PATH']) == str(relocated / 'bin/git')
    for missing in ['ssh', 'perl', 'curl']:
        assert shutil.which(missing, path=env['PATH']) is None
    def git(*args):
        command = ['git', '--git-dir', '../history.git', '--work-tree', '.', '-c', 'core.hooksPath=/dev/null',
                   '-c', 'commit.gpgsign=false', '-c', 'user.name=Pida', '-c', 'user.email=pida@localhost', *args]
        result = subprocess.run(command, cwd=files, env=env, text=True, capture_output=True, timeout=10)
        assert result.returncode == 0, (args, result.returncode, result.stderr)
        commands.append({'args': args, 'status': result.returncode, 'output': result.stdout.rstrip()})
        return result.stdout.rstrip()
    version = git('--version'); assert version == 'git version 2.53.0'
    git('init', '--quiet'); git('commit', '--allow-empty', '-qm', 'Initial workspace')
    first = git('rev-parse', 'HEAD')
    content = 'Synthetic Linux Git artifact: 리슬링\n'
    (files / 'result.txt').write_text(content)
    git('add', '--all'); git('commit', '-qm', 'Synthetic artifact')
    second = git('rev-parse', 'HEAD'); assert first != second
    assert git('status', '--porcelain') == ''
    assert git('log', '--format=%s', '-1') == 'Synthetic artifact'
    git('merge-base', '--is-ancestor', first, second)
    assert git('diff', '--name-only', first, second) == 'result.txt'
    assert git('ls-tree', '-r', '--name-only', 'HEAD') == 'result.txt'
    assert git('show', 'HEAD:result.txt') == content.rstrip()
    assert (home / '.gitconfig').read_text() == sentinel
    assert inventory(ROOT) == before
    assert inventory(relocated) == before
    proof = {'version': version, 'kernel': os.uname().release, 'architecture': os.uname().machine,
             'relocatedWithSpaces': True, 'cleanPath': env['PATH'], 'resolvedGit': shutil.which('git', path=env['PATH']),
             'ambientExecutableLookupExcluded': ['git', 'ssh', 'perl', 'curl'], 'syntheticGlobalConfigUnchanged': True,
             'actualUserConfig': 'Not read; isolated HOME, system/global configuration disabled',
             'artifactUnchanged': True, 'files': len(before), 'bytes': sum(entry['bytes'] for entry in before),
             'inventoryDigest': sha(json.dumps(before, separators=(',', ':')).encode()), 'inventory': before,
             'commands': commands, 'externalRuntime': ['/bin/sh', 'glibc', '/lib64/ld-linux-x86-64.so.2'],
             'scope': '13 actual local built-in Git invocations under clean PATH; not general/remote Git or clean VM proof'}
    (EVIDENCE / 'result.json').write_text(json.dumps(proof, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'version': version, 'commands': len(commands), 'files': len(before), 'bytes': proof['bytes'], 'inventoryDigest': proof['inventoryDigest']}))
