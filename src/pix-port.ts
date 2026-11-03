import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const pixWorkerSchema = "pida.pix.worker.v1" as const;
export interface PixDfgModel {
  activities: string[];
  edges: [string, string][];
  starts: string[];
  ends: string[];
  acceptsEmpty: boolean;
}
export interface PixTrace { caseId: string; events: { eventId: string; activity: string }[] }
export interface PixWorkerRequest {
  schemaVersion: typeof pixWorkerSchema;
  operation: "reflect" | "awareness" | "capabilities";
  traces?: PixTrace[];
  model?: PixDfgModel;
  limits?: { maxEvents?: number; maxVariants?: number; maxStates?: number; maxEventPairs?: number };
}
export interface PixEngineBuild {
  repository: string;
  sourceCommit: string;
  sourceDigest: string;
  packageVersion: string;
  pythonVersion: string;
  sourceVerified: true;
}
export interface PixWorkerResult {
  schemaVersion: typeof pixWorkerSchema;
  operation: PixWorkerRequest["operation"];
  status: "computed" | "partial" | "unavailable" | "invalid_input" | "error";
  engine?: PixEngineBuild;
  issues: { code: string; message: string }[];
  nativeResults: Record<string, unknown>[];
  variants?: { variantId: string; caseIds: string[]; activities: string[]; frequency: number; cumulativeCaseCount: number }[];
  model?: PixDfgModel;
  alignments?: { caseId: string; status: "optimal" | "unreachable" | "search_limit"; cost: number | null; moves: Record<string, unknown>[]; lowerBoundCost: number | null }[];
  sampleCount?: number;
  limits: string[];
}
/** A consumer port, not a PIX implementation. Test doubles must declare their profile separately. */
export interface PixPort { compute(request: PixWorkerRequest, signal?: AbortSignal): Promise<PixWorkerResult> }
export interface PixProcessConfig {
  pythonExecutable: string;
  workerPath: string;
  sourceDirectory: string;
  expectedSourceCommit: string;
  expectedSourceDigest: string;
  /** Optional install-time worker pin; otherwise captured at construction and checked before each call. */
  expectedWorkerDigest?: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxStderrBytes?: number;
}
export class PixPortError extends Error {
  constructor(readonly code: string, readonly details?: { exitCode?: number | null; stdoutBytes?: number; stderrBytes?: number }) { super(code); }
}
const fail = (code: string): never => { throw new PixPortError(code); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every(key => allowed.includes(key));
const text = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\0");
const count = (v: unknown, max = 1_000_000): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const strings = (v: unknown, max = 10000): v is string[] => Array.isArray(v) && v.length <= max && v.every(item => text(item));
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const commit = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
function model(v: unknown): v is PixDfgModel {
  if (!object(v) || !keys(v, ["activities", "edges", "starts", "ends", "acceptsEmpty"]) || !strings(v.activities, 256)
    || !Array.isArray(v.edges) || v.edges.length > 10000 || !v.edges.every((e: unknown) => Array.isArray(e) && e.length === 2 && e.every(a => text(a)))
    || !strings(v.starts, 256) || !strings(v.ends, 256) || typeof v.acceptsEmpty !== "boolean") return false;
  const activities = new Set(v.activities);
  return activities.size === v.activities.length && v.starts.every((a: string) => activities.has(a)) && v.ends.every((a: string) => activities.has(a))
    && v.edges.every((e: string[]) => e.every(a => activities.has(a))) && new Set(v.starts).size === v.starts.length && new Set(v.ends).size === v.ends.length
    && new Set(v.edges.map((e: string[]) => JSON.stringify(e))).size === v.edges.length;
}
export function validPixWorkerRequest(v: unknown): v is PixWorkerRequest {
  if (!object(v) || !keys(v, ["schemaVersion", "operation", "traces", "model", "limits"]) || v.schemaVersion !== pixWorkerSchema || !["capabilities", "reflect", "awareness"].includes(v.operation)) return false;
  if (v.traces !== undefined && (!Array.isArray(v.traces) || v.traces.length > 256 || !v.traces.every((t: unknown) => object(t) && keys(t, ["caseId", "events"]) && text(t.caseId) && Array.isArray(t.events) && t.events.length <= 10000 && t.events.every((e: unknown) => object(e) && keys(e, ["eventId", "activity"]) && text(e.eventId) && text(e.activity))))) return false;
  if (v.traces && (new Set(v.traces.map((t: PixTrace) => t.caseId)).size !== v.traces.length || v.traces.reduce((n: number, t: PixTrace) => n + t.events.length, 0) > 10000 || v.traces.some((t: PixTrace) => new Set(t.events.map(e => e.eventId)).size !== t.events.length))) return false;
  if (v.model !== undefined && !model(v.model)) return false;
  if (v.operation !== "capabilities" && !v.traces || v.operation === "awareness" && !v.model) return false;
  if (v.limits !== undefined) {
    if (!object(v.limits) || !keys(v.limits, ["maxEvents", "maxVariants", "maxStates", "maxEventPairs"])) return false;
    const maxima: Record<string, number> = { maxEvents: 10000, maxVariants: 1000, maxStates: 100000, maxEventPairs: 10000 };
    if (Object.entries(v.limits).some(([key, n]) => !count(n, maxima[key]!) || n < 1)) return false;
  }
  return true;
}
function validResult(v: unknown): v is PixWorkerResult {
  if (!object(v) || !keys(v, ["schemaVersion", "operation", "status", "engine", "issues", "nativeResults", "variants", "model", "alignments", "sampleCount", "limits"])
    || v.schemaVersion !== pixWorkerSchema || !["capabilities", "reflect", "awareness"].includes(v.operation)
    || !["computed", "partial", "unavailable", "invalid_input", "error"].includes(v.status)
    || !Array.isArray(v.issues) || v.issues.length > 128 || !v.issues.every((i: unknown) => object(i) && keys(i, ["code", "message"]) && typeof i.code === "string" && /^[A-Za-z0-9_]{1,100}$/.test(i.code) && text(i.message, 2000))
    || !Array.isArray(v.nativeResults) || v.nativeResults.length > 1024 || !v.nativeResults.every(object) || !strings(v.limits, 128)) return false;
  if (v.engine !== undefined && (!object(v.engine) || !keys(v.engine, ["repository", "sourceCommit", "sourceDigest", "packageVersion", "pythonVersion", "sourceVerified"]) || !text(v.engine.repository, 200) || !commit(v.engine.sourceCommit) || !digest(v.engine.sourceDigest) || !text(v.engine.packageVersion, 64) || !text(v.engine.pythonVersion, 64) || v.engine.sourceVerified !== true)) return false;
  if (["computed", "partial"].includes(v.status) && !v.engine) return false;
  if (v.sampleCount !== undefined && !count(v.sampleCount, 256)) return false;
  if (v.model !== undefined && !model(v.model)) return false;
  if (v.variants !== undefined && (!Array.isArray(v.variants) || v.variants.length > 10000 || !v.variants.every((x: unknown) => object(x) && keys(x, ["variantId", "caseIds", "activities", "frequency", "cumulativeCaseCount"]) && text(x.variantId) && strings(x.caseIds, 256) && strings(x.activities) && count(x.frequency, 256) && count(x.cumulativeCaseCount, 256)))) return false;
  if (v.alignments !== undefined && (!Array.isArray(v.alignments) || v.alignments.length > 256 || !v.alignments.every((x: unknown) => object(x) && keys(x, ["caseId", "status", "cost", "moves", "lowerBoundCost"]) && text(x.caseId) && ["optimal", "unreachable", "search_limit"].includes(x.status) && (x.cost === null || finite(x.cost)) && (x.lowerBoundCost === null || finite(x.lowerBoundCost)) && Array.isArray(x.moves) && x.moves.length <= 20000 && x.moves.every(object)))) return false;
  return true;
}
function matchesRequest(result: PixWorkerResult, request: PixWorkerRequest): boolean {
  if (result.operation !== request.operation) return false;
  const expected = new Map((request.traces ?? []).map(t => [t.caseId, t.events.map(e => e.activity)]));
  if (result.sampleCount !== undefined && result.sampleCount !== expected.size) return false;
  if (result.status === "computed" && request.operation === "reflect" && (!result.model || !result.variants || result.sampleCount === undefined)) return false;
  if (["computed", "partial"].includes(result.status) && request.operation === "awareness" && (!result.alignments || result.sampleCount === undefined)) return false;
  if (result.variants) {
    const seen = new Set<string>(); let cumulative = 0;
    for (const variant of result.variants) {
      if (!variant.frequency || variant.frequency !== variant.caseIds.length || variant.cumulativeCaseCount !== (cumulative += variant.frequency)) return false;
      for (const id of variant.caseIds) {
        if (seen.has(id) || !expected.has(id) || JSON.stringify(expected.get(id)) !== JSON.stringify(variant.activities)) return false;
        seen.add(id);
      }
    }
    if (seen.size !== expected.size) return false;
  }
  if (result.alignments) {
    const ids = result.alignments.map(x => x.caseId);
    if (new Set(ids).size !== ids.length || ids.some(id => !expected.has(id)) || ids.length !== expected.size) return false;
    if (result.alignments.some(x => x.status === "optimal" && x.cost === null)) return false;
  }
  return true;
}
function limited(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail("PIX_CONFIG_INVALID");
  return n;
}
function absolute(value: string): string {
  if (!text(value, 4096) || !isAbsolute(value)) fail("PIX_CONFIG_INVALID");
  return resolve(value);
}
function workerHash(path: string): string {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_097_152) fail("PIX_WORKER_INVALID");
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) { if (error instanceof PixPortError) throw error; return fail("PIX_WORKER_UNAVAILABLE"); }
}

