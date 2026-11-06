import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { canonical, savePrivate, isId } from "./private-state.js";

export type EffectState = "started" | "applied" | "not_applied" | "unknown";
export interface EffectReceipt {
  id: string; runId: string; toolCallId: string; toolName: string;
  operationKey: string; state: EffectState; occurredAt: string; updatedAt: string;
}
/** Safety ledger, independent of best-effort observation export. Never stores arguments/results. */
export class EffectLedger {
  private readonly secret: string;
  private readonly sessions = new Map<string, EffectReceipt[]>();
  constructor(private readonly directory?: string) {
    const path = directory && join(directory, "effect-key.json");
    if (path && existsSync(path)) {
      let value: { key?: unknown };
      try { value = JSON.parse(readFileSync(path, "utf8")); if (!value || typeof value !== "object") throw new Error(); }
      catch { throw new Error("EFFECT_LEDGER_INVALID"); }
      if (typeof value.key !== "string" || !/^[a-f0-9]{64}$/.test(value.key)) throw new Error("EFFECT_LEDGER_INVALID");
      this.secret = value.key;
    } else {
      this.secret = randomBytes(32).toString("hex");
      if (path) savePrivate(path, { key: this.secret });
    }
  }
  private path(sessionId: string) {
    if (!isId(sessionId)) throw new Error("EFFECT_LEDGER_INVALID");
    return this.directory && join(this.directory, "effects", sessionId + ".json");
  }
  list(sessionId: string): EffectReceipt[] {
    let records = this.sessions.get(sessionId);
    if (!records) {
      const path = this.path(sessionId);
      records = [];
      if (path && existsSync(path)) {
        if (statSync(path).size > 4_194_304) throw new Error("EFFECT_LEDGER_INVALID");
        const data = JSON.parse(readFileSync(path, "utf8"));
        if (!Array.isArray(data) || data.length > 10000 || data.some(r => !isId(r.id) || !isId(r.runId) || typeof r.toolCallId !== "string" || typeof r.toolName !== "string" || !/^[a-f0-9]{64}$/.test(r.operationKey) || !["started", "applied", "not_applied", "unknown"].includes(r.state))) throw new Error("EFFECT_LEDGER_INVALID");
        records = data;
      }
      this.sessions.set(sessionId, records!);
    }
    return structuredClone(records!);
  }
  pending(sessionId: string) { return this.list(sessionId).filter(r => r.state === "started" || r.state === "unknown"); }
  private save(sessionId: string, records: EffectReceipt[]) {
    const path = this.path(sessionId);
    if (path) savePrivate(path, records);
    this.sessions.set(sessionId, structuredClone(records));
  }
  begin(sessionId: string, runId: string, toolCallId: string, toolName: string, args: unknown, idempotent: boolean): EffectReceipt {
    const records = this.list(sessionId);
    if (records.some(r => r.state === "started" || r.state === "unknown")) throw new Error("EFFECT_STATE_UNKNOWN");
    const operationKey = createHmac("sha256", this.secret).update(canonical({ sessionId, runId, toolName, args })).digest("hex");
    if (!idempotent && records.some(r => r.operationKey === operationKey && r.state === "applied")) throw new Error("TOOL_REPLAY_BLOCKED");
    if (records.length >= 10000) throw new Error("EFFECT_LEDGER_LIMIT");
    const now = new Date().toISOString();
    const receipt: EffectReceipt = { id: randomUUID(), runId, toolCallId, toolName, operationKey, state: "started", occurredAt: now, updatedAt: now };
    this.save(sessionId, [...records, receipt]);
    return receipt;
  }
  settle(sessionId: string, id: string, state: Exclude<EffectState, "started">): void {
    const records = this.list(sessionId), receipt = records.find(r => r.id === id);
    if (!receipt) throw new Error("EFFECT_NOT_FOUND");
    receipt.state = state; receipt.updatedAt = new Date().toISOString();
    this.save(sessionId, records);
  }
  remove(sessionId: string) { const path = this.path(sessionId); if (path) rmSync(path, { force: true }); this.sessions.delete(sessionId); }
}
