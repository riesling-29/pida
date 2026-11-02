import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { PidaError, type BusinessTool, type ToolContext } from "./runtime.js";

export interface ProgramManifest {
  version: 1;
  id: string;
  name: string;
  description: string;
  /** Absolute native executable, $node, or $npm. No shell/PATH resolution. */
  command: string;
  args?: string[];
  /** Additional repository entrypoint to pin. $node/$npm infer this when omitted. */
  entrypoint?: string;
  inputMode: "json-stdin" | "none";
  outputMode: "json" | "text";
  timeoutMs?: number;
  effect: "read" | "write" | "idempotent";
  inputSchema: Record<string, unknown>;
}
export interface ProgramApproval {
  manifestDigest: string;
  commandDigest: string;
  entrypointDigest?: string;
  runnerDigest?: string;
}
export interface ProgramProxyOptions {
  trustedHost: true;
  approval: ProgramApproval;
  /** Explicit host-selected environment values; never pass process.env wholesale. */
  env?: Record<string, string>;
}
export class ProgramProxyError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new ProgramProxyError(code); };
const MAX_MANIFEST = 65_536, MAX_ENTRYPOINT = 4 * 1024 * 1024, MAX_EXECUTABLE = 512 * 1024 * 1024;
const MAX_INPUT = 16_384, MAX_OUTPUT = 131_072;
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const simpleText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
const schemaKeys = new Set(["type", "description", "title", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "enum", "const"]);
function checkSchema(schema: unknown): void {
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (!isObject(value)) return fail("PROGRAM_SCHEMA_INVALID");
    if (depth > 6 || ++nodes > 128 || Object.keys(value).some(key => !schemaKeys.has(key))) fail("PROGRAM_SCHEMA_INVALID");
    if (!["object", "array", "string", "number", "integer", "boolean", "null"].includes(value.type)) fail("PROGRAM_SCHEMA_INVALID");
    for (const key of ["description", "title"]) if (value[key] !== undefined && !simpleText(value[key], 1000)) fail("PROGRAM_SCHEMA_INVALID");
    if (value.type === "object") {
      if (!isObject(value.properties) || Object.keys(value.properties).length > 64 || value.additionalProperties !== false) fail("PROGRAM_SCHEMA_INVALID");
      for (const [key, child] of Object.entries(value.properties)) {
        if (!simpleText(key, 100) || ["__proto__", "prototype", "constructor"].includes(key)) fail("PROGRAM_SCHEMA_INVALID");
        visit(child, depth + 1);
      }
      if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some((key: unknown) => typeof key !== "string" || !Object.hasOwn(value.properties, key)) || new Set(value.required).size !== value.required.length)) fail("PROGRAM_SCHEMA_INVALID");
    } else if (value.properties !== undefined || value.required !== undefined || value.additionalProperties !== undefined) fail("PROGRAM_SCHEMA_INVALID");
    if (value.type === "array") visit(value.items, depth + 1);
    else if (value.items !== undefined) fail("PROGRAM_SCHEMA_INVALID");
    for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > MAX_INPUT)) fail("PROGRAM_SCHEMA_INVALID");
    for (const key of ["minimum", "maximum"]) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) fail("PROGRAM_SCHEMA_INVALID");
    if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > 64 || value.enum.some((item: unknown) => item !== null && !["string", "number", "boolean"].includes(typeof item)))) fail("PROGRAM_SCHEMA_INVALID");
    if (value.const !== undefined && value.const !== null && !["string", "number", "boolean"].includes(typeof value.const)) fail("PROGRAM_SCHEMA_INVALID");
  }
  visit(schema, 0);
  if ((schema as any).type !== "object") fail("PROGRAM_SCHEMA_INVALID");
}

