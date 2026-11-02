import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProviderBinding, ProviderFactory } from "./providers.js";

/** Host-owned disk configuration. Never accept this object from a model or HTTP request. */
export interface ProviderConnectorConfig {
  module: string;
  /** Non-secret, JSON-compatible settings. Credentials belong in the connector's own auth store. */
  options?: Record<string, unknown>;
}
export interface ProviderConnectorManifest {
  apiVersion: 1;
  id: string;
  displayName: string;
}
export interface ProviderConnectorContext {
  workspaceDir: string;
  env: Readonly<NodeJS.ProcessEnv>;
  options: Readonly<Record<string, unknown>>;
}
/** Called once for each Pi session, including restored sessions, not once per turn. */
export type PrivateProviderCreator = (context: ProviderConnectorContext) => ProviderBinding | Promise<ProviderBinding>;
export interface LoadedProviderConnector {
  manifest: Readonly<ProviderConnectorManifest>;
  provider: ProviderFactory;
}
type ConnectorErrorCode = "PROVIDER_CONNECTOR_CONFIG_INVALID" | "PROVIDER_CONNECTOR_PATH_INVALID"
  | "PROVIDER_CONNECTOR_LOAD_FAILED" | "PROVIDER_CONNECTOR_MANIFEST_INVALID"
  | "PROVIDER_CONNECTOR_VERSION_UNSUPPORTED" | "PROVIDER_CONNECTOR_FACTORY_INVALID"
  | "PROVIDER_CONNECTOR_CHANGED" | "PROVIDER_CONNECTOR_CREATE_FAILED" | "PROVIDER_CONNECTOR_BINDING_INVALID";
/** Never attach the original exception: it can contain tokens or company-only endpoint details. */
export class ProviderConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode) { super(code); this.name = "ProviderConnectorError"; }
}
function fail(code: ConnectorErrorCode): never { throw new ProviderConnectorError(code); }
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 256): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

function copyOptions(value: unknown): Readonly<Record<string, unknown>> {
  let nodes = 0;
  function copy(item: unknown, depth: number): unknown {
    if (++nodes > 4096 || depth > 12) fail("PROVIDER_CONNECTOR_CONFIG_INVALID");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return Object.freeze(item.map(child => copy(child, depth + 1)));
    if (!record(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail("PROVIDER_CONNECTOR_CONFIG_INVALID");
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("PROVIDER_CONNECTOR_CONFIG_INVALID");
      result[key] = copy(child, depth + 1);
    }
    return Object.freeze(result);
  }
  if (!record(value)) fail("PROVIDER_CONNECTOR_CONFIG_INVALID");
  const copied = copy(value, 0) as Readonly<Record<string, unknown>>;
  if (Buffer.byteLength(JSON.stringify(copied)) > 65_536) fail("PROVIDER_CONNECTOR_CONFIG_INVALID");
  return copied;
}

function parseManifest(value: unknown): Readonly<ProviderConnectorManifest> {
  if (!record(value) || Object.keys(value).some(key => !["apiVersion", "id", "displayName"].includes(key)))
    fail("PROVIDER_CONNECTOR_MANIFEST_INVALID");
  if (value.apiVersion !== 1) fail("PROVIDER_CONNECTOR_VERSION_UNSUPPORTED");
  if (typeof value.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.id) || !text(value.displayName, 100))
    fail("PROVIDER_CONNECTOR_MANIFEST_INVALID");
  return Object.freeze({ apiVersion: 1, id: value.id, displayName: value.displayName });
}

/** Checks the entry point, not its dependency graph. A private connector is trusted host code. */
async function entryFile(workspaceDir: string, module: string): Promise<{ workspaceDir: string; file: string; digest: string }> {
  const segments = module.split("/");
  if (module.length > 240 || segments.length < 2 || segments.length > 8 || segments[0] !== "connectors"
    || !segments.every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) || !module.endsWith(".mjs"))
    fail("PROVIDER_CONNECTOR_PATH_INVALID");
  try {
    const root = resolve(workspaceDir);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("PROVIDER_CONNECTOR_PATH_INVALID");
    const canonical = await realpath(root);
    let current = canonical;
    for (let index = 0; index < segments.length; index++) {
      current = join(current, segments[index]!);
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index === segments.length - 1 ? !info.isFile() || info.size > 1_048_576 : !info.isDirectory()))
        fail("PROVIDER_CONNECTOR_PATH_INVALID");
    }
    if (await realpath(current) !== current) fail("PROVIDER_CONNECTOR_PATH_INVALID");
    return { workspaceDir: canonical, file: current, digest: createHash("sha256").update(await readFile(current)).digest("hex") };
  } catch { return fail("PROVIDER_CONNECTOR_PATH_INVALID"); }
}

