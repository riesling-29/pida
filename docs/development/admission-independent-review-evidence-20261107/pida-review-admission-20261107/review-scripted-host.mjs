// Test-only trusted preload: replace model outputs only; retain actual host, policy, tools and persistence.
import {AgentSupervisor} from './dist/agent-supervisor.js';
import {fauxProvider,fauxAssistantMessage as answer,fauxToolCall as call} from '@earendil-works/pi-ai/providers/faux';
const original=AgentSupervisor.open;
AgentSupervisor.open=async function(options){let supervisor;const factory=options.createRuntime;
 const patched={...options,createRuntime:async(...args)=>{const runtime=await factory(...args),profile=args[0],principal={id:profile.owner,permissions:[]},f=fauxProvider({tokensPerSecond:100000});
 f.setResponses(profile.name==='review-root'?[
 ()=>answer(call('agent_delegate',{agentId:supervisor.list(principal).find(p=>p.name==='review-child').id,input:'Synthetic child check.'}),{stopReason:'toolUse'}),
 ()=>answer(call('agent_join',{required:[supervisor.jobs(supervisor.list(principal).find(p=>p.name==='review-child').id,principal)[0].id]}),{stopReason:'toolUse'}),
 ()=>answer('Initial root released.'),()=>answer('Combined synthetic child result.')]:[()=>answer('Synthetic child result.')]);
 runtime.options.provider=()=>({provider:f.provider,modelId:f.getModel().id});return runtime;}};
 supervisor=await original.call(this,patched);return supervisor;
};
