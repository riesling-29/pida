import { PidaClient, PidaClientError, explainError, type RuntimeInfo, type SessionSummary, type TraceEvent } from "./client.js";

export type TuiSession = Awaited<ReturnType<PidaClient["getSession"]>>;
export interface TuiState {
  info?: RuntimeInfo; session?: TuiSession; sessions: SessionSummary[]; trace: TraceEvent[];
  connected: boolean; submitting: boolean; notice: string;
  panel?: { title: string; text: string }; traceGap: boolean;
}
export const terminalCommands = [
  ["sessions", "대화 선택"], ["new", "새 대화"], ["resume", "대화 ID로 열기"],
  ["status", "대상·모델·컨텍스트"], ["activity", "실행 과정"], ["tools", "도구 실행 결과"],
  ["files", "프로젝트 파일 목록"], ["read", "파일 내용"], ["diff", "Git 변경 내역"],
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
  onQuit: () => void = () => {};
  private epoch = 0;
  private selectionRequest = 0;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private streamAbort?: AbortController;
  private streamTask?: Promise<void>;
  private commandBusy = false;
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
    this.state.notice = session.running ? "서버에서 진행 중인 작업에 연결했습니다." : "요청을 입력하세요. /help 명령 · /web 같은 대화 열기";
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
      if (reconnected) this.state.notice = "다시 연결했습니다. 서버의 실제 상태를 표시합니다.";
      this.changed();
    })();
    this.refreshing = task;
    try { await task; } finally { if (this.refreshing === task) this.refreshing = undefined; }
  }
  private selected() {
    if (!this.state.session || !this.state.connected) throw new PidaClientError("CONNECTION_FAILED", 503);
    return this.state.session;
  }
  private async send(prompt: string): Promise<boolean> {
    const session = this.selected();
    if (this.state.submitting || session.running) { this.state.notice = "실행 중입니다. /steer 내용 또는 /followup 내용으로 전달하세요."; this.changed(); return false; }
    const id = session.sessionId, ticket = this.epoch, controller = new AbortController();
    this.streamAbort = controller; this.state.submitting = true;
    this.state.notice = "전송 중 · 서버가 실행을 소유합니다."; this.changed();
    this.streamTask = (async () => {
      try {
        for await (const event of this.client.stream(id, prompt, { signal: controller.signal, disconnectPolicy: "continue" })) {
          if (ticket !== this.epoch || this.closed) break;
          if (event.type === "trace") {
            if (event.trace.type === "run_started") this.state.notice = "접수됨 · /steer 추가 지시 · /stop 중단 · Ctrl+D 분리";
            if (!this.state.trace.some(t => t.sequence === event.trace.sequence)) this.state.trace.push(event.trace);
            this.state.trace = this.state.trace.slice(-300);
          }
          if (event.type === "result") this.state.notice = `${event.result.code ? event.result.code + " · " : ""}실행 근거 /activity · 실제 변경 /diff`;
          this.changed();
        }
      } catch (error) {
        if (!controller.signal.aborted && ticket === this.epoch && !this.closed) {
          this.problem(error);
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
    if (command === "back") { this.state.panel = undefined; this.changed(); return true; }
    if (this.commandBusy && command !== "stop") { this.state.notice = "이전 명령의 응답을 기다리고 있습니다."; this.changed(); return false; }
    if (command !== "stop") this.commandBusy = true;
    try {
      switch (command) {
        case "help": this.state.panel = { title: "명령", text: terminalCommands.map(([name, description]) => `/${name}  ${description}`).join("\n") + "\n\nEnter 보내기 · Shift+Enter/Alt+Enter 줄바꿈\nF2 대화 · F3 실행 · F4 도구 · F6 변경\nCtrl+C 현재 실행 중단(대기 중에는 입력 비우기)\nCtrl+D 분리 · /quit 분리\n패널 스크롤: Alt+PageUp / Alt+PageDown\n//로 시작하면 /문자를 모델에 보냅니다.\n\n분리해도 별도로 실행한 서버와 작업은 계속됩니다." }; break;
        case "sessions": this.state.sessions = (await this.client.listSessions()).sessions; this.onSessions(this.state.sessions); break;
        case "new": await this.select((await this.client.createSession()).sessionId); break;
        case "resume": await this.select(arg); break;
        case "refresh": await this.refresh(); this.state.info = await this.client.getInfo(); break;
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
          this.state.panel = { title: "실행과 검증", text: this.state.trace.slice(-80).map(t => `${t.timestamp.slice(11, 19)} ${t.type} ${t.toolName ?? ""} ${t.code ?? t.status ?? ""}`).join("\n") + "\n\n" + evidence }; break;
        }
        case "tools": { const data = await this.client.getSessionTools(this.selected().sessionId); this.state.panel = { title: "도구 실행 결과", text: data.items.map(t => `${t.toolName} · ${t.status}${t.exitCode === undefined ? "" : " · exit " + t.exitCode}${t.runId ? " · " + t.runId.slice(0, 8) : ""}\n${t.command ?? ""}\n${t.output ?? ""}\n${t.stderr ?? ""}${t.truncated ? "\n[출력 일부]" : ""}`).join("\n\n") || "아직 도구 실행이 없습니다." }; break; }
        case "files": {
          try { const p = await this.client.getProject(arg || "."); this.state.panel = { title: "프로젝트 파일", text: p.files.map(f => `${f.type === "directory" ? "/ " : "  "}${f.path}`).join("\n") + (p.truncated ? "\n[목록 일부]" : "") }; }
          catch (e) { if (!(e instanceof PidaClientError) || e.code !== "PROJECT_DISABLED") throw e; const p = await this.client.getWorkbench(); this.state.panel = { title: "작업 파일", text: p.files.map(f => f.path).join("\n") || "작업 파일이 없습니다." }; } break;
        }
        case "read": {
          if (!arg) throw new PidaClientError("INVALID_PATH", 400);
          let content: string;
          try { content = (await this.client.readProjectFile(arg)).content; } catch (e) { if (!(e instanceof PidaClientError) || e.code !== "PROJECT_DISABLED") throw e; content = (await this.client.readWorkspaceFile(arg)).content; }
          this.state.panel = { title: arg, text: content }; break;
        }
        case "diff": { const p = await this.client.getProjectChanges(); this.state.panel = { title: "Git 변경 · 현재 작업 트리", text: (p.available ? p.diff || "추적 파일 변경 없음" : "Git 비교를 사용할 수 없습니다.") + (p.untracked.length ? "\n\n추적되지 않은 파일:\n" + p.untracked.join("\n") : "") + (p.truncated ? "\n[변경 내역 일부]" : "") }; break; }
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
