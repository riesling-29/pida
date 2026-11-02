import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createModels, type AuthOperationOptions, type Credential, type CredentialStore, type OAuthCredential } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { PidaError, type PidaRuntime } from "./runtime.js";

const queues = new Map<string, Promise<unknown>>();
const scope = "chatgpt.tokens.use.direct";
function validCredential(value: unknown): asserts value is OAuthCredential {
  const c = value as OAuthCredential | undefined;
  if (!c || c.type !== "oauth" || ![c.access, c.refresh, c.clientId].every(x => typeof x === "string" && x.length > 0 && x.length < 65536) ||
      !Number.isFinite(c.expires) || !Array.isArray(c.scopes) || !c.scopes.includes(scope)) throw new PidaError("CHATGPT_CREDENTIAL_INVALID", 400);
}
/** Workspace-local, single-process store. Pi owns refresh; this store serializes rotation and logout. */
export class ChatGPTCredentialStore implements CredentialStore {
  readonly directory: string;
  private root: string;
  constructor(workspace: string, stateDir: string) {
    this.root = resolve(workspace); this.directory = resolve(this.root, stateDir, "provider-chatgpt");
    const child = relative(this.root, this.directory);
    if (!child || child === ".." || child.startsWith(".." + sep) || isAbsolute(child)) throw new PidaError("CHATGPT_STORAGE_FAILED", 500);
  }
  private ensure() {
    let path = this.root;
    for (const part of relative(this.root, this.directory).split(sep)) {
      path = join(path, part);
      if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe credential directory");
    }
  }
  private file(name: string) {
    this.ensure(); const path = join(this.directory, name);
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 131072) throw new Error("Unsafe credential file");
      if (process.platform !== "win32") chmodSync(path, 0o600);
    }
    return path;
  }
  private write(name: string, value: unknown) {
    const file = this.file(name), temp = `${file}.${randomUUID()}.tmp`;
    const content = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(content) > 131072) throw new Error("Credential file too large");
    try { writeFileSync(temp, content, { mode: 0o600, flag: "wx" }); renameSync(temp, file); }
    finally { rmSync(temp, { force: true }); }
  }
  snapshot(): OAuthCredential | undefined {
    try {
      const file = this.file("credential.json"); if (!existsSync(file)) return;
      const value: unknown = JSON.parse(readFileSync(file, "utf8")); validCredential(value); return value;
    } catch { throw new PidaError("CHATGPT_STORAGE_FAILED", 500); }
  }
  status() {
    try { return { connected: !!this.snapshot() }; }
    catch { return { connected: false, code: "CHATGPT_STORAGE_FAILED" }; }
  }
  deviceId(): string {
    try {
      const file = this.file("host.json");
      if (existsSync(file)) {
        const id = JSON.parse(readFileSync(file, "utf8")).id;
        if (typeof id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new Error();
        return id;
      }
      const id = randomUUID(); this.write("host.json", { id }); return id;
    } catch { throw new PidaError("CHATGPT_STORAGE_FAILED", 500); }
  }
  private async locked<T>(fn: () => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    const previous = queues.get(this.directory) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => { options?.signal?.throwIfAborted(); return fn(); });
    queues.set(this.directory, next);
    try { return await next; } finally { if (queues.get(this.directory) === next) queues.delete(this.directory); }
  }
  async read(providerId: string, options?: AuthOperationOptions) { options?.signal?.throwIfAborted(); return providerId === "openai" ? this.snapshot() : undefined; }
  async list(options?: AuthOperationOptions) { return await this.read("openai", options) ? [{ providerId: "openai", type: "oauth" as const }] : []; }
  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions, beforeWrite?: () => void) {
    if (providerId !== "openai") throw new PidaError("CHATGPT_CREDENTIAL_INVALID", 400);
    return this.locked(async () => {
      const old = this.snapshot(), next = await fn(old);
      options?.signal?.throwIfAborted();
      if (next === undefined) return old;
      validCredential(next);
      beforeWrite?.(); // Check after asynchronous work, immediately before the synchronous commit.
      try { this.write("credential.json", next); } catch { throw new PidaError("CHATGPT_STORAGE_FAILED", 500); }
      return next;
    }, options);
  }
  async delete(providerId: string, options?: AuthOperationOptions) {
    if (providerId !== "openai") return;
    await this.disconnect(() => {}, options);
  }
  async disconnect(guard: () => void, options?: AuthOperationOptions) {
    await this.locked(async () => { guard(); try { rmSync(this.file("credential.json"), { force: true }); } catch { throw new PidaError("CHATGPT_STORAGE_FAILED", 500); } }, options);
  }
}

