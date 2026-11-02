import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { unlockStore } from "./storage.js";

const agentId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function directory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe workspace state directory; symbolic links are not unlocked.");
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
/** Preflight all owners before mutating any lock. A PID lookup failure is never permission to remove it. */
function verifyDeadOwner(path: string): boolean {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096)
    throw new Error("Unsafe workspace lock; inspect it manually.");
  let owner;
  try { owner = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Cannot verify lock owner; inspect the lock manually."); }
  if (!owner || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new Error("Cannot verify lock owner; inspect the lock manually.");
  try { process.kill(owner.pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw new Error("Cannot verify lock owner.");
  }
  throw new Error("Workspace process is still running.");
}

/** Explicit host CLI recovery. Only root and UUID-named agent runtime locks are eligible. */
export function unlockWorkspaceState(stateDirectory: string): { runtimeLocks: number } {
  const root = resolve(stateDirectory);
  if (!directory(root)) return { runtimeLocks: 0 };
  const stores = [root], service = join(root, "agents-service");
  if (directory(service)) {
    // A live supervisor can own the workspace even when no individual session has been opened yet.
    verifyDeadOwner(join(service, "supervisor.lock"));
    const agents = join(service, "agents");
    if (directory(agents)) for (const name of readdirSync(agents).filter(name => agentId.test(name))) {
      const agent = join(agents, name);
      directory(agent);
      const runtime = join(agent, "runtime");
      if (directory(runtime)) stores.push(runtime);
    }
  }
  const eligible = stores.filter(store => verifyDeadOwner(join(store, "runtime.lock")));
  // Recheck each runtime's owner through the existing same-host/no-force recovery implementation.
  let runtimeLocks = 0;
  for (const store of eligible) {
    const path = join(store, "runtime.lock");
    if (!existsSync(path)) continue;
    verifyDeadOwner(path);
    unlockStore(store); runtimeLocks++;
  }
  // Memory transaction locks have no verifiable owner metadata. Never remove those here.
  return { runtimeLocks };
}
