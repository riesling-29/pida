import {
  Container, Editor, HStack, ProcessTerminal, ScrollView, SelectList, Text, TuiAltScreen, VStack,
  isKeyRelease, matchesKey, stripTerminalSequences, truncateToWidth,
  type AutocompleteProvider, type OverlayHandle, type Terminal,
} from "@earendil-works/pi-tui";
import { PidaClient, sessionDisplayMessages } from "./client.js";
import { TuiController, terminalCommands, type TuiState } from "./tui-controller.js";

/** Host/model/file content must never introduce terminal controls (OSC clipboard/title etc.). */
export function terminalText(value: unknown, limit = 48_000): string {
  const text = stripTerminalSequences(String(value ?? "")).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\r/g, "");
  return text.length <= limit ? text : text.slice(0, limit) + "\n[표시 한도 · 원문은 Web UI에서 확인]";
}
function palette(color: boolean) {
  const wrap = (code: string) => (s: string) => color ? `\x1b[${code}m${s}\x1b[0m` : s;
  return { strong: wrap("1"), dim: wrap("2"), accent: wrap("33"), bad: wrap("31"), good: wrap("32") };
}
const phaseNames: Record<string, string> = { run_started: "시작", turn_started: "모델 응답 대기", tool_started: "도구 실행", tool_completed: "도구 완료", tool_failed: "도구 실패", retry_scheduled: "재시도 대기", auto_compaction_start: "대화 압축", run_finished: "실행 종료" };
const statusNames: Record<string, string> = { completed: "실행 완료 · 독립 검증 미확인", failed: "실패", cancelled: "중단됨", limited: "실행 한도 도달", interrupted: "서버 종료로 중단됨" };

