import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { PidaError, type BusinessTool } from "./runtime.js";

export const codingPackIds = ["debugging", "verification"] as const;
export function codingPacks(enabled: readonly string[] = codingPackIds) {
  if (enabled.some(id => !codingPackIds.includes(id as typeof codingPackIds[number]))) throw new Error("Unknown coding pack");
  const guides = new Map<string, string>();
  const skills = enabled.flatMap(id => {
    const dir = fileURLToPath(new URL(`../packs/${id}/`, import.meta.url));
    guides.set(id, readFileSync(new URL(`../packs/${id}/SKILL.md`, import.meta.url), "utf8"));
    return loadSkillsFromDir({ dir, source: "pida-reviewed-pack" }).skills;
  });
  const tools: BusinessTool<any>[] = enabled.length ? [{
    name: "coding_guide", description: `Read an installed coding guide by ID: ${enabled.join(", ")}. Use debugging for failures and verification before claiming completion.`,
    parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), permission: "workbench:read", effect: "read",
    async execute(args: { id: string }) {
      const guidance = guides.get(args.id);
      if (!guidance) throw new PidaError("CODING_GUIDE_NOT_FOUND", 400);
      return { id: args.id, guidance, environment: "Use only registered Pida tools. A guide grants no permissions or new tools. Translate shell/test examples to available tools. Do not claim unavailable checks. Use proportional verification for the requested change; no mandatory ceremony for simple reversible edits." };
    },
  }] : [];
  return { skills, tools, prompt: enabled.length ? `\nReviewed coding guides available through coding_guide: ${enabled.join(", ")}. Load the relevant guide on demand; do not read all guides every turn. Guide examples do not grant tools or permissions. Prefer a small, verified change. For UI work preserve existing design, use consistent spacing/type/color, maintain accessible labels and responsive layout. Split complex requests into small complete ui_patch calls and re-read the revision after each applied change. Keep requirement/decision/pending-task notes in workspace files for long tasks. Verify claims with available tools and distinguish file checks from actual browser checks.` : "" };
}
