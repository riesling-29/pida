import type { Provider } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
import type { ProviderFactory } from './providers.js';

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
}
function entry(id: string) {
  if (!Object.hasOwn(registry, id)) throw new Error('Unknown native provider');
  return registry[id]!;
}
export function nativeProviderCatalog() {
  return Object.entries(registry).map(([id, item]) => {
    const p = item.create();
    return {
      id, name: id === 'google' ? 'Google Gemini' : p.name,
      baseUrl: p.baseUrl, apiKeyEnv: item.apiKeyEnv, auth: 'api-key' as const,
      source: 'Pi SDK 1.2.0 bundled catalog',
      models: p.getModels().map(m => ({
        id: m.id, name: m.name, api: m.api,
        contextWindow: m.contextWindow, maxTokens: m.maxTokens,
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
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv) ||
      !p.getModels().some(m => m.id === config.modelId))
    throw new Error('Invalid native provider model or credential variable');
}
/** Use Pi's native request handling and metadata; scope auth to this workspace. */
export function nativeProvider(
  config: NativeProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  outputLimit?: number,
): ProviderFactory {
  validateNativeProvider(config);
  const c = { ...config };
  return () => {
    if (!env[c.apiKeyEnv]) throw new Error(`Missing provider credential environment variable: ${c.apiKeyEnv}`);
    const p = entry(c.providerId).create();
    const auth = p.auth.apiKey!;
    const provider: Provider = {
      ...p,
      // OAuth is deliberately not advertised until its complete login lifecycle is implemented.
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
    return { provider, modelId: c.modelId };
  };
}
