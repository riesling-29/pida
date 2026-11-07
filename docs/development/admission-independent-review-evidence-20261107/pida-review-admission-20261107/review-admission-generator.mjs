import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('review-tests',{recursive:true});
const unit=readFileSync('test/organization-admission.test.mjs','utf8');
writeFileSync('review-tests/admission-adversaries.test.mjs',unit.slice(0,unit.indexOf("test('one atomic"))+readFileSync('review-admission-additions.txt','utf8'));
const host=readFileSync('test/collaboration-policy-client.test.mjs','utf8');
writeFileSync('review-tests/admission-host-chain.test.mjs',host.slice(0,host.indexOf("test('trusted endpoint"))+readFileSync('review-admission-host-additions.txt','utf8'));
