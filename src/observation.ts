import { closeSync, fsyncSync, openSync, writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { canonical, sha256, savePrivate, isId } from "./private-state.js";
import { observationSchema, type Observation, type ObservationBundle, type ResultManifest } from "./execution-contract.js";
import { Value } from "typebox/value";
import { observationJsonSchema, manifestJsonSchema } from "./integration-contract.js";
import { exportOcel } from "./ocel.js";
import { setTimeout as delay } from "node:timers/promises";

export interface ObservationContext { sessionId: string; taskId: string; runId: string }
export interface ObservationSink { write(event: Observation): void | Promise<void> }
const lossReasons = ["OBSERVATION_ARCHIVE_CORRUPT", "OBSERVATION_ARCHIVE_LIMIT", "OBSERVATION_ARCHIVE_IO", "OBSERVATION_MANIFEST_FAILED"] as const;
type LossReason = typeof lossReasons[number];
interface Journal { sequence: number; events: Observation[]; reasons: Set<LossReason>; bytes: number; found: boolean; manifest?: ResultManifest; ocelFailed?: boolean }
/** Bounded, metadata-only producer journal. Sink failures never use the SSE cancellation path. */
export class ObservationArchive {
  readonly sourceId: string;
  readonly agentId: string;
  private readonly journals = new Map<string, Journal>();
  private unavailable?: LossReason;
  private sinkFailures = 0;
  private sinkPending = 0;
  private fingerprintKey = randomBytes(32).toString("hex");
  constructor(private readonly directory?: string, agentId?: string, private readonly sink?: ObservationSink, private readonly limit = 4000) {
    let identity = { sourceId: randomUUID() as string, agentId: randomUUID() as string };
    try {
      if (directory) {
        const path = join(directory, "observations", "identity.json");
        if (existsSync(path)) {
          const saved = JSON.parse(readFileSync(path, "utf8"));
          if (!isId(saved.sourceId) || !isId(saved.agentId)) throw new Error("invalid identity");
          identity = { sourceId: saved.sourceId, agentId: saved.agentId };
          if (typeof saved.fingerprintKey === "string" && /^[a-f0-9]{64}$/.test(saved.fingerprintKey)) this.fingerprintKey = saved.fingerprintKey;
          else savePrivate(path, { ...identity, fingerprintKey: this.fingerprintKey });
        } else savePrivate(path, { ...identity, fingerprintKey: this.fingerprintKey });
      }
    } catch (error) { this.unavailable = (error as NodeJS.ErrnoException).code ? "OBSERVATION_ARCHIVE_IO" : "OBSERVATION_ARCHIVE_CORRUPT"; }
    this.sourceId = identity.sourceId; this.agentId = agentId ?? identity.agentId;
  }
  /** Source-scoped keyed comparison: never export the input or the local key. */
  fingerprint(value: unknown): string { return createHmac("sha256", this.fingerprintKey).update(canonical(value)).digest("hex"); }
  private root(sessionId: string) {
    if (!isId(sessionId)) throw new Error("INVALID_ID");
    return this.directory && join(this.directory, "observations", sessionId);
  }
  private markLoss(context: ObservationContext, journal: Journal, reason: LossReason): void {
    if (journal.reasons.has(reason)) return;
    journal.reasons.add(reason);
    const root = this.root(context.sessionId);
    if (root) {
      try { savePrivate(join(root, context.runId + ".health.json"), { version: 1, reasons: [...journal.reasons], ...(journal.ocelFailed ? { ocelFailed: true } : {}) }); }
      catch { journal.reasons.add("OBSERVATION_ARCHIVE_IO"); }
    }
  }
  private journal(context: ObservationContext): Journal {
    if (!isId(context.runId)) throw new Error("INVALID_ID");
    const key = context.sessionId + "/" + context.runId;
    let journal = this.journals.get(key);
    if (!journal) {
      journal = { sequence: 0, events: [], reasons: new Set(this.unavailable ? [this.unavailable] : []), bytes: 0, found: false };
      const root = this.root(context.sessionId), path = root && join(root, context.runId + ".jsonl");
      const health = root && join(root, context.runId + ".health.json");
      if (health) try {
        const size = statSync(health).size; journal.found = true;
        if (size > 4096) throw new Error("invalid archive health");
        const saved = JSON.parse(readFileSync(health, "utf8"));
        if (saved.version !== 1 || !Array.isArray(saved.reasons) || !saved.reasons.every((r: unknown) => lossReasons.includes(r as LossReason))
          || (saved.ocelFailed !== undefined && typeof saved.ocelFailed !== "boolean")) throw new Error("invalid archive health");
        for (const reason of saved.reasons) journal.reasons.add(reason);
        journal.ocelFailed = saved.ocelFailed === true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") journal.reasons.add((error as NodeJS.ErrnoException).code ? "OBSERVATION_ARCHIVE_IO" : "OBSERVATION_ARCHIVE_CORRUPT");
      }
      try {
        if (path) {
          const size = statSync(path).size; journal.found = true;
          if (size > 16_777_216) throw new Error("archive limit");
          for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
            const event = JSON.parse(line) as Observation;
            if (!Value.Check(observationJsonSchema, event) || event.session_id !== context.sessionId || event.run_id !== context.runId || event.sequence_number !== journal.sequence + 1 || event.payload_digest !== sha256(canonical(event.payload))) throw new Error("invalid event");
            if (journal.events.length >= this.limit) throw new Error("archive limit");
            journal.sequence = event.sequence_number; journal.events.push(event);
            journal.bytes += Buffer.byteLength(line) + 1;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") journal.reasons.add(error instanceof Error && error.message === "archive limit" ? "OBSERVATION_ARCHIVE_LIMIT" : (error as NodeJS.ErrnoException).code ? "OBSERVATION_ARCHIVE_IO" : "OBSERVATION_ARCHIVE_CORRUPT");
      }
      const manifest = root && join(root, context.runId + ".manifest.json");
      if (manifest) try {
          const size = statSync(manifest).size; journal.found = true;
          if (size > 4_194_304) throw new Error("manifest too large");
          const saved = JSON.parse(readFileSync(manifest, "utf8"));
          if (!Value.Check(manifestJsonSchema, saved) || saved.run_id !== context.runId || saved.session_id !== context.sessionId) throw new Error("invalid manifest");
          journal.manifest = saved as unknown as ResultManifest;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || journal.events.at(-1)?.activity === "run_finished") journal.reasons.add("OBSERVATION_MANIFEST_FAILED");
      }
      this.journals.set(key, journal);
    }
    return journal;
  }
  record(context: ObservationContext, activity: string, payload: Observation["payload"] = {}, refs: { artifacts?: string[]; evidence?: string[] } = {}): boolean {
    const journal = this.journal(context);
    journal.found = true;
    const event: Observation = {
      schema_version: observationSchema, source_id: this.sourceId, source_event_id: randomUUID(), agent_id: this.agentId,
      session_id: context.sessionId, task_id: context.taskId, run_id: context.runId,
      activity, occurred_at: new Date().toISOString(), sequence_number: ++journal.sequence,
      capture_mode: "native-runtime", payload_digest: sha256(canonical(payload)),
      object_refs: [this.agentId, context.sessionId, context.taskId, context.runId, ...(payload.turn_id ? [payload.turn_id] : [])], artifact_refs: refs.artifacts ?? [], evidence_refs: refs.evidence ?? [],
      data_scope: "metadata-only", payload: structuredClone(payload),
    };
    const line = JSON.stringify(event) + "\n";
    if (journal.events.length >= this.limit || journal.bytes + Buffer.byteLength(line) > 16_777_216) { this.markLoss(context, journal, "OBSERVATION_ARCHIVE_LIMIT"); return false; }
    journal.bytes += Buffer.byteLength(line);
    journal.events.push(event);
    try {
      const root = this.root(context.sessionId);
      if (root) {
        if (this.unavailable) throw new Error("archive unavailable");
        // Preserve damaged evidence; continue publishing to an independent sink.
        if (!journal.reasons.has("OBSERVATION_ARCHIVE_CORRUPT")) {
          mkdirSync(root, { recursive: true, mode: 0o700 });
          const fd = openSync(join(root, context.runId + ".jsonl"), "a", 0o600);
          try { writeFileSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
        }
      }
    } catch { this.markLoss(context, journal, "OBSERVATION_ARCHIVE_IO"); }
    if (activity === "turn_finished" || activity === "operation_finished") this.checkpoint(context);
    if (this.sink) {
      if (this.sinkPending >= 64) { this.sinkFailures++; return journal.reasons.size === 0; }
      this.sinkPending++;
      Promise.resolve().then(() => this.sink!.write(structuredClone(event))).catch(() => { this.sinkFailures++; }).finally(() => { this.sinkPending--; });
    }
    return journal.reasons.size === 0;
  }
  async finish(context: ObservationContext, manifest: ResultManifest): Promise<void> {
    const journal = this.journal(context); journal.manifest = structuredClone(manifest); journal.found = true;
    try { const root = this.root(context.sessionId); if (root) {
      if (journal.reasons.size) savePrivate(join(root, context.runId + ".health.json"), { version: 1, reasons: [...journal.reasons] });
      savePrivate(join(root, context.runId + ".manifest.json"), manifest);
      let outcome = this.checkpoint(context);
      // Concurrent readers can briefly deny replacement on Windows. Yield so their async close can finish;
      // never unlink the old checkpoint or retry validation/permanent failures. Exhaustion stays observable.
      for (const waitMs of [5, 10, 25, 50, 100]) {
        if (outcome !== "sharing") break;
        await delay(waitMs); outcome = this.checkpoint(context);
      }
      // Keep projection failure visible after reopen; the complete JSONL/manifest is a separate source claim.
      savePrivate(join(root, context.runId + ".health.json"), { version: 1, reasons: [...journal.reasons], ocelFailed: !!journal.ocelFailed });
      if (!journal.reasons.size && !journal.ocelFailed) this.journals.delete(context.sessionId + "/" + context.runId); } }
    catch { this.markLoss(context, journal, "OBSERVATION_MANIFEST_FAILED"); }
  }
  /** Atomic materialized OCEL cut at each actual Pi turn end; JSONL remains the crash-recovery journal. */
  private checkpoint(context: ObservationContext): "written" | "sharing" | "failed" {
    const root = this.root(context.sessionId); if (!root) return "written";
    const journal = this.journal(context);
    try {
      journal.ocelFailed = false;
      const { document, ...metadata } = exportOcel(this.bundle(context.sessionId, context.runId));
      savePrivate(join(root, context.runId + ".ocel.json"), document);
      savePrivate(join(root, context.runId + ".ocel.meta.json"), metadata);
      journal.ocelFailed = false;
      return "written";
    } catch (error) {
      journal.ocelFailed = true;
      return process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException)?.code ?? "") ? "sharing" : "failed";
    }
  }
  bundle(sessionId: string, runId: string): ObservationBundle {
    const j = this.journal({ sessionId, runId, taskId: "" });
    if (!j.found) { this.journals.delete(sessionId + "/" + runId); throw new Error("RUN_NOT_FOUND"); }
    const terminal = (j.events.at(-1)?.activity === "run_finished" && !!j.manifest) || j.events.at(-1)?.activity === "operation_finished";
    const limits = [...(j.reasons.size ? ["OBSERVATION_INCOMPLETE", ...j.reasons] : []), ...(j.ocelFailed ? ["OCEL_CHECKPOINT_UNAVAILABLE"] : []), ...(!terminal ? ["TERMINAL_EVENT_MISSING"] : []), ...(this.sinkFailures ? ["EXTERNAL_SINK_DELIVERY_FAILED"] : []), ...(this.sinkPending ? ["EXTERNAL_SINK_DELIVERY_PENDING"] : [])];
    return { schema_version: "pida.bundle/0.1-draft", session_id: sessionId, run_id: runId, complete: !j.reasons.size && terminal, known_limits: limits, events: structuredClone(j.events), ...(j.manifest ? { manifest: structuredClone(j.manifest) } : {}) };
  }
  list(sessionId: string): string[] {
    const ids = new Set([...this.journals.keys()].filter(k => k.startsWith(sessionId + "/")).map(k => k.split("/")[1]!));
    const root = this.root(sessionId);
    if (root && existsSync(root)) for (const file of readdirSync(root)) {
      const id = file.replace(/\.(jsonl|manifest\.json)$/, ""); if (isId(id)) ids.add(id);
    }
    return [...ids].sort();
  }
  remove(sessionId: string): void {
    const root = this.root(sessionId); if (root) rmSync(root, { recursive: true, force: true });
    for (const key of this.journals.keys()) if (key.startsWith(sessionId + "/")) this.journals.delete(key);
  }
}
