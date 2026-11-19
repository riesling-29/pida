import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const source=readFileSync('test/collaboration-policy-client.test.mjs','utf8');
mkdirSync('review-tests',{recursive:true});
writeFileSync('review-tests/resume-adversaries.test.mjs',source.slice(0,source.indexOf("test('trusted endpoint"))+readFileSync('review-resume-additions.txt','utf8'));
