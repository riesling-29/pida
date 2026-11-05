/** Shared presentation state over Pida's existing session/trace API. No execution or persistence. */
const finalStatuses = new Set(["completed", "failed", "cancelled", "limited", "interrupted"]);
const emptyInput = () => ({ steering: 0, followUp: 0, durable: false });
const validTrace = event => event && typeof event.runId === "string" && event.runId && Number.isSafeInteger(event.sequence) && event.sequence > 0;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export class RunState {
  constructor(sessionId) {
    this.generation = 0;
    this.revision = 0;
    this.reset(sessionId);
  }

  reset(sessionId) {
    this.generation++;
    this.revision++;
    this.sessionId = sessionId;
    this.runId = undefined;
    this.sequence = 0;
    this.running = false;
    this.status = undefined;
    this.cancelling = false;
    this.pendingInput = emptyInput();
    this.tools = new Map();
    this.gap = false;
    this.result = undefined;
    this.retired = new Set();
    this.terminal = false;
    return this;
  }

  /** A caller checks revision:true before applying a delayed HTTP snapshot. */
  ticket() {
    return { generation: this.generation, sessionId: this.sessionId, runId: this.runId, revision: this.revision };
  }

  current(ticket, { run = false, revision = false } = {}) {
    return !!ticket && ticket.generation === this.generation && ticket.sessionId === this.sessionId
      && (!run || ticket.runId === this.runId) && (!revision || ticket.revision === this.revision);
  }

  /** Start waiting for a new run. Session sequence numbers continue across runs. */
  begin() {
    this.generation++;
    this.retire();
    this.runId = undefined;
    this.running = true;
    this.status = undefined;
    this.cancelling = false;
    this.terminal = false;
    this.result = undefined;
    this.pendingInput = emptyInput();
    this.tools.clear();
    this.revision++;
    return this.ticket();
  }

  cancel() {
    if (this.running && !this.cancelling) {
      this.cancelling = true;
      this.revision++;
    }
  }

  retire() {
    if (this.runId) this.retired.add(this.runId);
    // Sequence rejection remains the long-term fence; bound the extra identity fence.
    if (this.retired.size > 256) this.retired.delete(this.retired.values().next().value);
  }

  adopt(runId) {
    if (this.runId === runId) return;
    this.retire();
    this.runId = runId;
    this.running = true;
    this.status = undefined;
    this.cancelling = false;
    this.terminal = false;
    this.result = undefined;
    this.pendingInput = emptyInput();
    this.tools.clear();
  }

  fold(event) {
    if (event.type === "tool_started") this.tools.set(event.toolCallId ?? event.toolName, event.toolName ?? "도구");
    if (event.type === "tool_completed" || event.type === "tool_failed") this.tools.delete(event.toolCallId ?? event.toolName);
    if (event.type === "run_finished") this.finish(event.status);
  }

  finish(status) {
    this.running = false;
    this.status = finalStatuses.has(status) ? status : undefined;
    this.cancelling = false;
    this.terminal = true;
    this.tools.clear();
    this.pendingInput = emptyInput();
  }

  acceptTrace(event) {
    if (!validTrace(event) || event.sessionId !== this.sessionId || event.sequence <= this.sequence || this.retired.has(event.runId)) return false;
    if (this.runId && this.runId !== event.runId && event.type !== "run_started") {
      this.gap = true;
      return false;
    }
    if (this.runId === event.runId && this.terminal) return false;
    if (event.sequence > this.sequence + 1) this.gap = true;
    this.adopt(event.runId);
    this.sequence = event.sequence;
    this.fold(event);
    this.revision++;
    return true;
  }

  /** Result text is authoritative only for this run, even when its terminal trace arrived first. */
  acceptResult(result) {
    if (!result || result.sessionId !== this.sessionId || !result.runId || this.retired.has(result.runId)
      || (this.runId && result.runId !== this.runId) || !finalStatuses.has(result.status) || this.result) return false;
    this.adopt(result.runId);
    this.result = result;
    this.finish(result.status);
    this.revision++;
    return true;
  }

  /**
   * Fold a fresh getSession/getTrace pair. Caller must fence delayed reads with its ticket.
   * Returns newly observed events for the selected run; complete trace rows still belong to the caller.
   * Missing history is explicit in gap; no unseen tool or start time is fabricated.
   */
  snapshot(data, events = []) {
    if (!data || (data.sessionId !== undefined && data.sessionId !== this.sessionId)) return [];
    const rows = events.filter(event => validTrace(event) && event.sessionId === this.sessionId).sort((a, b) => a.sequence - b.sequence);
    const latest = rows.at(-1);
    const runId = data.running && typeof data.activeRunId === "string" ? data.activeRunId : latest?.runId ?? this.runId;
    if (runId && this.retired.has(runId)) return [];
    // An older running snapshot cannot revive a run whose terminal outcome was already observed.
    if (runId === this.runId && this.terminal && data.running) return [];
    const watermark = this.sequence;
    if (runId) this.adopt(runId);
    const selected = rows.filter(event => event.runId === runId);
    const accepted = selected.filter((event, index) => event.sequence > watermark && (index === 0 || event.sequence !== selected[index - 1].sequence));
    if (latest) this.sequence = Math.max(this.sequence, latest.sequence);
    if (selected.length) {
      this.tools.clear();
      this.gap = selected[0].type !== "run_started" || selected.some((event, index) => index > 0 && event.sequence > selected[index - 1].sequence + 1);
      for (const event of selected) this.fold(event);
    }
    if (data.running && !this.terminal) {
      this.running = true;
      this.status = undefined;
      this.pendingInput = { steering: count(data.pendingInput?.steering), followUp: count(data.pendingInput?.followUp), durable: false };
    } else if (!data.running) this.finish(this.status ?? data.lastStatus);
    this.revision++;
    return accepted;
  }
}

const inputError = code => Object.assign(new Error(code), { code });

/** Send only to the captured live run; receipt acceptance does not claim model execution. */
export async function submitQueuedInput({ client, state, mode, text }) {
  if (mode !== "steer" && mode !== "followUp") throw inputError("INPUT_COMMAND_UNSUPPORTED");
  if (typeof text !== "string" || !text.trim() || text.length > 16000) throw inputError("INVALID_PROMPT");
  if (!state.sessionId || !state.runId || !state.running || state.cancelling) throw inputError("RUN_NOT_ACCEPTING_INPUT");
  const ticket = state.ticket();
  const receipt = await client[mode](ticket.sessionId, text.trim(), ticket.runId);
  if (!receipt || receipt.runId !== ticket.runId || receipt.mode !== mode || !["queued", "handled"].includes(receipt.disposition) || receipt.durable !== false)
    throw inputError("INPUT_RECEIPT_INVALID");
  return { receipt, current: state.current(ticket, { run: true }) && state.running && !state.cancelling };
}
