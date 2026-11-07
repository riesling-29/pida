import { readFileSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve, join, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2]), expected = process.argv[3];
if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw Error('EXPECTED_MANIFEST_HASH_REQUIRED');
const sha = b => createHash('sha256').update(b).digest('hex'), bytes = readFileSync(join(root,'manifest.json'));
if (sha(bytes) !== expected) throw Error('MANIFEST_HASH_MISMATCH');
const manifest = JSON.parse(bytes), files = [];
if (manifest.schema_version !== 'pida.runtime-distribution/1' || manifest.platform !== process.platform + '-' + process.arch) throw Error('MANIFEST_PLATFORM_MISMATCH');
function walk(directory) { for (const entry of readdirSync(directory)) {
  const path = join(directory,entry), name = relative(root,path).split(sep).join('/'), stat = lstatSync(path);
  if (name === 'manifest.json') continue;
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(path); if (!resolve(dirname(path),link).startsWith(root+sep)) throw Error('EXTERNAL_RUNTIME_LINK');
    files.push({path:name,symlink:link});
  } else if (stat.isDirectory()) walk(path);
  else files.push({path:name,bytes:stat.size,mode:stat.mode & 0o777,sha256:sha(readFileSync(path))});
} }
walk(root); files.sort((a,b)=>a.path<b.path?-1:1);
if (files.length !== manifest.file_count || sha(JSON.stringify(files)) !== manifest.tree_sha256 || JSON.stringify(files) !== JSON.stringify(manifest.files)) throw Error('RUNTIME_TREE_MISMATCH');
console.log(JSON.stringify({status:'PASS',distribution_id:manifest.distribution_id,source_commit:manifest.source_commit,files:files.length,tree_sha256:manifest.tree_sha256}));
