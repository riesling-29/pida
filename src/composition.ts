import { createHash } from "node:crypto";
import type { WorkspaceConfig } from "./workspace.js";
import type { BusinessTool, Principal } from "./runtime.js";
import { PidaError } from "./runtime.js";
import type { ExtensionInventory, ExtensionScope } from "./extensions.js";
import type { McpServerInventory } from "./mcp.js";

export type WorkspacePreset = "coding" | "personal" | "headless";
export interface ToolContribution { source: string; scope: ExtensionScope; tools: readonly BusinessTool<any>[] }
export interface CompositionInventory {
  revision: string;
  preset: WorkspacePreset | "legacy";
  target: "main" | "agent";
  services: { web: boolean; workbench: boolean; project: boolean; agents: boolean };
  tools: { name: string; permission: string; source: string; scope: ExtensionScope; permitted: boolean }[];
  extensions: ExtensionInventory[];
}
export interface CompositionSnapshot {
  configuredRevision: string;
  restartRequired: boolean;
  active: (CompositionInventory & { agentId: string })[];
  mcp: McpServerInventory[];
}
/** Deliberately excludes schemas, descriptions, instructions, transport addresses, paths and environment. */
export interface CompositionReport {
  configuredRevision: string;
  restartRequired: boolean;
  active: (CompositionInventory & { agentId: string })[];
  mcp: {
    id: string; transport: "stdio" | "streamable-http";
    status: "connected" | "backoff" | "disconnected" | "failed" | "closed" | "schema-changed";
    generation: number; reconnectAttempts: number; maxReconnectAttempts: number;
    restartRequired: boolean; toolCount: number; code?: string;
  }[];
}

export function compositionReport(snapshot: CompositionSnapshot, principal: Principal, agentIds: readonly string[]): CompositionReport {
  const identifier = (value: string) => /^[A-Za-z0-9_.:@-]{1,256}$/.test(value) ? value : "redacted";
  const revision = (value: string) => /^[a-f0-9]{64}$/.test(value) ? value : compositionRevision(value);
  const visible = new Set(["main", ...agentIds]);
  return {
    configuredRevision: revision(snapshot.configuredRevision), restartRequired: snapshot.restartRequired === true,
    active: snapshot.active.filter(item => visible.has(item.agentId)).map(item => ({
      agentId: identifier(item.agentId), preset: item.preset, target: item.target, revision: revision(item.revision),
      services: { web: !!item.services.web, workbench: !!item.services.workbench, project: !!item.services.project, agents: !!item.services.agents },
      tools: item.tools.map(tool => ({ name: identifier(tool.name), permission: identifier(tool.permission), source: identifier(tool.source), scope: tool.scope, permitted: principal.permissions.includes(tool.permission) })),
      extensions: item.extensions.map(extension => ({ id: identifier(extension.id), scope: extension.scope, revision: extension.revision === "unversioned" ? "unversioned" : revision(extension.revision), tools: extension.tools.map(identifier) })),
    })),
    mcp: snapshot.mcp.map(server => ({
      id: identifier(server.id), transport: server.transport,
      status: server.restartRequired ? "schema-changed" : server.state === "ready" ? "connected"
        : server.state === "disconnected" && server.reconnectAttempts < server.maxReconnectAttempts ? "backoff" : server.state,
      generation: server.generation, reconnectAttempts: server.reconnectAttempts, maxReconnectAttempts: server.maxReconnectAttempts,
      restartRequired: server.restartRequired === true, toolCount: server.tools.length,
      ...(server.code && /^[A-Z0-9_]{1,100}$/.test(server.code) ? { code: server.code } : {}),
    })),
  };
}

/** Stable hash only: configuration values, prompt text and credentials are never returned in inventory. */
export function compositionRevision(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize)
    : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

/** Named presets supply defaults only. Explicit host settings and permission lists remain authoritative. */
export function resolveComposition(config: WorkspaceConfig, target: "main" | "agent") {
  const preset = config.preset ?? "legacy";
  const workbench = preset === "legacy" && target === "agent" ? true : config.workbench?.enabled ?? preset === "coding";
  return {
    preset: preset as WorkspacePreset | "legacy",
    workbench,
    web: preset !== "headless",
    agents: config.agents?.enabled !== false,
    project: config.project?.enabled === true,
    // Legacy agents previously reused the main workbench's guide selection.
    codingPacks: workbench && (preset !== "legacy" || config.workbench?.enabled) ? config.codingPacks : [],
  };
}

export function composeTools(contributions: readonly ToolContribution[]): BusinessTool<any>[] {
  const names = new Set<string>(), tools: BusinessTool<any>[] = [];
  for (const contribution of contributions) for (const tool of contribution.tools) {
    if (names.has(tool.name)) throw new PidaError("TOOL_DUPLICATE", 400);
    names.add(tool.name); tools.push(tool);
  }
  return tools;
}

export function compositionInventory(
  config: WorkspaceConfig, target: "main" | "agent", revision: string,
  contributions: readonly ToolContribution[], extensions: ExtensionInventory[], principal: Principal,
): CompositionInventory {
  const selected = resolveComposition(config, target);
  return {
    revision, preset: selected.preset, target,
    services: { web: selected.web, workbench: selected.workbench, project: selected.project, agents: selected.agents },
    tools: contributions.flatMap(c => c.tools.map(t => ({ name: t.name, permission: t.permission, source: c.source, scope: c.scope, permitted: principal.permissions.includes(t.permission) }))),
    extensions: structuredClone(extensions),
  };
}
