import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const httpSource = readFileSync(join(root, "src", "http.ts"), "utf8");

function serveDemoAllowlist() {
  const line = httpSource.split("\n").find(l => l.includes("agent-workspace-controller.js") && l.includes(".includes(path)"));
  assert.ok(line, "serveDemo static allowlist line not found in src/http.ts");
  return [...line.matchAll(/"(\/[^"]+)"/g)].map(m => m[1]);
}

function distPathForUrl(urlPath) {
  const base = urlPath === "/pida-client.js" ? "client.js" : urlPath.slice(1);
  return join(dist, base);
}

function parseImports(source) {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(m => m[1]);
}

function resolveImport(importerUrl, spec) {
  if (spec.startsWith("/")) return spec;
  if (!spec.startsWith("./")) return null;
  const dir = importerUrl.slice(0, importerUrl.lastIndexOf("/") + 1);
  const parts = (dir + spec.slice(2)).split("/").filter(p => p && p !== ".");
  const out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  return "/" + out.join("/");
}

test("serveDemo repo modules only import other allowlisted static paths", () => {
  const allow = new Set(serveDemoAllowlist());
  assert.ok(allow.has("/agent-workspace-controller.js"));
  const violations = [];
  const seen = new Set();
  const queue = ["/agent-workspace-controller.js"];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!allow.has(url)) {
      violations.push(url);
      continue;
    }
    const file = distPathForUrl(url);
    if (!existsSync(file)) continue;
    for (const spec of parseImports(readFileSync(file, "utf8"))) {
      const target = resolveImport(url, spec);
      if (!target?.endsWith(".js")) continue;
      if (!allow.has(target)) violations.push(`${url} -> ${target}`);
      if (existsSync(distPathForUrl(target))) queue.push(target);
    }
  }
  assert.deepEqual(violations, [], violations.join("; "));
});
