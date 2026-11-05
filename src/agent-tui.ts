import { Box, Editor, HStack, MouseRegion, ProcessTerminal, ScrollView, SelectList, Text, TuiAltScreen, VStack,
  isKeyRelease, matchesKey, truncateToWidth, visibleWidth, type Component, type Terminal, type TerminalColorMode, type OverlayHandle, type SelectItem } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import type { PidaClient } from "./client.js";
import { AgentWorkspaceController, admissionLabels, viewLabels, detailText, type WorkspaceControllerOptions } from "./agent-workspace-controller.js";
import { WorkspaceLayout, fitsLayout, paneList, splitList, type WorkNode, type WorkPane } from "./workspace-layout.js";
import { terminalPalette } from "./tui-theme.js";
import { formatTuiTimestamp } from "./tui-time.js";
import { displayStatus, formatTraceActivityLine } from "./tui-labels.js";
import { chooseNavBarStage, renderNavBar } from "./tui-nav-bar.js";
import { terminalText } from "./tui.js";

const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const line = (s: unknown) => terminalText(s, 400).replace(/\s+/g, " ");
class Row implements Component {
  text = "";
  constructor(private paint: (s: string, width: number) => string = s => s) {}
  invalidate() {}
  render(width: number) {
    const lines = this.text ? this.text.split("\n") : [""];
    return lines.map(line => this.paint(truncateToWidth(" " + line, width), width));
  }
}

/** Start with visible work areas; this only supplies a layout when no saved layout exists. */
export function terminalDefaultLayout() {
  const layout = new WorkspaceLayout(), first = layout.active.focus;
  const second = layout.split(first, "horizontal");
  layout.bind(second.id, { view: "activity" });
  layout.resize(splitList(layout.active.root)[0]!.id, .62);
  layout.focus(first);
  return layout.data;
}

