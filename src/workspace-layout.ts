/** Client-only view state. References never confer host authority or start work. */
export type PaneView = "chat" | "activity" | "tools" | "files" | "verification";
export interface PaneBinding { agentId?: string; jobId?: string; view: PaneView }
export interface WorkPane { kind: "pane"; id: string; binding: PaneBinding }
export interface WorkSplit { kind: "split"; id: string; axis: "horizontal" | "vertical"; ratio: number; first: WorkNode; second: WorkNode }
export type WorkNode = WorkPane | WorkSplit;
export interface WorkTab { id: string; title: string; root: WorkNode; focus: string; zoom: boolean }
export interface WorkLayout { version: 1; activeTab: string; tabs: WorkTab[] }
export const paneViews: readonly PaneView[] = ["chat", "activity", "tools", "files", "verification"];
const id = () => globalThis.crypto.randomUUID();
const validId = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const title = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 60) || "작업";
export function paneList(node: WorkNode): WorkPane[] { return node.kind === "pane" ? [node] : [...paneList(node.first), ...paneList(node.second)]; }
export function splitList(node: WorkNode): WorkSplit[] { return node.kind === "pane" ? [] : [node, ...splitList(node.first), ...splitList(node.second)]; }
function pane(binding: Partial<PaneBinding> = {}): WorkPane { return { kind: "pane", id: id(), binding: { ...binding, view: binding.view ?? "chat" } }; }
function tab(name: string, binding?: Partial<PaneBinding>): WorkTab { const root = pane(binding); return { id: id(), title: title(name), root, focus: root.id, zoom: false }; }
export function defaultLayout(): WorkLayout { const first = tab("작업 1"); return { version: 1, activeTab: first.id, tabs: [first] }; }

