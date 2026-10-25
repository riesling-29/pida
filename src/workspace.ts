import { codingPacks } from "./coding-packs.js";
import { PidaWorkbench, workbenchPermissions, workbenchPrompt } from "./workbench.js";
import { nativeProvider, validateNativeProvider, type NativeProviderConfig } from "./provider-catalog.js";
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
import { PidaRuntime, type BusinessTool } from "./runtime.js";
import {
  endpointProvider,
  mockProvider,
  type EndpointConfig,
} from "./providers.js";
import { createPidaServer, staticTokenAuth } from "./http.js";

const configSchema = Type.Object(
  {
    version: Type.Literal(1),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    stateDir: Type.String({ minLength: 1 }),
    systemPrompt: Type.String({ minLength: 1 }),
    provider: Type.Union([
      Type.Object({ kind: Type.Literal("native"), providerId: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }), apiKeyEnv: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }) }, { additionalProperties: false }),
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
          allowInsecureHttp: Type.Optional(Type.Boolean()),
          authMode: Type.Optional(
            Type.Union([Type.Literal("api-key"), Type.Literal("none")]),
          ),
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
    codingPacks: Type.Optional(Type.Array(Type.Union([Type.Literal("debugging"), Type.Literal("verification")]), { uniqueItems: true })),
    browserChecks: Type.Optional(Type.Boolean()),
    runtime: Type.Optional(Type.Object({ maxRunMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 900000 })), autoCompaction: Type.Optional(Type.Boolean()), maxOutputRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })) }, { additionalProperties: false })),
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
  codingPacks?: string[];
  browserChecks?: boolean;
  runtime?: { maxRunMs?: number; autoCompaction?: boolean; maxOutputRetries?: number };
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
  return config;
}
export function checkWorkspace(directory: string) {
  const config = readConfig(directory),
    env = providerEnvironment(directory, config);
  const problems: string[] = [];
  if (!env.PIDA_API_TOKEN || env.PIDA_API_TOKEN.length < 32)
    problems.push("PIDA_API_TOKEN is missing or too short.");
  if (
    config.provider.kind !== "mock" &&
    (config.provider.kind === "native" || config.provider.authMode !== "none") &&
    !env[config.provider.apiKeyEnv]
  )
    problems.push(`Missing credential variable: ${config.provider.apiKeyEnv}`);
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
    provider: config.provider.kind,
    tools: config.tools.enabled,
    persistence: true,
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
  const provider =
    config.provider.kind === "mock"
      ? mockProvider
      : config.provider.kind === "native"
        ? nativeProvider(config.provider, env)
        : endpointProvider({ id: "workspace", ...config.provider }, env);
  // Keep local settings reachable even when a provider key is absent. Model calls still fail closed.
  const tools = await loadWorkspaceTools(root, config);
  const workbench = config.workbench?.enabled ? new PidaWorkbench(join(inside(root, config.stateDir), "workbench"), config.browserChecks ?? false) : undefined;
  const packs = codingPacks(workbench ? config.codingPacks : []);
  const runtime = new PidaRuntime({
    provider,
    workspaceDir: root,
    tools: [...tools, ...(workbench?.tools() ?? []), ...packs.tools],
    skills: packs.skills,
    ...(workbench ? { maxTurns: 24, maxToolCalls: 48, maxRunMs: 180_000 } : {}),
    ...config.runtime,
    storageDir: inside(root, config.stateDir),
    systemPrompt: config.systemPrompt + (workbench ? "\n\n" + workbenchPrompt : "") + packs.prompt,
    providerInfo: providerLabel(config.provider),
  });
  const settings = new ProviderSettings(root, runtime);
  const server = createPidaServer({
    providerSettings: settings,
    workbench,
    runtime,
    serveDemo: true,
    allowedOrigin: `http://127.0.0.1:${config.port}`,
    authenticate: staticTokenAuth([
      {
        token: env.PIDA_API_TOKEN,
        principal: {
          id: "local-user",
          permissions: [...config.permissions, "pida:configure"],
        },
      },
    ]),
  });
  return { runtime, server, config, workbench };
}

