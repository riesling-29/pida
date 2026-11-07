// Separate process: terminate at the real file replacement boundary, without cleanup/ACK.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const [directory, mode, encoded] = process.argv.slice(2);
let armed = false;
const rename = fs.renameSync;
fs.renameSync = (...args) => {
  if (armed && String(args[1]).endsWith('supervisor.json')) {
    if (mode === 'before') process.exit(66);
    const result = rename(...args);
    if (mode === 'after') process.exit(67);
    return result;
  }
  return rename(...args);
};
syncBuiltinESMExports();
const { AgentSupervisor } = await import('../../dist/agent-supervisor.js');
const owner = { id: 'owner', permissions: ['pida:agents', 'pida:collaborate'] };
const supervisor = await AgentSupervisor.open({ directory, resolvePrincipal: () => owner, createRuntime: () => { throw Error('no dispatch in crash fixture'); }, collaboration: { hostId: 'host-1', authorize: () => true } });
armed = true;
const receipt = await supervisor.receiveCollaboration(owner, JSON.parse(encoded));
process.stdout.write(JSON.stringify(receipt));
// Abrupt exit after a successful receive; no supervisor.close or scheduling.
process.exit(68);
