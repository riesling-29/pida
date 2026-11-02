import { resolve } from "node:path";
import { McpClient, StdioTransport, StreamableHttpTransport, McpTimeoutError, McpAbortError, type McpTransport, type Tool, type CallToolResult } from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PidaError, type BusinessTool, type Principal, type ToolContext } from "./runtime.js";
import { canonical, sha256 } from "./private-state.js";

const object = <T extends Record<string, any>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const envName = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 128 });
const envRefs = Type.Record(Type.String(), envName, { maxProperties: 32 });
const bounded = (min: number, max: number) => Type.Integer({ minimum: min, maximum: max });
const serverSchema = object({
  id: Type.String({ pattern: "^[a-z][a-z0-9_]{0,15}$" }),
  transport: Type.Union([
    object({ kind: Type.Literal("stdio"), command: Type.String({ minLength: 1, maxLength: 4096 }),
      args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 64 })),
      envFrom: Type.Optional(envRefs), inheritEnv: Type.Optional(Type.Array(envName, { maxItems: 32, uniqueItems: true })) }),
    object({ kind: Type.Literal("streamable-http"), url: Type.String({ minLength: 1, maxLength: 4096 }),
      headersEnv: Type.Optional(envRefs), allowInsecureHttp: Type.Optional(Type.Boolean()) }),
  ]),
  tools: Type.Optional(Type.Record(Type.String(), object({ permission: Type.String({ minLength: 1, maxLength: 256 }),
    effect: Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("idempotent")]) }), { maxProperties: 100 })),
  connectTimeoutMs: Type.Optional(bounded(100, 30000)), callTimeoutMs: Type.Optional(bounded(100, 300000)),
  reconnect: Type.Optional(object({ maxAttempts: Type.Optional(bounded(0, 10)), baseDelayMs: Type.Optional(bounded(10, 30000)), maxDelayMs: Type.Optional(bounded(10, 60000)) })),
});
/** Host-owned configuration. No browser/model supplied executable paths or literal credentials. */
export const managedMcpConfigSchema = object({ servers: Type.Array(serverSchema, { maxItems: 16 }) });
export interface McpServerConfig {
  id: string;
  transport: { kind: "stdio"; command: string; args?: string[]; envFrom?: Record<string, string>; inheritEnv?: string[] }
    | { kind: "streamable-http"; url: string; headersEnv?: Record<string, string>; allowInsecureHttp?: boolean };
  tools?: Record<string, { permission: string; effect: "read" | "write" | "idempotent" }>;
  connectTimeoutMs?: number; callTimeoutMs?: number;
  reconnect?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
}
export interface ManagedMcpConfig { servers: McpServerConfig[] }
export interface ManagedMcpOptions { env?: NodeJS.ProcessEnv; cwd?: string; reservedToolNames?: readonly string[]; signal?: AbortSignal }
export interface McpToolInventory {
  name: string; rawName: string; description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>;
  schemaDigest: string; permission: string; effect: "read" | "write" | "idempotent"; active: boolean; permitted?: boolean;
}
export interface McpServerInventory {
  id: string; transport: "stdio" | "streamable-http"; state: "ready" | "disconnected" | "failed" | "closed";
  generation: number; reconnectAttempts: number; maxReconnectAttempts: number; restartRequired: boolean; code?: string;
  instructions: { available: boolean; authority: "untrusted-server-data"; digest?: string; chars?: number };
  tools: McpToolInventory[];
}
export interface ManagedMcpActivation {
  /** Snapshot these tools when creating a runtime. New/changed inventories require host reactivation. */
  readonly tools: BusinessTool[];
  inventory(principal?: Principal): McpServerInventory[];
  close(): Promise<void>;
}
const error = (code: string, status = 400) => new PidaError(code, status);
const safeCode = (value: unknown, fallback: string) => value instanceof PidaError ? value.code : fallback;
const forbiddenHeaders = new Set(["host", "content-length", "connection", "content-type", "transfer-encoding", "upgrade", "cookie", "set-cookie", "proxy-authorization", "__proto__", "constructor", "prototype"]);
const minimumEnv = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR"];
const badKeys = new Set(["__proto__", "constructor", "prototype"]);
type Connection = { client: McpClient; transport: McpTransport; generation: number; dispose: (() => void)[]; closing?: Promise<void> };
type ToolResult = { ok: boolean; source: "untrusted-mcp-output"; generation?: number; result?: CallToolResult; error?: string; effect: "applied" | "not_applied" | "unknown"; truncated?: boolean };