function validateBinding(binding: unknown): asserts binding is ProviderBinding {
  if (!record(binding) || !text(binding.modelId) || !record(binding.provider)) fail("PROVIDER_CONNECTOR_BINDING_INVALID");
  const provider = binding.provider;
  if (!text(provider.id, 100) || !text(provider.name, 200) || typeof provider.getModels !== "function"
    || typeof provider.stream !== "function" || typeof provider.streamSimple !== "function" || !record(provider.auth))
    fail("PROVIDER_CONNECTOR_BINDING_INVALID");
  const { apiKey, oauth } = provider.auth;
  if (!(record(apiKey) && typeof apiKey.resolve === "function")
    && !(record(oauth) && [oauth.login, oauth.refresh, oauth.toAuth].every(method => typeof method === "function")))
    fail("PROVIDER_CONNECTOR_BINDING_INVALID");
  const models: unknown = provider.getModels();
  if (!Array.isArray(models) || models.length === 0 || models.length > 4096) fail("PROVIDER_CONNECTOR_BINDING_INVALID");
  const ids = new Set<string>();
  for (const model of models) {
    if (!record(model) || !text(model.id) || model.provider !== provider.id || !text(model.api) || ids.has(model.id)
      || !Number.isSafeInteger(model.contextWindow) || !Number.isSafeInteger(model.maxTokens)
      || Number(model.maxTokens) <= 0 || Number(model.contextWindow) <= Number(model.maxTokens)) fail("PROVIDER_CONNECTOR_BINDING_INVALID");
    ids.add(model.id);
  }
  if (!ids.has(binding.modelId)) fail("PROVIDER_CONNECTOR_BINDING_INVALID");
  if (binding.credentials !== undefined) {
    const credentials = binding.credentials;
    if (!record(credentials) || !["read", "list", "modify", "delete"].every(method => typeof credentials[method] === "function"))
      fail("PROVIDER_CONNECTOR_BINDING_INVALID");
  }
}

/**
 * Import an explicitly activated, host-installed connector. This is NOT a sandbox:
 * its module and dependencies execute with the Pida process's operating-system rights.
 * The caller must enforce host-only activation and protect connector files from agent tools.
 */
export async function loadProviderConnector(
  workspaceDir: string,
  config: ProviderConnectorConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedProviderConnector> {
  let options: Readonly<Record<string, unknown>>;
  try {
    if (!record(config) || typeof config.module !== "string" || Object.keys(config).some(key => !["module", "options"].includes(key)))
      fail("PROVIDER_CONNECTOR_CONFIG_INVALID");
    options = copyOptions(config.options ?? {});
  } catch { return fail("PROVIDER_CONNECTOR_CONFIG_INVALID"); }
  const module = config.module;
  const entry = await entryFile(workspaceDir, module);
  const url = pathToFileURL(entry.file);
  url.searchParams.set("pida_connector", entry.digest);
  let imported: Record<string, unknown>;
  try { imported = await import(url.href); } catch { return fail("PROVIDER_CONNECTOR_LOAD_FAILED"); }
  let manifest: Readonly<ProviderConnectorManifest>;
  try { manifest = parseManifest(imported.manifest); }
  catch (error) {
    if (error instanceof ProviderConnectorError) throw error;
    return fail("PROVIDER_CONNECTOR_MANIFEST_INVALID");
  }
  if (typeof imported.default !== "function") fail("PROVIDER_CONNECTOR_FACTORY_INVALID");
  const create = imported.default as PrivateProviderCreator;
  const context: ProviderConnectorContext = Object.freeze({ workspaceDir: entry.workspaceDir, env: Object.freeze({ ...env }), options });
  return Object.freeze({ manifest, provider: async () => {
    const current = await entryFile(entry.workspaceDir, module);
    if (current.digest !== entry.digest || current.file !== entry.file) fail("PROVIDER_CONNECTOR_CHANGED");
    let binding: unknown;
    try { binding = await create(context); } catch { return fail("PROVIDER_CONNECTOR_CREATE_FAILED"); }
    try { validateBinding(binding); } catch { return fail("PROVIDER_CONNECTOR_BINDING_INVALID"); }
    return binding;
  } });
}
