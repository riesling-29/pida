import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentMemoryStore, memoryTools, agentMemoryPermissions } from "../dist/agent-memory.js";
import { PidaRuntime } from "../dist/runtime.js";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";

const info = (extra = {}) => ({ goal: "Understand equipment events", understanding: "The source is a sample", uncertainties: ["Live source mapping unknown"], nextAction: "Compare event definitions", relationships: [{ subject: "equipment:1", predicate: "belongs-to", object: "process:A" }], ...extra });
const sourceRefs = ["message:owner-1"];
async function fixture(t) { const directory = await mkdtemp(join(tmpdir(), "pida-memory-")); t.after(() => rm(directory, { recursive: true, force: true })); return { directory, store: new AgentMemoryStore(directory, "agent-a") }; }
const memoryFile = directory => join(directory, readdirSync(directory)[0], "memory.json");

test("all three memory tiers survive reload; persona versions and sourced corrections remain auditable", async t => {
  const { directory, store } = await fixture(t);
  const p1 = store.revisePersona({ expectedRevision: null, text: "Focus on process evidence", sourceRefs });
  const p2 = store.revisePersona({ expectedRevision: p1.revision, text: "Explain uncertainty explicitly", sourceRefs: ["owner:persona-revision"] });
  const fact = store.remember({ kind: "fact", text: "8 units are running", sourceRefs: ["artifact:table-v1"] });
  const corrected = store.remember({ kind: "correction", text: "4 running, 2 standby, 2 inspection", supersedes: [fact.id], sourceRefs: ["artifact:table-v2", "run:checked-2"] });
  const state = store.transition({ expectedHead: null, parentIds: [], information: info(), sourceRefs });
  const view = new AgentMemoryStore(directory, "agent-a").view();
  assert.deepEqual(view, store.view()); assert.equal(view.persona.revision, p2.revision);
  assert.equal(view.personaHistory[0].text, p1.text); assert.equal(view.head, state.id);
  assert.deepEqual(view.states[0].information, info()); assert.deepEqual(view.states[0].sourceRefs, sourceRefs);
  assert.equal(view.experiences[0].status, "superseded"); assert.equal(view.experiences[0].supersededBy, corrected.id);
  store.retractExperience({ id: corrected.id, expectedRevision: 1, reason: "Source revision needs checking", sourceRefs: ["owner:retraction-1"] });
  const reloaded = new AgentMemoryStore(directory, "agent-a").view();
  assert.equal(reloaded.experiences[1].status, "retracted"); assert.equal(reloaded.experiences[1].retraction.reason, "Source revision needs checking");
  assert.equal(reloaded.experiences[0].status, "superseded", "retraction must not silently revive an older claim");
  assert.equal(reloaded.head, state.id, "experience retraction does not invent an information-state transition");
});

test("independent store instances reject stale persona and head writes without erasing information", async t => {
  const { directory, store } = await fixture(t), other = new AgentMemoryStore(directory, "agent-a");
  store.revisePersona({ expectedRevision: null, text: "Owner preference", sourceRefs });
  assert.throws(() => other.revisePersona({ expectedRevision: null, text: "stale", sourceRefs }), /PERSONA_REVISION_CONFLICT/);
  const first = store.transition({ expectedHead: null, parentIds: [], information: info(), sourceRefs });
  const second = other.transition({ expectedHead: first.id, parentIds: [first.id], information: info({ understanding: "Mapped actual samples" }), sourceRefs: ["artifact:mapping"] });
  assert.throws(() => store.transition({ expectedHead: first.id, parentIds: [first.id], information: info({ understanding: "stale view" }), sourceRefs }), /MEMORY_HEAD_CONFLICT/);
  assert.equal(store.view().head, second.id); assert.equal(store.view().states.length, 2);
  const before = readFileSync(memoryFile(directory), "utf8");
  assert.throws(() => store.transition({ expectedHead: second.id, parentIds: [], information: info(), sourceRefs }), /MEMORY_HEAD_PARENT_REQUIRED/);
  assert.equal(readFileSync(memoryFile(directory), "utf8"), before);
});

