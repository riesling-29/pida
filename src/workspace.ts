import { createProgramRegistry, type ProgramRegistration } from "./program-registry.js";
import { managedMcpConfigSchema, managedMcpExtension, type ManagedMcpConfig, type ManagedMcpActivation } from "./mcp.js";
import { activateExtensions, assertBusinessTool, assertExtension, ResourceLifetime, type WorkspaceExtension } from "./extensions.js";
import { composeTools, compositionInventory, compositionRevision, resolveComposition, type WorkspacePreset, type CompositionInventory, type ToolContribution } from "./composition.js";
import { createAgentTools, agentToolPermissions } from "./agent-tools.js";
import { AgentSupervisor, type AgentProfile } from "./agent-supervisor.js";
import { AgentMemoryStore, memoryTools, agentMemoryPermissions } from "./agent-memory.js";
import { loadProviderConnector, type ProviderConnectorConfig } from "./provider-connector.js";
import { ProjectView } from "./project-view.js";
import { codingPacks } from "./coding-packs.js";
import { createProjectTools, type ProjectConfig } from "./project-tools.js";
import { normalizeCodemodeConfig, type CodemodeConfig } from "./codemode.js";
import type { ProcessExecutor } from "./process-executor.js";
import { PidaWorkbench, workbenchPermissions, workbenchPrompt } from "./workbench.js";
import { nativeProvider, validateNativeProvider, type NativeProviderConfig } from "./provider-catalog.js";
import { ChatGPTCredentialStore } from "./chatgpt-auth.js";
import {
  ProviderSettings,
  providerEnvironment,
  providerLabel,
} from "./provider-settings.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PidaRuntime, PidaError, type BusinessTool, type Principal } from "./runtime.js";
import {
  endpointProvider,
  endpointHeaders,
  mockProvider,
  type EndpointConfig,
  thinkingLevels,
} from "./providers.js";
import { createPidaServer, staticTokenAuth } from "./http.js";

