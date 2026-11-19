import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export function createHostPersona({ workspaceDirectory }) {
  return { mode: 'synthetic-close-test', personaProvider(context) {
    return { id: 'synthetic-close-test', agentId: context.agentId, authority: 'external', resolveContext() { throw Error('UNUSED_SYNTHETIC_CONTEXT'); } };
  }, close() { return writeFile(join(workspaceDirectory, 'persona-closed.txt'), 'closed'); } };
}