test("explicit branches preserve active head; merges account for differences and carry unresolved knowledge", async t => {
  const { store } = await fixture(t);
  const a = store.transition({ expectedHead: null, parentIds: [], information: info(), sourceRefs });
  const b = store.transition({ expectedHead: a.id, parentIds: [a.id], information: info({ understanding: "Hypothesis B" }), sourceRefs: ["run:B"] });
  const c = store.transition({ expectedHead: b.id, parentIds: [a.id], branch: true, information: info({ understanding: "Hypothesis C" }), sourceRefs: ["run:C"] });
  assert.equal(store.view().head, b.id); assert.deepEqual(c.parentIds, [a.id]);
  const merge = { expectedHead: b.id, parentIds: [b.id, c.id], information: info({ understanding: "Two competing explanations" }), sourceRefs: ["owner:merge"] };
  assert.throws(() => store.transition(merge), /MEMORY_MERGE_CONFLICTS_REQUIRED/);
  assert.throws(() => store.transition({ ...merge, conflicts: { resolved: [], unresolved: [] } }), /MEMORY_CONFLICT_DISPOSITION_REQUIRED/);
  const d = store.transition({ ...merge, conflicts: { resolved: [], unresolved: [{ field: "understanding", description: "B and C disagree; collect actual source evidence" }] } });
  assert.equal(store.view().head, d.id); assert.deepEqual(d.parentIds, [b.id, c.id]);
  assert.equal(store.view().states.find(s => s.id === b.id).information.understanding, "Hypothesis B");
  const e = store.transition({ expectedHead: d.id, parentIds: [d.id], information: info({ nextAction: "Collect source evidence" }), sourceRefs });
  assert.deepEqual(e.conflicts.unresolved, d.conflicts.unresolved, "ordinary continuation retains unresolved conflict");
  const f = store.transition({ expectedHead: e.id, parentIds: [e.id], information: info({ understanding: "Actual source supports B" }), sourceRefs: ["artifact:source-read"], conflicts: { resolved: [{ field: "understanding", resolution: "Compared both hypotheses with source revision 3" }], unresolved: [] } });
  assert.equal(f.conflicts.resolved[0].field, "understanding"); assert.equal(f.conflicts.unresolved.length, 0);
});

test("agent and owner storage namespaces do not leak; returned objects cannot mutate durable memory", async t => {
  const { directory, store } = await fixture(t);
  store.remember({ kind: "decision", text: "Private agent A decision", sourceRefs });
  const anotherAgent = new AgentMemoryStore(directory, "agent-b"); assert.equal(anotherAgent.view().experiences.length, 0);
  const anotherOwner = new AgentMemoryStore(join(directory, "owner-b"), "agent-a"); assert.equal(anotherOwner.view().experiences.length, 0);
  const copy = store.view(); copy.experiences[0].text = "tampered";
  assert.equal(store.view().experiences[0].text, "Private agent A decision");
});

test("provenance, capacity, corrupt records and unsafe memory paths fail explicitly", async t => {
  const { directory, store } = await fixture(t);
  for (const refs of [[], ["raw pasted conversation"], ["https://u:password@example.com/doc"], ["https://example.com/?api_key=secret"], ["secret:token"]]) {
    assert.throws(() => store.remember({ kind: "fact", text: "Claim", sourceRefs: refs }), /INVALID_MEMORY/);
  }
  assert.throws(() => store.remember({ kind: "correction", text: "Changed claim", sourceRefs }), /MEMORY_CORRECTION_TARGET_REQUIRED/);
  assert.throws(() => store.remember({ kind: "fact", text: "x".repeat(16385), sourceRefs }), /INVALID_MEMORY_INPUT/);
  for (let i = 0; i < 256; i++) store.revisePersona({ expectedRevision: i || null, text: `Revision ${i + 1}`, sourceRefs });
  assert.throws(() => store.revisePersona({ expectedRevision: 256, text: "over capacity", sourceRefs }), /MEMORY_CAPACITY_EXCEEDED/);
  assert.equal(store.view().persona.revision, 256);
  const file = memoryFile(directory); writeFileSync(file, "not-json");
  assert.throws(() => new AgentMemoryStore(directory, "agent-a"), /MEMORY_CORRUPT/);
  if (process.platform === "win32") return; // Windows file symlinks require an optional host privilege.
  const clean = new AgentMemoryStore(directory, "agent-c"); clean.revisePersona({ expectedRevision: null, text: "safe", sourceRefs });
  const cdir = readdirSync(directory).map(name => join(directory, name)).find(dir => { try { return JSON.parse(readFileSync(join(dir, "memory.json"), "utf8")).agentId === "agent-c"; } catch { return false; } });
  await rm(join(cdir, "memory.json")); symlinkSync(file, join(cdir, "memory.json"));
  assert.throws(() => clean.view(), /UNSAFE_MEMORY_PATH/);
});

test("context is bounded reference data; tools cannot edit persona or choose another agent", async t => {
  const { store } = await fixture(t);
  store.revisePersona({ expectedRevision: null, text: "Owner philosophy ".repeat(500), sourceRefs });
  const state = store.transition({ expectedHead: null, parentIds: [], information: info({ understanding: "Long observations ".repeat(500) }), sourceRefs });
  const context = store.context(700); assert.ok(context.length <= 700); assert.match(context, /untrusted reference data/); assert.match(context, new RegExp(state.id));
  const tools = memoryTools(store), principal = { id: "owner", permissions: [...agentMemoryPermissions] };
  assert.ok(tools.every(t => !/persona/.test(t.name)));
  const remember = tools.find(t => t.name === "agent_memory_remember"), recall = tools.find(t => t.name === "agent_memory_recall");
  const ctx = { principal, signal: new AbortController().signal, sessionId: "s", runId: "r" };
  const experience = await remember.execute({ kind: "fact", text: "Reported observation", sourceRefs: ["run:r"] }, ctx);
  assert.equal(experience.authority, "agent-report");
  const ownerFact = store.remember({ kind: "fact", text: "Owner supplied requirement", sourceRefs });
  await assert.rejects(remember.execute({ kind: "correction", text: "Agent silently overrides requirement", sourceRefs: ["run:r"], supersedes: [ownerFact.id] }, ctx), /MEMORY_OWNER_CORRECTION_REQUIRED/);
  const recalled = await recall.execute({ query: "reported" }, ctx); assert.equal(recalled.experiences.length, 1);
  assert.equal(recalled.authority, "reference-data");
  await assert.rejects(remember.execute({ kind: "fact", text: "bad", sourceRefs }, { ...ctx, principal: { id: "owner", permissions: [] } }), /FORBIDDEN/);
});

