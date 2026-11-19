import { createHash } from "node:crypto";
import { lstatSync, readFileSync, type Stats } from "node:fs";
import { resolve } from "node:path";
import type { OcelDocument } from "./ocel.js";
import { pixOcelSchema, validPixOcelRequest } from "./pix-ocel.js";

export const personaSubstrateOcelInput = "pida.persona-substrate.ocel-input/1" as const;

const MAX_INPUT_BYTES = 2_097_152;
const TOP_LEVEL_KEYS = ["eventTypes", "objectTypes", "events", "objects"] as const;
const FORBIDDEN_ATTRIBUTE_NAMES = new Set(["body", "text", "content", "summary", "reason", "prompt", "message"]);
const MAX_JSON_DEPTH = 64;
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

/** PS contract event types (Persona-Substrate types.EVENT_TYPES). Fixed here, never taken from the input file. */
export const personaSubstrateEventTypes: readonly string[] = Object.freeze([
  "새지시", "단계완료", "오류", "승인", "승인거절", "취소", "범위변경", "재개", "위임요청", "위임회신", "승인요청", "승격",
]);
const CONTRACT_EVENT_TYPES: ReadonlySet<string> = new Set(personaSubstrateEventTypes);

export interface PersonaSubstrateOcelRead {
  schemaVersion: typeof personaSubstrateOcelInput;
  document: OcelDocument;
  digest: string;
  counts: { events: number; objects: number; e2o: number; o2o: number };
}

const fail = (code: string): never => { throw new Error(code); };

function parseJsonUnique(text: string): unknown {
  let index = 0;
  let depth = 0;
  const invalid = () => fail("PERSONA_SUBSTRATE_OCEL_JSON_INVALID");
  const peek = () => text[index];
  const take = () => text[index++]!;
  const skipWs = () => { while (index < text.length && /\s/.test(text[index]!)) index++; };
  const parseString = (): string => {
    if (take() !== '"') invalid();
    let value = "";
    while (index < text.length) {
      const ch = take();
      if (ch === '"') return value;
      if (ch === "\\") {
        const esc = take();
        if (esc === '"' || esc === "\\" || esc === "/") value += esc;
        else if (esc === "b") value += "\b";
        else if (esc === "f") value += "\f";
        else if (esc === "n") value += "\n";
        else if (esc === "r") value += "\r";
        else if (esc === "t") value += "\t";
        else if (esc === "u") {
          const hex = text.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) invalid();
          value += String.fromCharCode(parseInt(hex, 16));
          index += 4;
        } else invalid();
      } else if (ch < "\x20") invalid();
      else value += ch;
    }
    return invalid();
  };
  const parseNumber = (): number => {
    const start = index;
    if (peek() === "-") index++;
    if (peek() === "0") index++;
    else if (peek()! >= "1" && peek()! <= "9") while (peek()! >= "0" && peek()! <= "9") index++;
    else invalid();
    const digits = () => {
      const from = index;
      while (peek()! >= "0" && peek()! <= "9") index++;
      if (index === from) invalid();
    };
    if (peek() === ".") { index++; digits(); }
    if (peek() === "e" || peek() === "E") {
      index++;
      if (peek() === "+" || peek() === "-") index++;
      digits();
    }
    const slice = text.slice(start, index);
    const value = Number(slice);
    if (!Number.isFinite(value)) invalid();
    return value;
  };
  const parseLiteral = (word: string, value: unknown): unknown => {
    if (text.slice(index, index + word.length) !== word) invalid();
    index += word.length;
    return value;
  };
  const parseValue = (): unknown => {
    skipWs();
    const ch = peek();
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"') return parseString();
    if (ch === "t") return parseLiteral("true", true);
    if (ch === "f") return parseLiteral("false", false);
    if (ch === "n") return parseLiteral("null", null);
    if (ch === "-" || (ch! >= "0" && ch! <= "9")) return parseNumber();
    invalid();
  };
  const enter = () => { if (++depth > MAX_JSON_DEPTH) invalid(); };
  const parseArray = (): unknown[] => {
    if (take() !== "[") invalid();
    enter();
    skipWs();
    const items: unknown[] = [];
    if (peek() === "]") { take(); depth--; return items; }
    while (true) {
      items.push(parseValue());
      skipWs();
      const ch = take();
      if (ch === "]") break;
      if (ch !== ",") invalid();
      skipWs();
    }
    depth--;
    return items;
  };
  const parseObject = (): Record<string, unknown> => {
    if (take() !== "{") invalid();
    enter();
    skipWs();
    const object: Record<string, unknown> = {};
    if (peek() === "}") { take(); depth--; return object; }
    while (true) {
      skipWs();
      const key = parseString();
      skipWs();
      if (take() !== ":") invalid();
      const value = parseValue();
      if (Object.hasOwn(object, key)) fail("PERSONA_SUBSTRATE_OCEL_JSON_DUPLICATE_KEY");
      // defineProperty keeps "__proto__" as an own key instead of calling the prototype setter.
      Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
      skipWs();
      const ch = take();
      if (ch === "}") break;
      if (ch !== ",") invalid();
    }
    depth--;
    return object;
  };
  skipWs();
  const root = parseValue();
  skipWs();
  if (index !== text.length) invalid();
  return root;
}

