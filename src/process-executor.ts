import { createLocalBashOperations, createLocalPowerShellOperations } from "@earendil-works/pi-coding-agent";

export type CommandSandbox = "none" | "read-only" | "workspace-write";
export interface ProcessCapabilities {
  backend: string;
  platform: string;
  pty: boolean;
  stdin: boolean;
  sandboxModes: readonly CommandSandbox[];
  containment: string;
  rangeExitVerification: boolean;
  outputStreams: "combined" | "separate";
}
export interface ProcessExit {
  exitCode: number | null;
  error?: "COMMAND_START_FAILED" | "COMMAND_EXECUTION_FAILED" | "COMMAND_CANCELLED";
  directExited: boolean | "unknown";
  rangeExited: boolean | "unknown";
}
export interface ProcessRequest {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  onData: (data: Buffer) => void;
  pty: boolean;
  sandbox: CommandSandbox;
}
/** Host-selected executor boundary. An adapter must implement each capability it advertises. */
export interface ProcessExecutor {
  readonly capabilities: ProcessCapabilities;
  execute(request: ProcessRequest): Promise<ProcessExit>;
}

/** Deliberately excludes provider credentials and shell/interpreter injection environment variables. */
export function projectCommandEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir", "home", "userprofile", "localappdata", "appdata", "programfiles", "programfiles(x86)", "lang", "lc_all", "term"]);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined));
}

/** Reuses Pi's installed shell driver, including its cancellation and process-tree cleanup. */
export function createPiProcessExecutor(shell: "bash" | "powershell"): ProcessExecutor {
  const operations = shell === "powershell" ? createLocalPowerShellOperations() : createLocalBashOperations();
  return {
    capabilities: Object.freeze({ backend: "pi-local", platform: process.platform, pty: false, stdin: false,
      sandboxModes: Object.freeze(["none"] as const), containment: process.platform === "win32" ? "windows-taskkill-best-effort" : "posix-process-group-best-effort",
      rangeExitVerification: false, outputStreams: "combined" }),
    async execute(request) {
      if (request.pty || request.sandbox !== "none") return { exitCode: null, error: "COMMAND_START_FAILED", directExited: true, rangeExited: "unknown" };
      if (request.signal.aborted) return { exitCode: null, error: "COMMAND_CANCELLED", directExited: true, rangeExited: "unknown" };
      try {
        const result = await operations.exec(request.command, request.cwd, { onData: request.onData, signal: request.signal, env: request.env });
        return { exitCode: result.exitCode, directExited: true, rangeExited: "unknown" };
      } catch (error) {
        // Pi's "aborted" outcome is produced after its direct-child wait. It does not expose a
        // managed process-range wait or prove that detached/escaped descendants have stopped.
        const aborted = error instanceof Error && error.message === "aborted";
        return { exitCode: null, error: request.signal.aborted ? "COMMAND_CANCELLED" : (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "COMMAND_START_FAILED" : "COMMAND_EXECUTION_FAILED",
          directExited: aborted ? true : "unknown", rangeExited: "unknown" };
      }
    },
  };
}
