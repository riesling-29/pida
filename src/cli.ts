#!/usr/bin/env node
import { once } from "node:events";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  createWorkspace,
  initWorkspace,
  readConfig,
  validateConfig,
  listToolFiles,
  setToolEnabled,
  workspaceEnvironment,
} from "./workspace.js";
import { nativeProviderCatalog } from "./provider-catalog.js";
import { unlockWorkspaceState } from "./workspace-unlock.js";
import { PidaClient } from "./client.js";
import { discoverPrograms, createManifest } from "./program-catalog.js";
import { inspectProgramProxy } from "./program-proxy.js";
import { savePrivate } from "./private-state.js";

const help = `Pida — reusable local agent workspace

  pida init [directory]                 Create config, private .env and sample tool
  pida setup [directory] [--no-open]    Initialize and open easy model setup
  pida configure [directory]            Open easy model setup (--terminal for advanced wizard)
  pida start [directory] [--open]        Serve web UI and API; save conversations
  pida open [directory]                 Open the UI with local authentication
  pida token [directory]                Explicitly print the local UI token
  pida programs scan ROOT              Discover declared repository programs without execution
  pida programs draft ROOT ID [dir]    Write a callable proxy contract for a discovered candidate
  pida programs enable ROOT FILE [dir] Pin a host-trusted program and grant its tool permission
  pida programs disable ID [dir]       Disable a registered proxy (restart required)
  pida tools [directory]                List tool files without importing them
  pida tools enable FILE [directory]    Approve a module; restart to load
  pida tools disable FILE [directory]   Disable a module; restart to unload
  pida doctor [directory]               Validate config, credentials and module paths
  pida runs SESSION [directory]         List captured run/operation IDs from a running server
  pida export SESSION RUN [directory] [--jsonl]  Export an owned run bundle or JSONL
  pida recovery SESSION [dir]          Inspect main-session unknown effects
  pida recovery resolve SESSION EFFECT applied|not_applied [dir]
                                      Record an inspected effect outcome; never replay it
  pida unlock [directory]               Clear a lock only if its local process is gone
  pida browser enable [directory]       Probe Chromium, then enable isolated UI checks
  pida project enable ROOT [directory] [--trusted-host]  Enable Pi project tools; flag also enables host shell
  pida project disable [directory]      Disable project tools (restart required)

Default directory: current working directory. Requires Node 22.19+.
The default mock demonstrates LOT-001/LOT-002; it is not a language model.
`;