test("large valid memory writes and selective recall complete through the real Pi loop without uncertain effect receipts (mock model)", async t => {
  const { directory, store } = await fixture(t);
  const principal = { id: "owner", permissions: [...agentMemoryPermissions] };
  const largeInformation = info({ goal: "g".repeat(16300), understanding: "u".repeat(16300), nextAction: "n".repeat(500) });
  const longRefs = Array.from({ length: 32 }, (_, i) => `message:${i}:`.padEnd(512, "x"));
  const savedText = "e".repeat(16384), outputs = [];
  const receive = (context, response) => {
    const message = context.messages.at(-1);
    assert.equal(message.role, "toolResult");
    assert.notEqual(message.isError, true);
    const text = message.content.filter(block => block.type === "text").map(block => block.text).join("");
    assert.ok(text.length <= 32000, `Tool transport exceeded the memory budget: ${text.length}`);
    outputs.push(JSON.parse(text)); return response;
  };
  const tools = memoryTools(store);
  const runtime = new PidaRuntime({ storageDir: join(directory, "runtime"), tools, maxTurns: 8, maxTotalTokens: 200000, maxRunMs: 10000,
    provider: () => {
      const provider = fauxProvider({ tokensPerSecond: 1000000 });
      provider.setResponses([
        answer(call("agent_memory_transition", { expectedHead: null, parentIds: [], information: largeInformation, sourceRefs }), { stopReason: "toolUse" }),
        context => receive(context, answer(call("agent_memory_remember", { kind: "fact", text: savedText, sourceRefs: longRefs }), { stopReason: "toolUse" })),
        context => receive(context, answer(call("agent_memory_recall", {}), { stopReason: "toolUse" })),
        context => receive(context, answer(call("agent_memory_recall", { fields: ["state"], stateFields: ["understanding"] }), { stopReason: "toolUse" })),
        context => receive(context, answer("Saved information and read the requested field.")),
        answer("Continued without effect reconciliation."),
      ]);
      return { provider: provider.provider, modelId: provider.getModel().id };
    },
  });
  t.after(() => runtime.close());
  const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "Persist the supplied information and recall it.");
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.recovery, undefined);
  assert.deepEqual(runtime.getRecovery(sessionId, principal).pendingEffects, []);
  assert.equal(outputs.length, 4);
  for (const receipt of outputs.slice(0, 2)) { assert.equal(receipt.persisted, true); assert.ok(JSON.stringify(receipt).length < 2048); }
  assert.equal(outputs[0].head, outputs[0].id);
  assert.equal(outputs[1].authority, "agent-report");
  const recalled = outputs[2];
  assert.equal(recalled.truncated, true);
  assert.ok(recalled.omittedFields.includes("state"));
  assert.ok(recalled.omittedFields.includes("experiences"));
  assert.equal(recalled.state.information, undefined);
  assert.equal(recalled.experiences[0].text, undefined);
  assert.match(recalled.guidance, /stateFields/);
  assert.match(recalled.guidance, /HTTP API/);
  assert.equal(outputs[3].truncated, false);
  assert.deepEqual(outputs[3].state.information, { understanding: largeInformation.understanding });
  assert.equal(outputs[3].experiences, undefined);
  const durable = new AgentMemoryStore(directory, "agent-a").view();
  assert.deepEqual(durable.states[0].information, largeInformation);
  assert.equal(durable.experiences[0].text, savedText);
  assert.deepEqual(durable.experiences[0].sourceRefs, longRefs);
  assert.ok(JSON.stringify(durable.states[0]).length > 32768);
  assert.ok(JSON.stringify(durable.experiences[0]).length > 32768);
  assert.equal((await runtime.run(sessionId, principal, "Continue the next request.")).status, "completed");
  assert.deepEqual(runtime.getRecovery(sessionId, principal).pendingEffects, []);

  store.remember({ kind: "decision", text: "Pagination marker", sourceRefs });
  const recall = tools.find(tool => tool.name === "agent_memory_recall");
  const context = { principal, signal: new AbortController().signal, sessionId, runId: result.runId };
  const first = await recall.execute({ fields: ["experiences"], limit: 1 }, context);
  assert.equal(first.experiences[0].text, "Pagination marker");
  assert.equal(first.pagination.nextExperienceOffset, 1);
  const second = await recall.execute({ fields: ["experiences"], limit: 1, offset: 1 }, context);
  assert.equal(second.experiences[0].id, outputs[1].id);
  assert.equal(second.truncated, true);
  assert.equal(second.pagination.nextExperienceOffset, null);
});
