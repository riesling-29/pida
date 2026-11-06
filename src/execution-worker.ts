import { parentPort, workerData } from "node:worker_threads";
import { getQuickJS } from "quickjs-emscripten";

// Guest code only runs inside WASM. No Node object, environment, module loader or network is bridged.
const { source, files, input, readOnly, timeoutMs } = workerData as {
  source: string; files: Record<string, string>; input: unknown; readOnly: boolean; timeoutMs: number;
};
const writes: Record<string, string> = Object.create(null);
const logs: string[] = [];
let assertions = 0, logSize = 0;
const module = await getQuickJS();
const runtime = module.newRuntime();
runtime.setMemoryLimit(32 * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
const deadline = Date.now() + timeoutMs;
runtime.setInterruptHandler(() => Date.now() > deadline);
const vm = runtime.newContext();
function valid(path: string) {
  if (path.length > 240 || !/^[A-Za-z0-9_-][A-Za-z0-9_./ -]*$/.test(path) || path.split("/").some(p => !p || p.startsWith(".")))
    throw new Error("INVALID_PATH");
  return path;
}
function bind(name: string, fn: (...args: any[]) => any) {
  const handle = vm.newFunction(name, fn);
  vm.setProp(vm.global, name, handle);
  handle.dispose();
}
try {
  bind("__read", (p) => {
    const path = valid(vm.getString(p));
    const value = Object.hasOwn(writes, path) ? writes[path] : Object.hasOwn(files, path) ? files[path] : undefined;
    if (value === undefined) throw new Error("FILE_NOT_FOUND");
    return vm.newString(value);
  });
  bind("__write", (p, value) => {
    if (readOnly) throw new Error("TEST_IS_READ_ONLY");
    const path = valid(vm.getString(p)), text = vm.getString(value);
    if (Buffer.byteLength(text) > 131072) throw new Error("FILE_TOO_LARGE");
    if (!Object.hasOwn(writes, path) && Object.keys(writes).length >= 64) throw new Error("FILE_LIMIT");
    writes[path] = text;
  });
  bind("__log", (value) => {
    const text = vm.getString(value);
    logSize += text.length;
    if (logSize > 12000) throw new Error("OUTPUT_LIMIT");
    logs.push(text);
  });
  bind("__assert", (condition, message) => {
    if (!vm.dump(condition)) throw new Error("ASSERTION_FAILED: " + vm.getString(message).slice(0, 300));
    assertions++;
  });
  const bootstrap = vm.evalCode(`
    globalThis.pida = Object.freeze({
      readText: __read, writeText: __write,
      listFiles: () => ${JSON.stringify(Object.keys(files))},
      input: ${JSON.stringify(input ?? null)}
    });
    globalThis.console = Object.freeze({log: (...xs) => __log(xs.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))});
    globalThis.assert = (condition, message = 'assertion') => __assert(!!condition, String(message));
  `);
  if (bootstrap.error) throw new Error("BOOTSTRAP_FAILED");
  bootstrap.value.dispose();
  const result = vm.evalCode(source, "workspace.js");
  if (result.error) {
    const error = vm.dump(result.error);
    result.error.dispose();
    parentPort!.postMessage({ ok: false, output: logs.join("\n"), assertions, error: String(error?.message ?? error).slice(0, 1000), writes: {} });
  } else {
    // Async jobs are not implicitly treated as successfully tested scripts.
    const state = vm.getPromiseState(result.value);
    const asyncValue = state.type !== "fulfilled" || !state.notAPromise;
    if (state.type === "fulfilled" && !state.notAPromise) state.value.dispose();
    if (state.type === "rejected") state.error.dispose();
    result.value.dispose();
    const pending = runtime.hasPendingJob();
    parentPort!.postMessage({ ok: !pending && !asyncValue, output: logs.join("\n"), assertions,
      ...(pending || asyncValue ? { error: "ASYNC_NOT_SUPPORTED" } : {}), writes: pending || asyncValue ? {} : writes });
  }
} catch {
  parentPort!.postMessage({ ok: false, output: logs.join("\n"), assertions, error: "EXECUTION_FAILED", writes: {} });
} finally {
  vm.dispose();
  runtime.dispose();
}
