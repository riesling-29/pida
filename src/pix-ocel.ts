import { Type } from "typebox";
import { Value } from "typebox/value";
import { canonical, sha256 } from "./private-state.js";
import { createPixJsonProcessPort, type PixProcessConfig, type PixEngineBuild } from "./pix-port.js";
import type { OcelDocument } from "./ocel.js";

export const pixOcelSchema = "pida.pix.ocel-verification/1" as const;
export const pixLifecyclePolicy = "pida.runtime-lifecycle/1" as const;
export interface PixOcelRequest { schemaVersion: typeof pixOcelSchema; document: OcelDocument; complete: boolean }
export interface PixOcelResult {
  schemaVersion: typeof pixOcelSchema; requestDigest: string; policy: typeof pixLifecyclePolicy;
  status: "computed" | "partial" | "unavailable" | "invalid_input" | "error";
  structure: "PASSED" | "FAILED" | "UNKNOWN";
  processJudgment: "conforms" | "deviates" | "pending" | "unknown";
  businessAcceptance: "UNKNOWN";
  engine?: PixEngineBuild;
  issues: string[]; limits: string[]; nativeResults: Record<string, unknown>[];
  models: Record<string, unknown>;
  checkedObjects: { objectId: string; type: string; status: string; cost: number | null }[];
  coverage: { events: number; objects: number; e2o: number; o2o: number; uncoveredTypes: string[] };
}
export interface PixOcelPort { compute(request: PixOcelRequest, signal?: AbortSignal): Promise<PixOcelResult> }
const obj = (fields: Record<string, any>) => Type.Object(fields, { additionalProperties: false });
const str = Type.String({ maxLength: 1024 }), strings = Type.Array(str, { maxItems: 128 });
const count = Type.Integer({ minimum: 0, maximum: 100000 });
const value = Type.Union([str, Type.Number(), Type.Boolean()]);
const attrs = Type.Array(obj({ name: str, value }), { maxItems: 128 });
const rels = Type.Array(obj({ objectId: str, qualifier: str }), { maxItems: 10000 });
const types = Type.Array(obj({ name: str, attributes: Type.Array(obj({ name: str, type: Type.Union(["string", "integer", "float", "boolean", "time"].map(x => Type.Literal(x))) }), { maxItems: 128 }) }), { maxItems: 256 });
const documentSchema = obj({
  eventTypes: types, objectTypes: types,
  events: Type.Array(obj({ id: str, type: str, time: str, attributes: attrs, relationships: rels }), { maxItems: 10000 }),
  objects: Type.Array(obj({ id: str, type: str, attributes: Type.Array(obj({ name: str, value, time: str }), { maxItems: 10000 }), relationships: rels }), { maxItems: 10000 }),
});
const requestSchema = obj({ schemaVersion: Type.Literal(pixOcelSchema), document: documentSchema, complete: Type.Boolean() });
const engine = obj({ repository: str, sourceCommit: Type.String({ pattern: "^[a-f0-9]{40}$" }), sourceDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), packageVersion: str, pythonVersion: str, sourceVerified: Type.Literal(true) });
const resultSchema = obj({
  schemaVersion: Type.Literal(pixOcelSchema), requestDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), policy: Type.Literal(pixLifecyclePolicy),
  status: Type.Union(["computed", "partial", "unavailable", "invalid_input", "error"].map(x => Type.Literal(x))),
  structure: Type.Union(["PASSED", "FAILED", "UNKNOWN"].map(x => Type.Literal(x))),
  processJudgment: Type.Union(["conforms", "deviates", "pending", "unknown"].map(x => Type.Literal(x))),
  businessAcceptance: Type.Literal("UNKNOWN"), engine: Type.Optional(engine), issues: strings, limits: strings,
  nativeResults: Type.Array(Type.Record(Type.String(), Type.Unknown()), { maxItems: 16 }),
  models: Type.Record(Type.String(), Type.Unknown()),
  checkedObjects: Type.Array(obj({ objectId: str, type: str, status: str, cost: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]) }), { maxItems: 512 }),
  coverage: obj({ events: count, objects: count, e2o: count, o2o: count, uncoveredTypes: strings }),
});
export function validPixOcelRequest(input: unknown): input is PixOcelRequest { return Value.Check(requestSchema, input); }
export function validPixOcelResult(input: unknown, request: PixOcelRequest): input is PixOcelResult {
  if (!Value.Check(resultSchema, input)) return false;
  const r = input as unknown as PixOcelResult;
  // Shared transport sends JSON.stringify(request), not canonical JSON.
  if (r.requestDigest !== sha256(JSON.stringify(request))) return false;
  if (["computed", "partial"].includes(r.status) && !r.engine) return false;
  const seen = new Set<string>();
  for (const c of r.checkedObjects) {
    if (seen.has(c.objectId) || !request.document.objects.some(o => o.id === c.objectId && o.type === c.type)) return false;
    seen.add(c.objectId);
  }
  if (r.processJudgment === "conforms" && (!request.complete || r.status !== "computed" || r.structure !== "PASSED" || !r.checkedObjects.length
    || r.checkedObjects.some(c => c.status !== "optimal" || c.cost !== 0))) return false;
  if (["conforms", "deviates"].includes(r.processJudgment)) {
    const subjects = request.document.objects.filter(o => ["Run", "Turn", "ToolCall"].includes(o.type));
    if (!request.complete || subjects.length !== seen.size || subjects.some(o => !seen.has(o.id)) || r.structure !== "PASSED") return false;
    if (r.processJudgment === "deviates" && !r.checkedObjects.some(c => c.status === "optimal" && c.cost !== null && c.cost > 0)) return false;
  }
  if (r.structure === "PASSED" && (r.coverage.events !== request.document.events.length || r.coverage.objects !== request.document.objects.length)) return false;
  return true;
}
export function createPixOcelPort(config: PixProcessConfig): PixOcelPort {
  return createPixJsonProcessPort({ maxInputBytes: 2_097_152, ...config }, validPixOcelRequest, validPixOcelResult);
}
export const pixOcelModelDigest = (r: PixOcelResult) => sha256(canonical({ policy: r.policy, models: r.models }));
