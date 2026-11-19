#!/usr/bin/python3
"""Private, pinned Linux built-in Git closure. Never installs system packages."""
import hashlib, json, os, pathlib, re, shutil, subprocess, tempfile, urllib.request

SOURCE = pathlib.Path('/mnt/d/ChantaResearchGroup/pida')
EVIDENCE = pathlib.Path(__file__).resolve().parent
ROOT = SOURCE / '.pida-test-runtime-distribution-20261107'
TARGET = ROOT / 'git-linux'
LOCK = SOURCE / 'scripts/runtime-platform-lock.json'
sha = lambda content: hashlib.sha256(content).hexdigest()

def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

lock_bytes = LOCK.read_bytes()
lock = json.loads(lock_bytes)['linuxGit']
if TARGET.exists():
    raise RuntimeError('Existing target must be inspected; refusing overwrite')
cache = ROOT / 'cache'
cache.mkdir(parents=True, exist_ok=True)
packages = []
with tempfile.TemporaryDirectory(prefix='pida-git-extract-') as temp:
    extract = pathlib.Path(temp) / 'packages'
    extract.mkdir()
    for spec in lock['packages']:
        assert spec['url'].startswith(('https://archive.ubuntu.com/ubuntu/pool/', 'https://snapshot.ubuntu.com/ubuntu/'))
        acquired_url = spec['url'] if spec['name'] != 'zlib1g' else 'https://snapshot.ubuntu.com/ubuntu/20261001T000000Z/pool/main/z/zlib/zlib1g_1.3.dfsg+really1.3.1-1ubuntu3.1_amd64.deb'
        archive = cache / spec['file']
        if not archive.exists():
            with urllib.request.urlopen(acquired_url, timeout=60) as response:
                content = response.read()
            if sha(content) != spec['sha256']:
                raise RuntimeError('Downloaded checksum mismatch: ' + spec['name'])
            archive.write_bytes(content)
        assert sha(archive.read_bytes()) == spec['sha256'], spec['name']
        metadata = run(['dpkg-deb', '-f', str(archive)])
        assert run(['dpkg-deb', '-f', str(archive), 'Version']) == spec['version']
        subprocess.run(['dpkg-deb', '-x', str(archive), str(extract)], check=True)
        packages.append({**spec, 'acquisitionURL': acquired_url, 'archiveBytes': archive.stat().st_size, 'controlMetadata': metadata})

    TARGET.mkdir()
    for directory in ['bin', 'lib', 'libexec/git-core', 'share/doc', 'share/git-core']:
        (TARGET / directory).mkdir(parents=True, exist_ok=True)
    shutil.copy2(extract / 'usr/bin/git', TARGET / 'libexec/git-core/git')
    libraries = []
    for soname in ['libpcre2-8.so.0', 'libz.so.1']:
        source = extract / 'usr/lib/x86_64-linux-gnu' / soname
        if not source.exists():
            source = extract / 'lib/x86_64-linux-gnu' / soname
        shutil.copy2(source.resolve(), TARGET / 'lib' / soname)
        libraries.append({'soname': soname, 'packageRelativeTarget': str(source.resolve().relative_to(extract)), 'sha256': sha(source.read_bytes())})
    shutil.copytree(extract / 'usr/share/git-core/templates', TARGET / 'share/git-core/templates')
    for spec in lock['packages']:
        # Preserve package notices, without unrelated contrib trees whose COPYING
        # links intentionally point at the external base-files common-license area.
        destination = TARGET / 'share/doc' / spec['name']
        destination.mkdir()
        for notice in (extract / 'usr/share/doc' / spec['name']).iterdir():
            if notice.is_file() and not notice.is_symlink():
                shutil.copy2(notice, destination / notice.name)
    shutil.copytree('/usr/share/common-licenses', TARGET / 'share/common-licenses', symlinks=False)
    wrapper = '''#!/bin/sh
# Pida local built-in Git closure; no remote/helper/toolchain promise.
case "$0" in */*) directory=${0%/*} ;; *) echo "Git wrapper requires a resolved path" >&2; exit 127 ;; esac
directory=$(CDPATH= cd -- "$directory/.." && pwd -P) || exit 127
LD_LIBRARY_PATH="$directory/lib"
GIT_TEMPLATE_DIR="$directory/share/git-core/templates"
GIT_EXEC_PATH="$directory/libexec/git-core"
export LD_LIBRARY_PATH GIT_TEMPLATE_DIR GIT_EXEC_PATH
exec "$directory/libexec/git-core/git" "$@"
'''
    (TARGET / 'bin/git').write_text(wrapper)
    (TARGET / 'bin/git').chmod(0o755)
    (TARGET / 'libexec/git-core/git').chmod(0o755)

elf = {}
for relative in ['libexec/git-core/git', 'lib/libpcre2-8.so.0', 'lib/libz.so.1']:
    file = TARGET / relative
    versions = sorted(set(re.findall(r'GLIBC_[0-9]+(?:\.[0-9]+)*', run(['readelf', '--version-info', str(file)]))), key=lambda v: tuple(map(int, v[6:].split('.'))))
    needed = re.findall(r'Shared library: \[(.*?)\]', run(['readelf', '-d', str(file)]))
    elf[relative] = {'needed': needed, 'glibcVersions': versions, 'maximumGLIBC': versions[-1]}
interpreter = run(['readelf', '-l', str(TARGET / 'libexec/git-core/git')])
loader = re.search(r'Requesting program interpreter: ([^\]]+)', interpreter).group(1)
resolved = run(['ldd', str(TARGET / 'libexec/git-core/git')], env={'PATH': '/usr/bin:/bin', 'LD_LIBRARY_PATH': str(TARGET / 'lib')})
provenance = {'scope': lock['scope'], 'platformLockSHA256': sha(lock_bytes), 'artifact': str(TARGET), 'packages': packages,
    'copiedLibraries': libraries, 'elf': elf, 'externalELFInterpreter': loader, 'resolvedDependencies': resolved,
    'hostGLIBC': run(['getconf', 'GNU_LIBC_VERSION']), 'wrapperSHA256': sha(wrapper.encode()),
    'sourceNotices': ['share/doc/git/copyright', 'share/doc/libpcre2-8-0/copyright', 'share/doc/zlib1g/copyright'],
    'commonLicenseTextSource': {'path': '/usr/share/common-licenses', 'package': run(['dpkg-query', '-W', '-f=${Package} ${Version}', 'base-files']), 'scope': 'License texts only, copied from installed Ubuntu base-files; no executable/library copied from host'},
    'omissions': 'Not the full Ubuntu git package: remote helpers, credential programs, Perl, ssh and interactive tooling deliberately outside scope'}
(EVIDENCE / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(json.dumps({'artifact': str(TARGET), 'packages': len(packages), 'elf': elf, 'loader': loader}))
