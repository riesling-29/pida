import { Type } from "typebox";
import { CodemodeSandbox, renderDeclarations, type CodemodeTool, type CodemodeResult } from "@earendil-works/pi-codemode";
import type { BusinessTool } from "./runtime.js";

export const composeToolName = "program_compose";
export const composePermission = "programs:compose";
export interface CodemodeConfig {
  enabled: boolean;
  tools?: readonly string[];
  maxCalls?: number;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  /** Maximum JSON characters returned by the composition, including its metadata. */
  maxOutputChars?: number;
}
export interface ResolvedCodemodeConfig {
  enabled: boolean; tools: readonly string[]; maxCalls: number; timeoutMs: number;
  memoryLimitBytes: number; maxOutputChars: number;
}

/** Host configuration only. Model source/options cannot raise these bounds. */
export function normalizeCodemodeConfig(value: unknown): ResolvedCodemodeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CODEMODE_CONFIG");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["enabled", "tools", "maxCalls", "timeoutMs", "memoryLimitBytes", "maxOutputChars"].includes(key)) || typeof input.enabled !== "boolean") throw new Error("INVALID_CODEMODE_CONFIG");
  const tools = input.tools ?? [];
  if (!Array.isArray(tools) || tools.length > 64 || (input.enabled && !Array.isArray(input.tools)) || tools.some(name => typeof name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(name) || name === composeToolName) || new Set(tools).size !== tools.length) throw new Error("INVALID_CODEMODE_TOOLS");
  const limit = (key: string, fallback: number, min: number, max: number) => {
    const n = input[key] ?? fallback;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) throw new Error("INVALID_CODEMODE_LIMIT");
    return n;
  };
  return Object.freeze({ enabled: input.enabled, tools: Object.freeze([...tools]), maxCalls: limit("maxCalls", 16, 1, 64), timeoutMs: limit("timeoutMs", 30_000, 100, 120_000), memoryLimitBytes: limit("memoryLimitBytes", 32 * 1024 * 1024, 4 * 1024 * 1024, 128 * 1024 * 1024), maxOutputChars: limit("maxOutputChars", 8192, 256, 24_000) });
}

interface ComposeResult {
  ok: boolean; output: string; value?: unknown; code?: string; callCount: number;
  calls: { name: string; status: string; durationMs: number }[]; truncated: boolean; autoReplay: false;
}
function projectResult(result: CodemodeResult, limit: number, code?: string): ComposeResult {
  const output = [...(!result.ok ? [`${result.error.kind}: ${result.error.message.slice(0, 1024)}`] : []), ...result.output.map(item => item.type === "text" ? item.text : "[image output omitted]")].join("\n");
  const value: ComposeResult = { ok: !code && result.ok, output: "", ...(code ? { code } : {}), callCount: result.calls.length, calls: [], truncated: false, autoReplay: false };
  // Preserve status and bounded call metadata before using the remaining space for script output.
  for (const call of result.calls) {
    value.calls.push({ name: call.name, status: call.status, durationMs: Math.max(0, Math.round(call.durationMs)) });
    if (JSON.stringify(value).length > limit) { value.calls.pop(); value.truncated = true; break; }
  }
  if (result.ok && result.value !== undefined) {
    value.value = result.value;
    if (JSON.stringify(value).length > limit) { delete value.value; value.truncated = true; }
  }
  let low = 0, high = output.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2); value.output = output.slice(0, mid);
    if (JSON.stringify(value).length <= limit) low = mid; else high = mid - 1;
  }
  value.output = output.slice(0, low);
  if (low < output.length) value.truncated = true;
  return value;
}

/** Tools contain declarations only; execution always uses Pi's guarded nested-call pipeline. */
export function createProgramComposeTool(config: ResolvedCodemodeConfig, registered: readonly BusinessTool<any>[]): BusinessTool | undefined {
  if (!config.enabled) return undefined;
  const byName = new Map(registered.map(tool => [tool.name, tool]));
  const allowed = config.tools.map(name => {
    const tool = byName.get(name);
    if (!tool || name === composeToolName) throw new Error("CODEMODE_TOOL_UNAVAILABLE");
    return tool;
  });
  const declarations: CodemodeTool[] = allowed.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters, execute: () => undefined }));
  return {
    name: composeToolName, permission: composePermission,
    // The container has no direct effects. Each nested tool owns its real effect receipt.
    effect: "read",
    parameters: Type.Object({ code: Type.String({ minLength: 1, maxLength: 65_536 }) }, { additionalProperties: false }),
    description: `Run an async JavaScript body in Pi CodemodeSandbox. Only the declared tools that your current permissions allow are injected. Await every call. Use Promise.all for independent reads; mutations execute serially. text() or return publishes bounded results. No filesystem, network, process, modules or persistent store is exposed directly. No recursive composition. Failures never automatically replay the script or its writes. Limits: ${config.maxCalls} nested calls, ${config.timeoutMs} ms, ${config.memoryLimitBytes} heap bytes, ${config.maxOutputChars} result characters.\n\n${renderDeclarations({ tools: declarations })}`,
    async execute(args, context) {
      if (!context.executeTool) throw new Error("CODEMODE_DISPATCH_UNAVAILABLE");
      const limitAbort = new AbortController(), pending = new Set<Promise<unknown>>();
      const signal = AbortSignal.any([context.signal, limitAbort.signal]);
      let count = 0, forcedCode: string | undefined;
      const tools: CodemodeTool[] = allowed.filter(tool => context.principal.permissions.includes(tool.permission)).map(tool => ({
        name: tool.name, description: tool.description, inputSchema: tool.parameters,
        execute: async (input, nested) => {
          signal.throwIfAborted();
          if (++count > config.maxCalls) {
            forcedCode = "COMPOSE_CALL_LIMIT"; limitAbort.abort(new Error(forcedCode)); throw new Error(forcedCode);
          }
          const call = context.executeTool!(tool.name, input, AbortSignal.any([signal, nested.signal]));
          pending.add(call);
          try { return await call; } finally { pending.delete(call); }
        },
      }));
      const sandbox = new CodemodeSandbox({ tools, timeoutMs: config.timeoutMs, memoryLimitBytes: config.memoryLimitBytes });
      let result: CodemodeResult;
      try { result = await sandbox.execute((args as { code: string }).code, { signal }); }
      finally {
        await sandbox.close();
        // Pi records nested outcomes before the parent settles, even for unawaited calls.
        await Promise.allSettled([...pending]);
      }
      const code = forcedCode ?? (!result.ok ? ({ timeout: "COMPOSE_TIMEOUT", aborted: "COMPOSE_CANCELLED", sandbox: "COMPOSE_SANDBOX_FAILED", script: "COMPOSE_SCRIPT_FAILED" }[result.error.kind])
        : result.calls.some(call => call.status === "cancelled") ? "COMPOSE_UNAWAITED_CALLS"
        : result.calls.some(call => call.status === "error") ? "COMPOSE_TOOL_FAILED" : undefined);
      return projectResult(result, config.maxOutputChars, code);
    },
    classifyResult(value) {
      const result = value as ComposeResult;
      return result.ok ? { status: "completed" } : { status: "failed", code: result.code ?? "COMPOSE_FAILED" };
    },
  };
}
