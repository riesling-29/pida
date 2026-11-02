import { createProgramRegistry, type ProgramRegistration } from "./program-registry.js";
import { createAgentTools, agentToolPermissions } from "./agent-tools.js";
import { AgentSupervisor } from "./agent-supervisor.js";
import { AgentMemoryStore, memoryTools, agentMemoryPermissions } from "./agent-memory.js";
import { loadProviderConnector, type ProviderConnectorConfig } from "./provider-connector.js";
import { ProjectView } from "./project-view.js";
import { codingPacks } from "./coding-packs.js";
import { createProjectTools, type ProjectConfig } from "./project-tools.js";
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
import { randomBytes, createHash } from "node:crypto";
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
    skills: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 16, uniqueItems: true })),
    agents: Type.Optional(Type.Object({ enabled: Type.Boolean(), maxConcurrent: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })) }, { additionalProperties: false })),
    codingPacks: Type.Optional(Type.Array(Type.Union([Type.Literal("debugging"), Type.Literal("verification")]), { uniqueItems: true })),
    browserChecks: Type.Optional(Type.Boolean()),
    project: Type.Optional(Type.Object({
      enabled: Type.Boolean(), root: Type.String({ minLength: 1 }), trustedHost: Type.Boolean(),
      shell: Type.Optional(Type.Union([Type.Literal("bash"), Type.Literal("powershell")])),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }, { additionalProperties: false })),
    runtime: Type.Optional(Type.Object({ maxRunMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 900000 })), autoCompaction: Type.Optional(Type.Boolean()), maxOutputRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })), maxTotalTokens: Type.Optional(Type.Integer({ minimum: 1 })), maxObservationEvents: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })) }, { additionalProperties: false })),
    workbench: Type.Optional(Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false })),
    permissions: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export interface WorkspaceConfig {
  version: 1;
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
  skills?: string[];
  agents?: { enabled: boolean; maxConcurrent?: number };
  codingPacks?: string[];
  browserChecks?: boolean;
  project?: ProjectConfig;
  runtime?: { maxRunMs?: number; autoCompaction?: boolean; maxOutputRetries?: number; maxTotalTokens?: number; maxObservationEvents?: number };
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
    const tool = (await import(pathToFileURL(path).href)).default;
    if (
      !tool ||
      typeof tool.name !== "string" ||
      typeof tool.description !== "string" ||
      !tool.parameters ||
      tool.parameters.type !== "object" ||
      typeof tool.permission !== "string" ||
      typeof tool.execute !== "function"
    )
      throw new Error(
        "A tool module must default-export a BusinessTool with an object input schema.",
      );
    tools.push(tool);
  }
  return tools;
}
export async function createWorkspace(directory: string) {
  const root = resolve(directory),
    config = readConfig(root),
    env = providerEnvironment(root, config);
  if (!env.PIDA_API_TOKEN || env.PIDA_API_TOKEN.length < 32)
    throw new Error(
      "Set PIDA_API_TOKEN (at least 32 random characters) in .env or the environment.",
    );
  const connector = config.providerConnector ? await loadProviderConnector(root, config.providerConnector, env) : undefined;
  const provider = connector?.provider ?? (
    config.provider.kind === "mock"
      ? mockProvider
      : config.provider.kind === "native"
        ? nativeProvider(config.provider, env, undefined, new ChatGPTCredentialStore(root, config.stateDir))
        : endpointProvider({ id: "workspace", ...config.provider }, env));
  // Keep local settings reachable even when a provider key is absent. Model calls still fail closed.
  const tools = await loadWorkspaceTools(root, config);
  const protectedPaths = [join(root, "pida.config.json"), join(root, ".env"), join(root, "connectors"), join(root, "programs"), join(root, config.tools.directory), inside(root, config.stateDir), ...(config.programs ?? []).map(p => resolve(root, p.manifest))];
  const programs = await createProgramRegistry(root, config.programs, { projectRoot: config.project?.enabled ? resolve(root, config.project.root) : undefined, protectedPaths, outputDirectory: join(inside(root, config.stateDir), "program-output") });
  const sharedWorkspaceKey = config.project?.enabled ? resolve(root, config.project.root) : programs.tools.some(t => t.effect !== "read") ? "host-programs" : undefined;
  const workbench = config.workbench?.enabled ? new PidaWorkbench(join(inside(root, config.stateDir), "workbench"), config.browserChecks ?? false) : undefined;
  const packs = codingPacks(workbench ? config.codingPacks : []);
  const project = config.project?.enabled ? createProjectTools({ ...config.project, root: resolve(root, config.project.root) }, {
    protectedPaths,
  }) : undefined;
  const principal: Principal = { id: "local-user", permissions: [...new Set([...config.permissions, "pida:configure", "pida:agents", "pida:recover", ...agentMemoryPermissions, ...agentToolPermissions, ...((config.skills?.length || packs.skills.length) ? ["resources:read"] : [])])] };
  const label = connector ? { mode: "host-connector", model: connector.manifest.displayName } : providerLabel(config.provider);
  let projectBusy = false;
  let providerGeneration = 0;
  let blockedWorkspaceKeys = () => [] as string[];
  const acquireRunLease = sharedWorkspaceKey ? () => {
    if (blockedWorkspaceKeys().includes(sharedWorkspaceKey)) throw new PidaError("AGENT_RECOVERY_REQUIRED", 409);
    if (runtime.listSessions(principal).some(session => runtime.getRecovery(session.sessionId, principal).pendingEffects.length)) throw new PidaError("EFFECT_STATE_UNKNOWN", 409);
    if (projectBusy) throw new PidaError("WORKSPACE_BUSY", 409);
    projectBusy = true;
    return () => { projectBusy = false; };
  } : undefined;
  const runtime = new PidaRuntime({
    provider,
    workspaceDir: root,
    instructionRoot: config.project?.enabled ? resolve(root, config.project.root) : undefined,
    skillPaths: config.skills?.map(path => inside(root, path)),
    acquireRunLease,
    ...(workbench ? { inspectArtifacts: (principal: import("./runtime.js").Principal) => workbench.captureArtifacts(principal) } : {}),
    tools: [...tools, ...(workbench?.tools() ?? []), ...packs.tools, ...(project?.tools ?? []), ...programs.tools],
    ...(project ? { singleWriter: true, evidenceLimits: ["HOST_PROJECT_ARTIFACTS_NOT_CAPTURED", ...(config.project?.trustedHost ? ["HOST_SHELL_IS_NOT_SANDBOXED"] : [])] } : {}),
    skills: packs.skills,
    ...(config.programs?.some(p => p.enabled) ? { evidenceLimits: ["HOST_PROGRAM_NOT_SANDBOXED", "PROGRAM_DEPENDENCIES_NOT_PINNED", "PROGRAM_DESCENDANTS_NOT_GUARANTEED_STOPPED", ...(project ? ["HOST_PROJECT_ARTIFACTS_NOT_CAPTURED", ...(config.project?.trustedHost ? ["HOST_SHELL_IS_NOT_SANDBOXED"] : [])] : [])] } : {}),
    ...(workbench ? { maxTurns: 24, maxToolCalls: 48, maxRunMs: 180_000 } : {}),
    ...config.runtime,
    storageDir: inside(root, config.stateDir),
    systemPrompt: config.systemPrompt + (workbench ? "\n\n" + workbenchPrompt : "") + packs.prompt + (project ? "\n\n" + project.prompt : ""),
    providerInfo: label,
  });
  try {
  const agentDirectory = join(inside(root, config.stateDir), "agents-service");
  const memories = new Map<string, AgentMemoryStore>();
  const agentWorkbenches = new Map<string, PidaWorkbench>();
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
  const agents: AgentSupervisor | undefined = config.agents?.enabled === false ? undefined : await AgentSupervisor.open({
    directory: agentDirectory,
    maxConcurrent: config.agents?.maxConcurrent ?? 3,
    runtimeKey: () => { const selected = readConfig(root); return createHash("sha256").update(JSON.stringify({ provider: selected.provider, connector: selected.providerConnector, generation: providerGeneration })).digest("hex"); },
    workspaceKey: profile => sharedWorkspaceKey ?? profile.id,
    resolvePrincipal: id => id === principal.id ? structuredClone(principal) : undefined,
    createRuntime: async (profile): Promise<PidaRuntime> => {
      const store = memory(profile.id);
      if (!store.view().persona && profile.persona) store.revisePersona({ expectedRevision: null, text: profile.persona, sourceRefs: ["owner:registration"] });
      const area = agentWorkbench(profile.id);
      const selected = readConfig(root);
      const selectedEnv = providerEnvironment(root, selected);
      const selectedConnector = selected.providerConnector ? await loadProviderConnector(root, selected.providerConnector, selectedEnv) : undefined;
      const selectedProvider = selectedConnector?.provider ?? (selected.provider.kind === "mock" ? mockProvider : selected.provider.kind === "native" ? nativeProvider(selected.provider, selectedEnv, undefined, new ChatGPTCredentialStore(root, selected.stateDir)) : endpointProvider({ id: "workspace", ...selected.provider }, selectedEnv));
      return new PidaRuntime({
        agentId: profile.id, provider: selectedProvider,
        providerInfo: selectedConnector ? { mode: "host-connector", model: selectedConnector.manifest.displayName } : providerLabel(selected.provider),
        workspaceDir: root, storageDir: join(agentDirectory, "agents", profile.id, "runtime"),
        instructionRoot: config.project?.enabled ? resolve(root, config.project.root) : undefined,
        skillPaths: config.skills?.map(path => inside(root, path)),
        skills: packs.skills,
        tools: [...tools, ...area.tools(), ...packs.tools, ...(project?.tools ?? []), ...memoryTools(store), ...createAgentTools(agents!, profile.id), ...programs.tools],
        acquireRunLease,
        contextForRun: () => store.context(12000),
        inspectArtifacts: p => area.captureArtifacts(p),
        ...(project ? { singleWriter: true, acquireRunLease, evidenceLimits: ["HOST_PROJECT_ARTIFACTS_NOT_CAPTURED", ...(config.project?.trustedHost ? ["HOST_SHELL_IS_NOT_SANDBOXED"] : [])] } : {}),
        ...(config.programs?.some(p => p.enabled) ? { evidenceLimits: ["HOST_PROGRAM_NOT_SANDBOXED", "PROGRAM_DEPENDENCIES_NOT_PINNED", "PROGRAM_DESCENDANTS_NOT_GUARANTEED_STOPPED", ...(project ? ["HOST_PROJECT_ARTIFACTS_NOT_CAPTURED", ...(config.project?.trustedHost ? ["HOST_SHELL_IS_NOT_SANDBOXED"] : [])] : [])] } : {}),
        maxTurns: 24, maxToolCalls: 48, maxRunMs: 180_000, ...config.runtime,
        systemPrompt: config.systemPrompt + "\n\nAgent role: " + profile.role + "\n" + workbenchPrompt + packs.prompt + (project ? "\n" + project.prompt : "") + "\nUse agent_memory_recall for prior information. Record meaningful changes to understanding with agent_memory_transition and sourced experience with agent_memory_remember. Persona edits belong to the owner. A job status is not an information-state transition.",
      });
    },
  });
  blockedWorkspaceKeys = () => agents?.blockedWorkspaceKeys() ?? [];
  const assertRuntimeIdle = runtime.assertIdle.bind(runtime);
  runtime.assertIdle = () => { assertRuntimeIdle(); agents?.assertIdle(); };
  const configureMainProvider = runtime.configureProvider.bind(runtime);
  runtime.configureProvider = (provider, info) => { configureMainProvider(provider, info); providerGeneration++; };
  const projectView = config.project?.enabled ? new ProjectView({ ...config.project, root: resolve(root, config.project.root) }, { protectedPaths }) : undefined;
  const settings = new ProviderSettings(root, runtime);
  const server = createPidaServer({
    providerSettings: settings,
    agents, agentMemory: memory, agentWorkbench, projectView, programs,
    connector: connector?.manifest,
    workbench,
    runtime,
    serveDemo: true,
    allowedOrigin: `http://127.0.0.1:${config.port}`,
    authenticate: staticTokenAuth([
      {
        token: env.PIDA_API_TOKEN,
        principal,
      },
    ]),
  });
  const closeRuntime = runtime.close.bind(runtime);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => { await agents?.close(); await closeRuntime(); await settings.close(); })();
  // Preserve the pre-0.8 host lifecycle contract: runtime.close() releases the whole workspace.
  runtime.close = close;
  server.once("close", () => { void close(); });
  agents?.start();
  return { runtime, server, config, workbench, agents, close };
  } catch (error) { await runtime.close(); throw error; }
}

