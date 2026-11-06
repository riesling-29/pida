import {
  PidaRuntime,
  mockProvider,
  endpointProvider,
  lotStatusTool,
  type EndpointConfig,
} from "./index.js";
import { createPidaServer, staticTokenAuth } from "./http.js";

const token = process.env.PIDA_API_TOKEN;
if (!token)
  throw new Error(
    "Set PIDA_API_TOKEN to a random token of at least 32 characters",
  );
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
const mode = process.env.PIDA_PROVIDER ?? "mock";
if (!["mock", "endpoint"].includes(mode))
  throw new Error("PIDA_PROVIDER must be mock or endpoint");
const provider =
  mode === "mock"
    ? mockProvider
    : endpointProvider({
        id: "company",
        api: (process.env.PIDA_API ??
          "openai-completions") as EndpointConfig["api"],
        baseUrl: process.env.PIDA_BASE_URL ?? "",
        modelId: process.env.PIDA_MODEL ?? "",
        apiKeyEnv: "PIDA_LLM_API_KEY",
        contextWindow: Number(process.env.PIDA_CONTEXT_WINDOW ?? 32000),
        maxTokens: Number(process.env.PIDA_MAX_TOKENS ?? 2048),
        allowInsecureHttp: process.env.PIDA_ALLOW_HTTP === "true",
      });
const runtime = new PidaRuntime({ provider, tools: [lotStatusTool] });
const server = createPidaServer({
  runtime,
  serveDemo: true,
  allowedOrigin: `http://127.0.0.1:${port}`,
  authenticate: staticTokenAuth([
    { token, principal: { id: "demo-user", permissions: ["lots:read"] } },
  ]),
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Pida ${mode} demo: http://127.0.0.1:${port} (token is not logged)`,
  ),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await runtime.close();
  server.closeAllConnections();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
