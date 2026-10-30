import { createProvider, type Provider, type CredentialStore } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai/providers/faux";

export interface ProviderBinding {
  provider: Provider;
  modelId: string;
  /** Host-owned, workspace-scoped credentials. Pi serializes OAuth refresh through this store. */
  credentials?: CredentialStore;
}
/** Host-owned factory, called once per session. Never accepted from HTTP input. */
export type ProviderFactory = () => ProviderBinding | Promise<ProviderBinding>;
export interface EndpointCompat {
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  supportsUsageInStreaming?: boolean;
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
}
export interface EndpointConfig {
  id: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages";
  baseUrl: string;
  modelId: string;
  apiKeyEnv: string;
  contextWindow: number;
  maxTokens: number;
  allowInsecureHttp?: boolean;
  authMode?: "api-key" | "none";
  /** Host-owned header -> environment-variable references. Never literal credentials. */
  headersEnv?: Record<string, string>;
  /** Explicit overrides for deployed OpenAI-compatible servers, implemented by Pi. */
  compat?: EndpointCompat;
}

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reservedHeaders = new Set(["host", "content-length", "content-type", "connection", "transfer-encoding", "upgrade", "trailer", "te", "proxy-authorization", "proxy-connection", "cookie", "set-cookie", "__proto__", "constructor", "prototype"]);
function validateEndpointExtras(config: EndpointConfig) {
  if (config.headersEnv !== undefined) {
    if (!config.headersEnv || typeof config.headersEnv !== "object" || Array.isArray(config.headersEnv) || Object.keys(config.headersEnv).length > 16)
      throw new Error("Invalid provider header configuration");
    const seen = new Set<string>();
    for (const [name, variable] of Object.entries(config.headersEnv)) {
      const lower = name.toLowerCase();
      if (name.length > 100 || !headerName.test(name) || reservedHeaders.has(lower) || seen.has(lower) || typeof variable !== "string" || !envName.test(variable) ||
          (config.authMode !== "none" && (lower === "authorization" || lower === "x-api-key")))
        throw new Error("Invalid provider header configuration");
      seen.add(lower);
    }
  }
  if (config.compat !== undefined) {
    if (config.api !== "openai-completions" || !config.compat || typeof config.compat !== "object" || Array.isArray(config.compat))
      throw new Error("Invalid provider compatibility configuration");
    for (const [key, value] of Object.entries(config.compat)) {
      if (key === "maxTokensField" ? !["max_tokens", "max_completion_tokens"].includes(value)
        : !["supportsUsageInStreaming", "supportsStore", "supportsDeveloperRole"].includes(key) || typeof value !== "boolean")
        throw new Error("Invalid provider compatibility configuration");
    }
  }
}
/** Shared by discovery and inference. No secret values or variable names in failures. */
export function endpointHeaders(config: EndpointConfig, env: NodeJS.ProcessEnv): Record<string, string> {
  validateEndpointExtras(config);
  const headers: Record<string, string> = {};
  if (config.api === "anthropic-messages") headers["anthropic-version"] = "2023-06-01";
  if (config.authMode !== "none") {
    const key = env[config.apiKeyEnv];
    if (!key || key.length > 4096 || /[^\x20-\xFF]|\x7F/.test(key)) throw new Error("Provider credential unavailable or invalid");
    headers[config.api === "anthropic-messages" ? "x-api-key" : "authorization"] = config.api === "anthropic-messages" ? key : `Bearer ${key}`;
  }
  for (const [name, variable] of Object.entries(config.headersEnv ?? {})) {
    const value = env[variable];
    if (!value || value.length > 4096 || /[^\x20-\xFF]|\x7F/.test(value)) throw new Error("Provider header credential unavailable or invalid");
    headers[name.toLowerCase()] = value;
  }
  return headers;
}
// Custom gateway headers must not follow a redirect to a different destination.
const endpointFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });

