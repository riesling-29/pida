/** Metadata-only extraction through Pi's public provider-event hook. Never retain raw events. */
type Counts = Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "reasoning" | "total", number>>;
const object = (value: unknown): Record<string, any> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export class ModelAttemptUsage {
  private counts: Counts = {};
  private seen = false;
  private invalid = false;
  private inputIncludesCache = true;
  /** Only known wire formats are interpreted. Private adapters may leave usage unknown. */
  accept(api: string, event: unknown): void {
    const value = object(event);
    if (!value) return;
    let usage: Record<string, any> | undefined;
    let fields: Partial<Record<keyof Counts, unknown>>;
    if (api === "openai-completions") {
      usage = object(value.usage) ?? object(value.choices?.[0]?.usage);
      if (!usage) return;
      fields = { input: usage.prompt_tokens, output: usage.completion_tokens, total: usage.total_tokens,
        cacheRead: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens,
        cacheWrite: usage.prompt_tokens_details?.cache_write_tokens, reasoning: usage.completion_tokens_details?.reasoning_tokens };
    } else if (["openai-responses", "azure-openai-responses", "openai-codex-responses"].includes(api)) {
      usage = object(value.response?.usage);
      if (!usage) return;
      fields = { input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens,
        cacheRead: usage.input_tokens_details?.cached_tokens, reasoning: usage.output_tokens_details?.reasoning_tokens };
    } else if (api === "anthropic-messages") {
      usage = object(value.message?.usage) ?? object(value.usage);
      if (!usage) return;
      this.inputIncludesCache = false;
      fields = { input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens };
    } else if (api === "google-generative-ai" || api === "google-vertex") {
      usage = object(value.usageMetadata);
      if (!usage) return;
      // Gemini's candidates count excludes thoughts. Preserve that distinction.
      const candidates = usage.candidatesTokenCount, thoughts = usage.thoughtsTokenCount;
      fields = { input: usage.promptTokenCount, output: count(candidates) && count(thoughts) ? candidates + thoughts : undefined,
        total: usage.totalTokenCount, cacheRead: usage.cachedContentTokenCount, reasoning: thoughts };
    } else return;
    this.seen = true;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!count(value)) { this.invalid = true; continue; }
      this.counts[key as keyof Counts] = value;
    }
  }
  snapshot(normalized?: import("@earendil-works/pi-ai").Usage): Record<string, string | number | null> {
    // Pi requires numeric zero defaults even when a backend supplies no usage.
    // A nonzero, consistent SDK result is useful for other adapters/host mocks,
    // but zero buckets cannot establish that the provider reported zero.
    if (!this.seen && normalized && [normalized.input, normalized.output, normalized.cacheRead, normalized.cacheWrite, normalized.totalTokens].every(count) &&
        normalized.totalTokens > 0 && normalized.totalTokens === normalized.input + normalized.output + normalized.cacheRead + normalized.cacheWrite) {
      return { usage_status: "normalized", input_tokens: normalized.input + normalized.cacheRead + normalized.cacheWrite || null,
        uncached_input_tokens: normalized.input || null, output_tokens: normalized.output || null,
        cache_read_tokens: normalized.cacheRead || null, cache_write_tokens: normalized.cacheWrite || null,
        reasoning_tokens: count(normalized.reasoning) && normalized.reasoning > 0 && normalized.reasoning <= normalized.output ? normalized.reasoning : null,
        tokens: normalized.totalTokens };
    }
    const c = this.counts;
    const cache = c.cacheRead !== undefined && c.cacheWrite !== undefined ? c.cacheRead + c.cacheWrite : undefined;
    const input = this.inputIncludesCache ? c.input : c.input !== undefined && cache !== undefined ? c.input + cache : undefined;
    const total = input !== undefined && c.output !== undefined ? input + c.output : c.total;
    const contradictory = this.invalid || (total !== undefined && !count(total)) ||
      (input !== undefined && c.cacheRead !== undefined && c.cacheRead > input) ||
      (input !== undefined && cache !== undefined && cache > input) ||
      (c.reasoning !== undefined && c.output !== undefined && c.reasoning > c.output) ||
      (c.total !== undefined && ((input !== undefined && input > c.total) || (c.output !== undefined && c.output > c.total))) ||
      (c.total !== undefined && total !== undefined && c.total !== total);
    const valid = this.seen && !contradictory;
    return {
      usage_status: contradictory ? "invalid" : !this.seen ? "unknown" : total === undefined ? "partial" : "reported",
      // input_tokens includes cached prompt tokens. These fields are not additive with cache buckets.
      input_tokens: valid ? input ?? null : null,
      uncached_input_tokens: valid ? !this.inputIncludesCache ? c.input ?? null : input !== undefined && cache !== undefined ? input - cache : null : null,
      output_tokens: valid ? c.output ?? null : null,
      cache_read_tokens: valid ? c.cacheRead ?? null : null,
      cache_write_tokens: valid ? c.cacheWrite ?? null : null,
      reasoning_tokens: valid ? c.reasoning ?? null : null,
      tokens: valid ? total ?? null : null,
    };
  }
}