/** Strict bounded JSON Schema subset; unsupported validators never silently disappear. */
export function validateProgramManifest(value: unknown): ProgramManifest {
  if (!isObject(value)) return fail("PROGRAM_MANIFEST_INVALID");
  if (Object.keys(value).some(key => !["version", "id", "name", "description", "command", "args", "entrypoint", "inputMode", "outputMode", "timeoutMs", "effect", "inputSchema"].includes(key)) ||
      value.version !== 1 || typeof value.id !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(value.id) ||
      !simpleText(value.name, 100) || !simpleText(value.description, 1000) || !simpleText(value.command, 2000) ||
      (!["$node", "$npm"].includes(value.command) && !isAbsolute(value.command)) ||
      (value.args !== undefined && (!Array.isArray(value.args) || value.args.length > 32 || value.args.some((arg: unknown) => typeof arg !== "string" || arg.length > 2000 || arg.includes("\0")))) ||
      (value.entrypoint !== undefined && !simpleText(value.entrypoint, 2000)) ||
      !["json-stdin", "none"].includes(value.inputMode) || !["json", "text"].includes(value.outputMode) ||
      !["read", "write", "idempotent"].includes(value.effect) ||
      (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 300_000))) fail("PROGRAM_MANIFEST_INVALID");
  if (JSON.stringify(value).length > MAX_MANIFEST) fail("PROGRAM_MANIFEST_INVALID");
  checkSchema(value.inputSchema);
  if (value.inputMode === "none" && Object.keys(value.inputSchema.properties).length) fail("PROGRAM_SCHEMA_INVALID");
  return structuredClone(value) as ProgramManifest;
}

