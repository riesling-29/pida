import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink, link } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ProjectView } from "../dist/project-view.js";

const owner = { id: "owner", permissions: ["project:read"] };
async function fixture(t, git = false) {
  const parent = await mkdtemp(join(tmpdir(), "pida-project-view-test-")), root = join(parent, "repo"), privateRoot = join(root, "agent");
  await mkdir(privateRoot, { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  const run = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" } });
  if (git) { run("init", "-q"); run("config", "user.email", "fixture@example.invalid"); run("config", "user.name", "Fixture"); }
  const view = new ProjectView({ enabled: true, root, trustedHost: false }, { protectedPaths: [privateRoot] });
  return { parent, root, privateRoot, view, git: run };
}
const code = expected => error => error.code === expected;

test("project view authorizes every read and excludes private, linked and out-of-root paths", async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, "src")); await writeFile(join(f.root, "src", "a.js"), "export const value = 1;\n");
  await writeFile(join(f.root, ".env.local"), "secret"); await writeFile(join(f.privateRoot, "credential.json"), "private");
  await writeFile(join(f.parent, "outside.txt"), "outside");
  await symlink(join(f.parent, "outside.txt"), join(f.root, "linked.txt"));
  await link(join(f.parent, "outside.txt"), join(f.root, "hard.txt"));
  for (const path of ["../outside.txt", ".env.local", ".ENV.local", ".git/config", ".pida/state", "agent/credential.json", "linked.txt", "hard.txt"]) {
    await assert.rejects(f.view.read(owner, path), code("PROJECT_PATH_DENIED"), path);
  }
  const listed = await f.view.list(owner);
  assert.deepEqual(listed.files.map(entry => entry.path), ["src"]);
  assert.equal((await f.view.list(owner, "src")).files[0].path, "src/a.js");
  const first = await f.view.read(owner, "src/a.js"); assert.equal(first.content, "export const value = 1;\n");
  await writeFile(join(f.root, "src", "a.js"), "export const value = 2;\n");
  assert.notEqual((await f.view.read(owner, "src/a.js")).revision, first.revision);
  const forbidden = { id: "other", permissions: [] };
  for (const call of [() => f.view.list(forbidden), () => f.view.read(forbidden, "src/a.js"), () => f.view.changes(forbidden)]) await assert.rejects(call(), code("FORBIDDEN"));
  assert.equal((await f.view.changes(owner)).available, false);
});

test("project reads have explicit text and size limits", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "large.txt"), "x".repeat(262145));
  await writeFile(join(f.root, "binary.dat"), Buffer.from([0, 1, 2]));
  await assert.rejects(f.view.read(owner, "large.txt"), code("PROJECT_FILE_UNSAFE_OR_TOO_LARGE"));
  await assert.rejects(f.view.read(owner, "binary.dat"), code("PROJECT_BINARY_UNSUPPORTED"));
  await assert.rejects(f.view.read(owner, "missing.txt"), code("PROJECT_FILE_NOT_FOUND"));
});

test("changes includes staged and working patches, untracked names, and excludes private content before diff", async t => {
  const f = await fixture(t, true);
  await writeFile(join(f.root, "a.txt"), "initial\n"); await writeFile(join(f.root, ".env"), "SECRET_BEFORE\n");
  await writeFile(join(f.privateRoot, "credential.txt"), "PRIVATE_BEFORE\n");
  f.git("add", "a.txt", ".env", "agent/credential.txt"); f.git("commit", "-qm", "fixture");
  await writeFile(join(f.root, "a.txt"), "staged\n"); f.git("add", "a.txt");
  await writeFile(join(f.root, "a.txt"), "working\n"); await writeFile(join(f.root, "new.txt"), "untracked\n");
  await writeFile(join(f.root, ".env"), "SECRET_AFTER\n"); await writeFile(join(f.privateRoot, "credential.txt"), "PRIVATE_AFTER\n");
  const beforeIndex = await readFile(join(f.root, ".git", "index"));
  const result = await f.view.changes(owner);
  assert.equal(result.available, true); assert.deepEqual(result.files, ["a.txt", "new.txt"]); assert.deepEqual(result.untracked, ["new.txt"]);
  assert.match(result.diff, /Staged changes/); assert.match(result.diff, /Working tree changes/);
  assert.match(result.diff, /-initial\n\+staged/); assert.match(result.diff, /-staged\n\+working/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|PRIVATE_|credential|\.env/);
  assert.equal(result.truncated, false); assert.equal(result.revision, (await f.view.changes(owner)).revision);
  assert.deepEqual(await readFile(join(f.root, ".git", "index")), beforeIndex);
  await writeFile(join(f.root, "a.txt"), "next-working\n"); assert.notEqual((await f.view.changes(owner)).revision, result.revision);
});