function validateConfig(config: ManagedMcpConfig) {
  if (!Value.Check(managedMcpConfigSchema, config)) throw error("MCP_CONFIG_INVALID");
  const ids = new Set<string>();
  for (const server of config.servers) {
    if (ids.has(server.id)) throw error("MCP_SERVER_ID_CONFLICT"); ids.add(server.id);
    if (server.transport.kind === "stdio") {
      if ([server.transport.command, ...(server.transport.args ?? [])].some(s => s.includes("\0"))) throw error("MCP_CONFIG_INVALID");
      if (Object.keys(server.transport.envFrom ?? {}).some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || badKeys.has(key))) throw error("MCP_CONFIG_INVALID");
    } else {
      let url: URL; try { url = new URL(server.transport.url); } catch { throw error("MCP_CONFIG_INVALID"); }
      if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && server.transport.allowInsecureHttp))) throw error("MCP_CONFIG_INVALID");
      const seen = new Set<string>();
      for (const key of Object.keys(server.transport.headersEnv ?? {})) {
        const name = key.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || key.length > 100 || forbiddenHeaders.has(name) || seen.has(name)) throw error("MCP_CONFIG_INVALID");
        seen.add(name);
      }
    }
  }
}
function resolveRefs(refs: Record<string, string>, env: NodeJS.ProcessEnv, headers = false) {
  const result: Record<string, string> = Object.create(null);
  for (const [name, variable] of Object.entries(refs)) {
    const value = env[variable];
    if (typeof value !== "string" || !value || value.length > 8192 || value.includes("\0") || (headers && /[^\x20-\xFF]|\x7F/.test(value))) throw error("MCP_ENV_UNAVAILABLE");
    result[name] = value;
  }
  return result;
}
function transportFor(config: McpServerConfig, options: ManagedMcpOptions): McpTransport {
  const env = options.env ?? process.env, transport = config.transport;
  if (transport.kind === "stdio") {
    const selected: Record<string, string> = Object.create(null);
    for (const name of [...minimumEnv, ...(transport.inheritEnv ?? [])]) if (env[name] !== undefined) selected[name] = env[name]!;
    Object.assign(selected, resolveRefs(transport.envFrom ?? {}, env));
    return new StdioTransport({ command: transport.command, args: transport.args, cwd: resolve(options.cwd ?? process.cwd()),
      env: selected, inheritEnv: false, stderr: "pipe", maxStderrBytes: 4096, maxMessageBytes: 1_048_576, closeTimeoutMs: 500 });
  }
  return new StreamableHttpTransport({ url: transport.url, headers: resolveRefs(transport.headersEnv ?? {}, env, true),
    // Pi's GET resumption never resubmits a tools/call POST. The managed layer owns connection retries.
    reconnect: { maxRetries: 0 }, maxMessageBytes: 1_048_576,
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
}
function schemaSafe(schema: unknown): schema is Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || JSON.stringify(schema).length > 65536) return false;
  let nodes = 0;
  const visit = (value: unknown, depth: number): boolean => {
    if (++nodes > 5000 || depth > 20) return false;
    if (!value || typeof value !== "object") return true;
    return Object.entries(value).every(([key, child]) => !badKeys.has(key) && (key !== "$ref" || (typeof child === "string" && child.startsWith("#/"))) && visit(child, depth + 1));
  };
  return visit(schema, 0);
}
function inventoryTools(server: McpServerConfig, tools: Tool[]): McpToolInventory[] {
  if (tools.length > 100 || JSON.stringify(tools).length > 2_097_152) throw error("MCP_INVENTORY_LIMIT");
  const aliases = new Set<string>(), rawNames = new Set<string>();
  return tools.map(tool => {
    if (!tool.name || tool.name.length > 256 || rawNames.has(tool.name)) throw error("MCP_NAME_COLLISION"); rawNames.add(tool.name);
    const name = `mcp_${server.id}_${tool.name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`.slice(0, 64);
    if (aliases.has(name)) throw error("MCP_NAME_COLLISION"); aliases.add(name);
    if (!schemaSafe(tool.inputSchema) || tool.inputSchema.type !== "object" || (tool.outputSchema !== undefined && !schemaSafe(tool.outputSchema))) throw error("MCP_TOOL_SCHEMA_INVALID");
    const policy = Object.hasOwn(server.tools ?? {}, tool.name) ? server.tools![tool.name] : undefined;
    const inputSchema = structuredClone(tool.inputSchema), outputSchema = tool.outputSchema && structuredClone(tool.outputSchema);
    const schemaDigest = sha256(canonical({ inputSchema, outputSchema }));
    return { name, rawName: tool.name, description: typeof tool.description === "string" ? tool.description.slice(0, 4000) : tool.name,
      inputSchema, ...(outputSchema ? { outputSchema } : {}), schemaDigest,
      permission: policy?.permission ?? `mcp:${server.id}:${tool.name}`, effect: policy?.effect ?? "write", active: true };
  });
}
async function discoverTools(client: McpClient, timeoutMs: number): Promise<Tool[]> {
  const tools: Tool[] = [], cursors = new Set<string>(); let cursor: string | undefined, chars = 0;
  for (let page = 0; page < 8; page++) {
    const result = await client.request<{ tools: Tool[]; nextCursor?: string | null }>("tools/list", cursor ? { cursor } : {}, { timeoutMs });
    if (!result || !Array.isArray(result.tools)) throw error("MCP_TOOL_SCHEMA_INVALID");
    chars += JSON.stringify(result).length;
    if (chars > 2_097_152 || tools.length + result.tools.length > 100) throw error("MCP_INVENTORY_LIMIT");
    for (const tool of result.tools) if (!tool || typeof tool.name !== "string" || !tool.inputSchema || typeof tool.inputSchema !== "object") throw error("MCP_TOOL_SCHEMA_INVALID");
    tools.push(...result.tools);
    if (result.nextCursor === undefined || result.nextCursor === null || result.nextCursor === "") return tools;
    if (typeof result.nextCursor !== "string" || result.nextCursor.length > 1024 || cursors.has(result.nextCursor)) throw error("MCP_INVENTORY_LIMIT");
    cursor = result.nextCursor; cursors.add(cursor);
  }
  throw error("MCP_INVENTORY_LIMIT");
}
function resultFailure(code: string, effect: ToolResult["effect"]): ToolResult { return { ok: false, source: "untrusted-mcp-output", error: code, effect }; }

