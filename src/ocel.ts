import { canonical, sha256 } from "./private-state.js";
import { validateObservationBundle } from "./integration-contract.js";
import type { ObservationBundle } from "./execution-contract.js";

export const ocelMappingVersion = "pida.ocel20/1" as const;
type Primitive = string | number | boolean;
interface Attribute { name: string; value: Primitive }
interface Relation { objectId: string; qualifier: string }
interface EntityType { name: string; attributes: { name: string; type: "string" | "integer" | "float" | "boolean" }[] }
export interface OcelDocument {
  eventTypes: EntityType[];
  objectTypes: EntityType[];
  events: { id: string; type: string; time: string; attributes: Attribute[]; relationships: Relation[] }[];
  objects: { id: string; type: string; attributes: (Attribute & { time: string })[]; relationships: Relation[] }[];
}
export interface OcelExport {
  mapping: typeof ocelMappingVersion;
  sourceDigest: string;
  digest: string;
  complete: boolean;
  knownLimits: string[];
  document: OcelDocument;
}
const id = (type: string, ...identity: string[]) => `pida:${type}:${sha256(canonical(identity))}`;
const sorted = <T extends { name: string }>(values: Iterable<T>) => [...values].sort((a, b) => a.name.localeCompare(b.name, "en"));
const typeOf = (value: Primitive): EntityType["attributes"][number]["type"] => typeof value === "number" ? "float" : typeof value === "boolean" ? "boolean" : "string";

/** OCEL 2.0 JSON (four standard arrays). No invented events, timestamps, or prompt/tool contents.
 * Source order is a per-run observation sequence, never a claim of cross-agent causality. */
