// Run after packing: node scripts/install-check.mjs <npm|pnpm|bun> <tarball> [manager-executable]
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
const [manager, input, executable = manager] = process.argv.slice(2);
if (!["npm", "pnpm", "bun"].includes(manager) || !input)
  throw new Error("Usage: install-check.mjs npm|pnpm|bun TARBALL [EXECUTABLE]");
const tarball = resolve(input),
  dir = await mkdtemp(join(tmpdir(), `pida-install-${manager}-`));
let server;
async function command(args) {
  const child = spawn(executable, args, {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "true" },
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${manager} failed (${code}): ${output}`);
  return output;
}
try {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "pida-install-check",
      version: "1.0.0",
      private: true,
      type: "module",
    }),
  );
  const version = await command(["--version"]);
  await command(
    manager === "npm"
      ? ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]
      : ["add", "--ignore-scripts", tarball],
  );
  const launch =
    manager === "npm"
      ? ["exec", "--no", "--", "pida"]
      : manager === "pnpm"
        ? ["exec", "pida"]
        : ["run", "pida"];
  await command([...launch, "init"]);
  const configPath = join(dir, "pida.config.json"),
    config = JSON.parse(await readFile(configPath, "utf8"));
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  config.port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  await writeFile(configPath, JSON.stringify(config));
  const token = (await readFile(join(dir, ".env"), "utf8")).match(
    /PIDA_API_TOKEN=(.*)/,
  )[1];
  // Use the installed Node CLI for the long-running child to avoid orphaning package-manager grandchildren.
  // The manager's own exec/run command already exercised its installed binary above.
  server = spawn(
    process.execPath,
    [join(dir, "node_modules/pida-core/dist/cli.js"), "start"],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  server.stderr.on("data", (c) => (err += c));
  await new Promise((ok, fail) => {
    server.stdout.on("data", (c) => {
      out += c;
      if (out.includes("Pida ready:")) ok();
    });
    server.once("error", fail);
    server.once("exit", () => fail(new Error(err)));
  });
  assert.ok(!out.includes(token));
  const base = `http://127.0.0.1:${config.port}`;
  const request = async (path, body) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.ok, true);
    return r;
  };
  const { sessionId } = await (await request("/v1/sessions", {})).json();
  const stream = await (
    await request(`/v1/sessions/${sessionId}/runs`, { prompt: "LOT-001" })
  ).text();
  assert.match(stream, /"status":"completed"/);
  assert.match(stream, /inspection/);
  assert.equal(
    (await (await request("/v1/provider")).json()).provider.kind,
    "mock",
  );
  assert.equal((await fetch(base)).status, 200);
  console.log(
    `PASS ${manager} ${version.trim()}: clean tarball install, manager exec/run init, installed CLI startup, sample tool execution, provider settings and UI.`,
  );
} finally {
  if (server?.exitCode === null && server?.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
}