/** Executes only the trusted pinned consumer worker. This is not an OS filesystem/network sandbox. */
export function createPixProcessPort(config: PixProcessConfig): PixPort {
  const python = absolute(config.pythonExecutable), worker = absolute(config.workerPath), source = absolute(config.sourceDirectory);
  if (!commit(config.expectedSourceCommit) || !digest(config.expectedSourceDigest) || config.expectedWorkerDigest !== undefined && !digest(config.expectedWorkerDigest)) fail("PIX_CONFIG_INVALID");
  const pin = { commit: config.expectedSourceCommit, source: config.expectedSourceDigest, worker: config.expectedWorkerDigest ?? workerHash(worker) };
  if (workerHash(worker) !== pin.worker) fail("PIX_WORKER_PIN_MISMATCH");
  const timeoutMs = limited(config.timeoutMs, 10000, 10, 120000);
  const maxInput = limited(config.maxInputBytes, 1048576, 256, 4194304), maxOutput = limited(config.maxOutputBytes, 4194304, 256, 16777216), maxStderr = limited(config.maxStderrBytes, 32768, 64, 1048576);
  // A trusted host selects the executable. Canonicalize interpreter symlinks but do not search PATH.
  let executable: string;
  try { executable = realpathSync(python); if (!lstatSync(executable).isFile()) fail("PIX_EXECUTABLE_UNAVAILABLE"); }
  catch { return fail("PIX_EXECUTABLE_UNAVAILABLE"); }
  return {
    async compute(request, signal) {
      if (signal?.aborted) fail("PIX_CANCELLED");
      if (!validPixWorkerRequest(request)) fail("PIX_INPUT_INVALID");
      const bytes = Buffer.from(JSON.stringify(request), "utf8");
      if (bytes.length > maxInput) fail("PIX_INPUT_LIMIT");
      if (workerHash(worker) !== pin.worker) fail("PIX_WORKER_PIN_MISMATCH");
      let cwd: string;
      try { cwd = mkdtempSync(join(tmpdir(), "pida-pix-")); } catch { return fail("PIX_TEMP_UNAVAILABLE"); }
      try {
        return await new Promise<PixWorkerResult>((resolveResult, reject) => {
          let stdoutBytes = 0, stderrBytes = 0, stopped: string | undefined, settled = false;
          const chunks: Buffer[] = [];
          const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && ["systemroot", "windir", "temp", "tmp", "tmpdir", "lang", "lc_all"].includes(key.toLowerCase())));
          const child = spawn(executable, ["-I", "-B", worker, "--source", source, "--source-commit", pin.commit, "--source-digest", pin.source], { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
          let force: ReturnType<typeof setTimeout> | undefined;
          const kill = (hard = false) => {
            try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, hard ? "SIGKILL" : "SIGTERM"); else child.kill(hard ? "SIGKILL" : "SIGTERM"); } catch { /* Exit may win the race. */ }
          };
          const stop = (code: string) => { if (stopped || settled) return; stopped = code; kill(); force = setTimeout(() => kill(true), 100); };
          const cancel = () => stop("PIX_CANCELLED");
          const timer = setTimeout(() => stop("PIX_TIMEOUT"), timeoutMs);
          signal?.addEventListener("abort", cancel, { once: true });
          if (signal?.aborted) cancel();
          child.stdout.on("data", (data: Buffer) => { stdoutBytes += data.length; if (stdoutBytes > maxOutput) stop("PIX_OUTPUT_LIMIT"); else if (!stopped) chunks.push(data); });
          child.stderr.on("data", (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > maxStderr) stop("PIX_STDERR_LIMIT"); });
          child.stdin.on("error", () => { /* EPIPE is classified with the direct child outcome below. */ });
          child.on("error", () => { stopped ??= "PIX_START_FAILED"; });
          child.on("close", exitCode => {
            settled = true; clearTimeout(timer); if (force) clearTimeout(force); signal?.removeEventListener("abort", cancel);
            const details = { exitCode, stdoutBytes, stderrBytes };
            if (stopped) { reject(new PixPortError(stopped, details)); return; }
            if (exitCode !== 0) { reject(new PixPortError("PIX_WORKER_FAILED", details)); return; }
            let parsed: unknown;
            try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { reject(new PixPortError("PIX_OUTPUT_INVALID", details)); return; }
            if (!validResult(parsed) || !matchesRequest(parsed, request)) { reject(new PixPortError("PIX_OUTPUT_INVALID", details)); return; }
            if (parsed.engine && (parsed.engine.repository !== "Chanta-Research-Group/PIX" || parsed.engine.sourceCommit !== pin.commit || parsed.engine.sourceDigest !== pin.source)) { reject(new PixPortError("PIX_SOURCE_PIN_MISMATCH", details)); return; }
            resolveResult(parsed);
          });
          child.stdin.end(bytes);
        });
      } finally { rmSync(cwd, { force: true, recursive: true }); }
    },
  };
}
