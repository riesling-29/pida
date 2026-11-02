import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutputCollector } from "../dist/vendor/deepseek-output.js";
import { ProgramOutputStore, utf8Window } from "../dist/program-output.js";

const owner = { principalId: "alice", sessionId: "session", programId: "fixture" };
async function dir(t) { const root = await mkdtemp(join(tmpdir(), "pida-output-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }

// Scenarios adapted from pinned DSH subprocess-local/tests/spawn.spec.ts (see THIRD_PARTY_NOTICES.md).
test("vendored collector keeps the final bytes, spills the complete stream, and seals idempotently", async t => {
  const root = await dir(t), collector = new OutputCollector(8, "stdout", { dir: root, maxBytes: 100, onFailure: () => assert.fail("unexpected spill failure") });
  collector.push(Buffer.from("first-")); collector.push(Buffer.from("last-words"));
  const final = collector.finalize(); assert.equal(final.text, "st-words"); assert.equal(final.truncated, true);
  assert.equal(await readFile(final.spillPath, "utf8"), "first-last-words"); assert.deepEqual(collector.finalize(), final);
  assert.equal(collector.readFrom(0).lossy, true);
});

test("vendored collector discards oversized or unavailable spills and continues collecting", async t => {
  const root = await dir(t), capped = new OutputCollector(8, "stdout", { dir: root, maxBytes: 10, onFailure: () => {} });
  capped.push(Buffer.from("123456789")); capped.push(Buffer.from("0abcdef"));
  assert.deepEqual(capped.finalize(), { text: "90abcdef", truncated: true }); assert.deepEqual(await readdir(root), []);
  let errors = 0;
  const broken = new OutputCollector(8, "stderr", { dir: join(root, "missing"), maxBytes: 100, onFailure: () => errors++ });
  broken.push(Buffer.from("123456789")); broken.push(Buffer.from("abcdefghi"));
  assert.deepEqual(broken.finalize(), { text: "bcdefghi", truncated: true }); assert.equal(errors, 1);
});

test("UTF-8 clipped windows avoid partial characters and page offsets reconstruct exact bytes", async t => {
  const raw = Buffer.from("A가😀B");
  assert.deepEqual(utf8Window(raw.subarray(2, 7), true, true), { text: "", start: 2, end: 2 });
  const root = await dir(t), store = new ProgramOutputStore(root), capture = store.begin(owner);
  const content = "가😀\n".repeat(3000);
  // Deliberately split each code point at arbitrary stream event boundaries.
  for (const byte of Buffer.from(content)) capture.push("stdout", Buffer.from([byte]));
  const preview = capture.finish().stdout;
  assert.equal(preview.lossy, false); assert.ok(!preview.text.includes("�"));
  let offset = 0, readBack = "";
  while (true) { const page = store.read(owner, preview.artifact.id, offset, 7); assert.equal(page.ok, true); readBack += page.text; if (page.eof) break; assert.ok(page.nextOffset > offset); offset = page.nextOffset; }
  assert.equal(readBack, content);
  const aligned = store.read(owner, preview.artifact.id, 1, 7);
  assert.equal(aligned.adjustedOffset, true); assert.equal(aligned.offset, 3); assert.ok(!aligned.text.includes("�"));
});

test("retention evicts old references and active reservations keep disk usage bounded", async t => {
  const root = await dir(t), store = new ProgramOutputStore(root, { maxSpillBytes: 16384, maxTotalBytes: 70000, maxArtifacts: 2 });
  const first = store.begin(owner), noRoom = store.begin(owner);
  first.push("stdout", Buffer.from("a".repeat(10000))); noRoom.push("stdout", Buffer.from("b".repeat(10000)));
  const firstRef = first.finish().stdout.artifact;
  assert.ok(firstRef); assert.equal(noRoom.finish().stdout.lossy, true);
  const next = store.begin(owner); next.push("stdout", Buffer.from("c".repeat(10000)));
  const nextRef = next.finish().stdout.artifact;
  assert.ok(nextRef); assert.equal(store.read(owner, firstRef.id).error, "PROGRAM_OUTPUT_NOT_FOUND");
  assert.equal(store.read(owner, nextRef.id).ok, true);
  assert.equal(store.read({ ...owner, programId: "other" }, nextRef.id).error, "PROGRAM_OUTPUT_NOT_FOUND");
  assert.ok((await readdir(root)).length <= 4);
});

test("escaped control characters are paged within the runtime result limit without skipping bytes", async t => {
  const store = new ProgramOutputStore(await dir(t)), capture = store.begin(owner);
  capture.push("stdout", Buffer.alloc(20000, 0));
  const reference = capture.finish().stdout.artifact;
  let offset = 0, count = 0;
  while (true) {
    const page = store.read(owner, reference.id, offset, 16384);
    assert.equal(page.ok, true); assert.ok(JSON.stringify(page).length <= 26000); count += page.text.length;
    if (page.eof) break; assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  }
  assert.equal(count, 20000);
});

test("store does not create output through a symlinked host directory", async t => {
  const root = await dir(t), outside = join(root, "outside"), link = join(root, "link");
  await mkdir(outside); await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  const capture = new ProgramOutputStore(join(link, "data")).begin(owner);
  capture.push("stdout", Buffer.from("x".repeat(10000)));
  assert.equal(capture.finish().stdout.lossy, true); assert.deepEqual(await readdir(outside), []);
});
