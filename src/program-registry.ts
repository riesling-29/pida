import { resolve } from "node:path";
import { discoverPrograms, createManifest, createProgramDiscoveryTool } from "./program-catalog.js";
import { loadProgramProxy, type ProgramApproval } from "./program-proxy.js";
import { PidaError, type Principal, type BusinessTool } from "./runtime.js";

export interface ProgramRegistration {
  id: string; enabled: boolean; root: string; manifest: string; approval: ProgramApproval;
}

/** The host selects all roots and pins the executable contract before any model can call it. */
export async function createProgramRegistry(workspaceRoot: string, registrations: ProgramRegistration[] = [], options: { projectRoot?: string; protectedPaths?: string[] } = {}) {
  const tools: BusinessTool<any>[] = [];
  const enabled: { id: string; name: string; description: string; toolName: string; permission: string; inputMode: string; outputMode: string; effect: string }[] = [];
  const ids = new Set<string>();
  for (const registration of registrations) {
    if (ids.has(registration.id)) throw new PidaError("PROGRAM_DUPLICATE", 400);
    ids.add(registration.id);
    if (!registration.enabled) continue;
    const proxy = await loadProgramProxy(resolve(workspaceRoot, registration.root), resolve(workspaceRoot, registration.manifest), { trustedHost: true, approval: registration.approval });
    if (proxy.manifest.id !== registration.id) throw new PidaError("PROGRAM_ID_MISMATCH", 400);
    tools.push(proxy.tool);
    enabled.push({ id: registration.id, name: proxy.manifest.name, description: proxy.manifest.description, toolName: proxy.tool.name, permission: proxy.tool.permission, inputMode: proxy.manifest.inputMode, outputMode: proxy.manifest.outputMode, effect: proxy.manifest.effect });
  }
  if (options.projectRoot) tools.push(createProgramDiscoveryTool(options.projectRoot, { protectedPaths: options.protectedPaths }));
  return {
    tools,
    list(principal: Principal) {
      return { enabled: enabled.map(item => ({ ...item, permitted: principal.permissions.includes(item.permission) })),
        ...(options.projectRoot && principal.permissions.includes("project:read") ? { catalog: (() => { const result = discoverPrograms(options.projectRoot!, { protectedPaths: options.protectedPaths }); return { ...result, candidates: result.candidates.map(({ manifest: _manifest, ...candidate }) => candidate) }; })() } : {}) };
    },
    draft(principal: Principal, candidateId: string, sourceDigest: string) {
      if (!principal.permissions.includes("project:read")) throw new PidaError("FORBIDDEN", 403);
      if (!options.projectRoot) throw new PidaError("PROJECT_DISABLED", 404);
      if (typeof candidateId !== "string" || typeof sourceDigest !== "string") throw new PidaError("INVALID_BODY", 400);
      const candidate = discoverPrograms(options.projectRoot, { protectedPaths: options.protectedPaths }).candidates.find(item => item.id === candidateId);
      if (!candidate) throw new PidaError("PROGRAM_CANDIDATE_NOT_FOUND", 404);
      if (candidate.sourceDigest !== sourceDigest) throw new PidaError("PROGRAM_SOURCE_CHANGED", 409);
      if (candidate.status !== "ready") throw new PidaError("PROGRAM_ADAPTER_REQUIRED", 409);
      const manifest = createManifest(candidate);
      return { manifest, suggestedFile: `${manifest.id}.json` };
    },
  };
}
export type ProgramRegistry = Awaited<ReturnType<typeof createProgramRegistry>>;
