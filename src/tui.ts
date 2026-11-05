import {
  Box, Editor, HStack, MouseRegion, ProcessTerminal, ScrollView, SelectList, Text, TuiAltScreen, VStack,
  isKeyRelease, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth,
  type AutocompleteProvider, type OverlayHandle, type Terminal, type SelectItem, type TerminalColorMode,
} from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { PidaClient, sessionDisplayMessages } from "./client.js";
import { TuiController, terminalCommands, type TuiState } from "./tui-controller.js";
import { terminalPalette } from "./tui-theme.js";
import { formatTuiTimestamp } from "./tui-time.js";
import { displayTraceEvent, sessionStatusDisplayNames, verificationCheckStatusLabel, verificationStatusLabel } from "./tui-labels.js";
import { chooseNavBarStage, renderNavBar } from "./tui-nav-bar.js";

/** Host/model/file content must never introduce terminal controls (OSC clipboard/title etc.). */
export function terminalText(value: unknown, limit = 48_000): string {
  const text = stripTerminalSequences(String(value ?? "")).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\r/g, "");
  return text.length <= limit ? text : text.slice(0, limit) + "\n[표시 한도 · 원문은 Web UI에서 확인]";
}
const statusNames = sessionStatusDisplayNames;
const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const singleLine = (value: unknown, limit = 120) => terminalText(value, limit).replace(/\s+/g, " ").trim();
/** Fixed-height signals must clip at the current render width, including between polls on resize. */
class SignalLines {
  private text = "";
  constructor(private paint: (s: string, width: number) => string = s => s) {}
  setText(text: string) { this.text = text; }
  invalidate() {}
  render(width: number) { return this.text.split("\n").map(text => this.paint(" ".slice(0, width) + truncateToWidth(text, Math.max(0, width - 2)), width)); }
}

/** Only observed facts. No invented plan, inferred completion criteria or progress percentage. */
export function workSignals(state: TuiState, now = Date.now()) {
  const s = state.session, run = s?.activeRunId ?? state.trace.at(-1)?.runId;
  const events = state.trace.filter(t => t.runId === run), last = events.at(-1);
  const began = events.find(t => t.type === "run_started"), ended = [...events].reverse().find(t => t.type === "run_finished");
  const observedEnd = ended ? Date.parse(ended.timestamp) : s?.running ? state.connected ? now : Date.parse(last?.timestamp ?? "") : undefined;
  const elapsed = began && observedEnd !== undefined ? Math.max(0, Math.floor((observedEnd - Date.parse(began.timestamp)) / 1000)) : undefined;
  const phase = s?.running ? `${displayTraceEvent(last?.type ?? "") || "실행 중"}${last?.toolName ? " · " + singleLine(last.toolName, 60) : ""}` : state.submitting ? "전송·응답 대기" : statusNames[s?.lastStatus ?? ""] ?? "준비됨";
  const manifest = !s?.running && !state.submitting && state.manifest && state.manifest.run_id === run && state.manifest.session_id === s?.sessionId ? state.manifest : undefined;
  const checks = manifest?.verification_results ?? [];
  const verification = manifest ? verificationStatusLabel(manifest.verification_status) : state.evidenceState === "error" ? "검증 근거 조회 실패" : state.evidenceState === "loading" ? "검증 근거 조회 중" : "독립 검증 미확인 · UNKNOWN";
  return {
    run, events, last, elapsed: Number.isFinite(elapsed) ? elapsed : undefined, phase, manifest, checks, verification,
    goal: s ? [...s.messages].reverse().find(m => m.role === "user")?.text : undefined,
    complete: events.filter(t => t.type === "tool_completed").length,
    failed: events.filter(t => t.type === "tool_failed").length,
  };
}

