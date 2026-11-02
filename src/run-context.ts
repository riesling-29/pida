/** Host-produced provenance. Never contains memory text, prompts, credentials or source URLs. */
export interface RunContextDescriptor {
  schemaVersion: 1;
  rendererVersion: string;
  personaRevision: number | null;
  informationState: { id: string; revision: number } | null;
  experiences: { id: string; revision: number }[];
  truncated: boolean;
}
export interface RunContextSnapshot { text: string; descriptor: RunContextDescriptor }
export interface LoadedRunContext extends RunContextDescriptor { digest: string }
export interface SessionHandoff {
  sourceSessionId: string;
  sourceRunId?: string;
  operationId: string;
  filesRestored: false;
  artifactSnapshotDigest?: string;
}
const id = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const ref = (v: any): boolean => !!v && Object.keys(v).every(k => ["id", "revision"].includes(k)) && id(v.id) && revision(v.revision);
export function validContextDescriptor(v: any, loaded = false): v is RunContextDescriptor {
  return !!v && typeof v === "object" && Object.keys(v).every(k => ["schemaVersion", "rendererVersion", "personaRevision", "informationState", "experiences", "truncated", ...(loaded ? ["digest"] : [])].includes(k))
    && v.schemaVersion === 1 && typeof v.rendererVersion === "string" && /^[a-zA-Z0-9._/-]{1,64}$/.test(v.rendererVersion)
    && (v.personaRevision === null || revision(v.personaRevision)) && (v.informationState === null || ref(v.informationState))
    && Array.isArray(v.experiences) && v.experiences.length <= 32 && v.experiences.every(ref)
    && new Set(v.experiences.map((r: any) => r.id)).size === v.experiences.length && typeof v.truncated === "boolean"
    && (!loaded || (typeof v.digest === "string" && /^[a-f0-9]{64}$/.test(v.digest)));
}
export function validHandoff(v: any): v is SessionHandoff {
  return !!v && typeof v === "object" && Object.keys(v).every(k => ["sourceSessionId", "sourceRunId", "operationId", "filesRestored", "artifactSnapshotDigest"].includes(k))
    && id(v.sourceSessionId) && (v.sourceRunId === undefined || id(v.sourceRunId)) && id(v.operationId) && v.filesRestored === false
    && (v.artifactSnapshotDigest === undefined || (typeof v.artifactSnapshotDigest === "string" && /^[a-f0-9]{64}$/.test(v.artifactSnapshotDigest)));
}
