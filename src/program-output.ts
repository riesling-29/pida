import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { OutputCollector } from "./vendor/deepseek-output.js";

export interface OutputOwner { principalId: string; sessionId: string; programId: string }
export interface ProgramOutputReference {
  id: string; stream: "stdout" | "stderr"; bytes: number; sha256: string;
  mediaType: "text/plain; charset=utf-8";
}
interface StoredOutput extends ProgramOutputReference, OutputOwner { version: 1; file: string; createdAt: number }
export interface ProgramOutputLimits {
  /** Per stream. Exceeding this discards the incomplete spill, never kills the program. */
  maxSpillBytes?: number;
  /** Includes retained output and reserved space for active collectors. */
  maxTotalBytes?: number;
  maxArtifacts?: number;
  retentionMs?: number;
}
export interface ProgramOutputPreview {
  text: string; totalBytes: number; truncated: boolean; lossy: boolean;
  artifact?: ProgramOutputReference; storageError?: string;
}
const HEAD_BYTES = 2048, TAIL_BYTES = 6144;
const ID = /^output_[a-f0-9]{32}$/;
const OUTPUT_FILE = /^dsh-subprocess-\d+-\d+-[a-f0-9]{12}-(stdout|stderr)\.log$/;
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const remove = (path: string) => { try { unlinkSync(path); } catch { /* Retained files continue to count against the quota. */ } };

/** Trim only incomplete window boundaries; malformed source bytes are decoded with replacement. */
export function utf8Window(bytes: Buffer, clippedStart = false, clippedEnd = false): { text: string; start: number; end: number } {
  let start = 0, end = bytes.length;
  if (clippedStart) while (start < end && (bytes[start]! & 0xc0) === 0x80) start++;
  if (clippedEnd && end > start) {
    let lead = end - 1;
    while (lead > start && (bytes[lead]! & 0xc0) === 0x80) lead--;
    const b = bytes[lead]!, width = b >= 0xf0 && b <= 0xf4 ? 4 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xc2 && b <= 0xdf ? 2 : 1;
    if (width > end - lead) end = lead;
  }
  return { text: bytes.subarray(start, end).toString("utf8"), start, end };
}

function exactFile(path: string, max: number): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > max) throw new Error("invalid output file");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (st.dev !== before.dev || st.ino !== before.ino || !st.isFile() || st.size > max || st.nlink !== 1) throw new Error("changed output file");
    const data = Buffer.alloc(st.size); let offset = 0;
    while (offset < data.length) { const read = readSync(fd, data, offset, data.length - offset, offset); if (!read) throw new Error("incomplete output file"); offset += read; }
    const after = fstatSync(fd);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) throw new Error("changed output file");
    return data;
  } finally { closeSync(fd); }
}

/** Host-selected private artifact store. Files contain command output and are never public URLs. */
export class ProgramOutputStore {
  readonly directory: string;
  readonly maxSpillBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxArtifacts: number;
  private readonly retentionMs: number;
  private reserved = 0;
  private reservations = 0;

  constructor(directory: string, limits: ProgramOutputLimits = {}) {
    this.directory = resolve(directory);
    this.maxSpillBytes = limits.maxSpillBytes ?? 4 * 1024 * 1024;
    this.maxTotalBytes = limits.maxTotalBytes ?? 64 * 1024 * 1024;
    this.maxArtifacts = limits.maxArtifacts ?? 128;
    this.retentionMs = limits.retentionMs ?? 24 * 60 * 60 * 1000;
    for (const value of [this.maxSpillBytes, this.maxTotalBytes, this.maxArtifacts, this.retentionMs]) if (!Number.isSafeInteger(value) || value < 1) throw new Error("PROGRAM_OUTPUT_LIMIT_INVALID");
    if (this.maxSpillBytes > 16 * 1024 * 1024 || this.maxTotalBytes > 256 * 1024 * 1024 || this.maxArtifacts > 1024) throw new Error("PROGRAM_OUTPUT_LIMIT_INVALID");
  }

