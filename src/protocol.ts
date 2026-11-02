import type { SessionHandoff } from "./run-context.js";
/** Transport-only types: safe to import into browser/native client projects. */
export type RunStatus = "completed" | "failed" | "cancelled" | "limited";
export interface SessionSummary {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  running: boolean;
  runs: number;
  lastStatus?: RunStatus | "interrupted";
  handoff?: SessionHandoff;
}
export interface RuntimeInfo {
  persistence: boolean;
  tools: { name: string; description: string; permitted: boolean }[];
  provider?: { mode: string; model: string };
  capabilities?: {
    steering: boolean; followUp: boolean; queuedInputDurable: false;
    instructions: { scope: "project-root" | "none"; files: number };
    skills: number; ambientExtensions: false;
  };
}
export interface TraceEvent {
  sequence: number;
  timestamp: string;
  sessionId: string;
  runId: string;
  type: string;
  toolName?: string;
  toolCallId?: string;
  status?: RunStatus;
  code?: string;
  persistenceError?: "PERSISTENCE_FAILED";
}
export interface ToolDetail {
  runId?: string;
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "failed" | "unknown";
  command?: string;
  cwd?: string;
  exitCode?: number;
  output?: string;
  stderr?: string;
  truncated?: boolean;
  artifactRefs?: string[];
  evidenceRefs?: string[];
}
export interface SessionTools {
  sessionId: string;
  items: ToolDetail[];
  truncated: boolean;
  historyScope: "retained-pi-context";
}
export interface TracePage {
  events: TraceEvent[];
  earliestSequence: number;
  nextSequence: number;
  truncated: boolean;
  activeRunId?: string;
}
export interface RunResult {
  runId: string;
  sessionId: string;
  status: RunStatus;
  text: string;
  code?: string;
  taskId?: string;
  recovery?: { autoRetry: false; pendingEffectIds: string[]; action: "inspect-and-reconcile" | "repair-effect-ledger" };
  /** Secondary storage failure; cancellation/timeout keep their original status and code. */
  persistenceError?: "PERSISTENCE_FAILED";
}
export type StreamEvent =
  | { type: "trace"; trace: TraceEvent }
  | { type: "text_delta"; delta: string }
  | { type: "result"; result: RunResult };
