import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
let text=readFileSync('test/collaboration-policy-client.test.mjs','utf8');
const target="assert.equal(binding.externalContext.organizationSessionId, org.id); assert.equal(binding.externalContext.agentInstanceId, worker.id);";
assert.ok(text.includes(target));
text=text.replace(target,target+"\n    assert.equal(binding.externalContext.taskId, job.id); assert.equal(binding.externalContext.runId, job.runId); assert.equal(binding.externalContext.attemptId, job.attemptId, 'Persona attempt must identify actual native OrgAttempt for an organized job');");
mkdirSync('review-tests',{recursive:true});writeFileSync('review-tests/native-ids.test.mjs',text);
