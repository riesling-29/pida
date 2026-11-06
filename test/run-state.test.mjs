import test from "node:test";
import assert from "node:assert/strict";
import { RunState, submitQueuedInput } from "../examples/web/run-state.js";

const trace = (sequence, type, runId = "run-1", extra = {}) => ({ sessionId: "session-1", runId, sequence, type, ...extra });
const result = (runId = "run-1", status = "completed") => ({ sessionId: "session-1", runId, status, text: "actual result" });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("trace projection rejects other sessions, duplicates and late prior runs without reviving completed tools", () => {
  const state = new RunState("session-1");
  assert.equal(state.acceptTrace(trace(1, "run_started")), true);
  assert.equal(state.acceptTrace(trace(2, "tool_started", "run-1", { toolCallId: "t1", toolName: "project_shell" })), true);
  assert.equal(state.tools.get("t1"), "project_shell");
  assert.equal(state.acceptTrace(trace(2, "tool_started")), false);
  assert.equal(state.acceptTrace(trace(3, "tool_completed", "run-1", { toolCallId: "t1" })), true);
  assert.equal(state.tools.size, 0);
  assert.equal(state.acceptTrace(trace(4, "run_finished", "run-1", { status: "failed" })), true);
  assert.equal(state.acceptResult(result("run-1", "failed")), true);
  assert.equal(state.acceptTrace(trace(5, "tool_started")), false);
  assert.equal(state.acceptTrace(trace(5, "run_started", "run-2")), true);
  assert.equal(state.acceptTrace(trace(6, "run_finished", "run-1", { status: "completed" })), false);
  assert.equal(state.acceptResult(result()), false);
  assert.equal(state.acceptTrace({ ...trace(6, "run_finished", "run-2"), sessionId: "other" }), false);
  assert.equal(state.runId, "run-2");
  assert.equal(state.running, true);
});

test("sequence gaps are visible and a fresh bounded snapshot repairs the live tool projection", () => {
  const state = new RunState("session-1");
  state.acceptTrace(trace(1, "run_started"));
  state.acceptTrace(trace(4, "turn_started"));
  assert.equal(state.gap, true);
  const rows = [trace(1, "run_started"), trace(2, "tool_started", "run-1", { toolCallId: "t", toolName: "read" }), trace(3, "tool_completed", "run-1", { toolCallId: "t" }), trace(4, "turn_started")];
  assert.deepEqual(state.snapshot({ sessionId: "session-1", running: true, activeRunId: "run-1", pendingInput: { steering: 1, followUp: 2 } }, rows), []);
  assert.equal(state.gap, false);
  assert.equal(state.tools.size, 0);
  assert.deepEqual(state.pendingInput, { steering: 1, followUp: 2, durable: false });
  state.snapshot({ running: true, activeRunId: "run-1" }, rows.slice(2));
  assert.equal(state.gap, true, "a bounded tail is not a complete execution history");
});

test("snapshot restores the latest run once and terminal status cannot be revived by an old running snapshot", () => {
  const state = new RunState("session-1");
  const rows = [trace(1, "run_started"), trace(2, "run_finished", "run-1", { status: "completed" }), trace(3, "run_started", "run-2"), trace(4, "tool_started", "run-2", { toolCallId: "x", toolName: "test" })];
  assert.deepEqual(state.snapshot({ running: true, activeRunId: "run-2" }, rows).map(row => row.sequence), [3, 4]);
  assert.deepEqual(state.snapshot({ running: true, activeRunId: "run-2" }, rows), []);
  assert.equal(state.tools.get("x"), "test");
  state.acceptTrace(trace(5, "run_finished", "run-2", { status: "cancelled" }));
  assert.deepEqual(state.snapshot({ running: true, activeRunId: "run-2" }, rows), []);
  assert.equal(state.status, "cancelled");
  assert.equal(state.running, false);
});

test("request tickets fence selection changes and delayed snapshots while begin retains session sequence", () => {
  const state = new RunState("session-1");
  state.acceptTrace(trace(1, "run_started"));
  const poll = state.ticket();
  state.acceptTrace(trace(2, "tool_started"));
  assert.equal(state.current(poll), true);
  assert.equal(state.current(poll, { revision: true }), false);
  state.begin();
  assert.equal(state.current(poll), false, "a previous local stream cannot publish into the next run");
  assert.equal(state.current(poll, { run: true }), false);
  assert.equal(state.sequence, 2);
  assert.equal(state.acceptTrace(trace(3, "run_finished")), false);
  assert.equal(state.acceptTrace(trace(3, "run_started", "run-2")), true);
  state.reset("session-2");
  assert.equal(state.current(poll), false);
  assert.equal(state.sequence, 0);
});

test("queued input keeps owner session/run correlation and reports acceptance without claiming execution", async () => {
  const state = new RunState("session-1"); state.acceptTrace(trace(1, "run_started"));
  const calls = [];
  const client = { followUp: async (...args) => { calls.push(args); return { runId: "run-1", mode: "followUp", disposition: "queued", durable: false }; } };
  const response = await submitQueuedInput({ client, state, mode: "followUp", text: "  Continue tests  " });
  assert.deepEqual(calls, [["session-1", "Continue tests", "run-1"]]);
  assert.equal(response.current, true);
  assert.equal(response.receipt.disposition, "queued");
  assert.equal(state.status, undefined);
  assert.equal(state.pendingInput.followUp, 0, "queue counters require a server observation");
});

test("a cancelled or replaced run cannot clear a newer draft when a queued input receipt arrives late", async () => {
  for (const transition of [state => state.cancel(), state => state.acceptResult(result()), state => { state.begin(); state.acceptTrace(trace(2, "run_started", "run-2")); }, state => state.reset("session-2")]) {
    const state = new RunState("session-1"); state.acceptTrace(trace(1, "run_started"));
    const pending = deferred();
    const response = submitQueuedInput({ client: { steer: () => pending.promise }, state, mode: "steer", text: "Keep existing tests" });
    transition(state);
    pending.resolve({ runId: "run-1", mode: "steer", disposition: "queued", durable: false });
    assert.equal((await response).current, false);
  }
});

test("input refusals and invalid receipts are propagated; cancellation never sends a new request", async () => {
  const state = new RunState("session-1"); state.acceptTrace(trace(1, "run_started"));
  const error = Object.assign(new Error("run ended"), { code: "RUN_NOT_ACCEPTING_INPUT" });
  await assert.rejects(submitQueuedInput({ client: { steer: async () => { throw error; } }, state, mode: "steer", text: "Keep draft" }), value => value === error);
  await assert.rejects(submitQueuedInput({ client: { steer: async () => ({ runId: "other", mode: "steer", disposition: "queued", durable: false }) }, state, mode: "steer", text: "Keep draft" }), { code: "INPUT_RECEIPT_INVALID" });
  state.cancel();
  await assert.rejects(submitQueuedInput({ client: { steer: () => assert.fail("must not send") }, state, mode: "steer", text: "Keep draft" }), { code: "RUN_NOT_ACCEPTING_INPUT" });
});
