import { constants, existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { PidaError, type Principal } from "./runtime.js";
import type { ProjectConfig } from "./project-tools.js";

const READ_BYTES = 262144, DIFF_BYTES = 262144, MAX_ENTRIES = 1000, MAX_CHANGED = 500;
const blocked = (part: string) => [".git", ".pida"].includes(part.toLowerCase()) || /^\.env(?:$|\.)/i.test(part);
const skipped = (part: string) => blocked(part) || ["node_modules", "vendor", "dist", "build", ".next", ".venv"].includes(part);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const denied = () => new PidaError("PROJECT_PATH_DENIED", 403);
const posix = (path: string) => path.split(sep).join("/");

export interface ProjectEntry { path: string; type: "file" | "directory"; bytes?: number }
export interface ProjectChanges {
  available: boolean; files: string[]; untracked: string[]; diff: string; truncated: boolean; revision: string;
  scope: "git-staged-and-working-tree"; revisionScope: "displayed-diff";
}

/** Read-only host project view. File policy mirrors the registered project tools.
 * Git is invoked directly, never through a shell, using sanitized temporary metadata.
 * This is a bounded live view, not an atomic snapshot or rollback/verification record. */
export class ProjectView {
  private readonly root: string;
  private readonly protectedPaths: string[];
  constructor(config: ProjectConfig, options: { protectedPaths?: string[] } = {}) {
    if (!config.enabled || !isAbsolute(config.root) || !existsSync(config.root) || lstatSync(config.root).isSymbolicLink() || !statSync(config.root).isDirectory())
      throw new PidaError("PROJECT_ROOT_INVALID", 400);
    this.root = realpathSync(config.root);
    this.protectedPaths = (options.protectedPaths ?? []).flatMap(path => {
      const absolute = resolve(path);
      return existsSync(absolute) ? [absolute, realpathSync(absolute)] : [absolute];
    });
  }
  private authorize(principal: Principal) {
    if (!principal.permissions.includes("project:read")) throw new PidaError("FORBIDDEN", 403);
  }
  private safe(path: string, allowRoot = false) {
    if (typeof path !== "string" || !path || path.length > 2000 || path.includes("\0") || path.includes(":")) throw denied();
    const full = resolve(this.root, path), rel = relative(this.root, full);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep) || (!rel && !allowRoot) || rel.split(sep).some(blocked)) throw denied();
    if (this.protectedPaths.some(path => { const r = relative(path, full); return !r || (!isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep)); })) throw denied();
    if (realpathSync(this.root) !== this.root || lstatSync(this.root).isSymbolicLink()) throw denied();
    let current = this.root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        const s = lstatSync(current);
        if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw denied();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return full;
  }
  async list(principal: Principal, path = ".") {
    this.authorize(principal);
    const full = this.safe(path, true);
    let entries;
    try {
      if (!lstatSync(full).isDirectory()) throw new PidaError("PROJECT_NOT_DIRECTORY", 400);
      entries = readdirSync(full, { withFileTypes: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PidaError("PROJECT_FILE_NOT_FOUND", 404); throw error; }
    const files: ProjectEntry[] = [];
    let truncated = entries.length > 10000;
    for (const entry of entries.slice(0, 10000)) {
      if (skipped(entry.name) || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      const name = relative(this.root, join(full, entry.name));
      try {
        const info = lstatSync(this.safe(name, true));
        if (files.length === MAX_ENTRIES) { truncated = true; break; }
        files.push({ path: posix(name), type: info.isDirectory() ? "directory" : "file", ...(info.isFile() ? { bytes: info.size } : {}) });
      } catch { /* Private, unsafe or concurrently removed entries are not exposed. */ }
    }
    files.sort((a, b) => a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1);
    return { name: basename(this.root), path: posix(relative(this.root, full)) || ".", files, truncated };
  }
  async read(principal: Principal, path: string) {
    this.authorize(principal);
    const full = this.safe(path);
    let file;
    try { file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PidaError("PROJECT_FILE_NOT_FOUND", 404); throw error; }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > READ_BYTES) throw new PidaError("PROJECT_FILE_UNSAFE_OR_TOO_LARGE", 413);
      // Read one extra byte so a growing file cannot evade the response bound.
      const buffer = Buffer.alloc(READ_BYTES + 1), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > READ_BYTES) throw new PidaError("PROJECT_FILE_UNSAFE_OR_TOO_LARGE", 413);
      const data = buffer.subarray(0, bytesRead);
      if (data.includes(0)) throw new PidaError("PROJECT_BINARY_UNSUPPORTED", 415);
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); }
      catch { throw new PidaError("PROJECT_BINARY_UNSUPPORTED", 415); }
      return { path: posix(relative(this.root, full)), content, bytes: bytesRead, revision: digest(data), truncated: false };
    } finally { await file.close(); }
  }
  private async metadata(path: string, maxBytes: number) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > maxBytes) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buffer = Buffer.alloc(maxBytes + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }
  private async gitDirectory() {
    const marker = join(this.root, ".git");
    if (!existsSync(marker)) return undefined;
    const stat = lstatSync(marker);
    if (stat.isSymbolicLink()) throw denied();
    let directory = marker;
    if (!stat.isDirectory()) {
      const match = (await this.metadata(marker, 4096)).toString("utf8").trim().match(/^gitdir: ([^\r\n\0]+)$/);
      if (!match) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
      directory = resolve(this.root, match[1]!);
    }
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw denied();
    let common = directory;
    if (existsSync(join(directory, "commondir"))) {
      const value = (await this.metadata(join(directory, "commondir"), 4096)).toString("utf8").trim();
      if (!value || /[\r\n\0]/.test(value)) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
      common = resolve(directory, value);
    }
    if (!lstatSync(common).isDirectory() || lstatSync(common).isSymbolicLink()) throw denied();
    return { directory, common };
  }
  private async head(directory: string, common: string) {
    let value = (await this.metadata(join(directory, "HEAD"), 1024)).toString("utf8").trim();
    for (let depth = 0; depth < 5; depth++) {
      if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) return value;
      if (!value.startsWith("ref: ")) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
      const ref = value.slice(5);
      if (!/^refs\/[^\\:\0\r\n]+$/.test(ref) || ref.split("/").some(part => !part || part === "." || part === "..")) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
      const loose = [join(directory, ref), join(common, ref)].find(path => existsSync(path));
      if (loose) { value = (await this.metadata(loose, 1024)).toString("utf8").trim(); continue; }
      if (existsSync(join(common, "packed-refs"))) {
        const packed = (await this.metadata(join(common, "packed-refs"), 8 * 1024 * 1024)).toString("utf8");
        const line = packed.split("\n").find(line => line.endsWith(" " + ref));
        if (line) { value = line.split(" ")[0]!; continue; }
      }
      return undefined; // Unborn branch: staged diff is against the empty tree.
    }
    throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
  }
  async changes(principal: Principal): Promise<ProjectChanges> {
    this.authorize(principal); this.safe(".", true);
    const repo = await this.gitDirectory();
    const empty = { available: !!repo, files: [] as string[], untracked: [] as string[], diff: "", truncated: false, revision: digest(""), scope: "git-staged-and-working-tree" as const, revisionScope: "displayed-diff" as const };
    if (!repo) return empty;
    const temporary = await mkdtemp(join(tmpdir(), "pida-project-view-"));
    try {
      await mkdir(join(temporary, "refs")); await mkdir(join(temporary, "objects"));
      const head = await this.head(repo.directory, repo.common);
      await writeFile(join(temporary, "HEAD"), head ? head + "\n" : "ref: refs/heads/pida-unborn\n");
      // Repository config is intentionally NOT read. Disabling external diff/textconv alone
      // does not disable clean/process filters or fsmonitor from an untrusted .git/config.
      await writeFile(join(temporary, "config"), `[core]\nrepositoryformatversion = ${head?.length === 64 ? 1 : 0}\nbare = false\nfsmonitor = false\n${head?.length === 64 ? "[extensions]\nobjectformat = sha256\n" : ""}`);
      let metadataBytes = 0;
      for (const name of ["index", ...readdirSync(repo.directory).filter(name => /^sharedindex\.[a-f0-9]{40,64}$/.test(name))]) {
        const file = join(repo.directory, name); if (!existsSync(file)) continue;
        const data = await this.metadata(file, 8 * 1024 * 1024); metadataBytes += data.length;
        if (metadataBytes > 16 * 1024 * 1024) throw new PidaError("PROJECT_GIT_UNAVAILABLE", 409);
        await writeFile(join(temporary, name), data);
      }
      const objects = join(repo.common, "objects");
      if (!lstatSync(objects).isDirectory() || lstatSync(objects).isSymbolicLink()) throw denied();
      const env: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(process.env)) if (["path", "systemroot", "windir", "temp", "tmp", "tmpdir", "lang"].includes(key.toLowerCase())) env[key] = value;
      Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_OBJECT_DIRECTORY: objects });
      const signal = AbortSignal.timeout(10000);
      const git = (args: string[], maxBytes = DIFF_BYTES) => new Promise<{ text: string; truncated: boolean }>((accept, reject) => {
        execFile("git", ["--no-pager", "--literal-pathspecs", `--git-dir=${temporary}`, `--work-tree=${this.root}`, "-c", "core.fsmonitor=false", "-c", "core.attributesFile=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
          { cwd: this.root, env, signal, encoding: "utf8", maxBuffer: maxBytes, windowsHide: true }, (error, stdout) => {
            if (error && (error as NodeJS.ErrnoException).code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") reject(new PidaError(signal.aborted ? "PROJECT_GIT_TIMEOUT" : "PROJECT_GIT_UNAVAILABLE", 409));
            else accept({ text: Buffer.from(stdout).subarray(0, maxBytes).toString("utf8"), truncated: !!error });
          });
      });
      const diffFlags = ["--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=all", "--no-color"];
      const [stagedNames, workingNames, untrackedNames] = await Promise.all([
        git(["diff", "--cached", ...diffFlags, "--name-only", "-z"]),
        git(["diff", ...diffFlags, "--name-only", "-z"]),
        git(["ls-files", "--others", "--exclude-standard", "-z"]),
      ]);
      let truncated = [stagedNames, workingNames, untrackedNames].some(r => r.truncated);
      const allowed = (result: { text: string; truncated: boolean }) => result.text.slice(0, result.text.lastIndexOf("\0") + 1).split("\0").filter(path => {
        if (!path || path.split("/").some(skipped)) return false;
        try { this.safe(path); return true; } catch { return false; }
      });
      const staged = allowed(stagedNames), working = allowed(workingNames), untracked = allowed(untrackedNames);
      const all = [...new Set([...staged, ...working, ...untracked])].sort();
      if (all.length > MAX_CHANGED) truncated = true;
      const files = all.slice(0, MAX_CHANGED), selected = new Set(files);
      let diff = "";
      for (const [heading, names, flags] of [["Staged changes", staged, ["--cached"]], ["Working tree changes", working, []]] as const) {
        const paths = names.filter(path => selected.has(path));
        for (let offset = 0; offset < paths.length; offset += 50) {
          if (Buffer.byteLength(diff) >= DIFF_BYTES) { truncated = true; break; }
          const remaining = DIFF_BYTES - Buffer.byteLength(diff), prefix = `\n--- ${heading} ---\n`;
          if (remaining < Buffer.byteLength(prefix) + 100) { truncated = true; break; }
          const result = await git(["diff", ...flags, ...diffFlags, "--src-prefix=a/", "--dst-prefix=b/", "--", ...paths.slice(offset, offset + 50)], remaining - Buffer.byteLength(prefix));
          diff += prefix + result.text; truncated ||= result.truncated;
        }
      }
      const visibleUntracked = untracked.filter(path => selected.has(path));
      return { ...empty, files, untracked: visibleUntracked, diff, truncated, revision: digest(JSON.stringify({ files, untracked: visibleUntracked, diff })) };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
