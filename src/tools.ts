import { Type } from "typebox";
import { defineBusinessTool } from "./runtime.js";

/** Synthetic fixtures only; replace with a permission-scoped business data service. */
export const lotStatusTool = defineBusinessTool({
  name: "get_lot_status",
  effect: "read",
  description:
    "Look up synthetic production lot status. This is demo data, not live manufacturing data.",
  permission: "lots:read",
  parameters: Type.Object(
    { lotId: Type.String({ pattern: "^LOT-[0-9]{3}$" }) },
    { additionalProperties: false },
  ),
  async execute({ lotId }, { signal }) {
    signal.throwIfAborted();
    const lots: Record<string, { stage: string; status: string }> = {
      "LOT-001": { stage: "inspection", status: "waiting" },
      "LOT-002": { stage: "etch", status: "processing" },
    };
    return {
      synthetic: true,
      lotId,
      ...(lots[lotId] ?? { stage: "unknown", status: "not_found" }),
    };
  },
});
