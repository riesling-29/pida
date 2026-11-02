import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { validContextDescriptor, validHandoff, type LoadedRunContext } from "./run-context.js";
import type { SessionSummary, TraceEvent } from "./protocol.js";

export interface SavedSession extends SessionSummary {
  version: 1;
  owner: string;
  piFile: string;
  hasTranscript?: boolean;
  nextSequence: number;
  traces: TraceEvent[];
  activeRunId?: string;
  activeTaskId?: string;
  lastRunId?: string;
  contextDescriptor?: LoadedRunContext;
}

/** Application metadata only. Conversation serialization belongs to Pi. Single process. */
export class SessionStore {
  readonly directory: string;
  readonly piDirectory: string;
  private readonly indexDirectory: string;
  private readonly lock: string;
  private readonly lockValue = JSON.stringify({
    pid: process.pid,
    host: hostname(),
    nonce: randomUUID(),
  });
  private readonly records = new Map<string, SavedSession>();
  constructor(directory: string) {
    this.directory = resolve(directory);
    this.piDirectory = join(this.directory, "sessions");
    this.indexDirectory = join(this.directory, "index");
    this.lock = join(this.directory, "runtime.lock");
    for (const dir of [this.directory, this.piDirectory, this.indexDirectory])
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(this.lock, this.lockValue, { flag: "wx", mode: 0o600 });
    } catch {
      throw new Error(
        "Workspace is locked. Stop its other server; after a crash, use pida unlock.",
      );
    }
    try {
      for (const file of readdirSync(this.indexDirectory).filter((f) =>
        f.endsWith(".json"),
      )) {
        const saved = JSON.parse(
          readFileSync(join(this.indexDirectory, file), "utf8"),
        ) as SavedSession;
        if (Number.isInteger(saved.version) && saved.version > 1) throw new Error("SESSION_SCHEMA_UNSUPPORTED");
        if (saved.contextDescriptor && Number.isInteger(saved.contextDescriptor.schemaVersion) && saved.contextDescriptor.schemaVersion > 1) throw new Error("SESSION_SCHEMA_UNSUPPORTED");
        if (
          saved.version !== 1 ||
          !/^[a-f0-9-]{36}$/.test(saved.sessionId) ||
          file !== `${saved.sessionId}.json` ||
          typeof saved.owner !== "string" ||
          !saved.owner ||
          typeof saved.piFile !== "string" ||
          saved.piFile !== basename(saved.piFile) ||
          !saved.piFile.endsWith(".jsonl") ||
          !Number.isSafeInteger(saved.runs) ||
          saved.runs < 0 ||
          !Array.isArray(saved.traces) ||
          !Number.isSafeInteger(saved.nextSequence) ||
          saved.nextSequence < 1 ||
          typeof saved.title !== "string" ||
          typeof saved.createdAt !== "string" ||
          typeof saved.updatedAt !== "string"
          || (saved.activeRunId !== undefined && !/^[a-f0-9-]{36}$/.test(saved.activeRunId))
          || (saved.lastRunId !== undefined && !/^[a-f0-9-]{36}$/.test(saved.lastRunId))
          || (saved.contextDescriptor !== undefined && !validContextDescriptor(saved.contextDescriptor, true))
          || (saved.handoff !== undefined && !validHandoff(saved.handoff))
          || (saved.activeTaskId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(saved.activeTaskId))
        ) {
          throw new Error("Invalid saved session metadata");
        }
        if (saved.running) {
          saved.running = false;
          saved.lastStatus = "interrupted";
        }
        this.records.set(saved.sessionId, saved);
      }
    } catch (error) {
      this.close();
      if (error instanceof Error && error.message === "SESSION_SCHEMA_UNSUPPORTED") throw new Error("SESSION_SCHEMA_UNSUPPORTED: A newer Pida version is required. Original metadata and transcripts were preserved.");
      throw new Error("SESSION_METADATA_INVALID: Invalid saved session metadata. Preserve index and transcripts; repair from a trusted backup before restarting.");
    }
  }
  list(): SavedSession[] {
    return [...this.records.values()].map((s) => structuredClone(s));
  }
  get(id: string): SavedSession | undefined {
    const s = this.records.get(id);
    return s && structuredClone(s);
  }
  save(record: SavedSession): void {
    const path = join(this.indexDirectory, `${record.sessionId}.json`);
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(record), { flag: "wx", mode: 0o600 });
      renameSync(temp, path);
      this.records.set(record.sessionId, structuredClone(record));
    } finally {
      rmSync(temp, { force: true });
    }
  }
  remove(id: string): void {
    const saved = this.records.get(id);
    if (!saved) return;
    // Remove discovery metadata first: an interrupted delete cannot resurrect the session.
    rmSync(join(this.indexDirectory, `${id}.json`), { force: true });
    this.records.delete(id);
    rmSync(join(this.piDirectory, saved.piFile), { force: true });
  }
  close(): void {
    if (
      existsSync(this.lock) &&
      readFileSync(this.lock, "utf8") === this.lockValue
    )
      rmSync(this.lock);
  }
}

/** Explicit crash recovery on the same machine, never while the recorded process is live. */
export function unlockStore(directory: string): void {
  const path = join(resolve(directory), "runtime.lock");
  if (!existsSync(path)) return;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    value.host !== hostname() ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0
  )
    throw new Error("Cannot verify lock owner; inspect runtime.lock manually.");
  try {
    process.kill(value.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      rmSync(path);
      return;
    }
    throw new Error("Cannot verify lock owner.");
  }
  throw new Error("Workspace process is still running.");
}