const thinkingLevelSchema = Type.Union(thinkingLevels.map(level => Type.Literal(level)));
const configSchema = Type.Object(
  {
    version: Type.Literal(1),
    preset: Type.Optional(Type.Union([Type.Literal("coding"), Type.Literal("personal"), Type.Literal("headless")])),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    stateDir: Type.String({ minLength: 1 }),
    systemPrompt: Type.String({ minLength: 1 }),
    provider: Type.Union([
      Type.Object({ kind: Type.Literal("native"), providerId: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }), apiKeyEnv: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), authMode: Type.Optional(Type.Union([Type.Literal("api-key"), Type.Literal("chatgpt")])), thinkingLevel: Type.Optional(thinkingLevelSchema) }, { additionalProperties: false }),
      Type.Object(
        { kind: Type.Literal("mock") },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("endpoint"),
          api: Type.Union([
            Type.Literal("openai-completions"),
            Type.Literal("openai-responses"),
            Type.Literal("anthropic-messages"),
          ]),
          baseUrl: Type.String({ minLength: 1 }),
          modelId: Type.String({ minLength: 1 }),
          apiKeyEnv: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
          contextWindow: Type.Integer({ minimum: 2 }),
          maxTokens: Type.Integer({ minimum: 1 }),
          reasoning: Type.Optional(Type.Boolean()),
          input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), { minItems: 1, maxItems: 2, uniqueItems: true })),
          thinkingLevelMap: Type.Optional(Type.Object(Object.fromEntries(thinkingLevels.map(level => [level, Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]))])), { additionalProperties: false })),
          thinkingLevel: Type.Optional(thinkingLevelSchema),
          allowInsecureHttp: Type.Optional(Type.Boolean()),
          authMode: Type.Optional(
            Type.Union([Type.Literal("api-key"), Type.Literal("none")]),
          ),
          headersEnv: Type.Optional(Type.Record(Type.String(), Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }))),
          compat: Type.Optional(Type.Object({
            maxTokensField: Type.Optional(Type.Union([Type.Literal("max_tokens"), Type.Literal("max_completion_tokens")])),
            supportsUsageInStreaming: Type.Optional(Type.Boolean()),
            supportsStore: Type.Optional(Type.Boolean()),
            supportsDeveloperRole: Type.Optional(Type.Boolean()),
          }, { additionalProperties: false })),
        },
        { additionalProperties: false },
      ),
    ]),
    tools: Type.Object(
      {
        directory: Type.String({ minLength: 1 }),
        enabled: Type.Array(Type.String(), { uniqueItems: true }),
      },
      { additionalProperties: false },
    ),
    programs: Type.Optional(Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }), enabled: Type.Boolean(), root: Type.String({ minLength: 1 }), manifest: Type.String({ minLength: 1 }), approval: Type.Object({ manifestDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), commandDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), entrypointDigest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })), runnerDigest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })) }, { additionalProperties: false }) }, { additionalProperties: false }), { maxItems: 64 })),
    providerConnector: Type.Optional(Type.Object({ module: Type.String({ minLength: 1 }), options: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }, { additionalProperties: false })),
    mcp: Type.Optional(managedMcpConfigSchema),
    codemode: Type.Optional(Type.Object({ enabled: Type.Boolean(), tools: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }), { maxItems: 64, uniqueItems: true })), maxCalls: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })), timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 120000 })), memoryLimitBytes: Type.Optional(Type.Integer({ minimum: 4194304, maximum: 134217728 })), maxOutputChars: Type.Optional(Type.Integer({ minimum: 256, maximum: 24000 })) }, { additionalProperties: false })),
    skills: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 16, uniqueItems: true })),
    agents: Type.Optional(Type.Object({ enabled: Type.Boolean(), maxConcurrent: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })) }, { additionalProperties: false })),
    codingPacks: Type.Optional(Type.Array(Type.Union([Type.Literal("debugging"), Type.Literal("verification")]), { uniqueItems: true })),
    browserChecks: Type.Optional(Type.Boolean()),
    project: Type.Optional(Type.Object({
      enabled: Type.Boolean(), root: Type.String({ minLength: 1 }), trustedHost: Type.Boolean(),
      shell: Type.Optional(Type.Union([Type.Literal("bash"), Type.Literal("powershell")])),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }, { additionalProperties: false })),
    runtime: Type.Optional(Type.Object({ maxRunMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 900000 })), httpIdleTimeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 900000 })), maxProviderRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })), retryBaseDelayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60000 })), retryMaxDelayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 300000 })), autoCompaction: Type.Optional(Type.Boolean()), maxOutputRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })), maxTotalTokens: Type.Optional(Type.Integer({ minimum: 1 })), maxObservationEvents: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })) }, { additionalProperties: false })),
    workbench: Type.Optional(Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false })),
    permissions: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export interface WorkspaceConfig {
  version: 1;
  preset?: WorkspacePreset;
  port: number;
  stateDir: string;
  systemPrompt: string;
  provider:
    | { kind: "mock" }
    | NativeProviderConfig
    | ({ kind: "endpoint" } & Omit<EndpointConfig, "id">);
  tools: { directory: string; enabled: string[] };
  programs?: ProgramRegistration[];
  providerConnector?: ProviderConnectorConfig;
  mcp?: ManagedMcpConfig;
  codemode?: CodemodeConfig;
  skills?: string[];
  agents?: { enabled: boolean; maxConcurrent?: number };
  codingPacks?: string[];
  browserChecks?: boolean;
  project?: ProjectConfig;
  runtime?: { maxRunMs?: number; httpIdleTimeoutMs?: number; maxProviderRetries?: number; retryBaseDelayMs?: number; retryMaxDelayMs?: number; autoCompaction?: boolean; maxOutputRetries?: number; maxTotalTokens?: number; maxObservationEvents?: number };
  workbench?: { enabled: boolean };
  permissions: string[];
}
export const defaultConfig: WorkspaceConfig = {
  version: 1,
  port: 8787,
  stateDir: ".pida",
  systemPrompt:
    "You are a helpful assistant. Use the registered tools when useful. Report errors and missing evidence honestly.",
  provider: { kind: "mock" },
  tools: { directory: "tools", enabled: ["lot-status.mjs"] },
  workbench: { enabled: true },
  permissions: ["lots:read", ...workbenchPermissions],
};

