import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime } from "../dist/runtime.js";
import { AgentSupervisor } from "../dist/agent-supervisor.js";
import { createAgentTools, agentToolPermissions } from "../dist/agent-tools.js";

const alice = { id: "alice", permissions: [...agentToolPermissions] }, bob = { id: "bob", permissions: [...agentToolPermissions] };
const context = (principal = alice) => ({ principal, runId: randomUUID(), sessionId: randomUUID(), toolCallId: "host-tool-call", signal: new AbortController().signal });
const invoke = (tools, name, args, ctx = context()) => tools.find(tool => tool.name === name).execute(args, ctx);
async function supervisor(t, factory) {
  const directory = await mkdtemp(join(tmpdir(), "pida-agent-tools-"));
  const s = await AgentSupervisor.open({ directory, resolvePrincipal: owner => owner === alice.id ? alice : bob, createRuntime: factory ?? (() => { throw new Error("unexpected execution"); }) });
  t.after(async () => { await s.close(); await rm(directory, { recursive: true, force: true }); });
  return s;
}
async function finished(s, job) {
  for (let i = 0; i < 500; i++) { const state = s.getJob(job.id, alice); if (!["queued", "running"].includes(state.status)) return state; await delay(10); }
  assert.fail("supervisor did not finish");
}

test("agent tools use same-owner profiles, explicit permissions, host request keys and no model-controlled ancestry", async t => {
  const s = await supervisor(t), a = s.register(alice, { name: "worker", role: "read code", persona: "private persona" }), other = s.register(bob, { name: "private worker" });
  const tools = createAgentTools(s), ctx = { ...context(), idempotencyKey: "host-operation-key" };
  const listed = await invoke(tools, "agent_list", {});
  assert.deepEqual(listed.agents.map(agent => agent.id), [a.id]); assert.ok(!JSON.stringify(listed).includes("private persona"));
  for (const [name, args] of [["agent_list", {}], ["agent_delegate", { agentId: a.id, input: "inspect" }], ["agent_job_status", { jobId: randomUUID() }]])
    await assert.rejects(invoke(tools, name, args, context({ id: alice.id, permissions: [] })), { code: "FORBIDDEN" });
  const first = await invoke(tools, "agent_delegate", { agentId: a.id, input: "inspect only this task" }, ctx);
  const repeat = await invoke(tools, "agent_delegate", { agentId: a.id, input: "inspect only this task" }, ctx);
  assert.equal(first.ok, true); assert.equal(first.asynchronous, true); assert.equal(first.sharedMemory, false); assert.equal(first.job.id, repeat.job.id);
  assert.equal(s.jobs(a.id, alice).length, 1); assert.equal(first.job.status, "queued"); assert.equal(first.job.parentJobId, undefined);
  assert.equal(first.job.links.job, `/v1/agents/${first.job.agentId}/jobs/${first.job.id}`);
  const rejected = await invoke(tools, "agent_delegate", { agentId: other.id, input: "not owned" });
  assert.equal(rejected.code, "AGENT_NOT_FOUND"); assert.equal(rejected.effectState, "not_applied");
  assert.equal((await invoke(tools, "agent_delegate", { agentId: a.id, input: "bad", parentJobId: first.job.id })).code, "AGENT_ARGUMENT_INVALID");
  assert.equal((await invoke(tools, "agent_delegate", { agentId: a.id, input: "bad", requestId: "model-key" })).code, "AGENT_ARGUMENT_INVALID");
  await assert.rejects(invoke(createAgentTools(s), "agent_job_status", { jobId: first.job.id }, context(bob)), { code: "AGENT_JOB_NOT_FOUND" });
  assert.equal((await invoke(createAgentTools(s, a.id), "agent_delegate", { agentId: a.id, input: "self" })).code, "AGENT_DELEGATION_CYCLE");
  const second = s.register(alice, { name: "second" });
  assert.equal((await invoke(createAgentTools(s, a.id), "agent_delegate", { agentId: second.id, input: "missing running parent" })).code, "AGENT_DELEGATION_CONTEXT_REQUIRED");
});

test("actual Pi parent releases shared workspace before child starts; child cannot delegate back to ancestor", async t => {
  let s, a, b;
  s = await supervisor(t, profile => {
    const f = fauxProvider({ tokensPerSecond: 100000 });
    const target = profile.id === a.id ? b.id : a.id;
    f.setResponses([answer(call("agent_delegate", { agentId: target, input: "perform bounded task" }), { stopReason: "toolUse" }), answer("Delegation recorded.")]);
    return new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: createAgentTools(s, profile.id), maxRunMs: 5000 });
  });
  a = s.register(alice, { name: "parent" }); b = s.register(alice, { name: "child" });
  const queued = s.enqueue(a.id, alice, { input: "delegate once", requestId: "root-task" }); s.start();
  const parent = await finished(s, queued); assert.equal(parent.status, "completed");
  const child = s.jobs(b.id, alice)[0]; assert.ok(child); assert.equal(child.parentJobId, parent.id); assert.equal(child.depth, 1);
  const result = await finished(s, child); assert.equal(result.status, "failed"); assert.equal(result.code, "AGENT_DELEGATION_CYCLE");
  assert.ok(result.startedAt >= parent.finishedAt); assert.equal(s.jobs(a.id, alice).length, 1);
});

test("actual delegation chain stops at depth two and job summaries are bounded result data", async t => {
  let s; const agents = [];
  s = await supervisor(t, profile => {
    const index = agents.findIndex(agent => agent.id === profile.id), f = fauxProvider({ tokensPerSecond: 100000 });
    f.setResponses([answer(call("agent_delegate", { agentId: agents[index + 1].id, input: "next task" }), { stopReason: "toolUse" }), answer("Bearer sensitive-token api_key=private-value " + "x".repeat(8000))]);
    return new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: createAgentTools(s, profile.id), maxRunMs: 5000 });
  });
  for (const name of ["one", "two", "three", "four"]) agents.push(s.register(alice, { name }));
  const root = s.enqueue(agents[0].id, alice, { input: "start", requestId: "chain" }); s.start(); await finished(s, root);
  const second = s.jobs(agents[1].id, alice)[0]; assert.ok(second); await finished(s, second);
  const third = s.jobs(agents[2].id, alice)[0]; assert.ok(third);
  const end = await finished(s, third); assert.equal(end.depth, 2); assert.equal(end.status, "failed"); assert.equal(end.code, "AGENT_DELEGATION_LIMIT");
  assert.equal(s.jobs(agents[3].id, alice).length, 0);
  const summary = await invoke(createAgentTools(s), "agent_job_status", { jobId: third.id });
  assert.equal(summary.job.textTruncated, true); assert.ok(summary.job.reportedText.length <= 6000);
  assert.doesNotMatch(JSON.stringify(summary), /sensitive-token|private-value/);
  assert.match(summary.job.interpretation, /not independent verification/); assert.equal(summary.job.input, undefined); assert.equal(summary.job.memoryRefs, undefined);
});
