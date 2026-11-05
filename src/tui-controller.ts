import { PidaClient, PidaClientError, explainError, formatWorkReview, type WorkTarget, type RuntimeInfo, type SessionSummary, type TraceEvent, type ResultManifest } from "./client.js";
import { formatTraceActivityLine } from "./tui-labels.js";
import { formatTuiTimestamp } from "./tui-time.js";

export type TuiSession = Awaited<ReturnType<PidaClient["getSession"]>>;
export interface TuiState {
  info?: RuntimeInfo; session?: TuiSession; sessions: SessionSummary[]; trace: TraceEvent[];
  connected: boolean; submitting: boolean; notice: string;
  panel?: { title: string; text: string }; traceGap: boolean;
  viewedFile?: { resource: "project" | "workbench"; path: string; revision: string; content: string };
  draftBinding?: WorkTarget;
  manifest?: ResultManifest; evidenceState?: "loading" | "available" | "missing" | "error";
  changes?: { files: number; untracked: number; revision: string; observedAt: string; available: boolean; truncated: boolean };
}
export interface TuiFiles { title: string; path: string; files: { path: string; type: "file" | "directory" }[]; truncated: boolean }
export const terminalCommands = [
  ["menu", "기능 메뉴 · 방향키로 선택"], ["overview", "목표·구조·실행·판단 개요"], ["density", "안내 / 간결 표시 전환"],
  ["sessions", "대화 선택"], ["new", "새 대화"], ["resume", "대화 ID로 열기"],
  ["status", "대상·모델·컨텍스트"], ["activity", "실행 과정"], ["tools", "도구 실행 결과"],
  ["ocel", "현재 실행의 OCEL 객체·관계·기록 범위"],
  ["files", "프로젝트 파일 목록"], ["read", "파일 내용"], ["diff", "Git 변경 내역"],
  ["bind", "열어 둔 파일을 요청 대상으로 고정 · /bind 시작행 끝행"], ["unbind", "요청 대상 고정 해제"],
  ["review", "서버에 저장된 실행 대상·변경·검사"], ["requests", "접수 기록 조회 · 재실행 없음"],
  ["steer", "현재 실행에 추가 지시"], ["followup", "현재 실행 뒤의 요청 예약"],
  ["stop", "현재 작업 중단"], ["compact", "대화 압축"], ["handoff", "요약하고 이어가기"],
  ["refresh", "서버 상태 다시 확인"], ["web", "같은 대화를 웹에서 열기"],
  ["back", "상세 패널 닫기"], ["help", "명령과 키 설명"], ["quit", "터미널 분리 · 작업 계속"],
] as const;

