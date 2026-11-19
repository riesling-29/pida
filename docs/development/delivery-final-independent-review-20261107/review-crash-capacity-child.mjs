import {AgentSupervisor} from './dist/agent-supervisor.js';
const owner={id:'review-owner',permissions:['pida:agents','pida:collaborate']};
const s=await AgentSupervisor.open({directory:process.argv[2],maxConcurrent:1,resolvePrincipal:()=>owner,createRuntime:()=>process.exit(78),collaboration:{hostId:'host-1',authorize:()=>true}});
s.start();
