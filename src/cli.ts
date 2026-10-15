#!/usr/bin/env node
import { once } from "node:events";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  createWorkspace,
  initWorkspace,
  readConfig,
  listToolFiles,
  setToolEnabled,
  workspaceEnvironment,
} from "./workspace.js";
import { unlockStore } from "./storage.js";

const help = `Pida — reusable local agent workspace

  pida init [directory]                 Create config, private .env and sample tool
  pida configure [directory]            Configure mock or company/local endpoint
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

async function openBrowser(directory: string) {
  const config = readConfig(directory),
    token = workspaceEnvironment(directory).PIDA_API_TOKEN;
  if (!token || token.length < 32)
    throw new Error("Missing local token; run pida doctor.");
  // Fragment never reaches the HTTP server. The UI immediately removes it from browser history.
  const url = `http://127.0.0.1:${config.port}/#token=${encodeURIComponent(token)}`;
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
    const mode = await ask("Provider: mock or endpoint", config.provider.kind);
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
    } else throw new Error("Provider must be mock or endpoint.");
    // Validate before replacing the user's configuration.
    const { validateConfig } = await import("./workspace.js");
    validateConfig(config, directory);
    writeFileSync(
      join(resolve(directory), "pida.config.json"),
      JSON.stringify(config, null, 2) + "\n",
    );
    console.log("Configuration saved. Restart Pida to apply it.");
    if (config.provider.kind === "endpoint")
      console.log(
        `Put ${config.provider.apiKeyEnv} in the private .env file or your shell environment. For a no-auth local endpoint, use a non-secret placeholder. Run pida doctor, then a real tool request to verify compatibility.`,
      );
  } finally {
    rl.close();
  }
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
      await configure(directory);
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
    case "start": {
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
        `Pida ready: http://127.0.0.1:${app.config.port}\nProvider: ${app.config.provider.kind} · conversations saved locally\nUse pida open to sign in, or pida token for manual sign-in. Ctrl+C stops the server.`,
      );
      if (args.includes("--open"))
        await openBrowser(directory).catch((e) => console.error(e.message));
      return;
    }
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
