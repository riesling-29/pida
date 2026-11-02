import { getSupportedThinkingLevels, type Provider, type CredentialStore, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
import { validateThinkingLevel, type ProviderFactory } from './providers.js';

// Factories and model metadata remain upstream-owned. No copied model catalog.
const registry: Record<string, { create: () => Provider; apiKeyEnv: string }> = {
  openai: { create: openaiProvider, apiKeyEnv: 'OPENAI_API_KEY' },
  anthropic: { create: anthropicProvider, apiKeyEnv: 'ANTHROPIC_API_KEY' },
  google: { create: googleProvider, apiKeyEnv: 'GEMINI_API_KEY' },
  openrouter: { create: openrouterProvider, apiKeyEnv: 'OPENROUTER_API_KEY' },
  deepseek: { create: deepseekProvider, apiKeyEnv: 'DEEPSEEK_API_KEY' },
  groq: { create: groqProvider, apiKeyEnv: 'GROQ_API_KEY' },
  xai: { create: xaiProvider, apiKeyEnv: 'XAI_API_KEY' },
  mistral: { create: mistralProvider, apiKeyEnv: 'MISTRAL_API_KEY' },
};
export interface NativeProviderConfig {
  kind: 'native';
  providerId: string;
  modelId: string;
  apiKeyEnv: string;
  authMode?: 'api-key' | 'chatgpt';
  thinkingLevel?: ModelThinkingLevel;
}
function entry(id: string) {
  if (!Object.hasOwn(registry, id)) throw new Error('Unknown native provider');
  return registry[id]!;
}
// Pi 1.2.0 emits flat tools. SIWC requires function/custom tools in namespaces.
// Keep the upstream request/stream engine; adapt only its public payload hook.
function chatgptPayload(payload: unknown) {
  const value = payload as Record<string, any>, result: Record<string, any> = { ...value, stream: true, store: false };
  for (const field of ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id']) delete result[field];
  if (Array.isArray(value.tools)) {
    const flat = value.tools.filter(t => t.type === 'function' || t.type === 'custom');
    result.tools = [...value.tools.filter(t => t.type !== 'function' && t.type !== 'custom'), ...(flat.length ? [{ type: 'namespace', name: 'pida', description: 'Authorized Pida tools', tools: flat }] : [])];
  }
  if (Array.isArray(value.input)) result.input = value.input.map(item => {
    if (item.role === 'system') return { ...item, role: 'developer' };
    if (['function_call', 'custom_tool_call'].includes(item.type) && !item.namespace) return { ...item, namespace: 'pida' };
    return item;
  });
  return result;
}
export function nativeProviderCatalog() {
  return Object.entries(registry).map(([id, item]) => {
    const p = item.create();
    return {
      id, name: id === 'google' ? 'Google Gemini' : p.name,
      baseUrl: p.baseUrl, apiKeyEnv: item.apiKeyEnv, auth: 'api-key' as const,
      ...(id === 'openai' ? { authModes: ['api-key', 'chatgpt'] } : {}),
      source: 'Pi SDK 1.2.0 bundled catalog',
      models: p.getModels().map(m => ({
        id: m.id, name: m.name, api: m.api,
        contextWindow: m.contextWindow, maxTokens: m.maxTokens,
        reasoning: m.reasoning, input: m.input, thinkingLevels: getSupportedThinkingLevels(m),
      })),
    };
  });
}
export function nativeProviderDefaults(providerId: string) {
  const item = entry(providerId);
  return { apiKeyEnv: item.apiKeyEnv, provider: item.create() };
}
export function validateNativeProvider(config: NativeProviderConfig) {
  const p = entry(config.providerId).create();
  if (config.authMode && !['api-key', 'chatgpt'].includes(config.authMode) || config.authMode === 'chatgpt' && config.providerId !== 'openai') throw new Error('Invalid native authentication mode');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv) ||
      !p.getModels().some(m => m.id === config.modelId))
    throw new Error('Invalid native provider model or credential variable');
  validateThinkingLevel(p.getModels().find(m => m.id === config.modelId)!, config.thinkingLevel);
}
/** Use Pi's native request handling and metadata; scope auth to this workspace. */
export function nativeProvider(
  config: NativeProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  outputLimit?: number,
  credentials?: CredentialStore,
): ProviderFactory {
  validateNativeProvider(config);
  const c = { ...config };
  return () => {
    if (c.authMode === 'chatgpt') {
      if (!credentials) throw new Error('ChatGPT credential store required');
      const p: Provider = openaiProvider();
      // OAuth only: an ambient API key must never silently change the billing path.
      const oauth = p.auth.oauth!;
      const provider: Provider = { ...p, auth: { oauth: { ...oauth, refresh: async (credential, signal) => {
        try { return await oauth.refresh(credential, signal); }
        catch { throw new Error('CHATGPT_REFRESH_FAILED'); } // Never persist a raw token-endpoint error in Pi transcripts.
      } } },
        streamSimple: (model, context, options) => p.streamSimple(model, context, { ...options, onPayload: async (payload, m) => chatgptPayload(await options?.onPayload?.(payload, m) ?? payload) }),
        stream: (model, context, options) => p.stream(model, context, { ...options, onPayload: async (payload: unknown, m: typeof model) => chatgptPayload(await options?.onPayload?.(payload, m) ?? payload) } as typeof options),
      };
      return { provider, modelId: c.modelId, credentials, ...(c.thinkingLevel !== undefined ? { thinkingLevel: c.thinkingLevel } : {}) };
    }
    if (!env[c.apiKeyEnv]) throw new Error(`Missing provider credential environment variable: ${c.apiKeyEnv}`);
    const p = entry(c.providerId).create();
    const auth = p.auth.apiKey!;
    const provider: Provider = {
      ...p,
      // API-key selection remains API-key-only even when OAuth credentials are stored.
      auth: { apiKey: { name: auth.name, resolve: async ({ signal }) => {
        const key = env[c.apiKeyEnv];
        if (!key) return undefined;
        return auth.resolve({ signal, credential: { type: 'api_key', key },
          ctx: { env: async () => undefined, fileExists: async () => false } });
      } } },
      ...(outputLimit ? {
        streamSimple: (model, context, options) => p.streamSimple(model, context, { ...options, maxTokens: outputLimit }),
      } : {}),
    };
    return { provider, modelId: c.modelId, ...(c.thinkingLevel !== undefined ? { thinkingLevel: c.thinkingLevel } : {}) };
  };
}
