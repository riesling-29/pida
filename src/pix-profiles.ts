import { createHash } from "node:crypto";
import { createPixJsonProcessPort, type PixEngineBuild, type PixProcessConfig } from "./pix-port.js";

export const pixProfilesSchema = "pida.pix.profiles/1" as const;
export const pixProfileBuild = { sourceCommit: "a0831bc0b34fd7feebfba928066b90b114ae531e",
  sourceDigest: "b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510" } as const;
export type PixProfile = "sequential-prefix/1" | "object-terminal/1";
/** Preserve native JSON bytes, including Python's 1.0 vs JavaScript's 1 serialization. */
export interface PixNativeArtifact { json: string; sha256: string }
export interface PixSequenceEvent { id: string; sequence: number; activity: string; time?: string }
export interface PixSequentialCut { caseId: string; events: PixSequenceEvent[]; closed: boolean; closeId?: string }
export interface PixObjectCut {
  closed: boolean;
  objects: { id: string; type: string }[];
  events: { id: string; activity: string; time: string; relations: { objectId: string; qualifier: string }[] }[];
  objectTypes: string[]; qualifiers: string[];
}
export interface PixProfileRequest {
  schemaVersion: typeof pixProfilesSchema; profile: PixProfile; generation: string;
  /** Unchanged pix.model/1.0.0 document; parsed by PIX's native codec. */
  model: Record<string, unknown>;
  sequential?: PixSequentialCut; objects?: PixObjectCut;
  /** Explicit accepting transition paths; no inferred DFG-to-Petri-net conversion. */
  proxyPaths?: string[][];
  /** Host-owned immutable previous result; never accepted as a tool argument. */
  resume?: { checkpoint: PixNativeArtifact; offset: number };
  limits?: { maxStates?: number; maxBindings?: number; maxProxyNodes?: number; maxExpansions?: number; witnessHistory?: number };
}
export interface PixProfileSummary {
  metric: "prefix-witness-upper-bound" | "terminal-witness-upper-bound" | "terminal-event-edit-cost";
  cost: number | null; eventCount: number; closed: boolean; finalCostUnresolved: boolean;
  boundScope: string; outcome: string; lowerBoundCost?: number | null;
  selectedObjectCount?: number; excludedObjectCount?: number; excludedRelationCount?: number;
}
export interface PixProfileResult {
  schemaVersion: typeof pixProfilesSchema; profile: PixProfile;
  requestDigest: string; status: "computed" | "partial" | "unavailable" | "invalid_input" | "error";
  engine?: PixEngineBuild; issues: { code: string; message: string }[];
  nativeResults: PixNativeArtifact[]; checkpoint?: PixNativeArtifact;
  summary?: PixProfileSummary; limits: string[];
}
export interface PixProfilePort { compute(request: PixProfileRequest, signal?: AbortSignal): Promise<PixProfileResult> }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, any>, names: string[]) => Object.keys(v).every(k => names.includes(k));
const label = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
const count = (v: unknown, max = 10000): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const names = (v: unknown, max = 256): v is string[] => Array.isArray(v) && v.length <= max && v.every(label) && new Set(v).size === v.length;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const point = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
export const pixProfileRequestDigest = (request: PixProfileRequest) => createHash("sha256").update(JSON.stringify(request)).digest("hex");
function nativeDocument(v: unknown): Record<string, any> | undefined {
  if (!object(v) || !keys(v, ["json", "sha256"]) || typeof v.json !== "string" || v.json.length > 2_000_000
    || !hash(v.sha256) || createHash("sha256").update(v.json).digest("hex") !== v.sha256) return undefined;
  try { const d = JSON.parse(v.json); return object(d) && d.format === "pix.analysis-result" && d.version === "1.3.0" && object(d.computation) ? d : undefined; } catch { return undefined; }
}
export function validPixProfileRequest(v: unknown): v is PixProfileRequest {
  if (!object(v) || !keys(v, ["schemaVersion", "profile", "generation", "model", "sequential", "objects", "proxyPaths", "resume", "limits"])
    || v.schemaVersion !== pixProfilesSchema || !["sequential-prefix/1", "object-terminal/1"].includes(v.profile) || !label(v.generation)
    || !object(v.model) || v.model.format !== "pix.model" || v.model.version !== "1.0.0" || JSON.stringify(v.model).length > 262144) return false;
  if (v.limits !== undefined) {
    const bounds: Record<string, number> = { maxStates: 10000, maxBindings: 10000, maxProxyNodes: 10000, maxExpansions: 10000, witnessHistory: 1000 };
    if (!object(v.limits) || !keys(v.limits, Object.keys(bounds)) || Object.entries(v.limits).some(([k, n]) => !count(n, bounds[k]) || n < 1)) return false;
  }
  if (v.profile === "sequential-prefix/1") {
    const s = v.sequential;
    if (v.objects !== undefined || !object(s) || !keys(s, ["caseId", "events", "closed", "closeId"]) || !label(s.caseId) || typeof s.closed !== "boolean"
      || (s.closed ? !label(s.closeId) : s.closeId !== undefined) || !Array.isArray(s.events) || s.events.length > 4096
      || s.events.some((e: unknown, i: number) => !object(e) || !keys(e, ["id", "sequence", "activity", "time"]) || !label(e.id) || !label(e.activity) || e.sequence !== i || e.time !== undefined && !point(e.time))
      || new Set(s.events.map((e: PixSequenceEvent) => e.id)).size !== s.events.length || s.events.some((e: PixSequenceEvent) => e.id === s.closeId)
      || !Array.isArray(v.proxyPaths) || !v.proxyPaths.length || v.proxyPaths.length > 100 || !v.proxyPaths.every((p: unknown) => Array.isArray(p) && p.length <= 256 && p.every(label))) return false;
    if (v.resume !== undefined && (!object(v.resume) || !keys(v.resume, ["checkpoint", "offset"]) || !count(v.resume.offset, s.events.length) || !nativeDocument(v.resume.checkpoint))) return false;
  } else {
    const s = v.objects;
    if (v.sequential !== undefined || v.resume !== undefined || v.proxyPaths !== undefined || !object(s)
      || !keys(s, ["closed", "objects", "events", "objectTypes", "qualifiers"]) || typeof s.closed !== "boolean"
      || !names(s.objectTypes, 32) || !s.objectTypes.length || !names(s.qualifiers, 32) || !s.qualifiers.length
      || !Array.isArray(s.objects) || s.objects.length > 256 || !s.objects.every((o: unknown) => object(o) && keys(o, ["id", "type"]) && label(o.id) && label(o.type))
      || new Set(s.objects.map((o: any) => o.id)).size !== s.objects.length || !Array.isArray(s.events) || s.events.length > 4096) return false;
    const ids = new Set(s.objects.map((o: any) => o.id));
    if (!s.events.every((e: unknown) => object(e) && keys(e, ["id", "activity", "time", "relations"]) && label(e.id) && label(e.activity) && point(e.time)
      && Array.isArray(e.relations) && e.relations.length <= 256 && e.relations.every((r: unknown) => object(r) && keys(r, ["objectId", "qualifier"]) && ids.has(r.objectId) && label(r.qualifier))
      && new Set(e.relations.map((r: any) => JSON.stringify([r.objectId, r.qualifier]))).size === e.relations.length)) return false;
    if (new Set(s.events.map((e: any) => e.id)).size !== s.events.length) return false;
  }
  return true;
}
export function validPixProfileResult(v: unknown, request: PixProfileRequest): v is PixProfileResult {
  if (!object(v) || !keys(v, ["schemaVersion", "profile", "requestDigest", "status", "engine", "issues", "nativeResults", "checkpoint", "summary", "limits"])
    || v.schemaVersion !== pixProfilesSchema || v.profile !== request.profile || v.requestDigest !== pixProfileRequestDigest(request)
    || !["computed", "partial", "unavailable", "invalid_input", "error"].includes(v.status)
    || !Array.isArray(v.issues) || v.issues.length > 128 || !v.issues.every((i: any) => object(i) && keys(i, ["code", "message"]) && /^[A-Za-z0-9_]{1,100}$/.test(i.code) && typeof i.message === "string" && i.message.length <= 2000)
    || !names(v.limits, 32) || !Array.isArray(v.nativeResults) || v.nativeResults.length > 3
    || !v.nativeResults.every((r: any) => nativeDocument(r))) return false;
  if (v.engine !== undefined && (!object(v.engine) || !keys(v.engine, ["repository", "sourceCommit", "sourceDigest", "packageVersion", "pythonVersion", "sourceVerified"])
    || v.engine.repository !== "Chanta-Research-Group/PIX" || !/^[a-f0-9]{40}$/.test(v.engine.sourceCommit) || !hash(v.engine.sourceDigest)
    || v.engine.packageVersion !== "0.5.0" || !label(v.engine.pythonVersion) || v.engine.sourceVerified !== true)) return false;
  if (["computed", "partial"].includes(v.status) && (!v.engine || !v.summary || !v.nativeResults.length)) return false;
  if (v.summary) {
    const s = v.summary, native = nativeDocument(v.nativeResults.at(-1))?.computation;
    if (!object(s) || !keys(s, ["metric", "cost", "eventCount", "closed", "finalCostUnresolved", "boundScope", "outcome", "lowerBoundCost", "selectedObjectCount", "excludedObjectCount", "excludedRelationCount"])
      || !count(s.eventCount, 4096) || s.cost !== null && !count(s.cost, 10000000) || typeof s.closed !== "boolean" || typeof s.finalCostUnresolved !== "boolean"
      || !label(s.boundScope) || !label(s.outcome) || s.lowerBoundCost !== undefined && s.lowerBoundCost !== null && !count(s.lowerBoundCost, 10000000)
      || !native || native.status !== v.status) return false;
    if (request.profile === "sequential-prefix/1") {
      const cut = request.sequential!, cases = native.value?.cases, c = cases?.[0];
      if (v.status !== "partial" || !Array.isArray(cases) || cases.length !== 1 || c.case_id !== cut.caseId || c.event_count !== cut.events.length
        || s.eventCount !== cut.events.length || s.cost !== c.reported_cost || s.closed !== cut.closed || c.closed !== cut.closed
        || s.finalCostUnresolved !== !cut.closed || c.final_cost_unresolved !== !cut.closed || s.boundScope !== c.bound_scope
        || s.metric !== (cut.closed ? "terminal-witness-upper-bound" : "prefix-witness-upper-bound") || s.outcome !== "approximate"
        || nativeDocument(v.checkpoint)?.payload_kind !== "online-alignment-checkpoint" || nativeDocument(v.checkpoint)?.computation?.spec?.ingestion?.stream_id !== request.generation) return false;
    } else {
      const value = native.value;
      if (!request.objects!.closed || s.metric !== "terminal-event-edit-cost" || !s.closed || s.finalCostUnresolved || s.eventCount !== request.objects!.events.length
        || !value || s.cost !== value.cost || s.outcome !== value.status || s.lowerBoundCost !== value.lower_bound_cost || v.checkpoint !== undefined
        || s.selectedObjectCount !== value.scope?.selected_objects?.length || s.excludedObjectCount !== value.scope?.excluded_object_count || s.excludedRelationCount !== value.scope?.excluded_relation_count) return false;
    }
  } else if (v.checkpoint !== undefined) return false;
  return true;
}
export function createPixProfileProcessPort(config: PixProcessConfig): PixProfilePort {
  return createPixJsonProcessPort(config, validPixProfileRequest, validPixProfileResult);
}