/** One upstream Pi screen, multiple retained upstream editors/scroll views. No terminal emulator. */
export function createAgentTui(controller: AgentWorkspaceController, options: {
  terminal?: Terminal; workspace: string; color?: boolean; colorMode?: TerminalColorMode;
  openWeb?: () => Promise<void>; onQuit?: () => void;
}) {
  const terminal = options.terminal ?? new ProcessTerminal(), colors = terminalPalette(options.color ?? !process.env.NO_COLOR, options.colorMode);
  const originalStart = terminal.start;
  terminal.start = (input, resized) => originalStart.call(terminal, input, () => { update(); resized(); });
  const tui: TuiAltScreen = new (class extends TuiAltScreen {
    protected override applyLineResets(lines: string[]) { return super.applyLineResets(lines.map(l => colors.frameLine(l, this.terminal.columns))); }
  })(terminal, true, undefined, { copyOnSelect: false, openUrl: () => {}, mouse: true });
  const theme = { selectedPrefix: colors.accent, selectedText: colors.selected, description: colors.dim, scrollInfo: colors.dim, noMatch: colors.dim };
  const panels = new Map<string, { component: Component; editor: Editor; heading: Row; signal: Row; content: Text; scroll: ScrollView; receipt: Row }>();
  let overlay: OverlayHandle | undefined, notice = "", stopped = false;
  const head = new Row(colors.band), context = new Row(), footer = new Row(colors.band), help = new Row();
  const focusId = () => controller.layout.active.focus;
  const focusEditor = () => { const p = panels.get(focusId()); if (p) tui.setFocus(p.editor); };
  const invoke = (fn: () => unknown) => { try { const result = fn(); if (result instanceof Promise) void result.catch(e => { notice = line(e.message); update(); }); } catch (e) { notice = line(e instanceof Error ? e.message : e); update(); } };
  const dismiss = () => { overlay?.hide(); overlay = undefined; focusEditor(); tui.requestRender(); };
  const choose = (title: string, items: SelectItem[], select: (value: string) => void) => {
    overlay?.hide();
    const list = new SelectList(items.length ? items : [{ value: "", label: "항목 없음" }], Math.max(3, Math.min(14, terminal.rows - 8)), theme, { minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 35 });
    list.onCancel = dismiss; list.onSelect = item => { dismiss(); if (item.value) invoke(() => select(item.value)); };
    const box = new (class extends Box { handleInput(data: string) { list.handleInput(data); } })(1, 1, colors.panel);
    box.addChild(new Text(line(title) + "\n↑↓ 선택 · Enter 실행 · Esc 닫기", 1, 1)); box.addChild(list);
    overlay = tui.showOverlay(box, { width: "90%", maxHeight: "90%" });
  };
  const ask = (title: string, initial: string, accept: (value: string) => void) => {
    overlay?.hide();
    const editor = new Editor(tui, { borderColor: colors.border, selectList: theme }, { paddingX: 1 }); editor.setText(initial);
    editor.onSubmit = text => { dismiss(); if (text.trim()) invoke(() => accept(text.trim())); };
    const box = new (class extends Box { handleInput(data: string) { if (matchesKey(data, "escape")) dismiss(); else editor.handleInput(data); } })(1, 1, colors.panel);
    box.addChild(new Text(line(title) + "\nEnter 확인 · Esc 닫기", 1, 1)); box.addChild(editor);
    overlay = tui.showOverlay(box, { width: "80%", maxHeight: "80%" });
  };
  const createAgent = () => {
    const paneId = focusId();
    ask("새 에이전트 이름", "", name => {
      const sources = controller.overview?.personaSources.sources ?? [];
      choose("Persona 출처 · 호스트가 허용한 연결", sources.map(s => ({ value: s.id, label: line(s.label) })), source => {
        invoke(async () => { const profile = await controller.create({ name, personaSourceId: source });
          if (!stopped && controller.layout.allPanes().some(p => p.id === paneId)) controller.bind(paneId, { agentId: profile.id, view: "chat" }); });
      });
    });
  };
  function tabMenu() {
    choose("작업 탭", [
      ...controller.layout.data.tabs.map(t => ({ value: t.id, label: line(t.title), description: `${paneList(t.root).length} 패널${t.id === controller.layout.active.id ? " · 현재" : ""}` })),
      { value: "new", label: "+ 새 탭" }, { value: "rename", label: "현재 탭 이름 바꾸기" }, { value: "close", label: "현재 탭 닫기 · 실행 유지" },
    ], value => { if (value === "new") controller.layout.addTab(); else if (value === "close") controller.layout.closeTab(controller.layout.active.id); else if (value === "rename") { const id = controller.layout.active.id; ask("탭 이름", controller.layout.active.title, text => controller.layout.renameTab(id, text)); } else controller.layout.selectTab(value); });
  }
  function agentMenu() {
    const paneId = focusId();
    choose("패널에 연결할 에이전트", [{ value: "new", label: "+ 새 에이전트" }, ...(controller.overview?.agents ?? []).map(a => ({ value: a.profile.id, label: line(a.profile.name), description: `${admissionLabels[a.admission]} · ${line(a.profile.personaSourceId ?? "호스트 기본")}` }))], value => {
      if (value === "new") createAgent(); else controller.bind(paneId, { agentId: value, view: controller.layout.find(paneId).binding.view });
    });
  }
  function jobMenu() {
    const paneId = focusId(), entry = controller.entry(paneId);
    choose("작업 선택 · 지시를 재실행하지 않습니다", [{ value: "latest", label: "최신 작업 따라가기" }, ...(entry?.jobs ?? []).slice().reverse().map(j => ({ value: j.id, label: `${displayStatus(j.status)} · ${j.id.slice(0, 8)}`, description: formatTuiTimestamp(j.createdAt, "datetime") }))], value => controller.bind(paneId, { ...controller.layout.find(paneId).binding, jobId: value === "latest" ? undefined : value }));
  }
  function views() {
    const paneId = focusId();
    choose("패널 보기", [...Object.entries(viewLabels).map(([value, label]) => ({ value, label })), { value: "refresh", label: "현재 보기 새로고침" }, { value: "read", label: "에이전트 파일 열기" }], value => {
      if (value === "read") {
        const agentId = controller.layout.find(paneId).binding.agentId; if (!agentId) return;
        invoke(async () => { const bench = await controller.client.getAgentWorkbench(agentId);
          if (stopped || controller.layout.find(paneId).binding.agentId !== agentId) return;
          choose("에이전트 작업 파일", bench.files.map(f => ({ value: f.path, label: line(f.path) })), path => {
            if (controller.layout.find(paneId).binding.agentId !== agentId) return;
            controller.bind(paneId, { ...controller.layout.find(paneId).binding, view: "files" }); void controller.inspect(paneId, path);
          });
        }); return;
      }
      if (value !== "refresh") controller.bind(paneId, { ...controller.layout.find(paneId).binding, view: value as WorkPane["binding"]["view"] });
      invoke(() => controller.inspect(paneId));
    });
  }
  function splitMenu() {
    const paneId = focusId();
    choose("분할과 배치", [{ value: "horizontal", label: "좌우 분할" }, { value: "vertical", label: "상하 분할" }, { value: "resize", label: "분할 비율 조절" }, { value: "swap", label: "다른 패널과 자리 바꾸기" }, { value: "close", label: "이 패널 닫기 · 실행 유지" }], value => {
      if (value === "horizontal" || value === "vertical") controller.layout.split(paneId, value);
      else if (value === "close") controller.layout.closePane(paneId);
      else if (value === "swap") choose("교환할 패널", controller.layout.data.tabs.flatMap(t => paneList(t.root).filter(p => p.id !== paneId).map((p, i) => ({ value: p.id, label: `${line(t.title)} / ${line(controller.entry(p.id)?.profile.name ?? "미연결")} ${i + 1}` }))), key => controller.layout.swap(paneId, key));
      else choose("조절할 분할", splitList(controller.layout.active.root).map((s, i) => ({ value: s.id, label: `${i + 1} · ${s.axis === "horizontal" ? "좌우" : "상하"} ${Math.round(s.ratio * 100)}:${Math.round((1 - s.ratio) * 100)}` })), key => choose("첫 패널 비율", [25, 33, 40, 50, 60, 67, 75].map(n => ({ value: String(n), label: `${n} : ${100 - n}` })), n => controller.layout.resize(key, Number(n) / 100)));
    });
  }
  function focusMenu() { choose("초점 패널", controller.layout.panes.map((p, i) => ({ value: p.id, label: `${i + 1} · ${line(controller.entry(p.id)?.profile.name ?? "미연결")} / ${viewLabels[p.binding.view]}` })), key => controller.layout.focus(key)); }
  function controlMenu() {
    const paneId = focusId();
    choose("이 패널의 에이전트 / 작업", [
      { value: "send", label: "입력한 지시를 새 작업으로 접수" }, { value: "steer", label: "현재 실행에 추가 지시 전달" },
      { value: "cancel", label: "현재 표시한 작업 취소" }, { value: "pause", label: "다음 작업 대기열 일시정지" }, { value: "resume", label: "대기열 재개" },
      { value: "check", label: "미확인 요청 접수 여부 확인" }, { value: "retry", label: "미확인 요청을 같은 ID로 재전송" },
      { value: "web", label: "Web 관리 · 기억 · 복구 열기" },
    ], value => invoke(() => {
      if (value === "send") return controller.submit(paneId);
      if (value === "steer") return controller.steer(paneId);
      if (value === "cancel") return controller.cancel(paneId);
      if (value === "pause" || value === "resume") return controller.pause(paneId, value === "pause");
      if (value === "check") return controller.checkDelivery(paneId);
      if (value === "retry") return controller.submit(paneId, true);
      return options.openWeb?.();
    }));
  }
  const envMenu = [
    { value: "1", label: "탭", description: "F2" },
    { value: "2", label: "에이전트 연결 / 생성", description: "F3" },
    { value: "3", label: "작업 선택", description: "F4" },
    { value: "4", label: "패널 보기 / 파일", description: "F5" },
    { value: "5", label: "분할 / 크기 / 교환", description: "F6" },
    { value: "6", label: "초점 패널", description: "F7" },
    { value: "7", label: "실행 제어", description: "F8 · Ctrl+C" },
    { value: "8", label: "Web 열기", description: "" },
    { value: "9", label: "연결 종료 · 작업 유지", description: "Ctrl+D" },
  ] as const;
  const actions = [ ["F1 메뉴", () => choose("작업 환경", [...envMenu], v => [tabMenu, agentMenu, jobMenu, views, splitMenu, focusMenu, controlMenu, () => invoke(() => options.openWeb?.()), () => options.onQuit?.()][Number(v) - 1]!())],
    ["F2 탭", tabMenu], ["F3 에이전트", agentMenu], ["F4 작업", jobMenu], ["F5 보기", views], ["F6 분할", splitMenu], ["F7 초점", focusMenu], ["F8 제어", controlMenu], ["F9 확대", () => controller.layout.zoom()] ] as const;
  function mouseBar(items: () => { label: string; action: () => void; selected?: boolean }[]) {
    let regions: { from: number; to: number; action: () => void }[] = [];
    return new MouseRegion({ invalidate() {}, render(width) {
      regions = [];
      const list = items();
      const stage = chooseNavBarStage(list, width);
      const painted = renderNavBar(list, width, stage, (text, selected) => selected ? colors.selected(text) : colors.accent(text));
      regions = painted.regions;
      return [colors.band(painted.line, width)];
    } }, event => { if (event.type === "click" && event.button === "left") { const region = regions.find(r => event.x >= r.from && event.x < r.to); if (region) { invoke(region.action); return { handled: true }; } } });
  }
  const nav = mouseBar(() => actions.map(([label, action]) => ({ label, action })));
  const tabs = mouseBar(() => [...controller.layout.data.tabs.map(t => ({ label: line(t.title), action: () => controller.layout.selectTab(t.id), selected: t.id === controller.layout.active.id })), { label: "+", action: () => controller.layout.addTab() }]);
  function newPanel(p: WorkPane) {
    const border = (value: string) => (focusId() === p.id ? colors.accent : colors.border)(value);
    const heading = new Row((value, width) => {
      const title = truncateToWidth(value, Math.max(0, width - 4));
      return border("╭─") + title + border("─".repeat(Math.max(0, width - visibleWidth(title) - 3)) + "╮");
    }), signal = new Row(), receipt = new Row();
    const content = new Text("", 1, 0), scroll = new ScrollView(content, { follow: "end", scrollbarTrackStyle: colors.border, scrollbarThumbStyle: colors.accent });
    const editor = new Editor(tui, { borderColor: colors.border, selectList: theme }, { paddingX: 1 });
    const renderEditor = editor.render.bind(editor);
    editor.render = width => {
      // Pi's editor draws a fake cursor even when unfocused; only the active pane
      // should show an input cursor. Retain the upstream editor and its cursor state.
      const lines = renderEditor(Math.max(6, width));
      return lines.map(s => truncateToWidth(editor.focused ? s : colors.dim(terminalText(s)), width));
    };
    const handleMouse = editor.handleMouse.bind(editor);
    editor.handleMouse = event => {
      if ((event.type === "press" || event.type === "click") && event.button === "left" && focusId() !== p.id) controller.layout.focus(p.id);
      return handleMouse(event);
    };
    editor.onChange = () => controller.setDraft(p.id, editor.getExpandedText());
    // Pi clears its buffer before onSubmit; retain the supplied text until host ACK.
    editor.onSubmit = text => { controller.setDraft(p.id, text); invoke(() => controller.submit(p.id)); };
    const header = new MouseRegion(heading, e => { if (e.type === "click" && e.button === "left") { controller.layout.focus(p.id); return { handled: true }; } });
    const inside = new VStack([{ component: signal, basis: 1 }, { component: scroll, grow: 1, basis: 0, minSize: 1 },
      { component: receipt, basis: 1 }, { component: editor, basis: "auto", minSize: 3, maxSize: 5, shrink: 1 }]);
    const side = (): Component => ({ invalidate() {}, render: () => Array.from({ length: terminal.rows }, () => border("│")) });
    const bottom: Component = { invalidate() {}, render: width => [border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯")] };
    const component = new VStack([{ component: header, basis: 1, shrink: 0 },
      { component: new HStack([{ component: side(), basis: 1, shrink: 0 }, { component: inside, grow: 1, basis: 0, minSize: 6 }, { component: side(), basis: 1, shrink: 0 }]), grow: 1, basis: 0, minSize: 1 },
      { component: bottom, basis: 1, shrink: 0 }]);
    return { component, heading, signal, receipt, content, scroll, editor };
  }
  function tree(node: WorkNode, width: number, height: number): Component {
    if (node.kind === "pane") return panels.get(node.id)!.component;
    const horizontal = node.axis === "horizontal";
    const divider: Component = { invalidate() {}, render: width => horizontal ? Array.from({ length: terminal.rows }, () => " ") : [" ".repeat(width)] };
    // Pi 1.2 uses integer growth weights. Explicit cell sizes keep ratios exact.
    const available = Math.max(2, (horizontal ? width : height) - 1), first = Math.floor(available * node.ratio), second = available - first;
    const children = [{ component: tree(node.first, horizontal ? first : width, horizontal ? height : first), basis: first, shrink: 0 }, { component: divider, basis: 1, shrink: 0 }, { component: tree(node.second, horizontal ? second : width, horizontal ? height : second), basis: second, shrink: 0 }];
    return horizontal ? new HStack(children) : new VStack(children);
  }
  function update() {
    if (stopped) return;
    const all = controller.layout.allPanes();
    for (const p of all) {
      if (!panels.has(p.id)) panels.set(p.id, newPanel(p));
      const n = panels.get(p.id)!, entry = controller.entry(p.id), job = controller.job(p.id), selected = p.id === focusId();
      n.heading.text = `${selected ? colors.accent("▸") : " "} ${colors.strong(line(entry?.profile.name ?? "F3 에이전트 연결"))} / ${viewLabels[p.binding.view]}${p.binding.view === "activity" ? " · KST" : ""} · ${line(entry?.profile.personaSourceId ?? "")}`;
      const age = job?.lastSignalAt ? Math.max(0, Math.floor((Date.now() - Date.parse(job.lastSignalAt)) / 1000)) : undefined;
      n.signal.text = entry ? `${admissionLabels[entry.admission]}${job ? ` | ${displayStatus(job.status)} ${line(job.currentTool ?? "")} · ${job.id.slice(0, 8)}${age !== undefined && job.status === "running" ? ` · ${age}초 전` : ""}` : " · 작업 없음"}` : "F3에서 생성 / 연결 · F1 전체 메뉴";
      let body: string;
      if (p.binding.view === "chat") body = job ? `${colors.accent("요청")}\n${terminalText(job.input)}\n\n${colors.strong("응답")}\n${terminalText(job.result?.text || job.latestText || "응답 대기 중")}` : entry
        ? "아래에 목표를 입력하세요.\n\nF6으로 패널을 나누고 F3에서 다른 에이전트를 연결합니다.\n\n창은 관찰 도구입니다. 닫아도 서버의 작업은 유지됩니다."
        : "첫 에이전트를 만드세요 · F3\n\nF6으로 패널을 나누고 F3에서 다른 에이전트를 연결합니다.\n\n창은 관찰 도구입니다. 닫아도 서버의 작업은 유지됩니다.";
      else if (p.binding.view === "activity") body = job?.activity.map(e => terminalText(formatTraceActivityLine(e.timestamp, e, iso => formatTuiTimestamp(iso, "time")))).join("\n") || "관측된 실행 기록 없음";
      else body = terminalText(detailText(controller.detail(p.id), p.binding.view) ?? `${viewLabels[p.binding.view]} 미조회 · F5 현재 보기 새로고침\n독립 검증 근거가 없으면 UNKNOWN입니다.`);
      n.content.setText(body);
      n.receipt.text = colors.dim(line(controller.message(p.id) || (controller.isBusy(p.id) ? "요청 처리 중" : "Enter 새 작업 · F8 추가 지시 / 취소")));
      const draft = controller.draft(p.id); if (n.editor.getExpandedText() !== draft) n.editor.setText(draft);
      n.editor.disableSubmit = !entry || controller.isBusy(p.id) || controller.isUncertain(p.id);
      n.editor.borderColor = selected ? colors.accent : colors.border;
    }
    for (const key of panels.keys()) if (!all.some(p => p.id === key)) panels.delete(key);
    const active = controller.layout.active;
    const agentCount = controller.overview?.agents.length ?? 0;
    const allPanelsEmpty = all.every(p => !controller.entry(p.id));
    const soloEmptyHome = agentCount === 0 && allPanelsEmpty && !active.zoom;
    const layoutFits = (v: { width: number; height: number }) => !active.zoom && fitsLayout(active.root, v.width, Math.max(1, v.height - 6), 38, 12);
    const fits = (v: { width: number; height: number }) => layoutFits(v) && !soloEmptyHome;
    const panelCount = controller.layout.panes.length;
    head.text = `${colors.strong(`pida ${version} · 멀티 · 에이전트 ${agentCount} · 패널 ${panelCount}/4`)}${soloEmptyHome ? " · 1개 표시" : ""}`;
    const navStage = chooseNavBarStage(actions.map(([label]) => ({ label })), terminal.columns);
    const collapsed = !active.zoom && !layoutFits({ width: terminal.columns, height: terminal.rows });
    context.text = line(active.zoom ? `F9 확대 중 · 다시 F9로 분할 복귀 · ${options.workspace}` : collapsed ? `창 ${terminal.columns}×${terminal.rows} · 초점 패널만 표시 · 창 확대 시 분할 복귀 · ${options.workspace}` : `${options.workspace}${navStage === 3 ? " · F1에서 키 설명" : ""}`);
    footer.text = colors.dim(line(controller.error || controller.storageError || notice || "배치 자동 저장 · 같은 작업공간 쓰기는 호스트에서 순차 실행"));
    help.text = "F1 메뉴 · Alt+←/→ 초점 · Alt+↑/↓ 크기 · Ctrl+D 연결 종료 · 초점만 보이면 창을 넓히세요";
    const root = new VStack([{ component: head, basis: 1 }, { component: context, basis: 1 }, { component: tabs, basis: 1 }, { component: nav, basis: 1 },
      { component: tree(active.root, terminal.columns, Math.max(1, terminal.rows - 6)), basis: 0, grow: 1, minSize: 1, visible: fits },
      { component: panels.get(active.focus)!.component, basis: 0, grow: 1, minSize: 1, visible: v => !fits(v) || soloEmptyHome },
      { component: footer, basis: 1 }, { component: help, basis: 1 }]);
    tui.setLayoutRoot(root); if (!overlay) focusEditor(); tui.requestRender();
  }
  tui.addInputListener(data => {
    if (isKeyRelease(data)) return { consume: true };
    if (matchesKey(data, "ctrl+d")) { options.onQuit?.(); return { consume: true }; }
    if (matchesKey(data, "ctrl+c")) { if (overlay) dismiss(); else controlMenu(); return { consume: true }; }
    if (overlay) return;
    for (let i = 0; i < actions.length; i++) if (matchesKey(data, (["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"] as const)[i]!)) { invoke(actions[i]![1]); return { consume: true }; }
    if (matchesKey(data, "alt+left") || matchesKey(data, "alt+right")) { controller.layout.nextFocus(matchesKey(data, "alt+left") ? -1 : 1); return { consume: true }; }
    if (matchesKey(data, "alt+up") || matchesKey(data, "alt+down")) {
      const splits = splitList(controller.layout.active.root).filter(s => paneList(s).some(p => p.id === focusId())); const split = splits.at(-1);
      if (split) controller.layout.resize(split.id, split.ratio + (matchesKey(data, "alt+up") ? -.05 : .05)); return { consume: true };
    }
    if (matchesKey(data, "alt+pageUp") || matchesKey(data, "alt+pageDown")) { panels.get(focusId())?.scroll.scrollBy(matchesKey(data, "alt+pageUp") ? -8 : 8); tui.requestRender(); return { consume: true }; }
  });
  controller.onChange = update; update();
  return { tui, terminal, update, editor: (id = focusId()) => panels.get(id)!.editor, getScreenLines: () => tui.getScreenLines(),
    start: () => tui.start(), stop: () => { stopped = true; overlay?.hide(); tui.stop(); terminal.start = originalStart; } };
}

export async function runAgentTerminal(options: { client: PidaClient; workspace: string; openWeb: () => Promise<void> } & WorkspaceControllerOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("TUI에는 대화형 터미널이 필요합니다.");
  const controller = new AgentWorkspaceController(options.client, { ...options,
    loadLayout: async scope => (await options.loadLayout?.(scope)) ?? terminalDefaultLayout(),
  });
  await controller.start();
  let finish!: () => void, stopped = false;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const close = () => { if (stopped) return; stopped = true; controller.close(); view.stop(); finish(); };
  let view: ReturnType<typeof createAgentTui>;
  try { view = createAgentTui(controller, { ...options, onQuit: close }); } catch (e) { controller.close(); throw e; }
  process.once("SIGINT", close); process.once("SIGTERM", close); process.stdin.once("end", close);
  try { view.start(); await done; }
  finally { close(); process.off("SIGINT", close); process.off("SIGTERM", close); process.stdin.off("end", close); }
  process.stdout.write("\nPida 멀티 TUI 연결을 닫았습니다. 서버와 에이전트 작업은 계속됩니다.\n");
}