test("Git view preserves racy-index detection when a same-size edit is copied later", async t => {
  const f = await fixture(t, true), path = join(f.root, "a.js"), index = join(f.root, ".git", "index");
  const original = "export const value = 1;\n", changed = "export const value = 2;\n";
  await writeFile(path, original); f.git("add", "a.js"); f.git("commit", "-qm", "fixture");
  let sameSecond = false;
  // Establish the stat-cache collision even if one attempt crosses a clock second.
  for (let attempt = 0; attempt < 5 && !sameSecond; attempt++) {
    await writeFile(path, original); f.git("add", "a.js");
    const before = await stat(path);
    await writeFile(path, changed);
    const after = await stat(path);
    sameSecond = Math.floor(before.mtimeMs / 1000) === Math.floor(after.mtimeMs / 1000)
      && Math.floor(before.ctimeMs / 1000) === Math.floor(after.ctimeMs / 1000);
  }
  assert.equal(sameSecond, true, "fixture must edit within the cached stat's second");
  const beforeIndex = await readFile(index), beforeTime = (await stat(index)).mtimeMs;
  // Copying the index now must retain its old timestamp rather than disarming
  // Git's same-second content check with the temporary file's newer timestamp.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const result = await f.view.changes(owner);
  assert.match(result.diff, /-export const value = 1;\n\+export const value = 2;/);
  assert.deepEqual(result.files, ["a.js"]);
  assert.deepEqual(await readFile(index), beforeIndex);
  assert.equal((await stat(index)).mtimeMs, beforeTime);
  assert.equal(await readFile(path, "utf8"), changed);
});

test("Git view never executes configured filters, textconv, external diff or fsmonitor", async t => {
  const f = await fixture(t, true);
  await writeFile(join(f.root, "a.txt"), "initial\n"); f.git("add", "a.txt"); f.git("commit", "-qm", "fixture");
  await writeFile(join(f.root, ".gitattributes"), "*.txt filter=hostile diff=hostile\n");
  await writeFile(join(f.root, "a.txt"), "changed\n");
  const canary = join(f.parent, "executed-canary");
  const command = `"${process.execPath}" -e "require('fs').writeFileSync('${canary.replaceAll("\\", "/")}', 'BAD')"`;
  f.git("config", "filter.hostile.clean", command); f.git("config", "filter.hostile.process", command);
  f.git("config", "diff.hostile.textconv", command); f.git("config", "diff.external", command); f.git("config", "core.fsmonitor", command);
  const result = await f.view.changes(owner);
  assert.match(result.diff, /\+changed/); assert.equal(existsSync(canary), false);
});

test("unborn repository and deleted files are supported with bounded diff output", async t => {
  const f = await fixture(t, true);
  await writeFile(join(f.root, "initial.txt"), "first\n"); f.git("add", "initial.txt");
  const unborn = await f.view.changes(owner); assert.match(unborn.diff, /\+first/);
  f.git("commit", "-qm", "fixture"); await rm(join(f.root, "initial.txt"));
  await writeFile(join(f.root, "large.txt"), Array.from({ length: 30000 }, (_, i) => `line-${i}`).join("\n")); f.git("add", "large.txt");
  const changed = await f.view.changes(owner);
  assert.ok(changed.files.includes("initial.txt")); assert.ok(changed.files.includes("large.txt"));
  assert.equal(changed.truncated, true); assert.ok(Buffer.byteLength(changed.diff) <= 262144);
});
