import { createHash } from "node:crypto";
import { lstatSync, readFileSync, type Stats } from "node:fs";
import { resolve } from "node:path";
import type { OcelDocument } from "./ocel.js";
import { pixOcelSchema, validPixOcelRequest } from "./pix-ocel.js";

export const personaSubstrateOcelInput = "pida.persona-substrate.ocel-input/1" as const;

const MAX_INPUT_BYTES = 2_097_152;
const TOP_LEVEL_KEYS = ["eventTypes", "objectTypes", "events", "objects"] as const;
const FORBIDDEN_ATTRIBUTE_NAMES = new Set(["body", "text", "content", "summary", "reason", "prompt", "message"]);

export interface PersonaSubstrateOcelRead {
  schemaVersion: typeof personaSubstrateOcelInput;
  document: OcelDocument;
  digest: string;
  counts: { events: number; objects: number; e2o: number; o2o: number };
}

const fail = (code: string): never => { throw new Error(code); };

function parseJsonUnique(text: string): unknown {
  let index = 0;
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
    if (peek() === ".") { index++; while (peek()! >= "0" && peek()! <= "9") index++; }
    if (peek() === "e" || peek() === "E") {
      index++;
      if (peek() === "+" || peek() === "-") index++;
      while (peek()! >= "0" && peek()! <= "9") index++;
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
  const parseArray = (): unknown[] => {
    if (take() !== "[") invalid();
    skipWs();
    const items: unknown[] = [];
    if (peek() === "]") { take(); return items; }
    while (true) {
      items.push(parseValue());
      skipWs();
      const ch = take();
      if (ch === "]") break;
      if (ch !== ",") invalid();
      skipWs();
    }
    return items;
  };
  const parseObject = (): Record<string, unknown> => {
    if (take() !== "{") invalid();
    skipWs();
    const object: Record<string, unknown> = {};
    if (peek() === "}") { take(); return object; }
    while (true) {
      skipWs();
      const key = parseString();
      skipWs();
      if (take() !== ":") invalid();
      const value = parseValue();
      if (Object.hasOwn(object, key)) fail("PERSONA_SUBSTRATE_OCEL_JSON_DUPLICATE_KEY");
      object[key] = value;
      skipWs();
      const ch = take();
      if (ch === "}") break;
      if (ch !== ",") invalid();
    }
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
  return new Set(document.eventTypes.map(type => type.name));
}

function readLogSeq(event: OcelDocument["events"][number]): number {
  const value = event.attributes.find(attribute => attribute.name === "log_seq")?.value;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return fail("PERSONA_SUBSTRATE_OCEL_LOG_SEQ_INVALID");
}

function validatePersonaInvariants(document: OcelDocument): void {
  const allowedTypes = contractEventTypes(document);
  const objects = new Map(document.objects.map(object => [object.id, object]));
  let previousLogSeq: number | undefined;
  for (const event of document.events) {
    if (!allowedTypes.has(event.type)) fail("PERSONA_SUBSTRATE_OCEL_EVENT_TYPE_INVALID");
    for (const attribute of event.attributes) {
      if (FORBIDDEN_ATTRIBUTE_NAMES.has(attribute.name)) fail("PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE");
    }
    const caseLinks = event.relationships.filter(relation => relation.qualifier === "case");
    if (caseLinks.length !== 1) fail("PERSONA_SUBSTRATE_OCEL_CASE_RELATION_INVALID");
    const workItem = objects.get(caseLinks[0]!.objectId);
    if (!workItem || workItem.type !== "work_item") fail("PERSONA_SUBSTRATE_OCEL_CASE_RELATION_INVALID");
    const logSeq = readLogSeq(event);
    if (previousLogSeq !== undefined && logSeq <= previousLogSeq) fail("PERSONA_SUBSTRATE_OCEL_LOG_SEQ_INVALID");
    previousLogSeq = logSeq;
  }
  for (const object of document.objects) {
    for (const attribute of object.attributes) {
      if (FORBIDDEN_ATTRIBUTE_NAMES.has(attribute.name)) fail("PERSONA_SUBSTRATE_OCEL_FORBIDDEN_ATTRIBUTE");
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
