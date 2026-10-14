/** Transport-only types: safe to import into browser/native client projects. */
export type RunStatus = "completed" | "failed" | "cancelled" | "limited";
export interface TraceEvent {
  sequence: number;
  timestamp: string;
  sessionId: string;
  runId: string;
  type: string;
  toolName?: string;
  status?: RunStatus;
  code?: string;
}
export interface RunResult {
  runId: string;
  sessionId: string;
  status: RunStatus;
  text: string;
  code?: string;
}
export type StreamEvent =
  | { type: "trace"; trace: TraceEvent }
  | { type: "text_delta"; delta: string }
  | { type: "result"; result: RunResult };