  private ensureDirectory(): void {
    // Check existing ancestors before mkdir: never create through a symlink selected by repository code.
    for (let path = this.directory; ; path = dirname(path)) {
      try { const st = lstatSync(path); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("invalid output directory"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (dirname(path) === path) break;
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (realpathSync(this.directory) !== this.directory) throw new Error("invalid output directory");
    if (process.platform !== "win32") chmodSync(this.directory, 0o700);
  }

  private records(): StoredOutput[] {
    const names = readdirSync(this.directory);
    // Bound scans even when a trusted host command left unexpected files here.
    if (names.length > this.maxArtifacts * 3 + 64) throw new Error("output directory full");
    return names.filter(name => /^output_[a-f0-9]{32}\.json$/.test(name)).flatMap(name => {
      try { const r = JSON.parse(exactFile(join(this.directory, name), 8192).toString("utf8")); return this.validRecord(r) && name === r.id + ".json" ? [r] : []; }
      catch { return []; }
    });
  }

  private validRecord(r: any): r is StoredOutput {
    return r?.version === 1 && typeof r.id === "string" && ID.test(r.id) && typeof r.file === "string" && OUTPUT_FILE.test(r.file) &&
      ["stdout", "stderr"].includes(r.stream) && Number.isSafeInteger(r.bytes) && r.bytes >= 0 && r.bytes <= this.maxSpillBytes &&
      typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256) && r.mediaType === "text/plain; charset=utf-8" &&
      Number.isFinite(r.createdAt) && [r.principalId, r.sessionId, r.programId].every(v => typeof v === "string" && v.length > 0 && v.length <= 1000);
  }

  private diskBytes(): number {
    let bytes = 0;
    for (const name of readdirSync(this.directory)) {
      const st = lstatSync(join(this.directory, name));
      if (!st.isFile() || st.isSymbolicLink()) throw new Error("invalid output directory entry");
      bytes += st.size;
    }
    return bytes;
  }

  private prune(requiredBytes: number, requiredRecords: number): boolean {
    let records = this.records().sort((a, b) => a.createdAt - b.createdAt);
    for (const r of records) if (Date.now() - r.createdAt > this.retentionMs) this.discard(r);
    records = records.filter(r => Date.now() - r.createdAt <= this.retentionMs);
    // Orphans left by a crash expire too. Recent ones remain charged to the quota.
    const referenced = new Set(records.map(r => r.file));
    for (const name of readdirSync(this.directory)) if (OUTPUT_FILE.test(name) && !referenced.has(name) && Date.now() - lstatSync(join(this.directory, name)).mtimeMs > this.retentionMs) remove(join(this.directory, name));
    while (records.length && (records.length + this.reservations * 2 + requiredRecords > this.maxArtifacts || this.diskBytes() + this.reserved + requiredBytes > this.maxTotalBytes)) this.discard(records.shift()!);
    return this.records().length + this.reservations * 2 + requiredRecords <= this.maxArtifacts && this.diskBytes() + this.reserved + requiredBytes <= this.maxTotalBytes;
  }

  private discard(record: StoredOutput): void { remove(join(this.directory, record.file)); remove(join(this.directory, record.id + ".json")); }

  begin(owner: OutputOwner): ProgramOutputCapture {
    let canSpill = false;
    const reserve = 2 * this.maxSpillBytes + 16_384;
    try { this.ensureDirectory(); canSpill = this.prune(reserve, 2); } catch { /* Output recovery must not prevent an approved command from running. */ }
    if (canSpill) { this.reserved += reserve; this.reservations++; }
    return new ProgramOutputCapture(this, owner, canSpill, () => { if (canSpill) { this.reserved -= reserve; this.reservations--; } });
  }

  /** Called only after upstream seals a complete spill. Never returns host paths. */
  retain(file: string, stream: "stdout" | "stderr", totalBytes: number, owner: OutputOwner): ProgramOutputReference | undefined {
    if (dirname(file) !== this.directory || !OUTPUT_FILE.test(basename(file))) return undefined;
    try {
      this.ensureDirectory();
      const data = exactFile(file, this.maxSpillBytes);
      if (data.length !== totalBytes) { remove(file); return undefined; }
      const reference: ProgramOutputReference = { id: "output_" + randomUUID().replaceAll("-", ""), stream, bytes: data.length, sha256: sha256(data), mediaType: "text/plain; charset=utf-8" };
      const record: StoredOutput = { version: 1, ...owner, ...reference, file: basename(file), createdAt: Date.now() };
      const serialized = JSON.stringify(record);
      if (!this.validRecord(record) || Buffer.byteLength(serialized) > 8192) { remove(file); return undefined; }
      writeFileSync(join(this.directory, reference.id + ".json"), serialized, { flag: "wx", mode: 0o600 });
      return reference;
    } catch { remove(file); return undefined; }
  }

  read(owner: OutputOwner, id: string, offset = 0, maxBytes = 8192): Record<string, unknown> {
    if (!ID.test(id) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > 16_384) return { ok: false, error: "PROGRAM_OUTPUT_ARGUMENT_INVALID" };
    try {
      this.ensureDirectory();
      const record = JSON.parse(exactFile(join(this.directory, id + ".json"), 8192).toString("utf8"));
      if (!this.validRecord(record) || record.id !== id || record.principalId !== owner.principalId || record.sessionId !== owner.sessionId || record.programId !== owner.programId || Date.now() - record.createdAt > this.retentionMs) return { ok: false, error: "PROGRAM_OUTPUT_NOT_FOUND" };
      const data = exactFile(join(this.directory, record.file), this.maxSpillBytes);
      if (data.length !== record.bytes || sha256(data) !== record.sha256) return { ok: false, error: "PROGRAM_OUTPUT_CHANGED" };
      if (offset > data.length) return { ok: false, error: "PROGRAM_OUTPUT_ARGUMENT_INVALID" };
      let pageBytes = maxBytes;
      while (true) {
        const end = Math.min(data.length, offset + pageBytes), window = utf8Window(data.subarray(offset, end), offset > 0, end < data.length);
        const result = { ok: true, id, stream: record.stream, text: window.text, offset: offset + window.start, nextOffset: offset + window.end, totalBytes: data.length, eof: offset + window.end === data.length, lossy: false, sha256: record.sha256, ...(window.start ? { adjustedOffset: true } : {}) };
        // Escaped control characters can multiply JSON size. Keep below the runtime tool-result cap
        // by shortening this page, never skipping bytes or modifying nextOffset after serialization.
        if (JSON.stringify(result).length <= 26_000) return result;
        pageBytes = Math.max(4, Math.floor(pageBytes * .75));
      }
    } catch { return { ok: false, error: "PROGRAM_OUTPUT_NOT_FOUND" }; }
  }
}

export class ProgramOutputCapture {
  private readonly collectors: Record<"stdout" | "stderr", OutputCollector>;
  private readonly heads = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  private readonly failures: Partial<Record<"stdout" | "stderr", string>> = {};
  private finished?: Record<"stdout" | "stderr", ProgramOutputPreview>;
  constructor(private readonly store: ProgramOutputStore, private readonly owner: OutputOwner, canSpill: boolean, private readonly release: () => void) {
    this.collectors = Object.fromEntries((["stdout", "stderr"] as const).map(stream => [stream, new OutputCollector(TAIL_BYTES, stream, canSpill ? {
      maxBytes: store.maxSpillBytes, dir: store.directory,
      onFailure: () => { this.failures[stream] = "PROGRAM_OUTPUT_STORAGE_UNAVAILABLE"; },
    } : undefined)])) as Record<"stdout" | "stderr", OutputCollector>;
    if (!canSpill) this.failures.stdout = this.failures.stderr = "PROGRAM_OUTPUT_STORAGE_UNAVAILABLE";
  }
  push(stream: "stdout" | "stderr", bytes: Buffer): void {
    if (this.finished) return;
    const remaining = HEAD_BYTES - this.heads[stream].length;
    if (remaining > 0) this.heads[stream] = Buffer.concat([this.heads[stream], bytes.subarray(0, remaining)]);
    this.collectors[stream].push(bytes);
  }
  finish(): Record<"stdout" | "stderr", ProgramOutputPreview> {
    if (this.finished) return this.finished;
    try {
      this.finished = Object.fromEntries((["stdout", "stderr"] as const).map(stream => {
        const collector = this.collectors[stream], finalized = collector.finalize(), snapshot = collector.snapshot();
        const totalBytes = snapshot.totalBytes, truncated = finalized.truncated;
        const artifact = finalized.spillPath ? this.store.retain(finalized.spillPath, stream, totalBytes, this.owner) : undefined;
        const tail = utf8Window(snapshot.bytes, truncated).text;
        const head = truncated ? utf8Window(this.heads[stream], false, true).text : "";
        const text = truncated ? `${head}\n[… output truncated; ${totalBytes} bytes total …]\n${tail}` : tail;
        return [stream, { text, totalBytes, truncated, lossy: truncated && !artifact, ...(artifact ? { artifact } : {}), ...(truncated && !artifact ? { storageError: totalBytes > this.store.maxSpillBytes ? "PROGRAM_OUTPUT_DISK_LIMIT" : this.failures[stream] ?? "PROGRAM_OUTPUT_STORAGE_UNAVAILABLE" } : {}) }];
      })) as Record<"stdout" | "stderr", ProgramOutputPreview>;
      return this.finished;
    } finally { this.release(); }
  }
}