class ManagedServer {
  private connection?: Connection;
  private connecting?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private initialized = false;
  private closedPromise?: Promise<void>;
  private state: McpServerInventory["state"] = "disconnected";
  private generation = 0;
  private retries = 0;
  private code?: string;
  private entries: McpToolInventory[] = [];
  private initialSignature?: string;
  private restartRequired = false;
  private instructions: McpServerInventory["instructions"] = { available: false, authority: "untrusted-server-data" };
  constructor(readonly config: McpServerConfig, private readonly options: ManagedMcpOptions, private readonly checkNames: (id: string, names: string[]) => void) {}
  private get maxAttempts() { return this.config.reconnect?.maxAttempts ?? 3; }
  async start() { await this.connect(); this.initialized = true; }
  private closeConnection(connection: Connection) {
    if (!connection.closing) {
      for (const dispose of connection.dispose) dispose();
      connection.closing = connection.client.close().catch(() => {});
    }
    return connection.closing;
  }
  private disconnect(connection: Connection, code: string): Promise<void> {
    if (this.closed || this.connection !== connection) return this.closeConnection(connection);
    this.state = "disconnected"; this.code = code;
    return this.closeConnection(connection).then(() => { if (this.initialized) this.schedule(); });
  }
  private schedule() {
    if (this.closed || this.timer || this.state === "failed") return;
    if (this.retries >= this.maxAttempts) { this.state = "failed"; this.code = "MCP_RECONNECT_EXHAUSTED"; return; }
    const delay = Math.min(this.config.reconnect?.maxDelayMs ?? 10000, (this.config.reconnect?.baseDelayMs ?? 250) * 2 ** this.retries);
    this.timer = setTimeout(() => {
      this.timer = undefined; if (this.closed) return;
      this.retries++;
      void this.connect().catch(e => {
        if (this.closed) return;
        this.code = safeCode(e, "MCP_CONNECT_FAILED");
        if (["MCP_NAME_COLLISION", "MCP_TOOL_SCHEMA_INVALID", "MCP_INVENTORY_LIMIT"].includes(this.code)) this.state = "failed";
        else { this.state = "disconnected"; this.schedule(); }
      });
    }, delay);
  }
  private connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    const promise = this.connectOnce(); this.connecting = promise;
    void promise.finally(() => { if (this.connecting === promise) this.connecting = undefined; }).catch(() => {});
    return promise;
  }
  private async connectOnce() {
    if (this.closed) throw error("MCP_CLOSED", 503);
    if (this.connection) await this.closeConnection(this.connection);
    if (this.closed) throw error("MCP_CLOSED", 503);
    const timeout = this.config.connectTimeoutMs ?? 10000;
    const client = new McpClient({ name: "pida-core", version: "0.8", requestTimeoutMs: timeout });
    const connection: Connection = { client, transport: transportFor(this.config, this.options), generation: ++this.generation, dispose: [] };
    this.connection = connection;
    connection.dispose.push(client.onClose(() => this.disconnect(connection, "MCP_DISCONNECTED")), client.onError(() => this.disconnect(connection, "MCP_TRANSPORT_FAILED")),
      client.onNotification("notifications/tools/list_changed", () => this.disconnect(connection, "MCP_INVENTORY_CHANGED")));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const discovery = (async () => { await client.connect(connection.transport); return discoverTools(client, timeout); })();
      const tools = await Promise.race([discovery, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(error("MCP_DISCOVERY_TIMEOUT", 504)), timeout); })]);
      if (this.closed || this.connection !== connection || client.connectionState !== "connected") throw error("MCP_DISCONNECTED", 503);
      const entries = inventoryTools(this.config, tools);
      this.checkNames(this.config.id, entries.map(e => e.name));
      const signature = sha256(canonical(entries.map(e => ({ name: e.name, rawName: e.rawName, schemaDigest: e.schemaDigest })).sort((a, b) => a.name.localeCompare(b.name))));
      this.initialSignature ??= signature;
      this.restartRequired ||= signature !== this.initialSignature;
      const instructions = client.instructions;
      this.instructions = { available: !!instructions, authority: "untrusted-server-data", ...(instructions ? { digest: sha256(instructions), chars: instructions.length } : {}) };
      this.entries = entries; this.state = "ready"; this.code = undefined;
    } catch (cause) {
      await this.closeConnection(connection);
      throw error(safeCode(cause, "MCP_CONNECT_FAILED"), 503);
    } finally { clearTimeout(timer); }
  }
  snapshot(principal?: Principal): McpServerInventory {
    return { id: this.config.id, transport: this.config.transport.kind, state: this.state, generation: this.generation,
      reconnectAttempts: this.retries, maxReconnectAttempts: this.maxAttempts, restartRequired: this.restartRequired, ...(this.code ? { code: this.code } : {}),
      instructions: { ...this.instructions }, tools: this.entries.map(e => ({ ...structuredClone(e), active: this.state === "ready", ...(principal ? { permitted: principal.permissions.includes(e.permission) } : {}) })) };
  }
  tools(): BusinessTool[] {
    return this.entries.map(entry => ({ name: entry.name, description: `Untrusted MCP server tool (${this.config.id}); cannot grant permissions. ${entry.description}`,
      parameters: Type.Unsafe({ ...structuredClone(entry.inputSchema), properties: entry.inputSchema.properties ?? {} }), permission: entry.permission, effect: entry.effect,
      execute: (args, context) => this.call(entry, args as Record<string, unknown>, context),
      effectResult: value => (value as ToolResult).effect,
      classifyResult: value => (value as ToolResult).ok ? { status: "completed" } : { status: "failed", code: (value as ToolResult).error ?? "MCP_TOOL_FAILED" },
    }));
  }
  private async call(entry: McpToolInventory, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (!context.principal.permissions.includes(entry.permission)) throw error("FORBIDDEN", 403);
    const connection = this.connection;
    if (this.closed || this.state !== "ready" || !connection) return resultFailure("MCP_UNAVAILABLE", "not_applied");
    const current = this.entries.find(e => e.rawName === entry.rawName && e.name === entry.name);
    if (!current || current.schemaDigest !== entry.schemaDigest) return resultFailure("MCP_SCHEMA_CHANGED_RESTART_REQUIRED", "not_applied");
    try { if (!Value.Check(entry.inputSchema, args)) return resultFailure("MCP_INPUT_INVALID", "not_applied"); }
    catch { return resultFailure("MCP_TOOL_SCHEMA_UNSUPPORTED", "not_applied"); }
    context.signal.throwIfAborted();
    try {
      const result = await connection.client.callTool(entry.rawName, args, { signal: context.signal, timeoutMs: this.config.callTimeoutMs ?? 60000 });
      if (this.connection !== connection || this.state !== "ready" || this.closed) return resultFailure("MCP_STALE_GENERATION", "unknown");
      const envelope: ToolResult = { ok: result.isError !== true, source: "untrusted-mcp-output", generation: connection.generation,
        result, effect: result.isError === true ? "unknown" : "applied", ...(result.isError === true ? { error: "MCP_TOOL_FAILED" } : {}) };
      if (JSON.stringify(envelope).length > 32000) {
        delete envelope.result; envelope.truncated = true;
        // A received successful result proves call completion, even when its content cannot fit the model transport.
      }
      return envelope;
    } catch (cause) {
      const code = cause instanceof McpAbortError || context.signal.aborted ? "MCP_CALL_CANCELLED"
        : cause instanceof McpTimeoutError ? "MCP_CALL_TIMEOUT" : "MCP_CALL_FAILED";
      // Pi 1.2 settles a cancelled/timed-out request before the HTTP POST necessarily ends.
      // Retire this whole generation to abort its transport controller and remaining I/O.
      // Other in-flight calls also become unknown; reconnect never resubmits tools/call.
      await this.disconnect(connection, code);
      return resultFailure(code, "unknown");
    }
  }
  close(): Promise<void> {
    if (this.closedPromise) return this.closedPromise;
    this.closed = true; this.state = "closed"; clearTimeout(this.timer); this.timer = undefined;
    this.closedPromise = (async () => { if (this.connection) await this.closeConnection(this.connection); await this.connecting?.catch(() => {}); if (this.connection) await this.closeConnection(this.connection); })();
    return this.closedPromise;
  }
}

