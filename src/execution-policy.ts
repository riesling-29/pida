import { canonical, sha256 } from "./private-state.js";

/** Trusted managed-host selection. Never renderer-supplied arbitrary runtime options. */
export interface ExecutionPolicy {
  schema_version: "pida.execution-policy/1";
  id: "smoke/1" | "work/1";
  run_timeout_ms: number; organization_timeout_ms: number; join_timeout_ms: number;
  max_turns: 24; max_tool_calls: 48; max_provider_retries: 0; max_output_retries: 0;
  max_repair_attempts: 0; max_total_tokens: 16384; max_concurrent: 2; digest: string;
}
export function resolveExecutionPolicy(id: unknown = "smoke/1"): Readonly<ExecutionPolicy> {
  if (id !== "smoke/1" && id !== "work/1") throw Error("EXECUTION_POLICY_INVALID");
  const body = { schema_version: "pida.execution-policy/1" as const, id: id as ExecutionPolicy["id"],
    run_timeout_ms: id === "smoke/1" ? 20000 : 180000,
    organization_timeout_ms: id === "smoke/1" ? 60000 : 900000,
    join_timeout_ms: id === "smoke/1" ? 60000 : 900000,
    max_turns: 24 as const, max_tool_calls: 48 as const, max_provider_retries: 0 as const, max_output_retries: 0 as const,
    max_repair_attempts: 0 as const, max_total_tokens: 16384 as const, max_concurrent: 2 as const };
  return Object.freeze({ ...body, digest: sha256(canonical(body)) });
}
export function validateExecutionPolicy(value: unknown): Readonly<ExecutionPolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw Error("EXECUTION_POLICY_INVALID");
  const expected = resolveExecutionPolicy((value as ExecutionPolicy).id);
  if (Object.keys(value).length !== Object.keys(expected).length || canonical(value) !== canonical(expected)) throw Error("EXECUTION_POLICY_INVALID");
  return expected;
}
export function executionRuntimeBounds(policy: Readonly<ExecutionPolicy>) {
  return { maxRunMs: policy.run_timeout_ms, maxTurns: policy.max_turns, maxToolCalls: policy.max_tool_calls,
    maxProviderRetries: policy.max_provider_retries, maxOutputRetries: policy.max_output_retries,
    maxTotalTokens: policy.max_total_tokens, autoCompaction: false };
}
