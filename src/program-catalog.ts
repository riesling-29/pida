import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, opendirSync, readFileSync, readSync, realpathSync, type Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256 } from "./private-state.js";
import { validateProgramManifest, type ProgramManifest } from "./program-proxy.js";
import { Type } from "typebox";
import { PidaError, type BusinessTool } from "./runtime.js";

export interface ProgramCandidate {
  id: string; name: string;
  kind: "manifest" | "npm-script" | "node-bin" | "python-entrypoint";
  /** Repository-relative metadata path. No package metadata is imported or executed. */
  path: string; description: string;
  /** ready means a deterministic proxy draft is available, never permission or execution success. */
  status: "ready" | "adapter-required";
  sourceDigest: string;
  entry?: string; target?: string;
  manifest?: ProgramManifest;
}
export interface ProgramCatalog {
  candidates: ProgramCandidate[];
  warnings: { path: string; code: string }[];
  truncated: boolean;
}
export interface ProgramScanOptions { maxDepth?: number; maxFiles?: number; protectedPaths?: string[] }
const METADATA_BYTES = 131072;
const ignored = (name: string) => [".git", ".pida", "node_modules", "vendor", "dist", "build", ".next", ".venv", "venv", "__pycache__"].includes(name.toLowerCase()) || /^\.env(?:$|\.)/i.test(name);
const relativePath = (path: string) => typeof path === "string" && !!path && path.length <= 2000 && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0") && !path.includes(":") && !path.split("/").some(p => p === ".." || ignored(p));
const text = (value: unknown, max = 500): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const entry = (value: unknown): value is string => text(value, 128) && !!value.trim() && !/[\r\n]/.test(value);
const portable = (path: string) => path.split(sep).join("/");
const identifier = (kind: string, path: string, name: string) => `program_${sha256(JSON.stringify([kind, path, name])).slice(0, 20)}`;

