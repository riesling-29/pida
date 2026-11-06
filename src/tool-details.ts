import type { ToolDetail } from "./protocol.js";

/** A bounded display projection of private Pi history, never copied into observations. */
export function projectToolDetails(messages: readonly unknown[], allowed: ReadonlySet<string>, runs: ReadonlyMap<string, string>, activeRunId?: string) {
  const calls = new Map<string, ToolDetail>();
  const object = (value: unknown): Record<string, any> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
  const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : undefined;
  for (const unknownMessage of messages) {
    const m = object(unknownMessage);
    if (!m) continue;
    if (m.role === "assistant" && Array.isArray(m.content)) for (const block of m.content) {
      const b = object(block);
      if (b?.type !== "toolCall" || typeof b.id !== "string" || !allowed.has(b.name)) continue;
      const args = object(b.arguments);
      calls.set(b.id, { toolCallId: b.id, toolName: b.name, status: "unknown", ...(runs.has(b.id) ? { runId: runs.get(b.id) } : {}),
        ...(typeof args?.command === "string" ? { command: text(args.command, 4000) } : {}),
      });
    }
    if (m.role !== "toolResult" || typeof m.toolCallId !== "string") continue;
    const call = calls.get(m.toolCallId);
    if (!call || m.toolName !== call.toolName) continue;
    const parts = Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text) : [];
    const raw = parts.join("\n");
    let value: Record<string, any> | undefined;
    try { value = object(JSON.parse(raw)); } catch { /* Pi errors may be plain text. */ }
    const runId = object(object(m.details)?.pida)?.runId;
    if (typeof runId === "string" && /^[a-f0-9-]{36}$/.test(runId)) call.runId = runId;
    call.status = m.isError || value?.ok === false ? "failed" : "completed";
    if (Number.isInteger(value?.exitCode)) call.exitCode = value!.exitCode;
    if (typeof value?.cwd === "string") call.cwd = text(value.cwd, 1000);
    const output = typeof value?.output === "string" ? value.output : typeof value?.stdout === "string" ? value.stdout : raw;
    call.output = output.slice(0, 12000);
    if (typeof value?.stderr === "string") call.stderr = value.stderr.slice(0, 12000);
    call.truncated = output.length > 12000 || (value?.stderr?.length ?? 0) > 12000 || value?.truncated === true;
    // Host output references are labels only. No URL or arbitrary filesystem access is granted.
    const refs = (v: unknown) => Array.isArray(v) ? v.flatMap(s => {
      if (typeof s === "string" && s.length < 512) return [s];
      const ref = object(s);
      if (typeof ref?.id !== "string" || !/^output_[a-f0-9]{32}$/.test(ref.id)) return [];
      return [ref.id + (typeof ref.readTool === "string" && /^program_[a-z0-9_]+_output$/.test(ref.readTool) ? ` · ${ref.readTool}` : "")];
    }).slice(0, 30) : undefined;
    call.artifactRefs = refs(value?.artifact_refs ?? value?.artifactRefs);
    call.evidenceRefs = refs(value?.evidence_refs ?? value?.evidenceRefs);
  }
  for (const call of calls.values()) if (call.status === "unknown" && call.runId && call.runId === activeRunId) call.status = "running";
  const items = [...calls.values()];
  return { items: items.slice(-40), truncated: items.length > 40, historyScope: "retained-pi-context" as const };
}
