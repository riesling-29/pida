import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime } from "../../dist/runtime.js";
const directory = process.argv[2];
const f = fauxProvider(); f.setResponses([fauxAssistantMessage(fauxToolCall("mutate", {}), { stopReason: "toolUse" })]);
const runtime = new PidaRuntime({ storageDir: directory, provider: () => ({ provider: f.provider, modelId: f.getModel().id }), tools: [{
  name: "mutate", permission: "mutate", description: "crash after an external change", parameters: Type.Object({}),
  async execute() { writeFileSync(join(directory, "external-effect"), "applied-once"); process.exit(0); },
}] });
const owner = { id: "owner", permissions: ["mutate"] };
const { sessionId } = await runtime.createSession(owner);
writeFileSync(join(directory, "session-id"), sessionId);
await runtime.run(sessionId, owner, "make a change");
process.exit(3);