/** Read-only, bounded metadata discovery. Never imports code, installs packages or executes commands. */
export function discoverPrograms(projectRoot: string, options: ProgramScanOptions = {}): ProgramCatalog {
  const maxDepth = options.maxDepth ?? 4, maxFiles = options.maxFiles ?? 1000;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 8 || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10000) throw new Error("PROGRAM_SCAN_LIMIT_INVALID");
  const selected = resolve(projectRoot);
  if (!existsSync(selected) || lstatSync(selected).isSymbolicLink() || !lstatSync(selected).isDirectory()) throw new Error("PROGRAM_ROOT_INVALID");
  const root = realpathSync(selected), protectedPaths = (options.protectedPaths ?? []).map(p => resolve(p));
  const catalog: ProgramCatalog = { candidates: [], warnings: [], truncated: false };
  const safe = (path: string) => {
    const rel = relative(root, path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep) || rel.split(sep).some(ignored)) return false;
    if (protectedPaths.some(p => { const rel = relative(p, path); return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep)); })) return false;
    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      const st = lstatSync(current);
      if (st.isSymbolicLink() || (!st.isDirectory() && (!st.isFile() || st.nlink !== 1))) return false;
    }
    return true;
  };
  const warn = (path: string, code: string) => { if (catalog.warnings.length < 50) catalog.warnings.push({ path: portable(relative(root, path)) || ".", code }); };
  const add = (candidate: Omit<ProgramCandidate, "id">) => {
    if (catalog.candidates.length >= 500) { catalog.truncated = true; return; }
    catalog.candidates.push({ id: identifier(candidate.kind, candidate.path, candidate.entry ?? candidate.name), ...candidate });
  };
  function metadata(path: string) {
    if (!safe(path)) throw new Error("PROGRAM_PATH_UNSAFE");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > METADATA_BYTES) throw new Error("PROGRAM_METADATA_TOO_LARGE");
      const bytes = readFileSync(fd);
      if (bytes.length > METADATA_BYTES || bytes.includes(0)) throw new Error("PROGRAM_METADATA_INVALID");
      return bytes.toString("utf8");
    } finally { closeSync(fd); }
  }
  function nodeTarget(packagePath: string, target: unknown): string | undefined {
    if (!text(target, 2000) || !relativePath(target)) return undefined;
    const full = resolve(dirname(packagePath), target);
    if (!safe(full)) return undefined;
    const fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1) return undefined;
      const prefix = Buffer.alloc(256); const length = readSync(fd, prefix, 0, prefix.length, 0);
      const first = prefix.subarray(0, length).toString("utf8").split(/\r?\n/)[0] ?? "";
      if (!/\.(?:js|mjs|cjs)$/i.test(full) && !/^#!.*(?:\/|\s)node(?:\s|$)/.test(first)) return undefined;
      return portable(relative(root, full));
    } finally { closeSync(fd); }
  }
  function inspect(path: string) {
    const source = metadata(path), sourceDigest = sha256(source), relativeName = portable(relative(root, path));
    if (path.endsWith("pida.program.json")) {
      const manifest = validateProgramManifest(JSON.parse(source));
      add({ kind: "manifest", path: relativeName, name: manifest.name, description: manifest.description, sourceDigest, status: "ready", manifest });
      return;
    }
    if (path.endsWith("package.json")) {
      const pkg = JSON.parse(source);
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("PROGRAM_METADATA_INVALID");
      const name = entry(pkg.name) ? pkg.name : portable(relative(root, dirname(path))) || "project";
      if (pkg.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts)) for (const [script, command] of Object.entries(pkg.scripts)) {
        if (!entry(script) || !text(command, 16000) || !command.trim()) continue;
        add({ kind: "npm-script", path: relativeName, name: `${name}: ${script}`.slice(0, 100), description: `Existing npm script ${script}; runs package lifecycle commands with host privileges after approval.`, sourceDigest, status: "ready", entry: script });
      }
      const bins = typeof pkg.bin === "string" ? { [name.split("/").at(-1)!]: pkg.bin } : pkg.bin;
      if (bins && typeof bins === "object" && !Array.isArray(bins)) for (const [bin, target] of Object.entries(bins)) {
        if (!entry(bin)) continue;
        let ready: string | undefined;
        try { ready = nodeTarget(path, target); } catch { /* Missing or inaccessible bin remains a candidate requiring an adapter. */ }
        add({ kind: "node-bin", path: relativeName, name: bin.slice(0, 100), description: ready ? "Declared Node executable; fixed entrypoint, no inferred input protocol." : "Declared executable cannot be mapped to a safe existing Node entrypoint.", sourceDigest, status: ready ? "ready" : "adapter-required", entry: bin, ...(ready ? { target: ready } : {}) });
      }
      return;
    }
    // Conservative TOML subset: section names and single-line quoted entrypoints only.
    // Unsupported Poetry tables/dynamic metadata stay unclaimed rather than being executed to discover them.
    let section = "";
    for (const line of source.split(/\r?\n/)) {
      const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
      if (header) { section = header[1]!.trim(); continue; }
      if (!["project.scripts", "project.gui-scripts", "tool.poetry.scripts"].includes(section)) continue;
      const match = line.match(/^\s*(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z0-9_.-]+))\s*=\s*(?:"([^"\\\n]*)"|'([^'\n]*)')\s*(?:#.*)?$/);
      if (!match) { if (/^\s*[^#\s].*=/.test(line)) warn(path, "PYTHON_ENTRYPOINT_DECLARATION_UNSUPPORTED"); continue; }
      const command = match[1] ?? match[2] ?? match[3]!, target = match[4] ?? match[5]!;
      if (!entry(command) || !text(target, 500)) continue;
      add({ kind: "python-entrypoint", path: relativeName, name: command.slice(0, 100), description: "Declared Python entrypoint; select the host environment and define its input/output adapter before use.", sourceDigest, status: "adapter-required", entry: command });
    }
  }
  let visited = 0;
  function walk(path: string, depth: number) {
    const entries: Dirent[] = [];
    try {
      if (!safe(path)) return;
      const dir = opendirSync(path);
      try {
        // Do not materialize an unbounded directory before applying the traversal budget.
        while (entries.length <= maxFiles - visited) { const item = dir.readSync(); if (!item) break; entries.push(item); }
      } finally { dir.closeSync(); }
      entries.sort((a, b) => a.name.localeCompare(b.name));
    }
    catch { warn(path, "PROGRAM_DIRECTORY_UNREADABLE"); return; }
    for (const item of entries) {
      if (++visited > maxFiles) { catalog.truncated = true; return; }
      if (ignored(item.name) || item.isSymbolicLink()) continue;
      const child = join(path, item.name);
      if (item.isDirectory()) { if (depth < maxDepth) walk(child, depth + 1); else catalog.truncated = true; }
      else if (item.isFile() && ["package.json", "pyproject.toml", "pida.program.json"].includes(item.name)) {
        try { inspect(child); } catch { warn(child, item.name === "pida.program.json" ? "PROGRAM_MANIFEST_INVALID" : "PROGRAM_METADATA_INVALID"); }
      }
      if (visited > maxFiles) return;
    }
  }
  walk(root, 0); return catalog;
}

