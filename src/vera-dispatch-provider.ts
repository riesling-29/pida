import { createVeraPersonaProvider, type VeraPersonaOptions, type VeraPersonaPort } from "./vera-persona-provider.js";
import type { PersonaProvider, PersonaRequest } from "./persona-provider.js";
import type { RunContextSnapshot } from "./run-context.js";
import { PidaError } from "./runtime.js";

export const veraDispatchProtocol = "vera-dispatch/0.1.0" as const;
export const veraDispatchCapabilities = ["identity", "memory-context", "linear-working-state", "dispatch-authorization"] as const;
const unsupported = ["working-graph", "behavior-models", "analysis-references", "artifact-references", "producer-receipts"];
export interface VeraDispatchPort {
  describe(request: { signal: AbortSignal }): Promise<unknown>;
  resolve(request: PersonaRequest & { protocol: typeof veraDispatchProtocol; requiredCapabilities: string[] }): Promise<{ protocol: string; binding: unknown; context: unknown }>;
  authorizeInput(request: Parameters<VeraPersonaPort["authorizeInput"]>[0] & { protocol: typeof veraDispatchProtocol }): ReturnType<VeraPersonaPort["authorizeInput"]>;
}
export interface VeraDispatchOptions extends Omit<VeraPersonaOptions, "port"> {
  /** Explicit host opt-in. A familiar context wire shape is not capability negotiation. */
  protocol: typeof veraDispatchProtocol;
  requiredCapabilities: readonly string[];
  port: VeraDispatchPort;
}
const fail = (): never => { throw new PidaError("VERA_DISPATCH_PROFILE_UNSUPPORTED", 403); };
const exactSet = (value: unknown, expected: readonly string[]) => Array.isArray(value) && value.length === expected.length && new Set(value).size === value.length && value.every(v => expected.includes(v));
export function validVeraDispatchDescription(value: unknown): boolean {
  const d = value as Record<string, unknown>;
  return !!d && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length === 6
    && d.protocol === veraDispatchProtocol && d.contextSchema === "vera-continuity/0.2.0" && d.stalePolicy === "strict-current/1"
    && exactSet(d.renderers, ["vera-json/1", "vera-reference-text/1"])
    && exactSet(d.capabilities, veraDispatchCapabilities) && exactSet(d.unsupported, unsupported);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value;
}
/** Opt-in consumer for a new limited producer, not a replacement for historical continuity evidence. */
export function createVeraDispatchPersonaProvider(options: VeraDispatchOptions): PersonaProvider {
  if (!Array.isArray(options.requiredCapabilities)) return fail();
  const required = [...options.requiredCapabilities];
  if (options.protocol !== veraDispatchProtocol || !required.length || new Set(required).size !== required.length
    || required.some(c => !(veraDispatchCapabilities as readonly string[]).includes(c)) || typeof options.port?.describe !== "function"
    || typeof options.port.resolve !== "function" || typeof options.port.authorizeInput !== "function") fail();
  const port = options.port;
  const negotiate = async (signal: AbortSignal) => {
    signal.throwIfAborted(); const description = await port.describe({ signal }); signal.throwIfAborted();
    if (!validVeraDispatchDescription(description)) fail();
  };
  const inner = createVeraPersonaProvider({ ...options, port: {
    async resolve(request) {
      await negotiate(request.signal);
      const selected = await port.resolve({ ...request, protocol: veraDispatchProtocol, requiredCapabilities: [...required] });
      request.signal.throwIfAborted();
      if (!selected || Object.keys(selected).some(k => !["protocol", "binding", "context"].includes(k)) || selected.protocol !== veraDispatchProtocol) fail();
      const context = selected.context as Record<string, unknown>;
      if (!context || context.branch !== "main" || ["model_refs", "model_activations", "analysis_refs", "artifact_refs"].some(k => !Array.isArray(context[k]) || context[k].length !== 0)) fail();
      let rendered: any;
      try {
        const text = context.text as string;
        rendered = JSON.parse(context.renderer_version === "vera-json/1" ? text : text.slice("Vera continuity reference (vera-continuity/0.2.0)\n".length));
      } catch { fail(); }
      if (rendered?.producer_profile !== veraDispatchProtocol || !exactSet(rendered.behavioral_models, []) || !exactSet(rendered.behavioral_analyses, [])) fail();
      return { binding: selected.binding, context: selected.context };
    },
    async authorizeInput(request) {
      await negotiate(request.signal);
      return port.authorizeInput({ ...request, protocol: veraDispatchProtocol });
    },
  } });
  const originals = new WeakMap<RunContextSnapshot, RunContextSnapshot>();
  const provider: PersonaProvider = {
    id: "pida.vera-dispatch/0.1.0", agentId: inner.agentId, authority: "external",
    async resolveContext(request) {
      const original = await inner.resolveContext(request), snapshot = structuredClone(original);
      snapshot.descriptor.personaBinding!.providerId = provider.id;
      originals.set(snapshot, original); return freeze(snapshot);
    },
    async authorizeInput(request) {
      const original = originals.get(request.snapshot); if (!original) return fail();
      await inner.authorizeInput!({ ...request, snapshot: original });
    },
  };
  return provider;
}
