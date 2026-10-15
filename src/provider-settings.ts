import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PidaRuntime, PidaError } from "./runtime.js";
import { endpointProvider, mockProvider } from "./providers.js";
import {
  readConfig,
  validateConfig,
  workspaceEnvironment,
  type WorkspaceConfig,
} from "./workspace.js";

type ProviderConfig = WorkspaceConfig["provider"];
interface SavedKey {
  baseUrl: string;
  api: string;
  apiKeyEnv: string;
  key: string;
}
function keyPath(directory: string, config: WorkspaceConfig) {
  return join(resolve(directory), config.stateDir, "provider-key.json");
}
function savedKey(
  directory: string,
  config: WorkspaceConfig,
): SavedKey | undefined {
  const path = keyPath(directory, config);
  if (!existsSync(path)) return;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof value.key !== "string" ||
    typeof value.baseUrl !== "string" ||
    typeof value.api !== "string" ||
    typeof value.apiKeyEnv !== "string"
  )
    throw new Error("Invalid local provider credential file");
  return value;
}
export function providerEnvironment(
  directory: string,
  config: WorkspaceConfig,
): NodeJS.ProcessEnv {
  const env = workspaceEnvironment(directory),
    secret = savedKey(directory, config),
    provider = config.provider;
  if (
    provider.kind === "endpoint" &&
    secret &&
    secret.baseUrl === provider.baseUrl &&
    secret.api === provider.api &&
    secret.apiKeyEnv === provider.apiKeyEnv
  )
    env[provider.apiKeyEnv] = secret.key;
  return env;
}
export function providerLabel(provider: ProviderConfig) {
  return provider.kind === "mock"
    ? { mode: "mock", model: "Deterministic demo" }
    : { mode: "endpoint", model: provider.modelId };
}
function atomicWrite(path: string, content: string, mode = 0o600) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { flag: "wx", mode });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
function sameTarget(a: ProviderConfig, b: ProviderConfig) {
  return (
    a.kind === "endpoint" &&
    b.kind === "endpoint" &&
    a.baseUrl === b.baseUrl &&
    a.api === b.api
  );
}
export class ProviderSettings {
  private busy = false;
  constructor(
    private directory: string,
    private runtime: PidaRuntime,
  ) {}
  get() {
    const config = readConfig(this.directory),
      provider = config.provider;
    return {
      provider,
      keyConfigured:
        provider.kind === "endpoint" &&
        provider.authMode !== "none" &&
        !!providerEnvironment(this.directory, config)[provider.apiKeyEnv],
    };
  }
  private draft(input: Record<string, unknown>, requireModel = true) {
    const allowed = [
      "kind",
      "api",
      "baseUrl",
      "modelId",
      "apiKey",
      "authMode",
      "allowInsecureHttp",
      "contextWindow",
      "maxTokens",
    ];
    if (Object.keys(input).some((k) => !allowed.includes(k)))
      throw new PidaError("UNKNOWN_FIELD", 400);
    if (
      input.apiKey !== undefined &&
      (typeof input.apiKey !== "string" ||
        input.apiKey.length > 4096 ||
        /[\r\n\0]/.test(input.apiKey))
    )
      throw new PidaError("INVALID_API_KEY", 400);
    const config = readConfig(this.directory),
      current = config.provider;
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (input.kind === "mock")
      return {
        config: { ...config, provider: { kind: "mock" } as ProviderConfig },
        env: workspaceEnvironment(this.directory),
        apiKey: "",
      };
    if (input.kind !== "endpoint" || typeof input.baseUrl !== "string")
      throw new PidaError("INVALID_PROVIDER", 400);
    let baseUrl: string;
    try {
      const url = new URL(input.baseUrl.trim());
      if (url.search || url.hash || url.username || url.password)
        throw new Error();
      baseUrl = url.href
        .replace(/\/$/, "")
        .replace(/\/(chat\/completions|responses|messages)$/, "");
    } catch {
      throw new PidaError("INVALID_PROVIDER_URL", 400);
    }
    const provider = {
      kind: "endpoint",
      baseUrl,
      api: input.api ?? "openai-completions",
      modelId: input.modelId || (requireModel ? "" : "model-discovery"),
      apiKeyEnv:
        current.kind === "endpoint" ? current.apiKeyEnv : "PIDA_LLM_API_KEY",
      authMode: input.authMode ?? "api-key",
      contextWindow: input.contextWindow ?? 8192,
      maxTokens: input.maxTokens ?? 1024,
      allowInsecureHttp: input.allowInsecureHttp ?? false,
    };
    let next: WorkspaceConfig;
    try {
      next = validateConfig({ ...config, provider }, this.directory);
    } catch {
      throw new PidaError("INVALID_PROVIDER", 400);
    }
    const env: NodeJS.ProcessEnv = {};
    // A blank field retains a saved key only for the unchanged URL+protocol.
    // Changing destinations never forwards ambient/previous credentials implicitly.
    env[provider.apiKeyEnv] =
      apiKey ||
      (sameTarget(current, next.provider)
        ? providerEnvironment(this.directory, config)[provider.apiKeyEnv]
        : undefined);
    if (provider.authMode !== "none" && !env[provider.apiKeyEnv])
      throw new PidaError("PROVIDER_KEY_REQUIRED", 400);
    return { config: next, env, apiKey };
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new PidaError("SETUP_BUSY", 409);
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
  async models(input: Record<string, unknown>) {
    return this.exclusive(async () => {
      const { config, env } = this.draft(input, false),
        p = config.provider;
      if (p.kind === "mock") return { models: [] };
      const headers: Record<string, string> = {};
      if (p.api === "anthropic-messages")
        headers["anthropic-version"] = "2023-06-01";
      if (p.authMode !== "none") {
        if (p.api === "anthropic-messages")
          headers["x-api-key"] = env[p.apiKeyEnv]!;
        else headers.Authorization = `Bearer ${env[p.apiKeyEnv]}`;
      }
      try {
        const response = await fetch(`${p.baseUrl}/models`, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
          throw new PidaError(
            response.status === 401 || response.status === 403
              ? "PROVIDER_AUTH_FAILED"
              : "MODEL_LIST_UNAVAILABLE",
            400,
          );
        if (!response.body) throw new Error();
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1_048_576) throw new Error();
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const models = [
          ...new Set<string>(
            (Array.isArray(value.data) ? value.data : [])
              .filter(
                (m: any) => typeof m?.id === "string" && m.id.length <= 300,
              )
              .map((m: any) => m.id),
          ),
        ].slice(0, 200);
        return { models };
      } catch (error) {
        if (error instanceof PidaError) throw error;
        throw new PidaError("MODEL_LIST_UNAVAILABLE", 400);
      }
    });
  }
  private async probe(draft: ReturnType<ProviderSettings["draft"]>) {
    const p = draft.config.provider;
    if (p.kind === "mock") return { ok: true, scope: "mock" };
    const probe = new PidaRuntime({
      provider: endpointProvider(
        { id: "setup-probe", ...p, maxTokens: Math.min(32, p.maxTokens) },
        draft.env,
      ),
      tools: [],
      maxRunMs: 15_000,
      maxTurns: 1,
    });
    const principal = { id: "setup-probe", permissions: [] };
    try {
      const { sessionId } = await probe.createSession(principal);
      const result = await probe.run(
        sessionId,
        principal,
        "Reply briefly with OK.",
      );
      if (result.status !== "completed" || !result.text.trim())
        throw new Error();
      return { ok: true, scope: "model-response" };
    } catch {
      throw new PidaError("PROVIDER_TEST_FAILED", 400);
    } finally {
      await probe.close();
    }
  }
  async test(input: Record<string, unknown>) {
    return this.exclusive(() => this.probe(this.draft(input)));
  }
  async apply(input: Record<string, unknown>) {
    return this.exclusive(async () => {
      this.runtime.assertIdle();
      const draft = this.draft(input);
      const verified = await this.probe(draft);
      this.runtime.assertIdle(); // A run could have started while awaiting the probe.
      const p = draft.config.provider;
      const provider =
        p.kind === "mock"
          ? mockProvider
          : endpointProvider({ id: "workspace", ...p }, draft.env);
      const file = keyPath(this.directory, draft.config),
        oldKey = existsSync(file) ? readFileSync(file, "utf8") : undefined;
      if (draft.apiKey && p.kind === "endpoint" && p.authMode !== "none") {
        mkdirSync(join(resolve(this.directory), draft.config.stateDir), {
          recursive: true,
          mode: 0o700,
        });
        atomicWrite(
          file,
          JSON.stringify({
            baseUrl: p.baseUrl,
            api: p.api,
            apiKeyEnv: p.apiKeyEnv,
            key: draft.apiKey,
          }),
        );
      }
      try {
        atomicWrite(
          join(resolve(this.directory), "pida.config.json"),
          JSON.stringify(draft.config, null, 2) + "\n",
        );
      } catch {
        if (oldKey === undefined) rmSync(file, { force: true });
        else atomicWrite(file, oldKey);
        throw new PidaError("CONFIG_SAVE_FAILED", 500);
      }
      this.runtime.configureProvider(provider, providerLabel(p));
      return {
        ...verified,
        applied: true,
        provider: p,
        keyConfigured:
          p.kind === "endpoint" &&
          p.authMode !== "none" &&
          !!draft.env[p.apiKeyEnv],
      };
    });
  }
}