export function exportOcel(bundle: ObservationBundle): OcelExport {
  const validation = validateObservationBundle(bundle);
  if (!validation.valid) throw new Error("OCEL_SOURCE_INVALID:" + validation.issues.join(","));
  const document: OcelDocument = { eventTypes: [], objectTypes: [], events: [], objects: [] };
  const objects = new Map<string, OcelDocument["objects"][number]>();
  const eventTypes = new Map<string, Map<string, EntityType["attributes"][number]>>();
  const objectTypes = new Map<string, Map<string, EntityType["attributes"][number]>>();
  const define = (types: typeof eventTypes, name: string, attributes: Attribute[]) => {
    let defs = types.get(name); if (!defs) types.set(name, defs = new Map());
    for (const a of attributes) defs.set(a.name, { name: a.name, type: typeOf(a.value) });
  };
  const object = (type: string, key: string, time: string, values: Record<string, Primitive> = {}) => {
    let item = objects.get(key);
    if (!item) { item = { id: key, type, attributes: [], relationships: [] }; objects.set(key, item); }
    for (const [name, value] of Object.entries(values)) {
      const previous = [...item.attributes].reverse().find(a => a.name === name);
      if (!previous || previous.value !== value) item.attributes.push({ name, value, time });
    }
    define(objectTypes, type, item.attributes);
    return item;
  };
  const link = (relationships: Relation[], objectId: string, qualifier: string) => {
    if (!relationships.some(r => r.objectId === objectId && r.qualifier === qualifier)) relationships.push({ objectId, qualifier });
  };
  const seen = new Set<string>();
  const artifactDetails = new Map(bundle.manifest?.artifact_refs.map(a => [a.id, a]) ?? []);
  const verificationDetails = new Map(bundle.manifest?.verification_results.map(v => [v.id, v]) ?? []);
  const executionType = bundle.events.some(e => ["run_started", "run_finished", "run_interrupted"].includes(e.activity)) ? "Run" : "Operation";
  for (const e of bundle.events) {
    const eventId = id("Event", e.source_id, e.source_event_id);
    if (seen.has(eventId)) continue; seen.add(eventId);
    const time = e.occurred_at, source = e.source_id;
    const agent = object("Agent", id("Agent", source, e.agent_id), time, { agent_id: e.agent_id });
    const session = object("Session", id("Session", source, e.session_id), time, { session_id: e.session_id });
    const task = object("Task", id("Task", source, e.task_id), time, { task_id: e.task_id });
    const run = object(executionType, id(executionType, source, e.run_id), time, { run_id: e.run_id });
    link(run.relationships, session.id, "in_session"); link(run.relationships, task.id, "for_task"); link(run.relationships, agent.id, "executed_by");
    const relationships: Relation[] = [{ objectId: agent.id, qualifier: "actor" }, { objectId: session.id, qualifier: "session" }, { objectId: task.id, qualifier: "task" }, { objectId: run.id, qualifier: "run" }];
    let turn: OcelDocument["objects"][number] | undefined;
    if (e.payload.turn_id) {
      turn = object("Turn", id("Turn", source, e.run_id, e.payload.turn_id), time, { turn_id: e.payload.turn_id, ...(e.payload.turn_index ? { index: e.payload.turn_index } : {}) });
      link(turn.relationships, run.id, "in_run"); link(relationships, turn.id, "turn");
    }
    if (e.payload.request_id) {
      const request = object("ModelRequest", id("ModelRequest", source, e.run_id, e.payload.request_id), time, { request_id: e.payload.request_id });
      link(request.relationships, run.id, "in_run"); if (turn) link(request.relationships, turn.id, "in_turn");
      link(relationships, request.id, "request");
    }
    let call: OcelDocument["objects"][number] | undefined;
    if (e.payload.tool_call_id) {
      call = object("ToolCall", id("ToolCall", source, e.run_id, e.payload.tool_call_id), time, { tool_call_id: e.payload.tool_call_id, ...(e.payload.tool_name ? { tool_name: e.payload.tool_name } : {}) });
      link(call.relationships, run.id, "in_run"); if (turn) link(call.relationships, turn.id, "in_turn");
      link(relationships, call.id, "call");
      if (e.payload.parent_tool_call_id) {
        const parent = object("ToolCall", id("ToolCall", source, e.run_id, e.payload.parent_tool_call_id), time, { tool_call_id: e.payload.parent_tool_call_id });
        link(call.relationships, parent.id, "child_of");
      }
    }
    const artifactIds: string[] = [];
    for (const ref of e.artifact_refs) {
      const detail = artifactDetails.get(ref);
      const version = object("ArtifactVersion", id("ArtifactVersion", source, ref), time, { artifact_ref: ref, ...(detail ? { sha256: detail.sha256, bytes: detail.bytes } : {}) });
      if (detail) {
        const file = object("Artifact", id("Artifact", source, detail.path), time, { path: detail.path });
        link(version.relationships, file.id, "version_of");
      }
      artifactIds.push(version.id);
      link(relationships, version.id, e.activity === "verification_finished" ? "checked_artifact" : e.activity === "artifact_changed" ? "changed_artifact" : "artifact");
    }
    for (const ref of e.evidence_refs) {
      const detail = verificationDetails.get(ref);
      const isVerification = !!detail || e.activity.startsWith("verification_");
      const evidence = object(isVerification ? "Verification" : "Evidence", id("Evidence", source, e.run_id, ref), detail?.occurred_at ?? time,
        { evidence_ref: ref, ...(detail ? { status: detail.status, scope: detail.scope, definition_digest: detail.definition_digest, artifact_snapshot_digest: detail.artifact_snapshot_digest } : {}) });
      link(evidence.relationships, run.id, "in_run");
      if (call) link(evidence.relationships, call.id, "produced_by_call");
      for (const artifact of artifactIds) link(evidence.relationships, artifact, "checks");
      link(relationships, evidence.id, "evidence");
    }
    if (e.activity === "run_finished" && e.payload.status) object("Run", run.id, time, { reported_status: e.payload.status });
    const attributes: Attribute[] = [
      { name: "source_id", value: source }, { name: "source_event_id", value: e.source_event_id },
      { name: "sequence_number", value: e.sequence_number }, { name: "payload_digest", value: e.payload_digest },
      { name: "capture_mode", value: e.capture_mode }, { name: "data_scope", value: e.data_scope },
      ...Object.entries(e.payload).filter(([key, value]) => key !== "descriptor" && value !== undefined && value !== null)
        .map(([key, value]) => ({ name: "payload." + key, value: value as Primitive })),
    ];
    define(eventTypes, e.activity, attributes);
    document.events.push({ id: eventId, type: e.activity, time, attributes, relationships });
  }
  const last = bundle.events.at(-1);
  if (last && bundle.manifest) {
    const time = last.occurred_at, source = last.source_id, run = objects.get(id(executionType, source, last.run_id))!;
    // Manifest metadata is known at the observed run end. Never backdate the final
    // freshness decision to test execution or synthesize artifact creation events.
    for (const a of bundle.manifest.artifact_refs) {
      const version = object("ArtifactVersion", id("ArtifactVersion", source, a.id), time, { artifact_ref: a.id, sha256: a.sha256, bytes: a.bytes });
      const file = object("Artifact", id("Artifact", source, a.path), time, { path: a.path });
      link(version.relationships, file.id, "version_of");
      link(run.relationships, version.id, bundle.manifest.current_artifact_refs.includes(a.id) ? "reported_current_artifact" : "observed_artifact_version");
    }
    for (const v of bundle.manifest.verification_results) {
      const key = id("Evidence", source, last.run_id, v.id);
      if (objects.has(key)) object("Verification", key, time, { current_at_run_end: v.current_at_run_end });
    }
  }
  document.objects = [...objects.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
  document.eventTypes = sorted([...eventTypes].map(([name, attributes]) => ({ name, attributes: sorted(attributes.values()) })));
  document.objectTypes = sorted([...objectTypes].map(([name, attributes]) => ({ name, attributes: sorted(attributes.values()) })));
  const knownLimits = [...new Set([...bundle.known_limits, "RUNTIME_OBSERVED_EVENTS_ONLY", "SEQUENCE_IS_OBSERVATION_ORDER_NOT_CAUSAL_ORDER", "PROCESS_CONFORMANCE_IS_NOT_ARTIFACT_CORRECTNESS",
    ...(bundle.events.some(e => e.activity === "turn_started" && !e.payload.turn_id) ? ["LEGACY_TURN_ID_UNOBSERVED"] : [])])];
  return { mapping: ocelMappingVersion, sourceDigest: sha256(canonical(bundle)), digest: sha256(canonical(document)), complete: bundle.complete, knownLimits, document };
}