function inside(root: string, path: string): string {
  const full = resolve(root, path),
    rel = relative(root, full);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  )
    throw new Error("Workspace paths must be subdirectories of the workspace.");
  return full;
}
export function readConfig(directory: string): WorkspaceConfig {
  const root = resolve(directory);
  const path = join(root, "pida.config.json");
  let content: string;
  try { content = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`CONFIG_NOT_FOUND: ${path}\nSelect the directory containing pida.config.json: pida start "<workspace-directory>" --open\nFrom the source checkout: npm start -- "<workspace-directory>" --open`);
    throw error;
  }
  let config: unknown;
  try { config = JSON.parse(content); }
  catch { throw new Error(`CONFIG_INVALID_JSON: ${path}. Fix the JSON syntax; the file was not changed.`); }
  return validateConfig(config, root);
}
export function validateConfig(
  config: unknown,
  directory: string,
): WorkspaceConfig {
  const root = resolve(directory);
  if (!Value.Check(configSchema, config))
    throw new Error(
      "Invalid pida.config.json. See docs/WORKSPACE.md for the configuration contract.",
    );
  inside(root, config.stateDir);
  inside(root, config.tools.directory);
  if (config.provider.kind === "endpoint")
    endpointProvider({ id: "workspace", ...config.provider });
  if (config.provider.kind === "native") validateNativeProvider(config.provider);
  if (config.codemode) normalizeCodemodeConfig(config.codemode);
  if (config.project?.enabled) {
    const projectRoot = resolve(root, config.project.root);
    if (!existsSync(projectRoot) || !lstatSync(projectRoot).isDirectory() || lstatSync(projectRoot).isSymbolicLink())
      throw new Error("PROJECT_ROOT_INVALID: choose an existing project directory.");
  }
  return config;
}
export function checkWorkspace(directory: string) {
  const config = readConfig(directory),
    env = providerEnvironment(directory, config);
  const problems: string[] = [];
  if (!env.PIDA_API_TOKEN || env.PIDA_API_TOKEN.length < 32)
    problems.push("PIDA_API_TOKEN is missing or too short.");
  if (
    !config.providerConnector && config.provider.kind !== "mock" && config.provider.authMode !== "chatgpt" &&
    (config.provider.kind === "native" || config.provider.authMode !== "none") &&
    !env[config.provider.apiKeyEnv]
  )
    problems.push(`Missing credential variable: ${config.provider.apiKeyEnv}`);
  if (!config.providerConnector && config.provider.kind === "native" && config.provider.authMode === "chatgpt" && !new ChatGPTCredentialStore(directory, config.stateDir).status().connected)
    problems.push("ChatGPT login is missing or its credential store is unreadable. Open model settings to reconnect.");
  if (!config.providerConnector && config.provider.kind === "endpoint" && config.provider.headersEnv) {
    try { endpointHeaders({ id: "workspace", ...config.provider }, env); }
    catch { problems.push("Provider authentication/header environment is missing or invalid; values are not displayed."); }
  }
  for (const file of config.tools.enabled) {
    try {
      approvedToolPath(directory, config, file);
    } catch {
      problems.push(`Missing or invalid approved tool: ${file}`);
    }
  }
  return {
    ok: problems.length === 0,
    workspaceDir: resolve(directory),
    provider: config.providerConnector ? "host-connector" : config.provider.kind,
    agents: config.agents?.enabled !== false,
    tools: config.tools.enabled,
    persistence: true,
    project: config.project?.enabled ? { enabled: true, shell: config.project.trustedHost, fileRestore: false } : { enabled: false },
    browserChecks: config.browserChecks ?? false,
    problems,
    note: "Configuration checks only. No tool module imported and no model request sent. Restart after configuration changes.",
  };
}
export function workspaceEnvironment(directory: string): NodeJS.ProcessEnv {
  const path = join(resolve(directory), ".env");
  // Shell/secret-manager values take precedence; never mutate the embedding host's environment.
  return {
    ...(existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}),
    ...process.env,
  };
}
export function initWorkspace(directory: string): void {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const planned = [
    "pida.config.json",
    ".env",
    "tools/lot-status.mjs",
    "tools/README.md",
  ];
  if (planned.some((path) => existsSync(join(root, path))))
    throw new Error(
      "Workspace files already exist; initialization does not overwrite them.",
    );
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(
    join(root, "pida.config.json"),
    JSON.stringify(defaultConfig, null, 2) + "\n",
    { flag: "wx" },
  );
  writeFileSync(
    join(root, ".env"),
    `# Private local credentials. Do not commit. Shell variables override this file.\nPIDA_API_TOKEN=${randomBytes(32).toString("hex")}\n# PIDA_LLM_API_KEY=\n`,
    { flag: "wx", mode: 0o600 },
  );
  writeFileSync(
    join(root, "tools/lot-status.mjs"),
    'import { lotStatusTool } from "pida-core";\nexport default lotStatusTool;\n',
    { flag: "wx" },
  );
  writeFileSync(
    join(root, "tools/README.md"),
    `# Business tools\n\nEach .mjs (or ESM .js) module exports one default BusinessTool. Use defineBusinessTool from pida-core and Type from typebox. Compile TypeScript to JavaScript before registering it.\n\nRun pida tools to list files, then pida tools enable FILE.mjs to approve a module. Add its required permission to pida.config.json separately, then restart. Disabled files are never imported.\n\nModules execute trusted server-side code at import time; only enable code you trust. The mock provider only demonstrates get_lot_status; use an endpoint provider for your own tools.\n`,
    { flag: "wx" },
  );
  const ignore = join(root, ".gitignore");
  const previous = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  writeFileSync(
    ignore,
    previous +
      "\n# Pida local credentials and conversations\n.env\n.env.*\n!.env.example\n.pida/\nnode_modules/\n",
  );
}
export function listToolFiles(
  directory: string,
  config = readConfig(directory),
) {
  const dir = inside(resolve(directory), config.tools.directory);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(mjs|js)$/.test(e.name))
    .map((e) => ({
      file: e.name,
      enabled: config.tools.enabled.includes(e.name),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
function approvedToolPath(
  directory: string,
  config: WorkspaceConfig,
  file: string,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(mjs|js)$/.test(file))
    throw new Error("Tool entries must be plain .mjs or .js filenames.");
  const dir = realpathSync(inside(resolve(directory), config.tools.directory));
  const path = join(dir, file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path)
    throw new Error("Tool symlinks are not accepted.");
  // Directory itself must remain inside the workspace after resolving symlinks.
  inside(realpathSync(resolve(directory)), dir);
  return path;
}
export function setToolEnabled(
  directory: string,
  file: string,
  enabled: boolean,
): void {
  const config = readConfig(directory);
  if (enabled) approvedToolPath(directory, config, file); // Check path without importing code.
  config.tools.enabled = config.tools.enabled.filter((f) => f !== file);
  if (enabled) config.tools.enabled.push(file);
  writeFileSync(
    join(resolve(directory), "pida.config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}
export async function loadWorkspaceTools(
  directory: string,
  config = readConfig(directory),
): Promise<BusinessTool<any>[]> {
  const tools: BusinessTool<any>[] = [];
  // Resolve every path before executing any approved module.
  const paths = config.tools.enabled.map((file) =>
    approvedToolPath(directory, config, file),
  );
  for (const path of paths) {
    const tool = await importApprovedModule(path);
    assertBusinessTool(tool);
    tools.push(tool);
  }
  return tools;
}
const importedToolSources = new Map<string, { revision: string; url: string }>();
async function importApprovedModule(path: string) {
  const revision = compositionRevision(readFileSync(path, "utf8")), url = pathToFileURL(path).href;
  const previous = importedToolSources.get(url);
  // The initial import keeps legacy object identity. A changed source gets a new Node module identity.
  const selected = previous?.revision === revision ? previous.url : previous ? `${url}?pida_revision=${revision}` : url;
  const module = await import(selected);
  importedToolSources.set(url, { revision, url: selected });
  return module.default;
}
/** Approved files may opt into a factory and disposer; legacy BusinessTool exports remain workspace-scoped. */
export async function loadWorkspaceExtensions(directory: string, config = readConfig(directory)): Promise<WorkspaceExtension[]> {
  const paths = config.tools.enabled.map(file => ({ file, path: approvedToolPath(directory, config, file) }));
  const definitions: WorkspaceExtension[] = [];
  for (const { file, path } of paths) {
    const revision = compositionRevision(readFileSync(path, "utf8"));
    const value = await importApprovedModule(path);
    if (value && typeof value.activate === "function") {
      assertExtension(value);
      definitions.push({ ...value, revision: compositionRevision({ source: revision, declared: value.revision }) });
    } else {
      assertBusinessTool(value);
      definitions.push({ id: `tool:${file}`, scope: "workspace", revision, activate: () => ({ tools: [value] }) });
    }
  }
  return definitions;
}
export interface CreateWorkspaceOptions {
  /** Executable factories supplied by the embedding host, never by an HTTP/model request. */
  extensions?: readonly WorkspaceExtension[];
  /** Optional host-installed process backend; never a model-selected module path. */
  commandExecutor?: ProcessExecutor;
  onCloseError?(error: unknown): void;
}

export async function createWorkspace(directory: string, options: CreateWorkspaceOptions = {}) {
  const root = resolve(directory), config = readConfig(root), env = providerEnvironment(root, config);
  if (!env.PIDA_API_TOKEN || env.PIDA_API_TOKEN.length < 32)
    throw new Error("Set PIDA_API_TOKEN (at least 32 random characters) in .env or the environment.");
  const lifetime = new ResourceLifetime();
  try {
    let mcp: Pick<ManagedMcpActivation, "tools" | "inventory"> | undefined;
    const mcpDefinition = config.mcp ? managedMcpExtension(config.mcp, { env, cwd: root }) : undefined;
    const definitions: WorkspaceExtension[] = [...await loadWorkspaceExtensions(root, config), ...(options.extensions ?? []),
      ...(mcpDefinition ? [{ ...mcpDefinition, async activate(context: Parameters<WorkspaceExtension["activate"]>[0]) {
        mcp = await mcpDefinition.activate(context);
        // The adapter registers close with onDispose. Runtime tool schemas stay fixed until restart.
        return { tools: mcp.tools };
      } }] : []),
    ];
    const ids = new Set<string>();
    for (const definition of definitions) {
      assertExtension(definition);
      if (ids.has(definition.id)) throw new PidaError("EXTENSION_DUPLICATE", 400);
      ids.add(definition.id);
    }
    const extensionRevisions = definitions.map(({ id, scope, revision }) => ({ id, scope, revision: revision ?? "unversioned" }));
    const selectedMain = resolveComposition(config, "main"), selectedAgent = resolveComposition(config, "agent");
    const workspaceExtensions = await activateExtensions(definitions.filter(d => d.scope === "workspace"), { workspaceDir: root, signal: lifetime.controller.signal });
    lifetime.add(() => workspaceExtensions.close());
    const protectedPaths = [join(root, "pida.config.json"), join(root, ".env"), join(root, "connectors"), join(root, "programs"), join(root, config.tools.directory), inside(root, config.stateDir), ...(config.programs ?? []).map(p => resolve(root, p.manifest))];
    const programs = await createProgramRegistry(root, config.programs, { projectRoot: config.project?.enabled ? resolve(root, config.project.root) : undefined, protectedPaths, outputDirectory: join(inside(root, config.stateDir), "program-output") });
    const project = config.project?.enabled ? createProjectTools({ ...config.project, root: resolve(root, config.project.root) }, { protectedPaths, commandStateDirectory: join(inside(root, config.stateDir), "commands"), commandExecutor: options.commandExecutor }) : undefined;
    if (project?.commands) lifetime.add(() => project.commands!.close());
    const sharedWorkspaceKey = config.project?.enabled ? resolve(root, config.project.root)
      : programs.tools.some(t => t.effect !== "read") ? "host-programs"
      : workspaceExtensions.tools.some(t => t.effect !== "read") || definitions.some(d => d.scope === "agent") ? "host-extensions" : undefined;
    const workbench = selectedMain.workbench ? new PidaWorkbench(join(inside(root, config.stateDir), "workbench"), config.browserChecks ?? false) : undefined;
    const packCache = new Map<string, ReturnType<typeof codingPacks>>();
    const packsFor = (target: "main" | "agent") => {
      const selected = resolveComposition(config, target), key = JSON.stringify(selected.codingPacks ?? null);
      let value = packCache.get(key);
      if (!value) { value = codingPacks(selected.codingPacks); packCache.set(key, value); }
      return value;
    };
    const principal: Principal = { id: "local-user", permissions: [...new Set([...config.permissions, "pida:configure", "pida:agents", "pida:recover", ...agentMemoryPermissions, ...agentToolPermissions, ...((config.skills?.length || packsFor("main").skills.length || packsFor("agent").skills.length) ? ["resources:read"] : [])])] };
    const agentDirectory = join(inside(root, config.stateDir), "agents-service");
    const memories = new Map<string, AgentMemoryStore>(), agentWorkbenches = new Map<string, PidaWorkbench>();
    const inventories = new Map<string, CompositionInventory>();
    const memory = (id: string) => {
      let value = memories.get(id);
      if (!value) { value = new AgentMemoryStore(join(agentDirectory, "memory"), id); memories.set(id, value); }
      return value;
    };
    const agentWorkbench = (id: string) => {
      let value = agentWorkbenches.get(id);
      if (!value) { value = new PidaWorkbench(join(agentDirectory, "agents", id, "workbench"), config.browserChecks ?? false); agentWorkbenches.set(id, value); }
      return value;
    };
    let projectBusy = false, providerGeneration = 0;
    let runtime: PidaRuntime;
    let agents: AgentSupervisor | undefined;
    // Provider settings may change at idle. Other capability changes require a workspace restart,
    // so a newly created agent never silently mixes new configuration with old activated tools.
    const capabilityConfig = (value: WorkspaceConfig) => { const { provider: _provider, providerConnector: _connector, ...rest } = value; return rest; };
    const toolSources = (selected: WorkspaceConfig) => selected.tools.enabled.map(file => ({ file, digest: compositionRevision(readFileSync(approvedToolPath(root, selected, file), "utf8")) }));
    const initialToolSources = toolSources(config);
    const capabilityRevision = compositionRevision({ config: capabilityConfig(config), extensions: extensionRevisions, toolSources: initialToolSources });
    const activeConfig = () => {
      const selected = readConfig(root);
      if (compositionRevision({ config: capabilityConfig(selected), extensions: extensionRevisions, toolSources: toolSources(selected) }) !== capabilityRevision)
        throw new PidaError("WORKSPACE_RESTART_REQUIRED", 409);
      return selected;
    };
    const revisionOf = (selected: WorkspaceConfig) => compositionRevision({ config: selected, extensions: extensionRevisions, toolSources: toolSources(selected), providerGeneration });
    const activeRevisionOf = (selected: WorkspaceConfig) => compositionRevision({
      config: { ...config, provider: selected.provider, providerConnector: selected.providerConnector },
      extensions: extensionRevisions, toolSources: initialToolSources, providerGeneration,
    });
    const acquireRunLease = sharedWorkspaceKey ? ({ sessionId }: { sessionId: string }) => {
      project?.commands?.assertRunAllowed(principal.id, sessionId);
      if (agents?.blockedWorkspaceKeys().includes(sharedWorkspaceKey)) throw new PidaError("AGENT_RECOVERY_REQUIRED", 409);
      if (runtime.listSessions(principal).some(session => runtime.getRecovery(session.sessionId, principal).pendingEffects.length)) throw new PidaError("EFFECT_STATE_UNKNOWN", 409);
      if (projectBusy) throw new PidaError("WORKSPACE_BUSY", 409);
      projectBusy = true;
      return () => { projectBusy = false; };
    } : undefined;
    let connectorManifest: Awaited<ReturnType<typeof loadProviderConnector>>["manifest"] | undefined;
    const buildRuntime = async (profile?: AgentProfile, context?: { signal: AbortSignal }): Promise<PidaRuntime> => {
      const owner = new ResourceLifetime(context?.signal ?? lifetime.controller.signal), target = profile ? "agent" : "main", agentId = profile?.id ?? "main";
      try {
        owner.controller.signal.throwIfAborted();
        const selected = activeConfig(), selectedEnv = providerEnvironment(root, selected);
        const connector = selected.providerConnector ? await loadProviderConnector(root, selected.providerConnector, selectedEnv) : undefined;
        if (!profile) connectorManifest = connector?.manifest;
        const provider = connector?.provider ?? (selected.provider.kind === "mock" ? mockProvider : selected.provider.kind === "native"
          ? nativeProvider(selected.provider, selectedEnv, undefined, new ChatGPTCredentialStore(root, selected.stateDir))
          : endpointProvider({ id: "workspace", ...selected.provider }, selectedEnv));
        const agentExtensions = await activateExtensions(definitions.filter(d => d.scope === "agent"), { workspaceDir: root, agentId, signal: owner.controller.signal });
        owner.add(() => agentExtensions.close());
        owner.controller.signal.throwIfAborted();
        const area = profile ? (selectedAgent.workbench ? agentWorkbench(profile.id) : undefined) : workbench;
        const packs = packsFor(target), store = profile ? memory(profile.id) : undefined;
        if (store && !store.view().persona && profile?.persona)
          store.revisePersona({ expectedRevision: null, text: profile.persona, sourceRefs: ["owner:registration"] });
        const contributions: ToolContribution[] = [
          ...workspaceExtensions.inventory.map(entry => ({ source: entry.id, scope: entry.scope, tools: workspaceExtensions.tools.filter(t => entry.tools.includes(t.name)) })),
          ...agentExtensions.inventory.map(entry => ({ source: entry.id, scope: entry.scope, tools: agentExtensions.tools.filter(t => entry.tools.includes(t.name)) })),
          { source: "workbench", scope: "agent", tools: area?.tools() ?? [] },
          { source: "coding-packs", scope: "workspace", tools: packs.tools },
          { source: "project", scope: "workspace", tools: project?.tools ?? [] },
          { source: "programs", scope: "workspace", tools: programs.tools },
          ...(profile && store ? [
            { source: "memory", scope: "agent" as const, tools: memoryTools(store) },
            { source: "agents", scope: "agent" as const, tools: createAgentTools(agents!, profile.id) },
          ] : []),
        ];
        const evidenceLimits = [
          ...(project ? ["HOST_PROJECT_ARTIFACTS_NOT_CAPTURED", ...(config.project?.trustedHost ? ["HOST_SHELL_IS_NOT_SANDBOXED"] : [])] : []),
          ...(project?.commands ? ["COMMAND_RANGE_EXIT_NOT_VERIFIED", "COMMAND_ADMISSION_IS_NOT_COMPLETION"] : []),
          ...(config.programs?.some(p => p.enabled) ? ["HOST_PROGRAM_NOT_SANDBOXED", "PROGRAM_DEPENDENCIES_NOT_PINNED", "PROGRAM_DESCENDANTS_NOT_GUARANTEED_STOPPED"] : []),
        ];
        const tools = composeTools(contributions);
        const created = new PidaRuntime({
          ...(profile ? { agentId: profile.id } : {}), provider,
          providerInfo: connector ? { mode: "host-connector", model: connector.manifest.displayName } : providerLabel(selected.provider),
          workspaceDir: root, storageDir: profile ? join(agentDirectory, "agents", profile.id, "runtime") : inside(root, config.stateDir),
          instructionRoot: config.project?.enabled ? resolve(root, config.project.root) : undefined,
          skillPaths: config.skills?.map(path => inside(root, path)), skills: packs.skills,
          tools, acquireRunLease, codemode: config.codemode,
          authorize: ({ toolName }) => {
            const tool = tools.find(item => item.name === toolName);
            if (tool && tool.effect !== "read" && toolName !== "project_command_cancel") project?.commands?.assertCanMutate();
            return true;
          },
          ...(area ? { inspectArtifacts: (p: Principal) => area.captureArtifacts(p) } : {}),
          ...(store ? { contextForRun: () => store.contextForRun(12000) } : {}),
          ...(project ? { singleWriter: true } : {}), evidenceLimits,
          ...(area || profile ? { maxTurns: 24, maxToolCalls: 48, maxRunMs: 180_000 } : {}), ...config.runtime,
          systemPrompt: config.systemPrompt + (profile ? "\n\nAgent role: " + profile.role : "") + (area ? "\n\n" + workbenchPrompt : "") + packs.prompt + (project ? "\n\n" + project.prompt : "")
            + (profile ? "\nUse agent_memory_recall for prior information. Record meaningful changes to understanding with agent_memory_transition and sourced experience with agent_memory_remember. Persona edits belong to the owner. A job status is not an information-state transition." : ""),
        });
        const closeRuntime = created.close.bind(created);
        owner.add(closeRuntime);
        const runRuntime = created.run.bind(created);
        created.run = async (sessionId, requestPrincipal, prompt, onEvent, signal, identity) => {
          let admitted = false, cancellation: Promise<void> | undefined;
          const cancelCommands = () => cancellation ??= requestPrincipal.permissions.includes("project:execute")
            ? project?.commands?.cancelSession(requestPrincipal, sessionId) ?? Promise.resolve() : Promise.resolve();
          const aborted = () => { if (admitted) void cancelCommands().catch(() => {}); };
          signal?.addEventListener("abort", aborted, { once: true });
          try {
            const result = await runRuntime(sessionId, requestPrincipal, prompt, event => {
              if (event.type === "trace" && event.trace.type === "run_started") { admitted = true; if (signal?.aborted) aborted(); }
              onEvent?.(event);
            }, signal, identity);
            if (result.status === "cancelled" || ["RUN_TIMEOUT", "PROVIDER_IDLE_TIMEOUT"].includes(result.code ?? "")) await cancelCommands();
            return result;
          } finally {
            signal?.removeEventListener("abort", aborted);
            await cancellation;
          }
        };
        const cancelRuntime = created.cancel.bind(created);
        created.cancel = async (sessionId, requestPrincipal) => {
          await cancelRuntime(sessionId, requestPrincipal);
          if (requestPrincipal.permissions.includes("project:execute")) await project?.commands?.cancelSession(requestPrincipal, sessionId);
        };
        const deleteSession = created.deleteSession.bind(created);
        created.deleteSession = async (sessionId, requestPrincipal) => {
          project?.commands?.assertSessionIdle(requestPrincipal.id, sessionId);
          return deleteSession(sessionId, requestPrincipal);
        };
        const compactSession = created.compactSession.bind(created);
        created.compactSession = async (sessionId, requestPrincipal, handoff) => {
          project?.commands?.assertSessionIdle(requestPrincipal.id, sessionId);
          return compactSession(sessionId, requestPrincipal, handoff);
        };
        const inventory = compositionInventory(config, target, activeRevisionOf(selected), contributions, [...workspaceExtensions.inventory, ...agentExtensions.inventory], principal);
        if (created.getInfo(principal).tools.some(tool => tool.name === "program_compose")) inventory.tools.push({ name: "program_compose", permission: "programs:compose", source: "pi-codemode", scope: "agent", permitted: principal.permissions.includes("programs:compose") });
        inventories.set(agentId, inventory);
        owner.add(() => { if (inventories.get(agentId) === inventory) inventories.delete(agentId); });
        created.close = () => owner.close();
        return created;
      } catch (error) { return owner.fail(error); }
    };
    runtime = await buildRuntime();
    const closeMain = runtime.close.bind(runtime);
    lifetime.add(closeMain);
    agents = selectedMain.agents ? await AgentSupervisor.open({
      directory: agentDirectory, maxConcurrent: config.agents?.maxConcurrent ?? 3,
      runtimeKey: () => revisionOf(activeConfig()),
      workspaceKey: profile => sharedWorkspaceKey ?? profile.id,
      resolvePrincipal: id => id === principal.id ? structuredClone(principal) : undefined,
      createRuntime: buildRuntime,
    }) : undefined;
    if (agents) lifetime.add(() => agents!.close());
    const assertRuntimeIdle = runtime.assertIdle.bind(runtime);
    runtime.assertIdle = () => { assertRuntimeIdle(); agents?.assertIdle(); if (project?.commands?.hasActive()) throw new PidaError("PROVIDER_BUSY", 409); };
    const configureMainProvider = runtime.configureProvider.bind(runtime);
    runtime.configureProvider = (provider, info) => {
      configureMainProvider(provider, info); providerGeneration++;
      const main = inventories.get("main"); if (main) main.revision = activeRevisionOf(readConfig(root));
    };
    const projectView = config.project?.enabled ? new ProjectView({ ...config.project, root: resolve(root, config.project.root) }, { protectedPaths }) : undefined;
    const settings = new ProviderSettings(root, runtime);
    lifetime.add(() => settings.close());
    const server = createPidaServer({
      providerSettings: settings, agents, agentMemory: memory,
      ...(selectedAgent.workbench ? { agentWorkbench } : {}), projectView, programs, commands: project?.commands,
      connector: connectorManifest, workbench, runtime, serveDemo: selectedMain.web,
      getComposition: () => getComposition(),
      allowedOrigin: `http://127.0.0.1:${config.port}`,
      authenticate: staticTokenAuth([{ token: env.PIDA_API_TOKEN, principal }]),
    });
    let closeError: unknown;
    let closePromise: Promise<void> | undefined;
    const close = () => closePromise ??= lifetime.close().catch(error => { closeError = error; throw error; });
    runtime.close = close; // Preserve the existing whole-workspace lifecycle contract.
    server.once("close", () => { void close().catch(error => {
      closeError = error;
      if (options.onCloseError) options.onCloseError(error);
      else process.stderr.write("Pida: workspace cleanup failed; await workspace.close() for details.\n");
    }); });
    const getComposition = () => {
      const selected = readConfig(root), configuredRevision = revisionOf(selected);
      const mcpInventory = mcp?.inventory(principal) ?? [];
      return {
        configuredRevision,
        restartRequired: compositionRevision({ config: capabilityConfig(selected), extensions: extensionRevisions, toolSources: toolSources(selected) }) !== capabilityRevision || mcpInventory.some(server => server.restartRequired),
        active: structuredClone([...inventories.entries()].map(([agentId, value]) => ({ agentId, ...value }))),
        mcp: mcpInventory,
      };
    };
    agents?.start();
    return { runtime, server, config, workbench, agents, commands: project?.commands, close, getComposition, get closeError() { return closeError; } };
  } catch (error) { return lifetime.fail(error); }
}