/** Presentation controller only. The HTTP host remains the sole runtime/session owner. */
export class TuiController {
  readonly state: TuiState = { sessions: [], trace: [], connected: false, submitting: false, notice: "서버 연결 중", traceGap: false };
  onChange: () => void = () => {};
  onSessions: (sessions: SessionSummary[]) => void = () => {};
  onFiles: (files: TuiFiles) => void = () => {};
  onMenu: () => void = () => {};
  onOverview: () => void = () => {};
  onDensity: () => void = () => {};
  onQuit: () => void = () => {};
  onRestoreDraft: (text: string) => void = () => {};
  private pendingRequest?: { payload: string; id: string };
  private epoch = 0;
  private selectionRequest = 0;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private streamAbort?: AbortController;
  private streamTask?: Promise<void>;
  private commandBusy = false;
  private evidenceKey?: string;
  private evidenceRequest = 0;
  constructor(readonly client: PidaClient, private options: { pollMs?: number; openWeb?: (sessionId: string) => Promise<void> } = {}) {}
  private changed() { if (!this.closed) this.onChange(); }
  private problem(error: unknown) {
    const code = error instanceof PidaClientError ? error.code : "CONNECTION_FAILED";
    this.state.notice = code === "CONNECTION_FAILED" ? "서버 연결을 확인하세요. 요청은 자동 재전송하지 않습니다." : `${code} · ${explainError(code)}`;
    this.changed();
  }
  async start(options: { sessionId?: string; newSession?: boolean } = {}) {
    this.state.info = await this.client.getInfo();
    this.state.sessions = (await this.client.listSessions()).sessions;
    const id = options.sessionId ?? (!options.newSession ? this.state.sessions[0]?.sessionId : undefined) ?? (await this.client.createSession()).sessionId;
    await this.select(id);
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = setTimeout(async () => { try { await this.refresh(); } catch (e) { this.state.connected = false; this.problem(e); } finally { this.schedule(); } }, this.state.connected ? this.options.pollMs ?? 1000 : 2500);
  }
  async select(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new PidaClientError("SESSION_NOT_FOUND", 404);
    // Resolve before leaving the current session; failure must not erase its view.
    const ticket = ++this.selectionRequest;
    const [session, trace] = await Promise.all([this.client.getSession(id), this.client.getTrace(id)]);
    if (this.closed || ticket !== this.selectionRequest) return;
    ++this.epoch;
    this.streamAbort?.abort(); this.streamAbort = undefined;
    this.state.session = session; this.state.trace = trace.events; this.state.traceGap = trace.truncated;
    this.state.submitting = false; this.state.connected = true; this.state.panel = undefined;
    this.state.viewedFile = undefined; this.state.draftBinding = undefined; this.pendingRequest = undefined;
    this.state.manifest = undefined; this.state.evidenceState = undefined; this.state.changes = undefined; this.evidenceKey = undefined;
    this.state.notice = session.running ? "서버에서 진행 중인 작업에 연결했습니다." : "목표와 완료 조건을 입력하세요. F1 메뉴 · F2 대화 선택";
    this.loadEvidence();
    this.changed();
  }
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const id = this.state.session?.sessionId, ticket = this.epoch;
    if (!id || this.closed) return;
    const task = (async () => {
      const [session, trace] = await Promise.all([this.client.getSession(id), this.client.getTrace(id)]);
      if (this.closed || ticket !== this.epoch || this.state.session?.sessionId !== id) return;
      const reconnected = !this.state.connected;
      this.state.session = session; this.state.trace = trace.events; this.state.traceGap = trace.truncated; this.state.connected = true;
      this.loadEvidence();
      if (reconnected) this.state.notice = "다시 연결했습니다. 서버의 실제 상태를 표시합니다.";
      this.changed();
    })();
    this.refreshing = task;
    try { await task; } finally { if (this.refreshing === task) this.refreshing = undefined; }
  }
  /** Optional evidence never blocks execution polling or promotes a model's completion claim. */
  private loadEvidence(force = false) {
    const session = this.state.session, run = this.state.trace.at(-1)?.runId;
    if (!session || session.running || !run) {
      this.state.manifest = undefined; this.state.evidenceState = undefined; this.evidenceKey = undefined; return;
    }
    const key = `${session.sessionId}:${run}`;
    if (!force && this.evidenceKey === key) return;
    this.evidenceKey = key; this.state.manifest = undefined; this.state.evidenceState = "loading";
    const epoch = this.epoch, request = ++this.evidenceRequest;
    const current = () => !this.closed && request === this.evidenceRequest && epoch === this.epoch && key === this.evidenceKey && !this.state.session?.running && this.state.trace.at(-1)?.runId === run;
    void this.client.getManifest(session.sessionId, run).then(manifest => {
      if (!current()) return;
      if (manifest.run_id !== run || manifest.session_id !== session.sessionId) { this.state.evidenceState = "error"; return; }
      this.state.manifest = manifest; this.state.evidenceState = "available";
    }).catch(error => {
      if (current()) this.state.evidenceState = error instanceof PidaClientError && error.status === 404 ? "missing" : "error";
    }).finally(() => { if (current()) this.changed(); });
  }
  private selected() {
    if (!this.state.session || !this.state.connected) throw new PidaClientError("CONNECTION_FAILED", 503);
    return this.state.session;
  }
  private async send(prompt: string): Promise<boolean> {
    const session = this.selected();
    if (this.state.submitting || session.running) { this.state.notice = "실행 중입니다. /steer 내용 또는 /followup 내용으로 전달하세요."; this.changed(); return false; }
    const id = session.sessionId, ticket = this.epoch, controller = new AbortController();
    const targets = this.state.draftBinding ? [structuredClone(this.state.draftBinding)] : undefined;
    const payload = JSON.stringify({ id, prompt, targets });
    if (!this.pendingRequest || this.pendingRequest.payload !== payload) this.pendingRequest = { payload, id: crypto.randomUUID() };
    const requestId = this.state.info?.workSurface ? this.pendingRequest.id : undefined;
    this.streamAbort = controller; this.state.submitting = true;
    this.state.notice = "전송 중 · 서버가 실행을 소유합니다."; this.changed();
    this.streamTask = (async () => {
      try {
        for await (const event of this.client.stream(id, prompt, { signal: controller.signal, disconnectPolicy: "continue", requestId, targets })) {
          if (ticket !== this.epoch || this.closed) break;
          if (event.type === "trace") {
            if (event.trace.type === "run_started") {
              this.state.notice = "접수됨 · F1 추가 지시 / 중단 · Ctrl+D 분리";
              this.state.manifest = undefined; this.state.evidenceState = undefined; this.evidenceKey = undefined;
            }
            if (!this.state.trace.some(t => t.sequence === event.trace.sequence)) this.state.trace.push(event.trace);
            this.state.trace = this.state.trace.slice(-300);
          }
          if (event.type === "result") { this.pendingRequest = undefined; this.state.notice = `${event.result.code ? event.result.code + " · " : ""}실행 근거 /activity · 접수 대상·변경 /review`; }
          this.changed();
        }
      } catch (error) {
        if (!controller.signal.aborted && ticket === this.epoch && !this.closed) {
          this.problem(error);
          this.onRestoreDraft(prompt);
          this.state.panel = { title: "전송·연결 결과 확인 필요", text: "자동 재전송하지 않았습니다. /refresh로 서버 기록을 확인하세요.\n\n보낸 요청:\n" + prompt };
        }
      } finally {
        if (ticket === this.epoch && !this.closed) {
          this.state.submitting = false;
          await this.refresh().catch(error => { this.state.connected = false; this.problem(error); }); this.changed();
        }
      }
    })();
    return true;
  }
  async submit(input: string): Promise<boolean> {
    const text = input.trim(); if (!text || this.closed) return false;
    if (!text.startsWith("/") || text.startsWith("//")) {
      try { return await this.send(text.startsWith("//") ? text.slice(1) : text); } catch (e) { this.problem(e); return false; }
    }
    const split = text.indexOf(" "), command = text.slice(1, split < 0 ? undefined : split), arg = split < 0 ? "" : text.slice(split + 1).trim();
    if (command === "quit") { this.onQuit(); return true; }
    if (command === "menu") { this.onMenu(); return true; }
    if (command === "overview") { this.onOverview(); return true; }
    if (command === "density") { this.onDensity(); return true; }
    if (command === "back") { this.state.panel = undefined; this.changed(); return true; }
    if (this.commandBusy && command !== "stop") { this.state.notice = "이전 명령의 응답을 기다리고 있습니다."; this.changed(); return false; }
    if (command !== "stop") this.commandBusy = true;
    try {
      switch (command) {
        case "help": this.state.panel = { title: "명령", text: terminalCommands.map(([name, description]) => `/${name}  ${description}`).join("\n") + "\n\nEnter 보내기 · Shift+Enter/Alt+Enter 줄바꿈\nF1 메뉴 · F2 대화 · F3 실행 · F4 도구\nF5 파일 · F6 변경 · F7 개요 · F8 안내/간결\nCtrl+C 현재 실행 중단(대기 중에는 입력 비우기)\nCtrl+D 분리 · /quit 분리\n패널 스크롤: Alt+PageUp / Alt+PageDown\n//로 시작하면 /문자를 모델에 보냅니다.\n\n분리해도 별도로 실행한 서버와 작업은 계속됩니다." }; break;
        case "sessions": this.state.sessions = (await this.client.listSessions()).sessions; this.onSessions(this.state.sessions); break;
        case "new": await this.select((await this.client.createSession()).sessionId); break;
        case "resume": await this.select(arg); break;
        case "refresh": await this.refresh(); this.state.info = await this.client.getInfo(); this.loadEvidence(true); break;
        case "web": if (!this.options.openWeb) throw new Error("WEB_UNAVAILABLE"); await this.options.openWeb(this.selected().sessionId); this.state.notice = "같은 대화를 웹에서 열었습니다."; break;
        case "stop": {
          const s = this.selected(), expected = s.activeRunId;
          if (!expected) { this.state.notice = "확인된 실행이 없습니다. /refresh로 상태를 확인하세요."; break; }
          this.state.notice = "중단 요청 중 · 서버 응답 대기"; this.changed();
          await this.client.cancel(s.sessionId, expected); await this.refresh(); this.state.notice = "중단 요청이 처리됐습니다. 실제 종료 상태를 확인하세요."; break;
        }
        case "steer": case "followup": {
          const s = this.selected();
          if (!arg || !s.activeRunId) throw new PidaClientError("RUN_CHANGED", 409);
          await (command === "steer" ? this.client.steer(s.sessionId, arg, s.activeRunId) : this.client.followUp(s.sessionId, arg, s.activeRunId));
          this.state.notice = "요청을 대기열에 전달했습니다. 서버 재시작 시 대기열은 유지되지 않습니다."; break;
        }
        case "compact": case "handoff": {
          const s = this.selected(); if (s.running || this.state.submitting) throw new PidaClientError("SESSION_BUSY", 409);
          this.state.notice = "대화 요약 중"; this.changed();
          await this.client.compactSession(s.sessionId, command === "handoff"); await this.refresh(); this.state.notice = "요약 결과를 불러왔습니다."; break;
        }
        case "status": { const s = this.selected(); this.state.panel = { title: "작업 맥락", text: JSON.stringify({ session: s.sessionId, title: s.title, model: this.state.info?.provider, running: s.running, activeRun: s.activeRunId, context: s.context, autoCompaction: s.autoCompaction, pendingInput: s.pendingInput, tools: s.tools }, null, 2) }; break; }
        case "activity": {
          const s = this.selected(); await this.refresh();
          let evidence = "실행 중이거나 검증 근거가 아직 없습니다.";
          const runId = this.state.trace.at(-1)?.runId;
          if (runId) {
            try { const m = await this.client.getManifest(s.sessionId, runId); evidence = JSON.stringify({ runtime: m.reported_status, verification: m.verification_status, results: m.verification_results, limits: m.known_limits }, null, 2); }
            catch (e) { if (!(e instanceof PidaClientError) || e.status !== 404) throw e; }
          }
          this.state.panel = { title: "실행과 검증 · KST · Esc 닫기", text: this.state.trace.slice(-80).map(t => formatTraceActivityLine(t.timestamp, t, iso => formatTuiTimestamp(iso, "time"))).join("\n") + "\n\n" + evidence }; break;
        }
        case "ocel": {
          const s = this.selected(), runId = s.activeRunId ?? this.state.trace.at(-1)?.runId;
          if (!runId) throw new PidaClientError("RUN_NOT_FOUND", 404);
          const cut = await this.client.exportRunOcel(s.sessionId, runId), d = cut.document;
          if (this.closed || this.state.session?.sessionId !== s.sessionId) break;
          this.state.panel = { title: "OCEL 2.0 · 실행 관측", text: JSON.stringify({ mapping: cut.mapping, runId, complete: cut.complete,
            events: d.events.length, objects: d.objects.length, objectTypes: d.objectTypes.map(t => ({ type: t.name, count: d.objects.filter(o => o.type === t.name).length })),
            e2o: d.events.reduce((n, e) => n + e.relationships.length, 0), o2o: d.objects.reduce((n, o) => n + o.relationships.length, 0),
            digest: cut.digest, knownLimits: cut.knownLimits, verification: "기록 조회 · PIX 검사는 pi_verify_run 도구로 별도 실행" }, null, 2) }; break;
        }
        case "tools": { const data = await this.client.getSessionTools(this.selected().sessionId); this.state.panel = { title: "도구 실행 결과", text: data.items.map(t => `${t.toolName} · ${t.status}${t.exitCode === undefined ? "" : " · exit " + t.exitCode}${t.runId ? " · " + t.runId.slice(0, 8) : ""}\n${t.command ?? ""}\n${t.output ?? ""}\n${t.stderr ?? ""}${t.truncated ? "\n[출력 일부]" : ""}`).join("\n\n") || "아직 도구 실행이 없습니다." }; break; }
        case "files": {
          try { const p = await this.client.getProject(arg || "."); this.onFiles({ title: "프로젝트 파일", path: p.path, files: p.files, truncated: p.truncated }); }
          catch (e) { if (!(e instanceof PidaClientError) || e.code !== "PROJECT_DISABLED") throw e; const p = await this.client.getWorkbench(); this.onFiles({ title: "작업 파일", path: ".", files: p.files.map(f => ({ path: f.path, type: "file" })), truncated: false }); } break;
        }
        case "read": {
          if (!arg) throw new PidaClientError("INVALID_PATH", 400);
          let file, resource: "project" | "workbench" = "project";
          try { file = await this.client.readProjectFile(arg); } catch (e) { if (!(e instanceof PidaClientError) || e.code !== "PROJECT_DISABLED") throw e; resource = "workbench"; file = await this.client.readWorkspaceFile(arg); }
          this.state.viewedFile = { ...file, resource };
          this.state.panel = { title: arg, text: file.content.split("\n").map((line, i) => `${i + 1}  ${line}`).join("\n") };
          this.state.notice = "보기만 변경했습니다. 요청 대상으로 고정: /bind 또는 /bind 시작행 끝행"; break;
        }
        case "bind": {
          const file = this.state.viewedFile;
          if (!file?.revision || !this.state.info?.workSurface) throw new PidaClientError("WORK_SURFACE_UNAVAILABLE", 409);
          const base = { resource: file.resource, path: file.path, contentSha256: file.revision };
          if (arg) {
            const match = /^(\d+)\s+(\d+)$/.exec(arg), startLine = Number(match?.[1]), endLine = Number(match?.[2]);
            if (!match || startLine < 1 || endLine < startLine || endLine > file.content.split("\n").length) throw new PidaClientError("TARGET_RANGE_INVALID", 400);
            this.state.draftBinding = { ...base, kind: "source-range", range: { startLine, endLine } };
          } else this.state.draftBinding = { ...base, kind: "file" };
          this.state.notice = "요청 대상을 고정했습니다. 다른 파일을 열어도 유지됩니다. /unbind 해제"; break;
        }
        case "unbind": this.state.draftBinding = undefined; this.state.notice = "요청 대상 고정을 해제했습니다."; break;
        case "requests": {
          const records = await this.client.listWorkReviews(this.selected().sessionId);
          this.state.panel = { title: "접수 기록 · 조회만 수행", text: records.reviews.map(r => `${r.binding.runId} · ${r.status}\nrequest ${r.requestId}`).join("\n\n") || "접수 기록 없음" }; break;
        }
        case "review": {
          const session = this.selected(), records = await this.client.listWorkReviews(session.sessionId);
          const id = arg || records.reviews.at(-1)?.binding.runId;
          if (!id) throw new PidaClientError("WORK_REVIEW_NOT_FOUND", 404);
          this.state.panel = { title: "공통 작업 기록", text: formatWorkReview(await this.client.getWorkReview(session.sessionId, id)) }; break;
        }
        case "diff": { const p = await this.client.getProjectChanges(); this.state.changes = { files: p.files.length, untracked: p.untracked.length, revision: p.revision, observedAt: new Date().toISOString(), available: p.available, truncated: p.truncated }; this.state.panel = { title: "Git 변경 · 현재 작업 트리", text: (p.available ? p.diff || "추적 파일 변경 없음" : "Git 비교를 사용할 수 없습니다.") + (p.untracked.length ? "\n\n추적되지 않은 파일:\n" + p.untracked.join("\n") : "") + (p.truncated ? "\n[변경 내역 일부]" : "") }; break; }
        default: this.state.notice = "알 수 없는 명령입니다. /help로 확인하세요."; return false;
      }
      this.changed(); return true;
    } catch (e) { this.problem(e); return false; }
    finally { if (command !== "stop") this.commandBusy = false; }
  }
  /** Observation-only detach. Never calls the runtime cancel or creates a replacement run. */
  close() { this.closed = true; ++this.epoch; clearTimeout(this.timer); this.streamAbort?.abort(); }
  async settled() { await this.streamTask; }
}