export interface ProgramDraftOptions {
  id?: string;
  /** Optional host-selected npm runner. No command is read from package script contents. */
  npmRunner?: { command: string; argsPrefix?: string[] };
}
/** Optional host-registered discovery tool; the model cannot select another root or activate a program. */
export function createProgramDiscoveryTool(projectRoot: string, options: ProgramScanOptions = {}): BusinessTool<any> {
  return {
    name: "programs_discover", permission: "project:read", effect: "read",
    description: "Discover existing declared programs in the host-selected repository without executing them. ready means a proxy draft can be generated, not tested or enabled. Only a host-approved registered program tool can run a program. Never install or grant permissions from repository metadata.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_args, context) {
      if (!context.principal.permissions.includes("project:read")) throw new PidaError("FORBIDDEN", 403);
      context.signal.throwIfAborted();
      const found = discoverPrograms(projectRoot, options);
      const result = {
        candidates: found.candidates.slice(0, 50).map(({ manifest: _manifest, ...summary }) => summary),
        warnings: found.warnings,
        candidateCount: found.candidates.length,
        truncated: found.truncated || found.candidates.length > 50,
      };
      // Runtime tool results have a 32 KiB ceiling. Schemas belong in the host review flow, not discovery output.
      while (Buffer.byteLength(JSON.stringify(result)) > 27000 && (result.candidates.length || result.warnings.length)) {
        result.truncated = true;
        if (result.warnings.length) result.warnings.pop(); else result.candidates.pop();
      }
      return result;
    },
  };
}
/** Produce a reviewable manifest only. No registration, permissions, installation or process launch occurs. */
export function createManifest(candidate: ProgramCandidate, options: ProgramDraftOptions = {}): ProgramManifest {
  if (!candidate || candidate.status !== "ready" || !relativePath(candidate.path) || !/^[a-f0-9]{64}$/.test(candidate.sourceDigest)) throw new Error("PROGRAM_ADAPTER_REQUIRED");
  if (candidate.kind === "manifest") return validateProgramManifest({ ...candidate.manifest, ...(options.id ? { id: options.id } : {}) });
  const common = { version: 1 as const, id: options.id ?? candidate.id, name: candidate.name, description: candidate.description, inputMode: "none" as const, outputMode: "text" as const, timeoutMs: 120000, effect: "write" as const, inputSchema: { type: "object", properties: {}, additionalProperties: false } };
  if (candidate.kind === "node-bin" && candidate.target && relativePath(candidate.target)) return validateProgramManifest({ ...common, command: "$node", args: [candidate.target], entrypoint: candidate.target });
  if (candidate.kind === "npm-script" && entry(candidate.entry)) {
    if (options.npmRunner && !isAbsolute(options.npmRunner.command)) throw new Error("PROGRAM_NPM_RUNNER_INVALID");
    const prefix = options.npmRunner?.argsPrefix ?? [];
    if (!Array.isArray(prefix) || prefix.some(p => !text(p, 2000))) throw new Error("PROGRAM_NPM_RUNNER_INVALID");
    const packageDir = portable(dirname(candidate.path));
    return validateProgramManifest({ ...common, command: options.npmRunner?.command ?? "$npm", args: [...prefix, "--prefix", packageDir, "run", candidate.entry] });
  }
  throw new Error("PROGRAM_ADAPTER_REQUIRED");
}