function exactPath(path: string, directory = false): string {
  if (!isAbsolute(path)) fail("PROGRAM_PATH_DENIED");
  const full = resolve(path), st = lstatSync(full);
  if (st.isSymbolicLink() || relative(full, realpathSync(full)) || (directory ? !st.isDirectory() : !st.isFile() || st.nlink !== 1)) fail("PROGRAM_PATH_DENIED");
  return full;
}
function inside(root: string, path: string): string {
  if (!simpleText(path, 2000) || isAbsolute(path)) fail("PROGRAM_PATH_DENIED");
  const full = resolve(root, path), rel = relative(root, full);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) fail("PROGRAM_PATH_DENIED");
  return full;
}
function fileData(path: string, max: number, capture = false): { digest: string; data?: Buffer } {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > max) fail("PROGRAM_FILE_INVALID");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (st.dev !== before.dev || st.ino !== before.ino || st.size > max || !st.isFile()) fail("PROGRAM_FILE_INVALID");
    const hash = createHash("sha256"), blocks: Buffer[] = [], buffer = Buffer.alloc(Math.min(max + 1, 1024 * 1024));
    let total = 0, count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      if ((total += count) > max) fail("PROGRAM_FILE_INVALID");
      const bytes = buffer.subarray(0, count); hash.update(bytes); if (capture) blocks.push(Buffer.from(bytes));
    }
    return { digest: hash.digest("hex"), ...(capture ? { data: Buffer.concat(blocks) } : {}) };
  } finally { closeSync(fd); }
}
function npmRunner(): string {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")];
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate) || !existsSync(candidate)) continue;
    const full = realpathSync(candidate);
    if (full.endsWith(`${sep}npm-cli.js`) && lstatSync(full).isFile()) return full;
  }
  return fail("PROGRAM_NPM_UNAVAILABLE");
}
interface InspectedProgram {
  manifest: ProgramManifest;
  approval: ProgramApproval;
  root: string;
  manifestPath: string;
  command: string;
  args: string[];
  entrypoint?: string;
  runner?: string;
}
function inspect(rootPath: string, manifestPath: string): InspectedProgram {
  try {
    const root = exactPath(rootPath, true), file = exactPath(isAbsolute(manifestPath) ? manifestPath : inside(root, manifestPath));
    const source = fileData(file, MAX_MANIFEST, true);
    const manifest = validateProgramManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source.data)));
    let args = [...(manifest.args ?? [])], entrypoint = manifest.entrypoint ? exactPath(inside(root, manifest.entrypoint)) : undefined, runner: string | undefined;
    const command = realpathSync(["$node", "$npm"].includes(manifest.command) ? process.execPath : manifest.command);
    if (manifest.command === "$node") {
      if (!args[0] || args[0].startsWith("-")) fail("PROGRAM_ENTRYPOINT_INVALID");
      const script = exactPath(inside(root, args[0]!));
      if (entrypoint && entrypoint !== script) fail("PROGRAM_ENTRYPOINT_INVALID");
      entrypoint = script; args[0] = script;
    } else if (manifest.command === "$npm") {
      runner = npmRunner();
      let packageRoot = root;
      if (args[0] === "--prefix") {
        if (!args[1]) fail("PROGRAM_ENTRYPOINT_INVALID");
        packageRoot = args[1] === "." ? root : exactPath(inside(root, args[1]!), true);
        args = args.slice(2);
      }
      if (args[0] !== "run" || !args[1] || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(args[1]) || (args.length > 2 && args[2] !== "--")) fail("PROGRAM_ENTRYPOINT_INVALID");
      const packageFile = exactPath(join(packageRoot, "package.json"));
      if (entrypoint && entrypoint !== packageFile) fail("PROGRAM_ENTRYPOINT_INVALID");
      entrypoint = packageFile;
      const pkg = JSON.parse(fileData(packageFile, MAX_ENTRYPOINT, true).data!.toString("utf8"));
      if (!isObject(pkg.scripts) || typeof pkg.scripts[args[1]!] !== "string") fail("PROGRAM_ENTRYPOINT_INVALID");
      args = [runner, "--prefix", packageRoot, ...args];
    }
    return { manifest, root, manifestPath: file, command, args, entrypoint, runner, approval: {
      manifestDigest: source.digest, commandDigest: fileData(command, MAX_EXECUTABLE).digest,
      ...(entrypoint ? { entrypointDigest: fileData(entrypoint, MAX_ENTRYPOINT).digest } : {}),
      ...(runner ? { runnerDigest: fileData(runner, MAX_ENTRYPOINT).digest } : {}),
    } };
  } catch (error) { if (error instanceof ProgramProxyError) throw error; throw new ProgramProxyError("PROGRAM_INSPECTION_FAILED"); }
}
export function inspectProgramProxy(root: string, manifestPath: string): { manifest: ProgramManifest; approval: ProgramApproval } {
  const inspected = inspect(root, manifestPath);
  return { manifest: inspected.manifest, approval: inspected.approval };
}
function equalApproval(actual: ProgramApproval, expected: ProgramApproval): boolean {
  return isObject(expected) && Object.keys(expected).every(key => ["manifestDigest", "commandDigest", "entrypointDigest", "runnerDigest"].includes(key)) &&
    ["manifestDigest", "commandDigest", "entrypointDigest", "runnerDigest"].every(key => {
      const value = expected[key as keyof ProgramApproval];
      return (value === undefined || /^[a-f0-9]{64}$/.test(value)) && actual[key as keyof ProgramApproval] === value;
    });
}
function environment(explicit: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir", "home", "userprofile", "localappdata", "appdata", "programfiles", "programfiles(x86)", "lang", "lc_all"]);
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (allowed.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  if (!isObject(explicit) || Object.keys(explicit).length > 32) fail("PROGRAM_ENV_INVALID");
  for (const [name, value] of Object.entries(explicit)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || value.length > 4096 || value.includes("\0") || /^(NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|PYTHONPATH|PYTHONSTARTUP|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*)$/i.test(name)) fail("PROGRAM_ENV_INVALID");
    result[name] = value;
  }
  return result;
}
function bounded(result: Record<string, any>): Record<string, any> {
  for (const key of ["output", "stderr"]) if (typeof result[key] === "string") {
    while (JSON.stringify(result).length > 26_000 && result[key].length) { result[key] = result[key].slice(0, Math.floor(result[key].length * .75)); result.truncated = true; }
  }
  return result;
}
function executeProgram(program: InspectedProgram, env: NodeJS.ProcessEnv, input: string, context: ToolContext): Promise<Record<string, any>> {
  return new Promise(resolveResult => {
    let child: ReturnType<typeof spawn>, started = false, settled = false, stopping: string | undefined, outputBytes = 0, stdout: Buffer[] = [], stderr: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined, grace: NodeJS.Timeout | undefined;
    const startedAt = Date.now();
    const finish = (code?: number | null, launchError = false) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(grace); context.signal.removeEventListener("abort", abort);
      const base = { exitCode: code ?? null, durationMs: Date.now() - startedAt, effectState: stopping || (launchError && started) ? "unknown" : started ? "applied" : "not_applied" };
      const error = stopping ?? (launchError ? "PROGRAM_START_FAILED" : code !== 0 ? "PROGRAM_EXIT_FAILED" : undefined);
      const errorOutput = Buffer.concat(stderr).toString("utf8"), text = Buffer.concat(stdout).toString("utf8");
      if (error) { resolveResult(bounded({ ...base, ok: false, error, output: text, stderr: errorOutput, ...(stopping ? { hint: "Inspect program state before retrying. Child termination does not undo changes or guarantee descendant cleanup." } : {}) })); return; }
      if (program.manifest.outputMode === "json") {
        try {
          const output = JSON.parse(text);
          if (JSON.stringify({ output, stderr: errorOutput }).length > 24_000) { resolveResult({ ...base, ok: false, error: "PROGRAM_JSON_OUTPUT_LIMIT" }); return; }
          resolveResult({ ...base, ok: true, output, ...(errorOutput ? { stderr: errorOutput } : {}) });
        } catch { resolveResult({ ...base, ok: false, error: "PROGRAM_OUTPUT_INVALID" }); }
      } else resolveResult(bounded({ ...base, ok: true, output: text, ...(errorOutput ? { stderr: errorOutput } : {}) }));
    };
    const stop = (error: string) => {
      if (settled || stopping) return; stopping = error;
      child?.kill("SIGKILL");
      // A descendant may keep stdout open. Never wait forever or claim it was terminated.
      grace = setTimeout(() => { child?.stdout?.destroy(); child?.stderr?.destroy(); finish(null); }, 1000);
    };
    const abort = () => stop("PROGRAM_CANCELLED");
    try {
      child = spawn(program.command, program.args, { cwd: program.root, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      child.once("spawn", () => { started = true; if (stopping) child.kill("SIGKILL"); });
      child.once("error", () => finish(null, true));
      child.once("close", code => finish(code));
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        const remaining = MAX_OUTPUT - outputBytes; outputBytes += chunk.length;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        if (outputBytes > MAX_OUTPUT) stop("PROGRAM_OUTPUT_LIMIT");
      };
      child.stdout!.on("data", chunk => collect(stdout, chunk)); child.stderr!.on("data", chunk => collect(stderr, chunk));
      child.stdin!.on("error", () => { /* Program may finish without reading stdin. Exit status remains authoritative. */ });
      context.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => stop("PROGRAM_TIMEOUT"), program.manifest.timeoutMs ?? 30_000);
      if (context.signal.aborted) abort(); else child.stdin!.end(input);
    } catch { finish(null, true); }
  });
}

