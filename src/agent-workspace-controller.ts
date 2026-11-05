import { PidaClientError, type PidaClient, type AgentJob, type AgentOverview, type AgentProfile } from "./client.js";
import { displayStatus, verificationCheckStatusLabel, verificationStatusLabel } from "./tui-labels.js";
import { WorkspaceLayout, type WorkPane, type PaneBinding } from "./workspace-layout.js";

export const admissionLabels: Record<AgentOverview["agents"][number]["admission"], string> = {
  ready: "접수 가능", paused: "대기열 일시정지", recovery_required: "복구 확인 필요", workspace_recovery: "공유 작업공간 복구 대기",
  workspace_busy: "같은 작업공간 사용 중", agent_busy: "이 에이전트 실행 중", capacity: "실행 슬롯 대기", host_stopped: "호스트 정지",
};
export const viewLabels = { chat: "대화", activity: "활동", tools: "도구", files: "파일", verification: "검증" };
/** Human-readable inspection; raw evidence remains available through the existing export API. */
export function detailText(raw: string | undefined, view: PaneBinding["view"]): string | undefined {
  if (!raw) return;
  try {
    const value = JSON.parse(raw);
    if (view === "verification") return [
      `실행 결과: ${value.reported_status ? displayStatus(value.reported_status) : "미확인"}`,
      `독립 검증: ${verificationStatusLabel(value.verification_status)}`,
      `작업: ${value.task_id ?? ""}`, `실행: ${value.run_id ?? ""}`, "",
      "검사 결과 (종료 시점 기준)",
      ...(value.verification_results?.length ? value.verification_results.map((v: any) => `${v.scope} · ${verificationCheckStatusLabel(v.status)} · ${v.current_at_run_end ? "해당 산출물 버전" : "현재 버전과 불일치"}`) : ["기록된 검사 없음"]), "",
      "산출물", ...(value.artifact_refs?.length ? value.artifact_refs.map((a: any) => `${a.path}\n  SHA256 ${a.sha256}`) : ["기록된 산출물 없음"]), "",
      "모델의 완료 선언과 독립 검증은 별개입니다.",
    ].join("\n");
    if (view === "files") {
      if (typeof value.content === "string") return `${value.path}\n\n${value.content}`;
      if (Array.isArray(value.files)) return value.files.map((f: any) => `${f.path}${f.bytes === undefined ? "" : ` · ${f.bytes} bytes`}`).join("\n") || "기록된 파일 없음";
    }
    if (view === "tools" && Array.isArray(value.items)) return value.items.map((t: any) => [
      `${t.toolName} · ${t.status}`, ...(t.command ? [t.command] : []), ...(t.exitCode === undefined ? [] : [`종료 코드: ${t.exitCode}`]),
      ...(t.output ? [t.output] : []), ...(t.stderr ? [t.stderr] : []), ...(t.truncated ? ["[출력 일부]"] : []),
    ].join("\n")).join("\n\n") || "보존된 도구 결과 없음";
  } catch { /* Fall back to explicit recorded text. */ }
  return raw;
}
type Pending = { requestId: string; text: string; agentId: string; uncertain: boolean };
export interface WorkspaceControllerOptions {
  loadLayout?(scope: string): unknown | Promise<unknown>;
  saveLayout?(scope: string, json: string): void | Promise<void>;
  pollMs?: number;
}
/** Shared Web/TUI observer. All mutations stay on existing owner-authorized host routes. */
export class AgentWorkspaceController {
  layout = new WorkspaceLayout();
  overview?: AgentOverview;
  error = "";
  storageError = "";
  onChange: () => void = () => {};
  readonly jobs = new Map<string, AgentJob>();
  private drafts = new Map<string, string>();
  private pending = new Map<string, Pending>();
  private busy = new Set<string>();
  private messages = new Map<string, string>();
  private details = new Map<string, string>();
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private polling?: Promise<void>;
  private closed = true;
  constructor(readonly client: PidaClient, private options: WorkspaceControllerOptions = {}) {}
  private emit() { if (!this.closed) this.onChange(); }
  private key(paneId: string) { return `${paneId}:${this.layout.find(paneId).binding.agentId ?? ""}`; }
  private target(paneId: string) { const p = this.layout.find(paneId); return `${p.id}:${p.binding.agentId ?? ""}:${this.job(paneId)?.id ?? ""}:${p.binding.view}`; }
  entry(paneId: string) { const id = this.layout.find(paneId).binding.agentId; return this.overview?.agents.find(a => a.profile.id === id); }
  job(paneId: string): AgentJob | undefined {
    const p = this.layout.find(paneId), entry = this.entry(paneId);
    const jobId = p.binding.jobId ?? entry?.jobs.at(-1)?.id;
    return jobId ? this.jobs.get(`${p.binding.agentId}:${jobId}`) : undefined;
  }
  draft(paneId: string) { return this.drafts.get(this.key(paneId)) ?? ""; }
  setDraft(paneId: string, value: string) { this.drafts.set(this.key(paneId), value.slice(0, 12000)); }
  message(paneId: string) { return this.messages.get(this.key(paneId)) ?? ""; }
  detail(paneId: string) { return this.details.get(this.target(paneId)); }
  isBusy(paneId: string) { return this.busy.has(this.key(paneId)); }
  isUncertain(paneId: string) { return !!this.pending.get(this.key(paneId))?.uncertain; }
  bind(paneId: string, binding: PaneBinding) { this.layout.bind(paneId, binding); void this.refresh(); }
  async start() {
    this.closed = false; const generation = ++this.generation;
    const overview = await this.client.getAgentOverview();
    if (this.closed || generation !== this.generation) return;
    let saved: unknown;
    try { saved = await this.options.loadLayout?.(overview.scopeId); } catch { this.storageError = "배치를 읽지 못했습니다."; }
    if (this.closed || generation !== this.generation) return;
    this.overview = overview; this.layout = new WorkspaceLayout(saved);
    this.layout.onChange = () => {
      const scope = this.overview?.scopeId;
      if (scope) Promise.resolve().then(() => this.options.saveLayout?.(scope, this.layout.serialize())).catch(() => { this.storageError = "배치를 저장하지 못했습니다."; this.emit(); });
      this.emit();
    };
    await this.refresh(); this.schedule();
  }
  private schedule() {
    if (this.closed || this.options.pollMs === 0) return;
    this.timer = setTimeout(() => { void this.refresh().finally(() => this.schedule()); }, this.options.pollMs ?? 1000);
  }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.polling) return this.polling;
    const generation = this.generation;
    const valid = () => !this.closed && generation === this.generation;
    this.polling = (async () => {
      try {
        const overview = await this.client.getAgentOverview();
        if (!valid()) return;
        if (this.overview && overview.scopeId !== this.overview.scopeId) { this.close(); throw Error("WORKSPACE_IDENTITY_CHANGED"); }
        this.overview = overview;
        const targets = new Map<string, { agentId: string; jobId: string }>();
        for (const p of this.layout.panes) {
          const entry = overview.agents.find(a => a.profile.id === p.binding.agentId);
          const jobId = p.binding.jobId ?? entry?.jobs.at(-1)?.id;
          if (entry && jobId) targets.set(`${entry.profile.id}:${jobId}`, { agentId: entry.profile.id, jobId });
        }
        const values = await Promise.allSettled([...targets].map(async ([key, t]) => [key, await this.client.getAgentJob(t.agentId, t.jobId)] as const));
        if (!valid()) return;
        const next = new Map<string, AgentJob>();
        values.forEach((r, i) => {
          const key = [...targets.keys()][i]!;
          if (r.status === "fulfilled") next.set(r.value[0], r.value[1]);
          else this.error = r.reason instanceof PidaClientError ? r.reason.code : "작업을 새로 읽지 못했습니다.";
          if (r.status === "rejected") this.jobs.delete(key);
        });
        this.jobs.clear(); for (const [key, value] of next) this.jobs.set(key, value);
        if (values.every(r => r.status === "fulfilled")) this.error = "";
      } catch (e) { if (valid()) this.error = e instanceof Error ? e.message : "연결 실패"; }
      finally { this.emit(); }
    })().finally(() => { this.polling = undefined; });
    return this.polling;
  }
  private async afterMutation() { await this.polling; await this.refresh(); }
  private same(paneId: string, key: string) { try { return !this.closed && this.key(paneId) === key; } catch { return false; } }
  private async action(paneId: string, fn: (key: string) => Promise<void>) {
    const key = this.key(paneId), generation = this.generation;
    if (this.closed || this.busy.has(key)) return;
    this.busy.add(key); this.messages.delete(key); this.emit();
    try { await fn(key); }
    catch (e) { if (!this.closed && generation === this.generation) this.messages.set(key, e instanceof Error ? e.message : "요청 실패"); }
    finally { this.busy.delete(key); if (!this.closed && generation === this.generation) { await this.afterMutation(); this.emit(); } }
  }
  async submit(paneId: string, retry = false) {
    const agentId = this.layout.find(paneId).binding.agentId, text = this.draft(paneId).trim();
    if (!agentId || !text) return;
    await this.action(paneId, async key => {
      let request = this.pending.get(key);
      if (request && (!retry || request.text !== text || request.agentId !== agentId)) throw Error("접수 여부를 먼저 확인하세요. 미확인 요청을 자동 재전송하지 않습니다.");
      request ??= { requestId: crypto.randomUUID(), text, agentId, uncertain: false };
      this.pending.set(key, request);
      try {
        const job = await this.client.enqueueAgentJob(agentId, { input: request.text, requestId: request.requestId });
        if (this.closed) return;
        this.pending.delete(key); this.messages.set(key, `접수됨 · ${job.id.slice(0, 8)}`);
        if ((this.drafts.get(key) ?? "").trim() === text) this.drafts.delete(key);
        if (this.same(paneId, key)) this.layout.bind(paneId, { ...this.layout.find(paneId).binding, jobId: job.id });
      } catch (e) {
        // A transport/5xx failure can occur after enqueue. Preserve the exact request id in RAM.
        if (e instanceof PidaClientError && e.status >= 400 && e.status < 500) this.pending.delete(key);
        else request.uncertain = true;
        throw e;
      }
    });
  }
  async checkDelivery(paneId: string) {
    await this.action(paneId, async key => {
      const request = this.pending.get(key); if (!request) return;
      const { jobs } = await this.client.listAgentJobs(request.agentId);
      if (this.closed) return;
      const job = jobs.find(j => j.requestId === request.requestId);
      if (!job) { this.messages.set(key, "아직 접수 기록 없음 · 필요하면 같은 요청 재전송을 선택하세요."); return; }
      this.pending.delete(key); this.messages.set(key, `접수 확인 · ${job.id.slice(0, 8)}`);
      if ((this.drafts.get(key) ?? "").trim() === request.text) this.drafts.delete(key);
      if (this.same(paneId, key)) this.layout.bind(paneId, { ...this.layout.find(paneId).binding, jobId: job.id });
    });
  }
  async cancel(paneId: string) {
    const job = this.job(paneId); if (!job) return;
    await this.action(paneId, async () => { await this.client.cancelAgentJob(job.agentId, job.id); });
  }
  async steer(paneId: string) {
    const job = this.job(paneId), text = this.draft(paneId).trim();
    if (!job?.runId || job.status !== "running" || !text) return;
    await this.action(paneId, async key => {
      try { await this.client.steerAgentJob(job.agentId, job.id, text, job.runId!); }
      catch (e) { throw Error(`${e instanceof Error ? e.message : "전달 실패"} · 추가 지시의 접수 여부를 확인하고 재입력하세요.`); }
      if ((this.drafts.get(key) ?? "").trim() === text) this.drafts.delete(key);
      this.messages.set(key, `추가 지시 접수 · ${job.runId!.slice(0, 8)}`);
    });
  }
  async pause(paneId: string, paused: boolean) {
    const agentId = this.layout.find(paneId).binding.agentId; if (!agentId) return;
    await this.action(paneId, async () => { await (paused ? this.client.pauseAgent(agentId) : this.client.resumeAgent(agentId)); });
  }
  async create(input: Parameters<PidaClient["createAgent"]>[0]): Promise<AgentProfile> {
    const profile = await this.client.createAgent(input); await this.afterMutation(); return profile;
  }
  async inspect(paneId: string, filePath?: string): Promise<void> {
    const pane = this.layout.find(paneId), agentId = pane.binding.agentId, job = this.job(paneId);
    if (!agentId) return;
    const target = this.target(paneId), generation = this.generation;
    await this.action(paneId, async () => {
      let result: unknown;
      if (filePath !== undefined) result = await this.client.readAgentFile(agentId, filePath);
      else if (pane.binding.view === "files") result = await this.client.getAgentWorkbench(agentId);
      else if (pane.binding.view === "tools" && job) result = await this.client.getAgentJobTools(agentId, job.id);
      else if (pane.binding.view === "verification" && job) result = (await this.client.exportAgentJob(agentId, job.id)).manifest;
      else return;
      if (!this.closed && generation === this.generation) this.details.set(target, JSON.stringify(result, null, 2));
    });
  }
  close() {
    this.closed = true; ++this.generation; clearTimeout(this.timer);
    this.drafts.clear(); this.pending.clear(); this.messages.clear(); this.details.clear(); this.jobs.clear(); this.busy.clear();
    // No host cancellation or replay. The host owns execution independently of this view.
  }
}
