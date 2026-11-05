import {
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { validContextDescriptor, validHandoff, type LoadedRunContext } from "./run-context.js";
import type { SessionSummary, TraceEvent } from "./protocol.js";
import { savePrivate } from "./private-state.js";

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
  readonly instanceId = randomUUID();
  readonly directory: string;
  readonly piDirectory: string;
  private readonly indexDirectory: string;
  private readonly lock: string;
  private readonly lockValue = JSON.stringify({
    pid: process.pid,
    host: hostname(),
    nonce: this.instanceId,
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new Error(`WORKSPACE_LOCK_IO: Cannot create runtime.lock (${(error as NodeJS.ErrnoException).code ?? "IO_ERROR"}). Check storage permissions and available space.`, { cause: error });
      const owner = inspectRuntimeLock(this.directory);
      if (owner.state === "live") throw new Error("WORKSPACE_ALREADY_RUNNING: Workspace is locked by a running process. Use pida open or pida tui to connect; stop the original server before restarting.");
      if (owner.state === "stale") throw new Error("WORKSPACE_STALE_LOCK: The previous local process has stopped. Run pida unlock for this workspace, then start again.");
      throw new Error("WORKSPACE_LOCK_UNVERIFIED: Cannot verify runtime.lock ownership. Inspect the lock and original host; it was preserved.");
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
    // Publish in memory only after the file has been flushed and atomically replaced.
    // Pi still owns the transcript; this is not a cross-file/power-loss transaction.
    savePrivate(path, record, { createDirectory: false });
    this.records.set(record.sessionId, structuredClone(record));
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

/** Read-only diagnosis. Unknown, remote, linked and inaccessible owners are never called stale. */
export function inspectRuntimeLock(directory: string): { state: "absent" | "live" | "stale" | "unverified"; nonce?: string } {
  const path = join(resolve(directory), "runtime.lock");
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) return { state: "unverified" };
    const owner = JSON.parse(readFileSync(path, "utf8"));
    if (!owner || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return { state: "unverified" };
    try { process.kill(owner.pid, 0); }
    catch (error) { return { state: (error as NodeJS.ErrnoException).code === "ESRCH" ? "stale" : "unverified" }; }
    return { state: "live", ...(typeof owner.nonce === "string" ? { nonce: owner.nonce } : {}) };
  } catch (error) { return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unverified" }; }
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