function assertTopLevel(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("PERSONA_SUBSTRATE_OCEL_TOP_LEVEL_INVALID");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== TOP_LEVEL_KEYS.length || !TOP_LEVEL_KEYS.every(key => keys.includes(key))) fail("PERSONA_SUBSTRATE_OCEL_TOP_LEVEL_INVALID");
  return record;
}

function contractEventTypes(document: OcelDocument): Set<string> {
  const declared = new Set(document.eventTypes.map(type => type.name));
  for (const name of declared) if (!CONTRACT_EVENT_TYPES.has(name)) fail("PERSONA_SUBSTRATE_OCEL_EVENT_TYPE_INVALID");
  return declared;
}

function assertUniqueIds(items: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail("PERSONA_SUBSTRATE_OCEL_ID_DUPLICATE");
    seen.add(item.id);
  }
}

function assertUtcTime(value: string): void {
  const match = RFC3339_UTC.exec(value);
  if (!match) fail("PERSONA_SUBSTRATE_OCEL_TIME_INVALID");
  const [year, month, day, hour, minute, second] = match!.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    fail("PERSONA_SUBSTRATE_OCEL_TIME_INVALID");
  }
}

const forbiddenAttribute = (name: string) => FORBIDDEN_ATTRIBUTE_NAMES.has(name.toLowerCase());

function readLogSeq(event: OcelDocument["events"][number]): number {
  const value = event.attributes.find(attribute => attribute.name === "log_seq")?.value;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return fail("PERSONA_SUBSTRATE_OCEL_LOG_SEQ_INVALID");
}

function validatePersonaInvariants(document: OcelDocument): void {
  const allowedTypes = contractEventTypes(document);
  assertUniqueIds(document.events);
  assertUniqueIds(document.objects);
  const objects = new Map(document.objects.map(object => [object.id, object]));
  let previousLogSeq: number | undefined;
  for (const event of document.events) {
    if (!allowedTypes.has(event.type)) fail("PERSONA_SUBSTRATE_OCEL_EVENT_TYPE_INVALID");
    for (const attribute of event.attributes) {
      if (forbiddenAttribute(attribute.name)) fail("PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE");
    }
    const caseLinks = event.relationships.filter(relation => relation.qualifier === "case");
    if (caseLinks.length !== 1) fail("PERSONA_SUBSTRATE_OCEL_CASE_RELATION_INVALID");
    const workItem = objects.get(caseLinks[0]!.objectId);
    if (!workItem || workItem.type !== "work_item") fail("PERSONA_SUBSTRATE_OCEL_CASE_RELATION_INVALID");
    for (const relation of event.relationships) {
      if (!objects.has(relation.objectId)) fail("PERSONA_SUBSTRATE_OCEL_RELATION_DANGLING");
    }
    assertUtcTime(event.time);
    const logSeq = readLogSeq(event);
    if (previousLogSeq !== undefined && logSeq <= previousLogSeq) fail("PERSONA_SUBSTRATE_OCEL_LOG_SEQ_INVALID");
    previousLogSeq = logSeq;
  }
  for (const object of document.objects) {
    for (const attribute of object.attributes) {
      if (forbiddenAttribute(attribute.name)) fail("PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE");
      assertUtcTime(attribute.time);
    }
    for (const relation of object.relationships) {
      if (!objects.has(relation.objectId)) fail("PERSONA_SUBSTRATE_OCEL_RELATION_DANGLING");
    }
  }
}

function ocelCounts(document: OcelDocument): PersonaSubstrateOcelRead["counts"] {
  return {
    events: document.events.length,
    objects: document.objects.length,
    e2o: document.events.reduce((total, event) => total + event.relationships.length, 0),
    o2o: document.objects.reduce((total, object) => total + object.relationships.length, 0),
  };
}

function fileStat(path: string): Stats {
  try { return lstatSync(path); } catch { return fail("PERSONA_SUBSTRATE_OCEL_INPUT_INVALID"); }
}

export function readPersonaSubstrateOcel(path: string): PersonaSubstrateOcelRead {
  const absolute = resolve(path);
  const stat = fileStat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("PERSONA_SUBSTRATE_OCEL_INPUT_INVALID");
  if (stat.size > MAX_INPUT_BYTES) fail("PERSONA_SUBSTRATE_OCEL_INPUT_LIMIT");
  const bytes = readFileSync(absolute);
  if (bytes.length > MAX_INPUT_BYTES) fail("PERSONA_SUBSTRATE_OCEL_INPUT_LIMIT");
  const digest = createHash("sha256").update(bytes).digest("hex");
  let text = "";
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("PERSONA_SUBSTRATE_OCEL_JSON_INVALID"); }
  const parsed = assertTopLevel(parseJsonUnique(text));
  const request = { schemaVersion: pixOcelSchema, document: parsed as unknown as OcelDocument, complete: false };
  if (!validPixOcelRequest(request)) fail("PERSONA_SUBSTRATE_OCEL_SHAPE_INVALID");
  const document = request.document;
  validatePersonaInvariants(document);
  return { schemaVersion: personaSubstrateOcelInput, document, digest, counts: ocelCounts(document) };
}
