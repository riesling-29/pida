import { Type } from "typebox";
import { CommandManager } from "./commands.js";
import { PidaError, type BusinessTool, type ToolContext } from "./runtime.js";

/** Host-owned handles; model arguments never select an executor, environment or workspace. */
export function createCommandTools(manager: CommandManager, revision: () => string): BusinessTool<any>[] {
  const id = Type.String({ pattern: "^cmd_[a-f0-9]{32}$" });
  const outcome = (value: any) => ({ status: value.ok ? "completed" as const : "failed" as const, ...(value.error ? { code: value.error } : {}) });
  const call = async (fn: () => unknown | Promise<unknown>, start = false) => {
    try { return { ok: true, ...await fn() as object, ...(start ? { effectState: "applied" } : {}) }; }
    catch (error) { if (error instanceof PidaError && error.code === "FORBIDDEN") throw error; return { ok: false, error: error instanceof PidaError ? error.code : "COMMAND_FAILED", ...(start ? { effectState: "not_applied" } : {}) }; }
  };
  const tools: BusinessTool<any>[] = [{
    name: "project_command_start", description: "Start an approved host-project command and return its persistent handle. This acknowledges admission, not completion. Use project_command_wait/read to inspect the actual outcome. A short wait does not stop the command; its separate execution deadline does. Host execution is not sandboxed unless an explicitly configured backend enforces the requested policy.",
    parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 16000 }), deadlineMs: Type.Optional(Type.Integer({ minimum: 1, maximum: manager.capabilities().maxDeadlineMs })), pty: Type.Optional(Type.Boolean()), sandbox: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("read-only"), Type.Literal("workspace-write")])) }, { additionalProperties: false }),
    permission: "project:execute", effect: "write", effectRevision: revision, effectResult: (value: any) => value.effectState,
    classifyResult: outcome,
    execute: (args: any, context: ToolContext) => call(() => ({ accepted: true, completionVerified: false, command: manager.start(context.principal, { ...args, sessionId: context.sessionId, runId: context.runId, requestId: context.idempotencyKey ?? context.toolCallId }, context.signal) }), true),
  }, {
    name: "project_command_read", description: "Read status and bounded combined stdout/stderr from this session's command handle. Reads are non-consuming: UI polling cannot steal model output. Continue using nextOffset. lossy reports an unrecoverable output gap.",
    parameters: Type.Object({ id, offset: Type.Optional(Type.Integer({ minimum: 0 })), maxBytes: Type.Optional(Type.Integer({ minimum: 4, maximum: 16384 })) }, { additionalProperties: false }),
    permission: "project:read", effect: "read", classifyResult: outcome,
    execute: (args: any, c: ToolContext) => call(() => manager.read(c.principal, c.sessionId, args.id, args)),
  }, {
    name: "project_command_wait", description: "Wait briefly for a command's actual outcome. waitExpired only ends this wait; it does not cancel or restart the command. completed means the direct command exited successfully, not independent verification or proof that all descendants exited.",
    parameters: Type.Object({ id, waitTimeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 30000 })) }, { additionalProperties: false }),
    permission: "project:read", effect: "read", classifyResult: outcome,
    execute: (args: any, c: ToolContext) => call(() => manager.wait(c.principal, c.sessionId, args.id, args.waitTimeoutMs, c.signal)),
  }, {
    name: "project_command_cancel", description: "Request command cancellation. requested/stopping are not proof of termination; inspect the later outcome and recovery information. Cancellation does not roll back file changes.",
    parameters: Type.Object({ id }, { additionalProperties: false }), permission: "project:execute", effect: "idempotent", effectResult: (value: any) => value.ok ? "applied" : "not_applied", classifyResult: outcome,
    execute: (args: any, c: ToolContext) => call(() => manager.cancel(c.principal, c.sessionId, args.id)),
  }, {
    name: "project_command_list", description: "List this user's current-session command handles and the executor's actual supported capabilities. Interrupted commands are not automatically restarted.",
    parameters: Type.Object({ afterId: Type.Optional(id), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })) }, { additionalProperties: false }), permission: "project:read", effect: "read", classifyResult: outcome,
    execute: (args: any, c: ToolContext) => call(() => {
      const all = manager.list(c.principal, c.sessionId), index = args.afterId ? all.findIndex(r => r.id === args.afterId) + 1 : 0;
      if ((args.afterId && index === 0) || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 16))) throw new PidaError("COMMAND_ARGUMENT_INVALID", 400);
      const commands = all.slice(index, index + (args.limit ?? 8)), capabilities = manager.capabilities();
      while (commands.length > 1 && JSON.stringify({ commands, capabilities }).length > 25000) commands.pop();
      return { commands, capabilities, ...(index + commands.length < all.length ? { nextCursor: commands.at(-1)!.id } : {}) };
    }),
  }];
  return tools;
}
