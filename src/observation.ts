import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, sha256, savePrivate, isId } from "./private-state.js";
import { observationSchema, type Observation, type ObservationBundle, type ResultManifest } from "./execution-contract.js";

export interface ObservationContext { sessionId: string; taskId: string; runId: string }
export interface ObservationSink { write(event: Observation): void | Promise<void> }
interface Journal { sequence: number; events: Observation[]; lost: boolean; bytes: number; manifest?: ResultManifest }
/** Bounded, metadata-only producer journal. Sink failures never use the SSE cancellation path. */
export class ObservationArchive {
  readonly sourceId: string;
  readonly agentId: string;
  private readonly journals = new Map<string, Journal>();
  private unavailable = false;
  private sinkFailures = 0;
  private sinkPending = 0;
  constructor(private readonly directory?: string, agentId?: string, private readonly sink?: ObservationSink, private readonly limit = 4000) {
    let identity = { sourceId: randomUUID() as string, agentId: randomUUID() as string };
    try {
      if (directory) {
        const path = join(directory, "observations", "identity.json");
        if (existsSync(path)) {
          const saved = JSON.parse(readFileSync(path, "utf8"));
          if (!isId(saved.sourceId) || !isId(saved.agentId)) throw new Error("invalid identity");
          identity = saved;
        } else savePrivate(path, identity);
      }
    } catch { this.unavailable = true; }
    this.sourceId = identity.sourceId; this.agentId = agentId ?? identity.agentId;
  }
  private root(sessionId: string) {
    if (!isId(sessionId)) throw new Error("INVALID_ID");
    return this.directory && join(this.directory, "observations", sessionId);
  }
  private journal(context: ObservationContext): Journal {
    if (!isId(context.runId)) throw new Error("INVALID_ID");
    const key = context.sessionId + "/" + context.runId;
    let journal = this.journals.get(key);
    if (!journal) {
      journal = { sequence: 0, events: [], lost: this.unavailable, bytes: 0 };
      const root = this.root(context.sessionId), path = root && join(root, context.runId + ".jsonl");
      try {
        if (path && existsSync(path)) {
          if (statSync(path).size > 16_777_216) throw new Error("archive too large");
          for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
            const event = JSON.parse(line) as Observation;
            if (event.schema_version !== observationSchema || event.session_id !== context.sessionId || event.run_id !== context.runId || event.sequence_number !== journal.sequence + 1 || event.payload_digest !== sha256(canonical(event.payload))) throw new Error("invalid event");
            if (journal.events.length >= this.limit) throw new Error("archive limit");
            journal.sequence = event.sequence_number; journal.events.push(event);
            journal.bytes += Buffer.byteLength(line) + 1;
          }
        }
        const manifest = root && join(root, context.runId + ".manifest.json");
        if (manifest && existsSync(manifest)) {
          if (statSync(manifest).size > 4_194_304) throw new Error("manifest too large");
          const saved = JSON.parse(readFileSync(manifest, "utf8"));
          if (saved.run_id !== context.runId || saved.session_id !== context.sessionId) throw new Error("invalid manifest");
          journal.manifest = saved;
        }
      } catch { journal.lost = true; }
      this.journals.set(key, journal);
    }
    return journal;
  }
  record(context: ObservationContext, activity: string, payload: Observation["payload"] = {}, refs: { artifacts?: string[]; evidence?: string[] } = {}): void {
    const journal = this.journal(context);
    const event: Observation = {
      schema_version: observationSchema, source_id: this.sourceId, source_event_id: randomUUID(), agent_id: this.agentId,
      session_id: context.sessionId, task_id: context.taskId, run_id: context.runId,
      activity, occurred_at: new Date().toISOString(), sequence_number: ++journal.sequence,
      capture_mode: "native-runtime", payload_digest: sha256(canonical(payload)),
      object_refs: [context.sessionId, context.runId], artifact_refs: refs.artifacts ?? [], evidence_refs: refs.evidence ?? [],
      data_scope: "metadata-only", payload: structuredClone(payload),
    };
    const line = JSON.stringify(event) + "\n";
    if (journal.events.length >= this.limit || journal.bytes + Buffer.byteLength(line) > 16_777_216) { journal.lost = true; return; }
    journal.bytes += Buffer.byteLength(line);
    journal.events.push(event);
    try {
      const root = this.root(context.sessionId);
      if (root) {
        if (this.unavailable) throw new Error("archive unavailable");
        mkdirSync(root, { recursive: true, mode: 0o700 });
        appendFileSync(join(root, context.runId + ".jsonl"), line, { mode: 0o600 });
      }
    } catch { journal.lost = true; }
    if (this.sink) {
      if (this.sinkPending >= 64) { this.sinkFailures++; return; }
      this.sinkPending++;
      Promise.resolve().then(() => this.sink!.write(structuredClone(event))).catch(() => { this.sinkFailures++; }).finally(() => { this.sinkPending--; });
    }
  }
  finish(context: ObservationContext, manifest: ResultManifest): void {
    const journal = this.journal(context); journal.manifest = structuredClone(manifest);
    try { const root = this.root(context.sessionId); if (root) { savePrivate(join(root, context.runId + ".manifest.json"), manifest); if (!journal.lost) this.journals.delete(context.sessionId + "/" + context.runId); } }
    catch { journal.lost = true; }
  }
  bundle(sessionId: string, runId: string): ObservationBundle {
    const j = this.journal({ sessionId, runId, taskId: "" });
    if (!j.events.length && !j.manifest) { this.journals.delete(sessionId + "/" + runId); throw new Error("RUN_NOT_FOUND"); }
    const terminal = (j.events.at(-1)?.activity === "run_finished" && !!j.manifest) || j.events.at(-1)?.activity === "operation_finished";
    const limits = [...(j.lost ? ["OBSERVATION_INCOMPLETE"] : []), ...(!terminal ? ["TERMINAL_EVENT_MISSING"] : []), ...(this.sinkFailures ? ["EXTERNAL_SINK_DELIVERY_FAILED"] : []), ...(this.sinkPending ? ["EXTERNAL_SINK_DELIVERY_PENDING"] : [])];
    return { schema_version: "pida.bundle/0.1-draft", session_id: sessionId, run_id: runId, complete: !j.lost && terminal, known_limits: limits, events: structuredClone(j.events), ...(j.manifest ? { manifest: structuredClone(j.manifest) } : {}) };
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
