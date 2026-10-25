#!/usr/bin/env node
import { once } from "node:events";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  createWorkspace,
  initWorkspace,
  readConfig,
  listToolFiles,
  setToolEnabled,
  workspaceEnvironment,
} from "./workspace.js";
import { nativeProviderCatalog } from "./provider-catalog.js";
import { unlockStore } from "./storage.js";

const help = `Pida — reusable local agent workspace

  pida init [directory]                 Create config, private .env and sample tool
  pida setup [directory] [--no-open]    Initialize and open easy model setup
  pida configure [directory]            Open easy model setup (--terminal for advanced wizard)
  pida start [directory] [--open]        Serve web UI and API; save conversations
  pida open [directory]                 Open the UI with local authentication
  pida token [directory]                Explicitly print the local UI token
  pida tools [directory]                List tool files without importing them
  pida tools enable FILE [directory]    Approve a module; restart to load
  pida tools disable FILE [directory]   Disable a module; restart to unload
  pida doctor [directory]               Validate config, credentials and module paths
  pida unlock [directory]               Clear a lock only if its local process is gone

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
      const baseUrl = await ask(
        "Base URL",
        previous?.baseUrl ?? "http://localhost:1234/v1",
      );
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
    await app.runtime.close();
    app.server.closeAllConnections();
  };
  try {
    app.server.listen(app.config.port, "127.0.0.1");
    await once(app.server, "listening");
  } catch (error) {
    await app.runtime.close();
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
    case "unlock":
      unlockStore(join(directory, readConfig(directory).stateDir));
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