/** Reject malformed trees; rebuild from a whitelist so storage cannot smuggle drafts/credentials. */
export function restoreLayout(value: unknown): WorkLayout {
  try {
    const raw = typeof value === "string" ? value.length <= 64_000 ? JSON.parse(value) : null : value;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.tabs) || !raw.tabs.length || raw.tabs.length > 8) throw Error();
    const seen = new Set<string>();
    const identity = (s: unknown) => { if (!validId(s) || seen.has(s)) throw Error(); seen.add(s); return s; };
    const node = (n: any, depth = 0): WorkNode => {
      if (!n || depth > 3) throw Error();
      const key = identity(n.id);
      if (n.kind === "pane") {
        const b = n.binding;
        if (!b || !paneViews.includes(b.view) || (b.agentId !== undefined && !validId(b.agentId)) || (b.jobId !== undefined && (!validId(b.jobId) || !b.agentId))) throw Error();
        return { kind: "pane", id: key, binding: { view: b.view, ...(b.agentId ? { agentId: b.agentId } : {}), ...(b.jobId ? { jobId: b.jobId } : {}) } };
      }
      if (n.kind !== "split" || !["horizontal", "vertical"].includes(n.axis) || !Number.isFinite(n.ratio) || n.ratio < .2 || n.ratio > .8) throw Error();
      return { kind: "split", id: key, axis: n.axis, ratio: n.ratio, first: node(n.first, depth + 1), second: node(n.second, depth + 1) };
    };
    const tabs: WorkTab[] = raw.tabs.map((t: any) => {
      const key = identity(t.id), root = node(t.root), panes = paneList(root);
      if (panes.length > 4 || !panes.some(p => p.id === t.focus) || typeof t.title !== "string" || typeof t.zoom !== "boolean") throw Error();
      return { id: key, title: title(t.title), root, focus: t.focus, zoom: t.zoom };
    });
    if (!tabs.some(t => t.id === raw.activeTab)) throw Error();
    return { version: 1, activeTab: raw.activeTab, tabs };
  } catch { return defaultLayout(); }
}
function replace(node: WorkNode, key: string, change: (n: WorkNode) => WorkNode): WorkNode {
  if (node.id === key) return change(node);
  if (node.kind === "split") { node.first = replace(node.first, key, change); node.second = replace(node.second, key, change); }
  return node;
}
function remove(node: WorkNode, key: string): WorkNode | undefined {
  if (node.id === key) return;
  if (node.kind === "pane") return node;
  const first = remove(node.first, key), second = remove(node.second, key);
  return first && second ? { ...node, first, second } : first ?? second;
}
export class WorkspaceLayout {
  data: WorkLayout;
  onChange: () => void = () => {};
  constructor(saved?: unknown) { this.data = saved === undefined ? defaultLayout() : restoreLayout(saved); }
  get active(): WorkTab { return this.data.tabs.find(t => t.id === this.data.activeTab)!; }
  get panes(): WorkPane[] { return paneList(this.active.root); }
  allPanes(): WorkPane[] { return this.data.tabs.flatMap(t => paneList(t.root)); }
  find(key: string): WorkPane { const p = this.allPanes().find(p => p.id === key); if (!p) throw Error("PANE_NOT_FOUND"); return p; }
  private owner(key: string) { const t = this.data.tabs.find(t => paneList(t.root).some(p => p.id === key)); if (!t) throw Error("PANE_NOT_FOUND"); return t; }
  serialize(): string { return JSON.stringify(restoreLayout(this.data)); }
  selectTab(key: string) { if (!this.data.tabs.some(t => t.id === key)) throw Error("TAB_NOT_FOUND"); this.data.activeTab = key; this.onChange(); }
  addTab(name = `작업 ${this.data.tabs.length + 1}`, binding?: Partial<PaneBinding>) {
    if (this.data.tabs.length >= 8) throw Error("TAB_LIMIT");
    const next = tab(name, binding); this.data.tabs.push(next); this.data.activeTab = next.id; this.onChange(); return next;
  }
  renameTab(key: string, name: string) { const t = this.data.tabs.find(t => t.id === key); if (!t) throw Error("TAB_NOT_FOUND"); t.title = title(name); this.onChange(); }
  closeTab(key: string) {
    if (!this.data.tabs.some(t => t.id === key)) throw Error("TAB_NOT_FOUND");
    this.data.tabs = this.data.tabs.filter(t => t.id !== key);
    if (!this.data.tabs.length) this.data = defaultLayout();
    else if (this.data.activeTab === key) this.data.activeTab = this.data.tabs[0]!.id;
    this.onChange();
  }
  focus(key: string) { const t = this.owner(key); t.focus = key; this.data.activeTab = t.id; this.onChange(); }
  nextFocus(delta = 1) { const list = this.panes, at = list.findIndex(p => p.id === this.active.focus); this.focus(list[(at + delta + list.length) % list.length]!.id); }
  bind(key: string, binding: PaneBinding) {
    if (!paneViews.includes(binding.view) || (binding.agentId !== undefined && !validId(binding.agentId)) || (binding.jobId !== undefined && (!validId(binding.jobId) || !binding.agentId))) throw Error("PANE_BINDING_INVALID");
    this.find(key).binding = { ...binding }; this.onChange();
  }
  split(key: string, axis: WorkSplit["axis"]) {
    const t = this.owner(key); if (paneList(t.root).length >= 4) throw Error("PANE_LIMIT");
    if (!["horizontal", "vertical"].includes(axis)) throw Error("SPLIT_INVALID");
    const fresh = pane({ ...this.find(key).binding });
    t.root = replace(t.root, key, first => ({ kind: "split", id: id(), axis, ratio: .5, first, second: fresh }));
    t.focus = fresh.id; t.zoom = false; this.onChange(); return fresh;
  }
  closePane(key: string) { const t = this.owner(key); t.root = remove(t.root, key) ?? pane(); if (!paneList(t.root).some(p => p.id === t.focus)) t.focus = paneList(t.root)[0]!.id; this.onChange(); }
  zoom() { this.active.zoom = !this.active.zoom; this.onChange(); }
  resize(key: string, ratio: number) {
    const s = this.data.tabs.flatMap(t => splitList(t.root)).find(s => s.id === key);
    if (!s || !Number.isFinite(ratio)) throw Error("SPLIT_INVALID");
    s.ratio = Math.max(.2, Math.min(.8, ratio)); this.onChange();
  }
  swap(firstId: string, secondId: string) {
    if (firstId === secondId) return;
    const first = this.find(firstId), second = this.find(secondId);
    for (const t of this.data.tabs) {
      const walk = (n: WorkNode): WorkNode => n.id === firstId ? second : n.id === secondId ? first : n.kind === "pane" ? n : { ...n, first: walk(n.first), second: walk(n.second) };
      t.root = walk(t.root);
      if (t.focus === firstId) t.focus = secondId; else if (t.focus === secondId) t.focus = firstId;
    }
    this.onChange();
  }
}

export function fitsLayout(node: WorkNode, width: number, height: number, minWidth = 38, minHeight = 10): boolean {
  if (node.kind === "pane") return width >= minWidth && height >= minHeight;
  const available = (node.axis === "horizontal" ? width : height) - 1, first = Math.floor(available * node.ratio), second = available - first;
  return node.axis === "horizontal"
    ? fitsLayout(node.first, first, height, minWidth, minHeight) && fitsLayout(node.second, second, height, minWidth, minHeight)
    : fitsLayout(node.first, width, first, minWidth, minHeight) && fitsLayout(node.second, width, second, minWidth, minHeight);
}
