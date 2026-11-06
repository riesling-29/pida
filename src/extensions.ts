import { PidaError, type BusinessTool } from "./runtime.js";

export type ExtensionScope = "workspace" | "agent";
export interface ExtensionContext {
  readonly workspaceDir: string;
  readonly agentId?: string;
  readonly signal: AbortSignal;
  /** Register cleanup before acquiring resources that may fail during activation. */
  onDispose(cleanup: () => void | Promise<void>): void;
}
export interface ExtensionActivation {
  readonly tools: readonly BusinessTool<any>[];
  close?(): void | Promise<void>;
}
/** Trusted host registration. A preset or model request cannot install extensions or grant permissions. */
export interface WorkspaceExtension {
  id: string;
  scope: ExtensionScope;
  /** Host-owned code/config revision. Change it when an embedded factory changes. */
  revision?: string;
  activate(context: ExtensionContext): ExtensionActivation | Promise<ExtensionActivation>;
}
export interface ExtensionInventory {
  id: string;
  scope: ExtensionScope;
  revision: string;
  tools: string[];
}

/** An ordered owner of resources, including half-built resources. Every caller joins the same teardown. */
export class ResourceLifetime {
  private readonly cleanups: (() => void | Promise<void>)[] = [];
  private closing?: Promise<void>;
  private stopped = false;
  private detachParent?: () => void;
  readonly controller = new AbortController();
  constructor(parentSignal?: AbortSignal) {
    if (!parentSignal) return;
    const abort = () => this.controller.abort(parentSignal.reason);
    if (parentSignal.aborted) abort();
    else {
      parentSignal.addEventListener("abort", abort, { once: true });
      this.detachParent = () => parentSignal.removeEventListener("abort", abort);
      this.cleanups.push(() => this.releaseParent());
    }
  }
  /** Once activation is published, normal ordered teardown owns its cancellation. */
  releaseParent(): void { this.detachParent?.(); this.detachParent = undefined; }
  add(cleanup: () => void | Promise<void>): void {
    if (this.stopped) throw new PidaError("EXTENSION_CLOSED", 503);
    this.cleanups.push(cleanup);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.controller.abort();
    this.closing = Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      for (const cleanup of this.cleanups.splice(0).reverse()) {
        try { await cleanup(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Resource cleanup failed");
    });
    return this.closing;
  }
  async fail(error: unknown): Promise<never> {
    try { await this.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Activation failed and cleanup reported errors", { cause: error }); }
    throw error;
  }
}

export function assertBusinessTool(tool: unknown): asserts tool is BusinessTool<any> {
  const value = tool as Partial<BusinessTool> | null;
  if (!value || typeof value.name !== "string" || !value.name || typeof value.description !== "string" ||
    !value.parameters || (value.parameters as { type?: unknown }).type !== "object" || typeof value.permission !== "string" ||
    !value.permission || typeof value.execute !== "function")
    throw new Error("A tool module must default-export a BusinessTool with an object input schema.");
}

export function assertExtension(value: WorkspaceExtension): void {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.id) ||
    !["workspace", "agent"].includes(value.scope) || typeof value.activate !== "function" ||
    (value.revision !== undefined && (typeof value.revision !== "string" || value.revision.length > 256)))
    throw new PidaError("EXTENSION_INVALID", 400);
}

export interface ActivatedExtensions {
  tools: BusinessTool<any>[];
  inventory: ExtensionInventory[];
  close(): Promise<void>;
}

/** Activates only host-selected definitions. No discovery/import/install or permission mutation occurs here. */
export async function activateExtensions(
  definitions: readonly WorkspaceExtension[],
  context: { workspaceDir: string; agentId?: string; signal?: AbortSignal },
): Promise<ActivatedExtensions> {
  const tools: BusinessTool<any>[] = [], inventory: ExtensionInventory[] = [];
  const ids = new Set<string>(), names = new Set<string>();
  for (const definition of definitions) {
    assertExtension(definition);
    if (ids.has(definition.id)) throw new PidaError("EXTENSION_DUPLICATE", 400);
    ids.add(definition.id);
  }
  const lifetime = new ResourceLifetime(context.signal);
  try {
    lifetime.controller.signal.throwIfAborted();
    for (const definition of definitions) {
      lifetime.controller.signal.throwIfAborted();
      const child = new ResourceLifetime(lifetime.controller.signal);
      lifetime.add(() => child.close());
      const activation = await definition.activate({ ...context, signal: child.controller.signal, onDispose: cleanup => child.add(cleanup) });
      if (activation?.close) child.add(() => activation.close!());
      child.controller.signal.throwIfAborted();
      if (!activation || !Array.isArray(activation.tools)) throw new PidaError("EXTENSION_INVALID", 400);
      for (const tool of activation.tools) {
        assertBusinessTool(tool);
        if (names.has(tool.name)) throw new PidaError("TOOL_DUPLICATE", 400);
        names.add(tool.name); tools.push(tool);
      }
      inventory.push({ id: definition.id, scope: definition.scope, revision: definition.revision ?? "unversioned", tools: activation.tools.map(t => t.name) });
    }
    lifetime.releaseParent();
    return { tools, inventory, close: () => lifetime.close() };
  } catch (error) { return lifetime.fail(error); }
}
