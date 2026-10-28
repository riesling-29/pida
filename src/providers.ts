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
}

/** Credentials resolve server-side on each request; no shell interpolation. */
export function endpointProvider(
  config: EndpointConfig,
  env: NodeJS.ProcessEnv = process.env,
): ProviderFactory {
  const c = Object.freeze({ ...config });
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
    return {
      provider: createProvider({
        id: c.id,
        baseUrl: c.baseUrl,
        auth: {
          apiKey: {
            name: c.id,
            resolve: async () => {
              if (c.authMode === "none")
                return {
                  auth: {
                    apiKey: "pida-no-auth",
                    headers: { Authorization: null, "x-api-key": null },
                  },
                };
              const apiKey = env[c.apiKeyEnv];
              if (!apiKey) throw new Error("Provider credential unavailable");
              return { auth: { apiKey } };
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
            // Pi requires cost metadata. Zero is a placeholder, NOT a price estimate.
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      }),
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