/** Reuses pi-mcp for framing, negotiation, cancellation and transport teardown. Never retries tool calls. */
export async function activateMcp(config: ManagedMcpConfig, options: ManagedMcpOptions = {}): Promise<ManagedMcpActivation> {
  validateConfig(config); options.signal?.throwIfAborted();
  const servers: ManagedServer[] = [], reserved = new Set(options.reservedToolNames ?? []);
  const checkNames = (id: string, names: string[]) => {
    const used = new Set([...reserved, ...servers.filter(s => s.config.id !== id).flatMap(s => s.snapshot().tools.map(t => t.name))]);
    if (names.some(name => used.has(name))) throw error("MCP_NAME_COLLISION");
  };
  let closed = false, closePromise: Promise<void> | undefined;
  const activation: ManagedMcpActivation = {
    get tools() { return closed ? [] : servers.flatMap(server => server.tools()); },
    inventory(principal) { return servers.map(server => server.snapshot(principal)); },
    close() { closed = true; options.signal?.removeEventListener("abort", aborted); return closePromise ??= Promise.all(servers.map(server => server.close())).then(() => {}); },
  };
  const aborted = () => { void activation.close(); };
  options.signal?.addEventListener("abort", aborted, { once: true });
  try {
    for (const configEntry of config.servers) {
      options.signal?.throwIfAborted();
      const server = new ManagedServer(structuredClone(configEntry), options, checkNames); servers.push(server); await server.start();
    }
    options.signal?.throwIfAborted(); return activation;
  } catch (cause) { await activation.close(); throw error(safeCode(cause, "MCP_ACTIVATION_FAILED"), 503); }
}

/** Structural adapter for the host-owned extension composition contract. */
export function managedMcpExtension(config: ManagedMcpConfig, options: ManagedMcpOptions = {}) {
  return { id: "managed-mcp", scope: "workspace" as const, revision: sha256(canonical(config)),
    async activate(context: { workspaceDir: string; signal: AbortSignal; onDispose(dispose: () => Promise<void>): void }) {
      const activation = await activateMcp(config, { ...options, cwd: context.workspaceDir, signal: context.signal });
      try { context.onDispose(() => activation.close()); return { tools: activation.tools, inventory: (principal?: Principal) => activation.inventory(principal) }; }
      catch (cause) { await activation.close(); throw cause; }
    },
  };
}
