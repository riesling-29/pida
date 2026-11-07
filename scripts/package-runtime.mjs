// Build a private platform distribution from an explicit source revision. Never installs globally.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync, lstatSync, readlinkSync, chmodSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityPath, createManagedCapabilities, validateManagedCapabilityFiles } from './managed-host-capabilities.mjs';
const repo = resolve(fileURLToPath(new URL('../', import.meta.url))), options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--output','--source','--node-archive','--git-directory','--package-tar','--managed-capabilities'].includes(process.argv[i]) || !process.argv[i+1]) throw Error('INVALID_ARGUMENT');
  options[process.argv[i].slice(2)] = process.argv[i+1];
}
if (!options.output || !options.source || !options['node-archive'] || !options['git-directory']) throw Error('OUTPUT_SOURCE_NODE_GIT_REQUIRED');
const output = resolve(options.output), platform = process.platform + '-' + process.arch;
const lock = JSON.parse(readFileSync(join(repo, 'scripts/runtime-platform-lock.json'), 'utf8')), nodeLock = lock.node[platform];
if (!nodeLock) throw Error('UNSUPPORTED_PLATFORM');
if (existsSync(output) && readdirSync(output).length) throw Error('OUTPUT_NOT_EMPTY');
mkdirSync(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), hashFile = file => sha(readFileSync(file));
const run = (exe, args, cwd = repo, env = process.env) => {
  const r = spawnSync(exe, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw Error('COMMAND_FAILED:' + exe + ':' + (r.status ?? r.error?.code) + '\n' + (r.stderr ?? '').slice(-3000));
  return r.stdout;
};
const archive = resolve(options['node-archive']);
if (hashFile(archive) !== nodeLock.sha256) throw Error('NODE_ARCHIVE_HASH_MISMATCH');
const tools = join(output, 'build-tools'); mkdirSync(tools);
run('tar', ['-xf', archive, '-C', tools]);
const officialNode = join(tools, 'node-v' + lock.nodeVersion + '-' + (process.platform === 'win32' ? 'win' : 'linux') + '-x64');
const buildNode = join(officialNode, process.platform === 'win32' ? 'node.exe' : 'bin/node');
const npm = join(officialNode, process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
if (run(buildNode, ['--version']).trim() !== 'v' + lock.nodeVersion) throw Error('NODE_VERSION_MISMATCH');
let packageTar, sourceCommit, sourceEvidence;
if (options['package-tar']) {
  packageTar = resolve(options['package-tar']); sourceCommit = options.source;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('SOURCE_COMMIT_REQUIRED');
  sourceEvidence = JSON.parse(readFileSync(packageTar + '.source.json', 'utf8'));
  if (sourceEvidence.source_commit !== sourceCommit || sourceEvidence.package_sha256 !== hashFile(packageTar)) throw Error('PACKAGE_SOURCE_PIN_MISMATCH');
} else {
  sourceCommit = run('git', ['rev-parse', options.source + '^{commit}']).trim();
  const changed = run('git', ['diff', sourceCommit, '--', 'src', 'tsconfig.json', 'package.json', 'npm-shrinkwrap.json', 'scripts/task.mjs']);
  if (changed.trim()) throw Error('BUILD_SOURCE_DIFFERS_FROM_PIN');
  const frozen = join(output, 'frozen-package'); mkdirSync(frozen);
  const sourceTar = join(output, 'frozen-source.tar'); run('git', ['archive', '--format=tar', '--output=' + sourceTar, sourceCommit]);
  run('tar', ['-xf', sourceTar, '-C', frozen]);
  const compiler = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));
  run(process.execPath, [compiler, '-p', join(repo, 'tsconfig.json'), '--outDir', join(frozen, 'dist')]);
  const result = JSON.parse(run(buildNode, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], frozen));
  packageTar = join(output, result[0].filename);
  if (!result[0].files.some(f => f.path === 'npm-shrinkwrap.json')) throw Error('PACKAGE_DEPENDENCY_LOCK_MISSING');
  writeFileSync(join(output, 'npm-pack.json'), JSON.stringify(result, null, 2) + '\n');
  sourceEvidence = { source_commit: sourceCommit, source_archive_sha256: hashFile(sourceTar), package_sha256: hashFile(packageTar),
    dependency_lock_sha256: hashFile(join(frozen, 'npm-shrinkwrap.json')), compiler: run(process.execPath, [compiler, '--version']).trim() };
  writeFileSync(packageTar + '.source.json', JSON.stringify(sourceEvidence, null, 2) + '\n');
}
const runtime = join(output, 'runtime'), nodeDir = join(runtime, 'node'), pida = join(runtime, 'pida');
mkdirSync(nodeDir, { recursive: true }); mkdirSync(pida);
cpSync(buildNode, join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node'));
for (const file of ['LICENSE', 'README.md']) cpSync(join(officialNode, file), join(nodeDir, file));
if (process.platform !== 'win32') chmodSync(join(nodeDir, 'node'), 0o755);
run('tar', ['-xf', packageTar, '-C', pida, '--strip-components=1']);
const cache = join(output, 'npm-cache'), userconfig = join(output, 'empty.npmrc'); writeFileSync(userconfig, '');
const install = run(buildNode, [npm, 'ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund',
  '--registry=https://registry.npmjs.org', '--userconfig=' + userconfig, '--cache=' + cache], pida);
writeFileSync(join(output, 'production-install.log'), install);
if (existsSync(join(pida, 'node_modules/typescript'))) throw Error('DEV_COMPILER_IN_RUNTIME');
cpSync(resolve(options['git-directory']), join(runtime, 'git'), { recursive: true, dereference: false });
if (process.platform === 'linux') {
  // Windows staging files may appear as 0777 through drvfs. Archive ordinary
  // Linux modes, so normal tar extraction under umask 022 preserves the manifest.
  const gitRoot = join(runtime, 'git'), executables = new Set(['bin/git', 'libexec/git-core/git']);
  for (const name of executables) if (!statSync(join(gitRoot, name)).isFile()) throw Error('GIT_EXECUTABLE_MISSING');
  const modes = directory => {
    chmodSync(directory, 0o755);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) modes(file);
      else if (entry.isFile()) chmodSync(file, executables.has(relative(gitRoot, file).split(sep).join('/')) ? 0o755 : 0o644);
    }
  };
  modes(gitRoot);
}
const packageJson = JSON.parse(readFileSync(join(pida, 'package.json'), 'utf8')), shrinkwrap = JSON.parse(readFileSync(join(pida, 'npm-shrinkwrap.json'), 'utf8'));
if (options['managed-capabilities']) {
  const capabilities = createManagedCapabilities(sourceCommit, options['managed-capabilities']);
  validateManagedCapabilityFiles(runtime, capabilities, sourceCommit);
  writeFileSync(join(runtime, capabilityPath), JSON.stringify(capabilities, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
}
const files = [], licenses = [], dependencies = [];
const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
  const file = join(directory, entry.name), name = relative(runtime, file).split(sep).join('/'), stat = lstatSync(file);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(file), resolved = resolve(dirname(file), link);
    if (!resolved.startsWith(runtime + sep)) throw Error('EXTERNAL_RUNTIME_LINK');
    files.push({ path: name, symlink: link });
  } else if (stat.isDirectory()) walk(file);
  else {
    files.push({ path: name, bytes: stat.size, mode: stat.mode & 0o777, sha256: hashFile(file) });
    if (/^(licen[cs]e|copying|copyright|notice|third.party)/i.test(entry.name)) licenses.push(name);
    if (entry.name === 'package.json' && name.startsWith('pida/node_modules/')) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')), dependencyPath = relative(pida, directory).split(sep).join('/'), pin = shrinkwrap.packages[dependencyPath];
      if (pin && pkg.name) dependencies.push({ path: dependencyPath, name: pkg.name, version: pkg.version, license: pkg.license ?? pin.license ?? 'UNKNOWN',
        resolved: pin.resolved ?? null, integrity: pin.integrity ?? null, packageJsonSha256: hashFile(file), dev: pin.dev === true });
    }
  }
} };
walk(runtime); files.sort((a,b) => a.path < b.path ? -1 : 1); dependencies.sort((a,b) => a.path < b.path ? -1 : 1); licenses.sort();
if (dependencies.some(p => p.dev)) throw Error('DEV_DEPENDENCY_IN_RUNTIME');
const manifest = { schema_version: 'pida.runtime-distribution/1', distribution_id: 'pida-' + packageJson.version + '+schumpeter.' + sourceCommit.slice(0,12) + '.' + platform,
  source_commit: sourceCommit, platform, built_with: { node: run(buildNode, ['--version']).trim(), npm: run(buildNode,[npm,'--version']).trim(),
    abi: JSON.parse(run(buildNode, ['-p', 'JSON.stringify({modules:process.versions.modules,napi:process.versions.napi})'])) },
  package: { name: packageJson.name, version: packageJson.version, archive: packageTar.split(/[\\/]/).at(-1), sha256: hashFile(packageTar), bytes: statSync(packageTar).size, license: packageJson.license },
  source: sourceEvidence,
  packaging: { managed_capabilities_generator_sha256: hashFile(join(repo, 'scripts/managed-host-capabilities.mjs')), script_sha256: hashFile(fileURLToPath(import.meta.url)), platform_lock_sha256: hashFile(join(repo, 'scripts/runtime-platform-lock.json')) },
  node: { version: lock.nodeVersion, ...nodeLock, included: 'binary + original LICENSE and README; no npm needed at runtime' },
  profile: { optionalDependencies: 'omitted', lifecycleScripts: 'disabled', browserChecks: 'not bundled', persona: 'separate explicit provider; synthetic example is not production canonical memory' },
  dependencies, license_files: licenses, native_addon_paths: files.filter(f => f.path.endsWith('.node')).map(f => f.path),
  file_count: files.length, tree_sha256: sha(JSON.stringify(files)), files };
writeFileSync(join(runtime, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const tar = join(output, 'pida-runtime-' + sourceCommit.slice(0,7) + '-' + platform + '.tar.gz');
run('tar', ['-czf', tar, '-C', output, 'runtime']);
const summary = { source_commit: sourceCommit, platform, runtime, archive: tar, archive_sha256: hashFile(tar), archive_bytes: statSync(tar).size,
  manifest_sha256: hashFile(join(runtime, 'manifest.json')), tree_sha256: manifest.tree_sha256, file_count: files.length, dependencies: dependencies.length,
  node_binary_sha256: hashFile(join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node')), package_sha256: manifest.package.sha256 };
writeFileSync(join(output, 'result.json'), JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary));