export interface ChatGPTLoginStatus {
  id: string;
  status: "pending" | "connected" | "failed" | "cancelled";
  expiresAt: number;
  authUrl?: string;
  manualInput?: boolean;
  code?: string;
}
interface Login extends ChatGPTLoginStatus { owner: string; abort: AbortController; done: Promise<void>; input?: (value: string) => void }
/** Pida owns UI orchestration; PKCE, callback/state checks and token exchange stay upstream. */
export class ChatGPTAuth {
  readonly store: ChatGPTCredentialStore;
  private login?: Login;
  constructor(directory: string, stateDir: string, private runtime: PidaRuntime) { this.store = new ChatGPTCredentialStore(directory, stateDir); }
  active() { return this.login?.status === "pending"; }
  start(owner: string): ChatGPTLoginStatus {
    this.runtime.assertIdle();
    if (this.active()) throw new PidaError("SETUP_BUSY", 409);
    const login: Login = { id: randomUUID(), owner, status: "pending", expiresAt: Date.now() + 600_000, abort: new AbortController(), done: Promise.resolve() };
    this.login = login;
    const timer = setTimeout(() => { login.code = "CHATGPT_LOGIN_TIMEOUT"; login.abort.abort(); }, 600_000); timer.unref();
    login.done = (async () => {
      try {
        const credential = await openaiProvider().auth.oauth!.login({
          signal: login.abort.signal,
          notify: event => {
            if (event.type === "auth_url") {
              const url = new URL(event.url);
              if (url.origin !== "https://auth.openai.com" || url.username || url.password) throw new Error("Unexpected authorization origin");
              login.authUrl = url.href;
            }
          },
          prompt: prompt => new Promise((resolveInput, reject) => {
            if (prompt.type !== "manual_code") { reject(new Error("Unsupported login interaction")); return; }
            const signal = prompt.signal ? AbortSignal.any([login.abort.signal, prompt.signal]) : login.abort.signal;
            const abort = () => { login.input = undefined; login.manualInput = false; reject(new Error("Login cancelled")); };
            if (signal.aborted) { abort(); return; }
            login.manualInput = true;
            login.input = value => { signal.removeEventListener("abort", abort); login.input = undefined; login.manualInput = false; resolveInput(value); };
            signal.addEventListener("abort", abort, { once: true });
          }),
        }, { agentName: "pida-core", getDeviceId: () => this.store.deviceId() });
        login.abort.signal.throwIfAborted();
        await this.store.modify("openai", async () => credential, { signal: login.abort.signal }, () => this.runtime.assertIdle());
        login.status = "connected";
      } catch (error) {
        login.status = login.abort.signal.aborted ? "cancelled" : "failed";
        login.code ??= error instanceof PidaError ? error.code : login.abort.signal.aborted ? "CHATGPT_LOGIN_CANCELLED" :
          error instanceof Error && error.message.includes("Port 1455 is in use") ? "CHATGPT_LOGIN_PORT_BUSY" :
          error instanceof Error && error.message.includes(scope) ? "CHATGPT_PLAN_NOT_AUTHORIZED" : "CHATGPT_LOGIN_FAILED";
      } finally { clearTimeout(timer); delete login.authUrl; delete login.input; login.manualInput = false; }
    })();
    return this.get(login.id, owner);
  }
  private owned(id: string, owner: string) {
    if (!this.login || this.login.id !== id || this.login.owner !== owner) throw new PidaError("CHATGPT_LOGIN_NOT_FOUND", 404);
    return this.login;
  }
  get(id: string, owner: string): ChatGPTLoginStatus {
    const { status, expiresAt, authUrl, manualInput, code } = this.owned(id, owner);
    return { id, status, expiresAt, ...(authUrl ? { authUrl } : {}), manualInput, ...(code ? { code } : {}) };
  }
  input(id: string, owner: string, value: string) {
    const login = this.owned(id, owner);
    if (login.status !== "pending" || !login.input) throw new PidaError("CHATGPT_LOGIN_NOT_WAITING", 409);
    if (!value || value.length > 8192) throw new PidaError("INVALID_BODY", 400);
    login.input(value); return this.get(id, owner);
  }
  async cancel(id: string, owner: string) { const login = this.owned(id, owner); if (login.status === "pending") login.abort.abort(); await login.done; return this.get(id, owner); }
  async close() { if (this.login?.status === "pending") { this.login.abort.abort(); await this.login.done; } }
  async logout() {
    this.runtime.assertIdle(); if (this.active()) throw new PidaError("SETUP_BUSY", 409);
    await this.store.disconnect(() => this.runtime.assertIdle());
    return { connected: false };
  }
  async models() {
    const provider = openaiProvider(), models = createModels({ credentials: this.store });
    models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
    try {
      const auth = await models.getAuth("openai", { signal: AbortSignal.timeout(15_000) });
      if (!auth?.auth.apiKey) throw new PidaError("CHATGPT_LOGIN_REQUIRED", 400);
      const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${auth.auth.apiKey}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new PidaError(response.status === 401 || response.status === 403 ? "CHATGPT_AUTH_FAILED" : "MODEL_LIST_UNAVAILABLE", 400);
      if (!response.body) throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1_048_576) throw new Error(); chunks.push(chunk.value); } }
      finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8")), known = new Set(provider.getModels().map(m => m.id));
      if (!Array.isArray(data.models)) throw new Error();
      const available = data.models.filter((m: any) => m?.visibility === "list" && typeof m.slug === "string" && known.has(m.slug));
      return { models: [...new Set<string>(available.map((m: any) => m.slug))].slice(0, 200), source: "chatgpt-account-and-pi-catalog" };
    } catch (error) { if (error instanceof PidaError) throw error; throw new PidaError("CHATGPT_CONNECTION_FAILED", 400); }
  }
}