/** Stable dense surface; Pi owns layout, Unicode cells, editor, paste, scroll and terminal lifecycle. */
export function createTuiView(controller: TuiController, options: { terminal?: Terminal; workspace: string; target?: string; color?: boolean; colorMode?: TerminalColorMode }) {
  const terminal = options.terminal ?? new ProcessTerminal();
  const colors = terminalPalette(options.color ?? !process.env.NO_COLOR, options.colorMode);
  // Use Pi's protected final-line styling hook; layout, cursor, overlays, selection,
  // input and differential painting remain owned by the pinned upstream renderer.
  const tui: TuiAltScreen = new (class extends TuiAltScreen {
    protected override applyLineResets(lines: string[]) {
      return super.applyLineResets(lines.map(line => colors.frameLine(line, this.terminal.columns)));
    }
  })(terminal, true, undefined, { copyOnSelect: false, openUrl: () => {}, mouse: true });
  const theme = { selectedPrefix: colors.accent, selectedText: colors.selected, description: colors.dim, scrollInfo: colors.dim, noMatch: colors.dim };
  const header = new SignalLines(colors.band), context = new SignalLines(), status = new SignalLines(colors.band), footer = new SignalLines();
  const conversationTitle = new SignalLines(colors.band), detailTitle = new SignalLines(colors.band), compact = new SignalLines(), inputTitle = new SignalLines(colors.band);
  const conversation = new Text("", 1, 1), detail = new Text("", 1, 1);
  const scrollColors = { scrollbarTrackStyle: colors.border, scrollbarThumbStyle: colors.accent };
  const transcript = new ScrollView(conversation, { follow: "end", primary: true, ...scrollColors });
  const inspector = new ScrollView(detail, { follow: "none", ...scrollColors });
  const editor = new Editor(tui, { borderColor: colors.border, selectList: theme }, { paddingX: 1, autocompleteMaxVisible: 6 });
  // Slash-only completion does not read the local filesystem or bypass the host's file permissions.
  const autocomplete: AutocompleteProvider = {
    triggerCharacters: ["/"],
    async getSuggestions(lines, line, col) {
      const prefix = lines[line]?.slice(0, col) ?? "";
      if (!/^\/[a-z]*$/.test(prefix)) return null;
      const items = terminalCommands.filter(([name]) => name.startsWith(prefix.slice(1))).map(([name, description]) => ({ value: "/" + name, label: "/" + name, description }));
      return items.length ? { items, prefix } : null;
    },
    applyCompletion(lines, line, col, item, prefix) {
      const value = item.value + " ", updated = [...lines];
      updated[line] = (lines[line] ?? "").slice(0, col - prefix.length) + value + (lines[line] ?? "").slice(col);
      return { lines: updated, cursorLine: line, cursorCol: col - prefix.length + value.length };
    },
  };
  editor.setAutocompleteProvider(autocomplete);
  let overlay: OverlayHandle | undefined, panelVisible = false, overviewSelected = false, guided = true, lastPanel = "", lastSession: string | undefined, editorSubmitting = false;
  const actions = [["F1 메뉴", "menu"], ["F2 대화", "sessions"], ["F3 실행", "activity"], ["F4 도구", "tools"], ["F5 파일", "files"], ["F6 변경", "diff"], ["F7 개요", "overview"], ["F8 표시", "density"]] as const;
  const menuFKeys: Record<string, string> = { overview: "F7", sessions: "F2", activity: "F3", tools: "F4", files: "F5", diff: "F6", density: "F8" };
  let hitRegions: { from: number; to: number; action: () => void }[] = [];
  const navigation = new MouseRegion({
    invalidate() {},
    render(width: number) {
      hitRegions = [];
      const stage = chooseNavBarStage(actions.map(([label]) => ({ label })), width);
      const painted = renderNavBar(
        actions.map(([label, command]) => ({ label, action: () => { void controller.submit("/" + command); } })),
        width,
        stage,
        text => colors.accent(text),
        { label: "F1", action: () => { void controller.submit("/menu"); } },
      );
      hitRegions = painted.regions;
      return [colors.band(painted.line, width)];
    },
  }, event => {
    if (event.type === "click" && event.button === "left") {
      const hit = hitRegions.find(h => event.x >= h.from && event.x < h.to);
      if (hit) { hit.action(); return { handled: true }; }
    }
  });
  const divider = { invalidate() {}, render: () => Array.from({ length: terminal.rows }, () => colors.border("│")) };
  const document = new HStack([
    { component: new VStack([{ component: conversationTitle, basis: 1 }, { component: transcript, basis: 0, grow: 1 }]), grow: 3, basis: 0, minSize: 12, visible: viewport => !(panelVisible || overviewSelected) || viewport.width >= 104 },
    { component: divider, basis: 1, visible: viewport => viewport.width >= 104 },
    { component: new VStack([{ component: detailTitle, basis: 1 }, { component: inspector, basis: 0, grow: 1 }]), grow: 2, basis: 0, minSize: 28, visible: viewport => viewport.width >= 104 || panelVisible || overviewSelected },
  ]);
  tui.setLayoutRoot(new VStack([
    { component: header, basis: 1 }, { component: context, basis: 1 },
    { component: navigation, basis: 1 },
    { component: compact, basis: 2, visible: viewport => viewport.width < 104 && !panelVisible && !overviewSelected && viewport.height >= 20 },
    { component: document, basis: 0, grow: 1, minSize: 1 },
    { component: status, basis: 2, shrink: 1, minSize: 1 },
    { component: inputTitle, basis: 1, visible: viewport => viewport.height >= 20 },
    { component: editor, basis: "auto", minSize: 3, maxSize: 8, shrink: 1 },
    { component: footer, basis: 1 },
  ]));
  const update = (state: TuiState) => {
    const session = state.session, model = terminalText(state.info?.provider?.model ?? "모델 확인 중", 100);
    const signals = workSignals(state);
    header.setText(`${colors.strong(`pida ${version} · 단일 대화`)}  ${colors.dim(model)}  ${state.connected ? "연결됨" : colors.bad("연결 끊김")} · ${guided ? "안내" : "간결"}`);
    const stage = chooseNavBarStage(actions.map(([label]) => ({ label })), terminal.columns);
    const navHint = stage === 3 ? " · F1에서 키 설명" : "";
    context.setText(`대상 ${singleLine(options.target ?? options.workspace, 200)} · 대화 ${session?.sessionId.slice(0, 8) ?? "연결 중"}${navHint}`);
    conversationTitle.setText(colors.strong(`대화  /  ${singleLine(session?.title ?? "새 작업", 120)}`));
    const messages = session ? sessionDisplayMessages(session) : [];
    const parts: string[] = []; let remaining = 64_000;
    for (const m of messages.slice(-80).reverse()) {
      const text = terminalText(m.text, 16_000).trim();
      if (m.role === "assistant" && !text) continue;
      const part = `${m.role === "user" ? colors.accent("요청") : colors.strong("응답")}\n${text}`;
      if (part.length > remaining) break;
      parts.unshift(part); remaining -= part.length;
    }
    let body = parts.join("\n\n");
    if (parts.length < messages.length) body = colors.dim("[최근 대화 일부 · 전체 기록은 Web UI에서 확인]") + "\n\n" + body;
    conversation.setText(body || (guided ? "어떤 결과를 만들까요?\n\n목표와 완료 조건을 아래에 입력하세요.\n예: 검색 필터를 추가하고 기존 테스트를 실행해 주세요.\n\nF1 메뉴에서 기능을 고를 수 있습니다.\nF2 이전 대화 · F5 작업 파일\n오른쪽 개요에서 실제 실행과 검증 상태를 확인하세요." : "목표를 입력하세요. F1 메뉴 · F2 이전 대화"));
    panelVisible = !!state.panel;
    const checks = signals.checks;
    const change = state.changes ? state.changes.available ? `변경 ${state.changes.files} · 미추적 ${state.changes.untracked}${state.changes.truncated ? " · 일부" : ""}\n${formatTuiTimestamp(state.changes.observedAt, "time")} KST 조회 · F6 갱신\n전체 작업 트리 기준` : "Git 비교 사용 불가" : "변경 미조회 · F6으로 확인";
    const capability = state.info?.capabilities;
    const detailWidth = Math.max(20, (terminal.columns >= 104 ? Math.floor(terminal.columns * .4) : terminal.columns) - 4);
    const short = (s: unknown) => truncateToWidth(singleLine(s, 400), detailWidth);
    const tight = terminal.rows < 30, gap = tight ? [] : [""];
    const outline = [
      colors.accent("목표"), short(signals.goal || "아직 요청 없음 · 아래에 입력"), ...gap,
      colors.accent("구조"), state.info ? `허용 도구 ${state.info.tools.filter(t => t.permitted).length}개 · F4 결과` : "도구 권한 정보 미확인",
      capability ? singleLine(`지침 ${capability.instructions.files} · 스킬 ${capability.skills}`) : "지침·스킬 정보 미확인",
      ...(guided && !tight ? [colors.dim("계획·가정은 대화에서 확인")] : []), ...gap,
      colors.accent("실행"), short(signals.phase),
      `도구 실행 완료 ${signals.complete} · 도구 실행 실패 ${signals.failed}${signals.elapsed === undefined ? "" : ` · ${signals.elapsed}초`}`,
      ...(signals.last?.code ? ["사유 " + singleLine(signals.last.code)] : []),
      ...(tight ? [] : [colors.dim(signals.run ? `run ${singleLine(signals.run.slice(0, 8))}${state.traceGap ? " · 기록 일부" : ""} · F3 상세` : "아직 실행 없음")]), ...gap,
      colors.accent("판단"), singleLine(signals.verification),
      ...(checks.length ? [short(`종료 때 검사: 검증 통과 ${checks.filter(v => v.status === "PASSED" && v.current_at_run_end).length} · 검증 실패 ${checks.filter(v => v.status === "FAILED").length} · 오래됨 ${checks.filter(v => !v.current_at_run_end).length}`)] : ["기록된 검사 결과 없음"]),
      terminalText(change),
      ...(guided && !tight ? [colors.dim("검사 통과 ≠ 작업 전체 검증")] : []),
    ].join("\n");
    detailTitle.setText(colors.strong(state.panel ? `${singleLine(state.panel.title, 100)}${state.panel.title.includes("Esc 닫기") ? "" : " · Esc 닫기"}` : "작업 개요 · F8 표시 전환"));
    const panelKey = state.panel ? JSON.stringify(state.panel) : "overview";
    // The outline is trusted UI markup with separately sanitized host values.
    // Sanitizing it a second time stripped its own section colors.
    detail.setText(state.panel ? terminalText(state.panel.text) : outline);
    if (panelKey !== lastPanel) { inspector.scrollToStart(); lastPanel = panelKey; }
    if (lastSession !== session?.sessionId) { transcript.scrollToEnd(); inspector.scrollToStart(); tui.resetTextSelection(); lastSession = session?.sessionId; }
    compact.setText(`목표 ${singleLine(signals.goal || "입력 대기", 160)}\n${signals.verification} · F7 작업 개요`);
    const usage = session?.context?.percent == null ? "" : ` · 컨텍스트 ${session.context.percent.toFixed(0)}%`;
    status.setText(`${state.draftBinding ? "고정 " + singleLine(state.draftBinding.path, 80) + (state.draftBinding.kind === "source-range" ? `:${state.draftBinding.range.startLine}-${state.draftBinding.range.endLine}` : "") + " · " : ""}${state.connected ? signals.phase : colors.bad("연결 끊김 · 표시된 상태는 마지막 관측")}${usage}${state.traceGap ? " · 실행 기록 일부" : ""}\n` + colors.dim(singleLine(state.notice, 300)));
    inputTitle.setText(colors.accent(session?.running ? "지시 입력 · F1에서 추가 지시 / 후속 요청 선택" : "요청 입력 · 목표 + 완료 조건"));
    footer.setText(colors.dim(guided ? "Enter 보내기 · F1 메뉴 · Ctrl+C 중단 · Ctrl+D 분리" : "F1 메뉴 · F7 개요 · F8 안내 · Ctrl+C 중단 · Ctrl+D 분리"));
    tui.requestRender();
  };
  controller.onChange = () => update(controller.state);
  const dismiss = () => { overlay?.hide(); overlay = undefined; tui.setFocus(editor); tui.requestRender(); };
  const choose = (title: string, items: SelectItem[], onSelect: (item: SelectItem) => void) => {
    overlay?.hide();
    const list = new SelectList(items, Math.max(3, Math.min(14, terminal.rows - 8)), theme, { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 30 });
    list.onCancel = dismiss;
    list.onSelect = item => { dismiss(); onSelect(item); };
    const content = new (class extends Box { handleInput(data: string) { list.handleInput(data); } })(1, 1, colors.panel);
    content.addChild(new Text(singleLine(title, 200) + "\n↑↓ 선택 · Enter 열기 · Esc 닫기", 1, 1)); content.addChild(list);
    overlay = tui.showOverlay(content, { width: "85%", maxHeight: "85%" });
  };
  controller.onSessions = sessions => choose("대화 선택", [{ value: "new", label: "+ 새 대화" }, ...sessions.map(s => ({ value: s.sessionId, label: singleLine(s.title || "새 대화", 100), description: `${s.running ? "실행 중" : s.lastStatus ?? "대기"} · ${s.sessionId.slice(0, 8)}` }))], item => { void controller.submit(item.value === "new" ? "/new" : "/resume " + item.value); });
  controller.onFiles = files => {
    const items = files.files.map((f, index) => ({ value: String(index), label: (f.type === "directory" ? "▸ " : "  ") + singleLine(f.path, 160), description: f.type === "directory" ? "폴더 열기" : "내용 보기" }));
    if (files.path !== ".") items.unshift({ value: "parent", label: ".. 상위 폴더", description: "폴더 열기" });
    if (!items.length) items.push({ value: "empty", label: "표시할 파일 없음", description: "Esc 닫기" });
    choose(`${files.title} / ${files.path}${files.truncated ? " · 목록 일부" : ""}`, items, item => {
      if (item.value === "empty") return;
      if (item.value === "parent") { void controller.submit("/files " + (files.path.split("/").slice(0, -1).join("/") || ".")); return; }
      const f = files.files[Number(item.value)]; if (f) void controller.submit(`/${f.type === "directory" ? "files" : "read"} ${f.path}`);
    });
  };
  controller.onOverview = () => { controller.state.panel = undefined; overviewSelected = !overviewSelected; update(controller.state); };
  controller.onDensity = () => { guided = !guided; update(controller.state); };
  controller.onRestoreDraft = text => { if (!editor.getExpandedText()) editor.setText(text); tui.requestRender(); };
  controller.onMenu = () => choose("기능 메뉴 · 명령을 외울 필요 없이 선택하세요", terminalCommands.filter(([name]) => !["menu", "resume", "read"].includes(name)).map(([name, description]) => {
    const fKey = menuFKeys[name];
    return { value: name, label: description, description: fKey ? `${fKey} · /${name}` : `/${name}` };
  }), item => {
    if (item.value === "steer" || item.value === "followup") {
      // Preserve any draft; choosing a destination does not submit it.
      const draft = editor.getExpandedText().replace(/^\/(?:steer|followup)\s*/, "");
      editor.setText(`/${item.value} ${draft}`); tui.requestRender();
    } else void controller.submit("/" + item.value);
  });
  editor.onSubmit = text => {
    if (editorSubmitting) return;
    editorSubmitting = true; editor.disableSubmit = true;
    void controller.submit(text).then(accepted => { if (accepted && editor.getExpandedText() === text) { editor.addToHistory(text); editor.setText(""); } })
      .finally(() => { editorSubmitting = false; editor.disableSubmit = false; tui.requestRender(); });
  };
  tui.addInputListener(data => {
    if (isKeyRelease(data)) return { consume: true };
    if (matchesKey(data, "ctrl+d")) { controller.onQuit(); return { consume: true }; }
    if (matchesKey(data, "ctrl+c")) { if (overlay) { overlay.hide(); overlay = undefined; tui.setFocus(editor); } else if (controller.state.session?.running || controller.state.submitting) void controller.submit("/stop"); else editor.setText(""); tui.requestRender(); return { consume: true }; }
    if (overlay) return;
    for (const [key, command] of [["f1", "menu"], ["f2", "sessions"], ["f3", "activity"], ["f4", "tools"], ["f5", "files"], ["f6", "diff"], ["f7", "overview"], ["f8", "density"]] as const) {
      if (matchesKey(data, key)) { void controller.submit("/" + command); return { consume: true }; }
    }
    if ((panelVisible || overviewSelected || terminal.columns >= 104) && (matchesKey(data, "alt+pageUp") || matchesKey(data, "alt+pageDown"))) { inspector.scrollBy(matchesKey(data, "alt+pageUp") ? -10 : 10); tui.requestRender(); return { consume: true }; }
    if (matchesKey(data, "escape") && (panelVisible || overviewSelected) && !editor.isShowingAutocomplete()) { overviewSelected = false; void controller.submit("/back"); return { consume: true }; }
  });
  tui.setFocus(editor); update(controller.state);
  return { tui, editor, update, terminal, getScreenLines: () => tui.getScreenLines(), start: () => tui.start(), stop: () => { overlay?.hide(); tui.stop(); } };
}

export async function runTerminal(options: { client: PidaClient; workspace: string; target?: string; sessionId?: string; newSession?: boolean; openWeb: (id: string) => Promise<void> }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("TUI에는 대화형 터미널이 필요합니다.");
  const controller = new TuiController(options.client, { openWeb: options.openWeb });
  await controller.start(options);
  let view: ReturnType<typeof createTuiView>;
  try { view = createTuiView(controller, options); } catch (e) { controller.close(); throw e; }
  let finish!: () => void, stopped = false;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const close = () => { if (stopped) return; stopped = true; controller.close(); view.stop(); finish(); };
  controller.onQuit = close;
  process.once("SIGINT", close); process.once("SIGTERM", close); process.stdin.once("end", close);
  try { view.start(); await done; }
  finally { close(); process.off("SIGINT", close); process.off("SIGTERM", close); process.stdin.off("end", close); }
  process.stdout.write("\nPida TUI 연결을 닫았습니다. 별도로 실행한 서버와 작업은 계속됩니다.\n");
}
