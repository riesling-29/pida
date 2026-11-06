// Reproducible scenario logic with genuinely captured (new per generation) event IDs.
// Model decisions are scripted; Pi, tools, journal and verification are executed.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions } from "../dist/index.js";
import { validateObservationBundle, bundleJsonSchema, manifestJsonSchema, observationJsonSchema } from "../dist/integration-contract.js";
const output = fileURLToPath(new URL("../fixtures/schumpeter-readiness/", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "pida-fixtures-"));
const owner = { id: "fixture-owner", permissions: workbenchPermissions };
const index = { contract: "pida-native-draft", schumpeter_contract_confirmed: false, model: "scripted-faux", fixtures: [] };
const runtimes = [];
await mkdir(output, { recursive: true });
async function save(name, bundle) {
  const result = validateObservationBundle(bundle);
  await writeFile(join(output, name + ".json"), JSON.stringify(bundle, null, 2) + "\n");
  index.fixtures.push({ file: name + ".json", ...result });
}
async function create(responses, extra = {}) {
  const f = fauxProvider({ tokensPerSecond: 100000 }); f.setResponses(responses);
  const runtime = new PidaRuntime({ provider: () => ({ provider: f.provider, modelId: f.getModel().id }), ...extra }); runtimes.push(runtime);
  const { sessionId } = await runtime.createSession(owner); return { runtime, sessionId, f };
}
const tool = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
try {
  const bench = new PidaWorkbench(join(root, "workbench"));
  await bench.write(owner, "value.txt", "before");
  await bench.write(owner, "verify.js", 'assert(pida.readText("value.txt") === "before", "expected fixture value");');
  const a = await create([tool("workspace_test", { path: "verify.js" }), answer("Checks passed.")], { tools: bench.tools(), inspectArtifacts: p => bench.captureArtifacts(p) });
  const passed = await a.runtime.run(a.sessionId, owner, "Test the fixture.");
  const good = a.runtime.exportRun(a.sessionId, passed.runId, owner);
  await save("scoped-verification", good);
  await writeFile(join(output, "scoped-verification.jsonl"), good.events.map(e => JSON.stringify(e)).join("\n") + "\n");
  a.f.setResponses([tool("workspace_test", { path: "verify.js" }), tool("workspace_write", { path: "value.txt", content: "after" }), answer("Changed after testing.")]);
  const stale = await a.runtime.run(a.sessionId, owner, "Test, then change.");
  await save("stale-verification", a.runtime.exportRun(a.sessionId, stale.runId, owner));
  const b = await create([answer("I completed everything.")]);
  const claim = await b.runtime.run(b.sessionId, owner, "Report completion.");
  await save("claim-without-evidence", b.runtime.exportRun(b.sessionId, claim.runId, owner));
  const c = await create([answer("must not execute")]);
  const controller = new AbortController();
  const cancelled = await c.runtime.run(c.sessionId, owner, "cancel", e => { if (e.type === "trace" && e.trace.type === "run_started") controller.abort(); }, controller.signal);
  await save("cancelled", c.runtime.exportRun(c.sessionId, cancelled.runId, owner));
  const d = await create([async (_ctx, options) => { if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true })); return answer("", { stopReason: "aborted" }); }], { maxRunMs: 30 });
  const timed = await d.runtime.run(d.sessionId, owner, "wait");
  await save("timeout", d.runtime.exportRun(d.sessionId, timed.runId, owner));
  const e = await create([answer("partial", { stopReason: "length" }), answer("short response")]);
  const retried = await e.runtime.run(e.sessionId, owner, "continue in smaller output");
  await save("output-retry", e.runtime.exportRun(e.sessionId, retried.runId, owner));
  const duplicate = structuredClone(good); duplicate.events.splice(1, 0, structuredClone(duplicate.events[0])); await save("duplicate-delivery", duplicate);
  const gap = structuredClone(good); gap.events.splice(1, 1); gap.complete = false; gap.known_limits.push("OBSERVATION_INCOMPLETE"); await save("sequence-gap", gap);
  const tampered = structuredClone(good); tampered.events[0].payload.status = "tampered"; await save("tampered-digest", tampered);
  const fabricated = structuredClone(good); fabricated.manifest.verification_status = "VERIFIED"; await save("unsupported-verified-claim", fabricated);
  const leaked = structuredClone(good); leaked.events[0].payload.prompt = "synthetic-private-prompt"; await save("forbidden-payload-field", leaked);
  await writeFile(join(output, "index.json"), JSON.stringify(index, null, 2) + "\n");
  for (const [name, schema] of Object.entries({ observation: observationJsonSchema, manifest: manifestJsonSchema, bundle: bundleJsonSchema })) await writeFile(join(output, name + ".schema.json"), JSON.stringify(schema, null, 2) + "\n");
  console.log(JSON.stringify({ generated: index.fixtures.length, directory: "fixtures/schumpeter-readiness", schumpeter_contract_confirmed: false }));
} finally { for (const r of runtimes) await r.close(); await rm(root, { recursive: true, force: true }); }