async function openBrowser(directory: string, setup = false) {
  const config = readConfig(directory),
    token = workspaceEnvironment(directory).PIDA_API_TOKEN;
  if (!token || token.length < 32)
    throw new Error("Missing local token; run pida doctor.");
  // Fragment never reaches the HTTP server. The UI immediately removes it from browser history.
  const url = `http://127.0.0.1:${config.port}/#token=${encodeURIComponent(token)}${setup ? "&setup=1" : ""}`;
  const command =
    process.platform === "win32"
      ? "rundll32"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", shell: false });
  await new Promise<void>((ok, fail) => {
    child.once("error", () =>
      fail(
        new Error(
          "Browser could not be opened. Open the printed URL and use pida token to sign in.",
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? ok()
        : fail(
            new Error(
              "Browser could not be opened. Open the printed URL and use pida token to sign in.",
            ),
          ),
    );
  });
}
async function configure(directory: string) {
  if (!stdin.isTTY)
    throw new Error(
      "Interactive terminal required. Alternatively edit pida.config.json and .env directly.",
    );
  const config = readConfig(directory),
    rl = createInterface({ input: stdin, output: stdout });
  const ask = async (label: string, fallback: string) =>
    (await rl.question(`${label} [${fallback}]: `)).trim() || fallback;
  try {
    const catalog = nativeProviderCatalog();
    console.log("Providers: " + catalog.map(p => p.id).join(", ") + ", endpoint, mock");
    const mode = await ask("Provider", config.provider.kind === "native" ? config.provider.providerId : config.provider.kind);
    if (mode === "mock") config.provider = { kind: "mock" };
    else if (mode === "endpoint") {
      const previous =
        config.provider.kind === "endpoint" ? config.provider : undefined;
      const api = await ask("Protocol", previous?.api ?? "openai-completions");
      const enteredUrl = await ask(
        "Base URL",
        previous?.baseUrl ?? "http://localhost:1234/v1",
      );
      const normalizeUrl = (value: string) => new URL(value.trim()).href
        .replace(/\/$/, "")
        .replace(/\/(chat\/completions|responses|messages)$/, "");
      const baseUrl = normalizeUrl(enteredUrl);
      const sameEndpoint = previous?.api === api && normalizeUrl(previous.baseUrl) === baseUrl;
      const modelId = await ask(
        "Exact model/deployment ID",
        previous?.modelId ?? "your-model-id",
      );
      const contextWindow = Number(
        await ask(
          "Model context window",
          String(previous?.contextWindow ?? 32000),
        ),
      );
      const maxTokens = Number(
        await ask("Maximum output tokens", String(previous?.maxTokens ?? 2048)),
      );
      const apiKeyEnv = await ask(
        "Credential environment variable name",
        previous?.apiKeyEnv ?? "PIDA_LLM_API_KEY",
      );
      const allowInsecureHttp =
        baseUrl.startsWith("http:") &&
        (await ask(
          "Allow unencrypted HTTP for this endpoint? yes/no",
          "no",
        )) === "yes";
      config.provider = {
        kind: "endpoint",
        api: api as "openai-completions",
        baseUrl,
        modelId,
        contextWindow,
        maxTokens,
        apiKeyEnv,
        allowInsecureHttp,
        ...(sameEndpoint && previous?.authMode ? { authMode: previous.authMode } : {}),
        ...(sameEndpoint && previous?.headersEnv ? { headersEnv: previous.headersEnv } : {}),
        ...(sameEndpoint && previous?.compat ? { compat: previous.compat } : {}),
      };
    } else {
      const selected = catalog.find(p => p.id === mode);
      if (!selected) throw new Error("Select one of the listed providers.");
      selected.models.forEach((m, i) => console.log(`${i + 1}. ${m.name} (${m.id})`));
      const previous = config.provider.kind === "native" && config.provider.providerId === mode ? config.provider : undefined;
      const choice = await ask("Model number or exact ID", previous?.modelId ?? "1");
      const modelId = /^\d+$/.test(choice) ? selected.models[Number(choice) - 1]?.id : choice;
      if (!modelId) throw new Error("Invalid model selection");
      config.provider = { kind: "native", providerId: mode, modelId,
        apiKeyEnv: previous?.apiKeyEnv ?? selected.apiKeyEnv };
    }
    // Validate before replacing the user's configuration.
    const { validateConfig } = await import("./workspace.js");
    validateConfig(config, directory);
    writeFileSync(
      join(resolve(directory), "pida.config.json"),
      JSON.stringify(config, null, 2) + "\n",
    );
    console.log("Configuration saved. Restart Pida to apply it.");
    if (config.provider.kind !== "mock")
      console.log(
        `Put ${config.provider.apiKeyEnv} in the private .env file or your shell environment. For a keyless custom endpoint, set authMode to none. Run pida doctor, then a real tool request to verify compatibility.`,
      );
  } finally {
    rl.close();
  }
}

async function startWorkspace(
  directory: string,
  open: boolean,
  setup: boolean,
) {
  if (setup) {
    const config = readConfig(directory),
      token = workspaceEnvironment(directory).PIDA_API_TOKEN;
    const available = await fetch(
      `http://127.0.0.1:${config.port}/v1/provider`,
      {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        signal: AbortSignal.timeout(1500),
        redirect: "error",
      },
    )
      .then((response) => response.ok)
      .catch(() => false);
    if (available) {
      if (open)
        await openBrowser(directory, true).catch((e) =>
          console.error(e.message),
        );
      console.log(
        `Pida settings: http://127.0.0.1:${config.port} (use the model settings button after login)`,
      );
      return;
    }
  }
  // CLI owns its process environment, including credentials used by trusted business tools.
  const env = workspaceEnvironment(directory);
  for (const [key, value] of Object.entries(env))
    if (process.env[key] === undefined && value !== undefined)
      process.env[key] = value;
  const app = await createWorkspace(directory);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    app.server.close();
    await app.close();
    app.server.closeAllConnections();
  };
  try {
    app.server.listen(app.config.port, "127.0.0.1");
    await once(app.server, "listening");
  } catch (error) {
    await app.close();
    throw error;
  }
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  console.log(
    `Pida ready: http://127.0.0.1:${app.config.port}\nWorkspace: ${directory}\nProvider: ${app.config.provider.kind} · conversations saved locally\nUse pida open "${directory}" to sign in, or pida token "${directory}" for manual sign-in. Ctrl+C stops the server.`,
  );
  if (open)
    await openBrowser(directory, setup).catch((e) => console.error(e.message));
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(help);
    return;
  }
  const directory = resolve(args.find((a) => !a.startsWith("--")) ?? ".");
  switch (command) {
    case "browser": {
      if (args[0] !== "enable") throw new Error("Use pida browser enable [workspace-directory].");
      const selected = resolve(args[1] ?? "."), config = readConfig(selected);
      const browserExecutable = workspaceEnvironment(selected).PIDA_BROWSER_EXECUTABLE;
      if (browserExecutable) process.env.PIDA_BROWSER_EXECUTABLE = browserExecutable;
      const { checkUi } = await import("./ui-check.js");
      const result = await checkUi("<!doctype html><html><body>Pida browser ready</body></html>", [], new AbortController().signal);
      if (!result.ok) throw new Error(`${result.error ?? "UI_CHECK_FAILED"}: install Chromium with npx playwright install chromium, or set PIDA_BROWSER_EXECUTABLE to an existing browser. Configuration was not changed.`);
      config.browserChecks = true;
      validateConfig(config, selected);
      writeFileSync(join(selected, "pida.config.json"), JSON.stringify(config, null, 2) + "\n");
      console.log("Isolated browser probe passed; browserChecks enabled. Restart Pida to register ui_check.");
      return;
    }
    case "project": {
      const enable = args[0] === "enable";
      if (!enable && args[0] !== "disable") throw new Error("Use pida project enable ROOT [workspace] [--trusted-host], or pida project disable [workspace].");
      if (enable && (!args[1] || args[1].startsWith("--"))) throw new Error("Supply the project root directory.");
      const candidate = args[enable ? 2 : 1];
      const selected = resolve(candidate && !candidate.startsWith("--") ? candidate : "."), config = readConfig(selected);
      config.permissions = config.permissions.filter(p => !["project:read", "project:write", "project:execute"].includes(p));
      if (enable) {
        const trustedHost = args.includes("--trusted-host");
        config.project = { enabled: true, root: resolve(args[1]!), trustedHost, timeoutSeconds: 120 };
        config.permissions.push("project:read", "project:write", ...(trustedHost ? ["project:execute"] : []));
      } else delete config.project;
      validateConfig(config, selected);
      writeFileSync(join(selected, "pida.config.json"), JSON.stringify(config, null, 2) + "\n");
      console.log(enable ? `Project tools enabled: ${config.project!.root}\n${config.project!.trustedHost ? "Host shell enabled with your OS account privileges; this is not a sandbox." : "File tools only; host shell disabled."}\nRestart Pida. Workbench checkpoints do not restore project files.` : "Project tools disabled. Restart Pida.");
      return;
    }
    case "runs":
    case "export": {
      const sessionId = args[0], runId = command === "export" ? args[1] : undefined;
      if (!sessionId || (command === "export" && !runId)) throw new Error("Supply session ID and, for export, run ID.");
      const selected = resolve(args[command === "export" ? 2 : 1]?.startsWith("--") ? "." : args[command === "export" ? 2 : 1] ?? ".");
      const config = readConfig(selected), token = workspaceEnvironment(selected).PIDA_API_TOKEN;
      if (!token) throw new Error("Missing local token; run pida doctor.");
      const client = new PidaClient({ baseUrl: `http://127.0.0.1:${config.port}`, token: () => token });
      if (command === "runs") console.log(JSON.stringify(await client.listRuns(sessionId), null, 2));
      else if (args.includes("--jsonl")) {
        const output = await client.exportRunJsonl(sessionId, runId!);
        process.stdout.write(output.jsonl);
        if (!output.complete) { console.error("OBSERVATION_INCOMPLETE: export is partial; inspect the JSON bundle."); process.exitCode = 2; }
      } else console.log(JSON.stringify(await client.exportRun(sessionId, runId!), null, 2));
      return;
    }
    case "init":
      initWorkspace(directory);
      console.log(
        `Workspace created: ${directory}\nNext: pida start ${directory === process.cwd() ? "" : JSON.stringify(directory)} --open\nOptional: pida configure to connect your LLM.`,
      );
      return;
    case "configure":
      if (args.includes("--terminal")) {
        await configure(directory);
        return;
      }
      await startWorkspace(directory, !args.includes("--no-open"), true);
      return;
    case "setup":
      if (!existsSync(join(directory, "pida.config.json")))
        initWorkspace(directory);
      await startWorkspace(directory, !args.includes("--no-open"), true);
      return;
    case "token": {
      const token = workspaceEnvironment(directory).PIDA_API_TOKEN;
      if (!token) throw new Error("No token configured.");
      console.log(token);
      return;
    }
    case "open":
      await openBrowser(directory);
      return;
    case "recovery": {
      const resolving = args[0] === "resolve", sessionId = args[resolving ? 1 : 0];
      if (!sessionId) throw new Error("Supply the main session ID.");
      const selected = resolve(args[resolving ? 4 : 1] ?? "."), config = readConfig(selected), env = workspaceEnvironment(selected);
      if (!env.PIDA_API_TOKEN) throw new Error("Missing local application token.");
      const client = new PidaClient({ baseUrl: `http://127.0.0.1:${config.port}`, token: () => env.PIDA_API_TOKEN! });
      if (resolving) {
        const id = args[2], state = args[3];
        if (!id || !["applied", "not_applied"].includes(state ?? "")) throw new Error("Supply effect ID and inspected state applied or not_applied.");
        console.log(JSON.stringify(await client.reconcileSession(sessionId, [{ id, state: state as "applied" | "not_applied" }]), null, 2));
      } else console.log(JSON.stringify(await client.getRecovery(sessionId), null, 2));
      return;
    }
    case "programs": {
      const action = args[0];
      if (action === "scan" && args[1]) { console.log(JSON.stringify(discoverPrograms(resolve(args[1])), null, 2)); return; }
      if (action === "draft" && args[1] && args[2]) {
        const source = resolve(args[1]), selected = resolve(args[3] ?? ".");
        readConfig(selected);
        const candidate = discoverPrograms(source).candidates.find(item => item.id === args[2]);
        if (!candidate) throw new Error("PROGRAM_CANDIDATE_NOT_FOUND: scan the repository again.");
        const manifest = createManifest(candidate), folder = join(selected, "programs");
        if (existsSync(folder) && (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())) throw new Error("PROGRAM_REGISTRY_UNSAFE");
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        const file = join(folder, manifest.id + ".json");
        writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        console.log(`Proxy contract saved: ${file}\nInspect the fixed command/input/output contract, then use programs enable with the source root and this file. No program was run or enabled.`); return;
      }
      if (action === "enable" && args[1] && args[2]) {
        const source = resolve(args[1]), file = resolve(args[2]), selected = resolve(args[3] ?? "."), config = readConfig(selected);
        const inspected = await inspectProgramProxy(source, file);
        const registration = { id: inspected.manifest.id, enabled: true, root: source, manifest: file, approval: inspected.approval };
        config.programs = [...(config.programs ?? []).filter(item => item.id !== registration.id), registration];
        config.permissions = [...new Set([...config.permissions, `program:${registration.id}`])];
        validateConfig(config, selected); savePrivate(join(selected, "pida.config.json"), config);
        console.log(`Pinned program ${registration.id}; permission program:${registration.id}. Restart Pida to register the callable proxy. No program was run.`); return;
      }
      if (action === "disable" && args[1]) {
        const selected = resolve(args[2] ?? "."), config = readConfig(selected), id = args[1];
        const item = config.programs?.find(item => item.id === id);
        if (!item) throw new Error("PROGRAM_NOT_FOUND");
        item.enabled = false; config.permissions = config.permissions.filter(permission => permission !== `program:${id}`);
        savePrivate(join(selected, "pida.config.json"), config); console.log("Program proxy disabled. Restart Pida."); return;
      }
      throw new Error("Use programs scan ROOT, draft ROOT ID [workspace], enable ROOT MANIFEST [workspace], or disable ID [workspace].");
    }
    case "unlock":
      unlockWorkspaceState(join(directory, readConfig(directory).stateDir));
      console.log("No stale lock remains.");
      return;
    case "tools": {
      if (args[0] === "enable" || args[0] === "disable") {
        if (!args[1]) throw new Error("Supply a tool filename.");
        setToolEnabled(resolve(args[2] ?? "."), args[1], args[0] === "enable");
        console.log(
          "Tool selection saved. Grant its permission in pida.config.json if appropriate, then restart.",
        );
      } else console.table(listToolFiles(directory));
      return;
    }
    case "doctor": {
      const { checkWorkspace } = await import("./workspace.js");
      const report = checkWorkspace(directory);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "start":
      await startWorkspace(directory, args.includes("--open"), false);
      return;
    default:
      throw new Error(`Unknown command: ${command}. Use pida --help.`);
  }
}
main().catch((error) => {
  console.error(
    `Pida: ${error instanceof Error ? error.message : "Operation failed"}`,
  );
  process.exitCode = 1;
});