/** Host-trusted program bridge; no model-selected executable, argument interpolation or sandbox claim. */
export function loadProgramProxy(root: string, manifestPath: string, options: ProgramProxyOptions): { manifest: ProgramManifest; approval: ProgramApproval; tool: BusinessTool<any> } {
  if (options?.trustedHost !== true) fail("PROGRAM_HOST_TRUST_REQUIRED");
  const program = inspect(root, manifestPath), approved = structuredClone(options.approval);
  if (!equalApproval(program.approval, approved)) fail("PROGRAM_APPROVAL_MISMATCH");
  const env = environment(options.env), manifest = program.manifest, permission = `program:${manifest.id}`;
  const tool: BusinessTool<any> = {
    name: `program_${manifest.id}`, description: `${manifest.description} Runs an explicitly approved host program with fixed arguments. Input is ${manifest.inputMode}; output is ${manifest.outputMode}. Host execution is not sandboxed.`,
    parameters: structuredClone(manifest.inputSchema) as TSchema, permission, effect: manifest.effect,
    effectResult: (value: any) => value.effectState ?? "unknown",
    classifyResult: (value: any) => ({ status: value.ok ? "completed" : "failed", ...(value.error ? { code: value.error } : {}) }),
    async execute(args: unknown, context) {
      if (!context.principal.permissions.includes(permission)) throw new PidaError("FORBIDDEN", 403);
      if (context.signal.aborted) return { ok: false, error: "PROGRAM_CANCELLED", effectState: "not_applied" };
      let input: string;
      try {
        input = JSON.stringify(args);
        if (input === undefined || Buffer.byteLength(input) > MAX_INPUT || !Value.Check(manifest.inputSchema as TSchema, args)) return { ok: false, error: "PROGRAM_INPUT_INVALID", effectState: "not_applied" };
      } catch { return { ok: false, error: "PROGRAM_INPUT_INVALID", effectState: "not_applied" }; }
      try {
        const current = inspect(program.root, program.manifestPath);
        if (!equalApproval(current.approval, approved) || current.command !== program.command || current.entrypoint !== program.entrypoint || current.runner !== program.runner) return { ok: false, error: "PROGRAM_APPROVAL_MISMATCH", effectState: "not_applied" };
      } catch { return { ok: false, error: "PROGRAM_APPROVAL_MISMATCH", effectState: "not_applied" }; }
      if (context.signal.aborted) return { ok: false, error: "PROGRAM_CANCELLED", effectState: "not_applied" };
      return executeProgram(program, env, manifest.inputMode === "json-stdin" ? input + "\n" : "", context);
    },
  };
  return { manifest: structuredClone(manifest), approval: structuredClone(approved), tool };
}