/** Stable dense surface; Pi owns layout, Unicode cells, editor, paste, scroll and terminal lifecycle. */
export function createTuiView(controller: TuiController, options: { terminal?: Terminal; workspace: string; target?: string; color?: boolean }) {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, true, undefined, { copyOnSelect: false, openUrl: () => {}, mouse: true });
  const colors = palette(options.color ?? !process.env.NO_COLOR);
  const theme = { selectedPrefix: colors.accent, selectedText: colors.strong, description: colors.dim, scrollInfo: colors.dim, noMatch: colors.dim };
  const header = new Text("", 1, 0), context = new Text("", 1, 0), status = new Text("", 1, 0), footer = new Text("", 1, 0);
  const conversation = new Text("", 1, 1), detail = new Text("", 1, 1);
  const transcript = new ScrollView(conversation, { follow: "end", primary: true });
  const inspector = new ScrollView(detail, { follow: "none" });
  const editor = new Editor(tui, { borderColor: colors.accent, selectList: theme }, { paddingX: 1, autocompleteMaxVisible: 6 });
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
  let overlay: OverlayHandle | undefined, panelVisible = false, lastPanel = "", lastSession: string | undefined, editorSubmitting = false;
  const document = new HStack([
    { component: transcript, grow: 3, basis: 0, minSize: 12, visible: viewport => !panelVisible || viewport.width >= 100 },
    { component: inspector, grow: 2, basis: 0, minSize: 12, visible: () => panelVisible },
  ]);
  tui.setLayoutRoot(new VStack([
    { component: header, basis: 1 }, { component: context, basis: 1 },
    { component: document, basis: 0, grow: 1, minSize: 1 },
    { component: status, basis: 2, shrink: 1, minSize: 1 },
    { component: editor, basis: "auto", minSize: 3, maxSize: 8, shrink: 1 },
    { component: footer, basis: 1 },
  ]));
  const line = (s: string) => truncateToWidth(s, Math.max(1, terminal.columns - 2));
  const update = (state: TuiState) => {
    const session = state.session, model = terminalText(state.info?.provider?.model ?? "모델 확인 중", 100);
    header.setText(line(`${colors.strong("pida")} / ${terminalText(options.target ?? options.workspace, 160)}  ${colors.dim(model)}`));
    context.setText(line(`${session ? session.sessionId.slice(0, 8) : "연결"} · ${terminalText(session?.title ?? "작업 대기", 160)}`));
    const messages = session ? sessionDisplayMessages(session) : [];
    const parts: string[] = []; let remaining = 64_000;
    for (const m of messages.slice(-80).reverse()) {
      const part = `${m.role === "user" ? colors.accent("YOU") : colors.strong("PIDA")}\n${terminalText(m.text, 16_000)}`;
      if (part.length > remaining) break;
      parts.unshift(part); remaining -= part.length;
    }
    let body = parts.join("\n\n");
    if (parts.length < messages.length) body = colors.dim("[최근 대화 일부 · 전체 기록은 Web UI에서 확인]") + "\n\n" + body;
    conversation.setText(body || "목표를 입력하세요.\n\n실행 과정  /activity\n실제 변경  /diff\n도구 결과  /tools\n같은 대화  /web");
    panelVisible = !!state.panel;
    const panel = state.panel ? `${colors.strong(terminalText(state.panel.title, 180))}  ${colors.dim("/back 닫기")}\n\n${terminalText(state.panel.text)}` : "";
    if (panel !== lastPanel) { detail.setText(panel); inspector.scrollToStart(); lastPanel = panel; }
    if (lastSession !== session?.sessionId) { transcript.scrollToEnd(); tui.resetTextSelection(); lastSession = session?.sessionId; }
    const trace = state.trace.filter(t => !session?.activeRunId || t.runId === session.activeRunId).at(-1);
    const phase = session?.running ? `${phaseNames[trace?.type ?? ""] ?? "실행 중"}${trace?.toolName ? " · " + terminalText(trace.toolName, 80) : ""}` : state.submitting ? "전송·응답 대기" : statusNames[session?.lastStatus ?? ""] ?? "준비됨";
    const usage = session?.context?.percent == null ? "" : ` · 컨텍스트 ${session.context.percent.toFixed(0)}%`;
    status.setText(line(`${state.connected ? phase : colors.bad("연결 끊김 · 표시된 상태는 마지막 관측")}${usage}${state.traceGap ? " · 실행 기록 일부" : ""}`) + "\n" + line(colors.dim(terminalText(state.notice, 300))));
    footer.setText(line(colors.dim("F2 대화 · F3 실행 · F4 도구 · F6 변경 · Ctrl+C 중단 · Ctrl+D 분리 · /help")));
    tui.requestRender();
  };
  controller.onChange = () => update(controller.state);
  controller.onSessions = sessions => {
    overlay?.hide();
    const list = new SelectList([{ value: "new", label: "+ 새 대화" }, ...sessions.map(s => ({ value: s.sessionId, label: terminalText(s.title || "새 대화", 100), description: `${s.running ? "실행 중" : s.lastStatus ?? "대기"} · ${s.sessionId.slice(0, 8)}` }))], Math.max(3, Math.min(12, terminal.rows - 8)), theme);
    const dismiss = () => { overlay?.hide(); overlay = undefined; tui.setFocus(editor); tui.requestRender(); };
    list.onCancel = dismiss;
    list.onSelect = item => { dismiss(); void controller.submit(item.value === "new" ? "/new" : "/resume " + item.value); };
    const content = new (class extends Container { handleInput(data: string) { list.handleInput(data); } })();
    content.addChild(new Text("대화 선택 · Enter 열기 · Esc 닫기", 1, 1)); content.addChild(list);
    overlay = tui.showOverlay(content, { width: "85%", maxHeight: "85%" });
  };
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
    for (const [key, command] of [["f2", "sessions"], ["f3", "activity"], ["f4", "tools"], ["f6", "diff"]] as const) {
      if (matchesKey(data, key)) { void controller.submit("/" + command); return { consume: true }; }
    }
    if (panelVisible && (matchesKey(data, "alt+pageUp") || matchesKey(data, "alt+pageDown"))) { inspector.scrollBy(matchesKey(data, "alt+pageUp") ? -10 : 10); tui.requestRender(); return { consume: true }; }
    if (matchesKey(data, "escape") && panelVisible && !editor.isShowingAutocomplete()) { void controller.submit("/back"); return { consume: true }; }
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