/** Credentials resolve server-side on each request; no shell interpolation. */
export function endpointProvider(
  config: EndpointConfig,
  env: NodeJS.ProcessEnv = process.env,
): ProviderFactory {
  validateEndpointExtras(config);
  const c = Object.freeze({ ...config,
    ...(config.headersEnv ? { headersEnv: Object.freeze({ ...config.headersEnv }) } : {}),
    ...(config.compat ? { compat: Object.freeze({ ...config.compat }) } : {}),
  });
  const url = new URL(c.baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && c.allowInsecureHttp))
  ) {
    throw new Error(
      "Provider URL must be HTTPS without credentials, query or fragment; HTTP requires explicit opt-in",
    );
  }
  if (
    !/^[a-zA-Z0-9_-]+$/.test(c.id) ||
    !c.modelId.trim() ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.apiKeyEnv)
  )
    throw new Error("Invalid provider configuration");
  if (
    !Number.isSafeInteger(c.contextWindow) ||
    !Number.isSafeInteger(c.maxTokens) ||
    c.maxTokens <= 0 ||
    c.contextWindow <= c.maxTokens
  )
    throw new Error("Invalid model limits");
  const apis = {
    "openai-completions": openAICompletionsApi,
    "openai-responses": openAIResponsesApi,
    "anthropic-messages": anthropicMessagesApi,
  };
  if (!Object.hasOwn(apis, c.api)) throw new Error("Unsupported API");
  return () => {
    if (c.authMode !== "none" && !env[c.apiKeyEnv])
      throw new Error(
        `Missing provider credential environment variable: ${c.apiKeyEnv}`,
      );
    const provider: Provider = createProvider({
        id: c.id,
        baseUrl: c.baseUrl,
        auth: {
          apiKey: {
            name: c.id,
            resolve: async () => {
              const headers = endpointHeaders(c, env);
              if (c.authMode === "none")
                return {
                  auth: {
                    apiKey: "pida-no-auth",
                    headers: { authorization: null, "x-api-key": null, ...headers },
                  },
                };
              const apiKey = env[c.apiKeyEnv];
              if (!apiKey) throw new Error("Provider credential unavailable");
              return { auth: { apiKey, headers } };
            },
          },
        },
        api: apis[c.api](),
        models: [
          {
            provider: c.id,
            id: c.modelId,
            name: c.modelId,
            api: c.api,
            baseUrl: c.baseUrl,
            reasoning: false,
            input: ["text"],
            contextWindow: c.contextWindow,
            maxTokens: c.maxTokens,
            ...(c.compat ? { compat: c.compat } : {}),
            // Pi requires cost metadata. Zero is a placeholder, NOT a price estimate.
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      });
    return {
      provider: { ...provider,
        stream: (model, context, options) => provider.stream(model, context, { ...options, fetch: endpointFetch } as typeof options),
        streamSimple: (model, context, options) => provider.streamSimple(model, context, { ...options, fetch: endpointFetch }),
      },
      modelId: c.modelId,
    };
  };
}

/** Deterministic demo, using Pi's real faux provider and real tool loop. Not an LLM. */
export function mockProvider(): ProviderBinding {
  const faux = fauxProvider({ provider: "pida-mock", tokensPerSecond: 500 });
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond]);
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return fauxAssistantMessage(
        last.isError
          ? "업무 도구 실행이 거부되었거나 실패했습니다."
          : `조회 결과 (합성 데모 데이터): ${last.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("")}`,
      );
    }
    const user = [...context.messages].reverse().find((m) => m.role === "user");
    const prompt =
      user?.role === "user"
        ? typeof user.content === "string"
          ? user.content
          : user.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("")
        : "";
    const lotId = prompt.match(/LOT-\d{3}/i)?.[0]?.toUpperCase() ?? "LOT-001";
    return fauxAssistantMessage(fauxToolCall("get_lot_status", { lotId }), {
      stopReason: "toolUse",
    });
  };
  faux.setResponses([respond]);
  return { provider: faux.provider, modelId: faux.getModel().id };
}
