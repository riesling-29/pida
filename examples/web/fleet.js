import * as display from "/display.js";
import { AgentWorkspaceController, admissionLabels, viewLabels, detailText } from "/agent-workspace-controller.js";
import { paneList, fitsLayout } from "/workspace-layout.js";
const { executionStatusLabels: states, traceEventLabels } = display ?? { executionStatusLabels: {}, traceEventLabels: {}, formatClockKst: value => String(value ?? "") };

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const button = (label, action) => { const b = el("button", label); b.type = "button"; b.onclick = action; return b; };
const select = label => { const s = el("select"); s.setAttribute("aria-label", label); return s; };
function choices(node, items, selected) {
  const signature = JSON.stringify(items);
  if (node.dataset.options !== signature) { node.replaceChildren(...items.map(([value, label]) => { const o = el("option", label); o.value = value; return o; })); node.dataset.options = signature; }
  node.value = selected ?? "";
}

export function createFleet({ client }) {
  const root = document.getElementById("fleet-view");
  let controller, signature = "", tabSignature = "", dragging = false, generation = 0;
  const panels = new Map();
  const tabs = el("nav", undefined, "fleet-tabs"); tabs.setAttribute("aria-label", "작업 탭");
  const toolbar = el("div", undefined, "fleet-toolbar");
  const hint = el("p", "탭과 패널을 닫아도 서버 작업은 계속됩니다.", "fleet-hint");
  const warning = el("p", "", "fleet-warning"); warning.setAttribute("role", "status");
  const stage = el("div", undefined, "fleet-stage");
  const panelPicker = select("초점 패널"), swapPicker = select("패널 자리 바꾸기");
  const run = action => { try { const result = action(); if (result?.catch) result.catch(e => { warning.textContent = e.message; }); } catch (e) { warning.textContent = e.message; } };
  const current = () => controller.layout.active.focus;
  const splitH = button("좌우 분할", () => run(() => controller.layout.split(current(), "horizontal")));
  const splitV = button("상하 분할", () => run(() => controller.layout.split(current(), "vertical")));
  const zoom = button("패널 확대", () => controller.layout.zoom());
  toolbar.append(button("+ 탭", () => run(() => controller.layout.addTab())), splitH, splitV, zoom, panelPicker, swapPicker,
    button("패널 닫기", () => controller.layout.closePane(current())), button("에이전트 생성", () => createDialog.showModal()),
    button("관리 · 기억 · 복구", () => document.querySelector('[data-mode="agents"]').click()));
  panelPicker.onchange = () => controller.layout.focus(panelPicker.value);
  swapPicker.onchange = () => { if (swapPicker.value) controller.layout.swap(current(), swapPicker.value); };
  const createDialog = el("dialog"), createForm = el("form"), name = el("input"), role = el("textarea"), source = select("Persona 출처"), createError = el("p");
  name.required = true; name.maxLength = 100; name.setAttribute("aria-label", "에이전트 이름"); name.placeholder = "예: 코드 · 조사 · 운영";
  role.maxLength = 4000; role.setAttribute("aria-label", "역할"); role.placeholder = "에이전트 역할 (선택)";
  const createSubmit = el("button", "생성"); createSubmit.type = "submit";
  createForm.append(el("h2", "에이전트 생성"), el("label", "이름"), name, el("label", "역할"), role, el("label", "Persona 출처"), source, createError, createSubmit, button("닫기", () => createDialog.close())); createDialog.append(createForm);
  createForm.onsubmit = async e => {
    e.preventDefault(); const c = controller, g = generation, target = current(); createSubmit.disabled = true;
    try { const agent = await c.create({ name: name.value, role: role.value, personaSourceId: source.value });
      if (g !== generation) return;
      if (c.layout.allPanes().some(p => p.id === target)) c.bind(target, { agentId: agent.id, view: "chat" });
      name.value = role.value = createError.textContent = ""; createDialog.close();
    } catch (e) { if (g === generation) createError.textContent = e.message; }
    finally { createSubmit.disabled = false; }
  };
  root.replaceChildren(tabs, toolbar, hint, warning, stage, createDialog);
  function newPanel(p) {
    const box = el("section", undefined, "fleet-pane"); box.dataset.pane = p.id;
    const head = el("header"), agent = select("에이전트 선택"), view = select("패널 보기"), job = select("작업 선택");
    const status = el("p", "", "fleet-status"), transcript = el("pre", "", "fleet-transcript"); transcript.tabIndex = 0;
    const controls = el("div", undefined, "fleet-controls");
    const pause = button("대기열 정지", () => run(() => controller.pause(p.id, !controller.entry(p.id)?.profile.paused)));
    const cancel = button("이 작업 취소", () => run(() => controller.cancel(p.id)));
    const inspect = button("조회 / 새로고침", () => run(() => controller.inspect(p.id)));
    const files = select("에이전트 파일"); files.hidden = true; files.onchange = () => { if (files.value) run(() => controller.inspect(p.id, files.value)); };
    const receipt = el("p", "", "fleet-receipt"), form = el("form"), draft = el("textarea");
    draft.rows = 2; draft.maxLength = 12000; draft.setAttribute("aria-label", "이 패널의 작업 지시"); draft.placeholder = "이 에이전트에게 작업 지시 · Ctrl+Enter";
    const send = el("button", "새 작업 접수"); send.type = "submit";
    const steer = button("실행 중 추가 지시", () => run(() => controller.steer(p.id)));
    const check = button("접수 여부 확인", () => run(() => controller.checkDelivery(p.id)));
    const retry = button("같은 요청 재전송", () => run(() => controller.submit(p.id, true)));
    form.append(draft, send, steer, check, retry);
    form.onsubmit = e => { e.preventDefault(); run(() => controller.submit(p.id)); };
    draft.oninput = () => controller.setDraft(p.id, draft.value);
    draft.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (!send.disabled) run(() => controller.submit(p.id)); } };
    box.addEventListener("focusin", () => { if (current() !== p.id) controller.layout.focus(p.id); });
    head.onclick = () => { if (current() !== p.id) controller.layout.focus(p.id); };
    agent.onchange = () => controller.bind(p.id, { agentId: agent.value || undefined, view: view.value });
    view.onchange = () => controller.bind(p.id, { ...controller.layout.find(p.id).binding, view: view.value });
    job.onchange = () => controller.bind(p.id, { ...controller.layout.find(p.id).binding, jobId: job.value || undefined });
    head.append(agent, view, job); controls.append(pause, cancel, inspect, files);
    box.append(head, status, controls, transcript, receipt, form);
    return { box, agent, view, job, status, transcript, pause, cancel, inspect, files, receipt, draft, send, steer, check, retry };
  }
  function updatePanel(p, n) {
    const entry = controller.entry(p.id), job = controller.job(p.id), focused = current() === p.id, busy = controller.isBusy(p.id);
    n.box.classList.toggle("focused", focused);
    if (n.files.dataset.agent !== p.binding.agentId) { n.files.replaceChildren(); delete n.files.dataset.options; n.files.dataset.agent = p.binding.agentId ?? ""; }
    n.box.setAttribute("aria-label", `${entry?.profile.name ?? "미연결"} 패널`);
    choices(n.agent, [["", "에이전트 선택"], ...(controller.overview?.agents ?? []).map(a => [a.profile.id, a.profile.name])], p.binding.agentId);
    if (p.binding.agentId && !entry) choices(n.agent, [[p.binding.agentId, "접근 불가 · 다시 선택"], ...(controller.overview?.agents ?? []).map(a => [a.profile.id, a.profile.name])], p.binding.agentId);
    choices(n.view, Object.entries(viewLabels), p.binding.view);
    choices(n.job, [["", "최신 작업 따라가기"], ...(entry?.jobs ?? []).slice().reverse().map(j => [j.id, `${states[j.status]} · ${j.id.slice(0,8)}`])], p.binding.jobId);
    const age = job?.lastSignalAt ? Math.max(0, Math.floor((Date.now() - Date.parse(job.lastSignalAt)) / 1000)) : undefined;
    n.status.textContent = entry ? `${entry.profile.name} · ${entry.profile.personaSourceId ?? "호스트 기본"} · ${admissionLabels[entry.admission]}${job ? ` | ${states[job.status]} · ${job.currentTool ?? ""} · 작업 ${job.id.slice(0,8)}${age !== undefined && job.status === "running" ? ` · 마지막 신호 ${age}초 전` : ""}` : " · 작업 없음"}` : "에이전트를 선택하거나 생성하세요.";
    let text = "";
    if (p.binding.view === "chat") text = job ? `요청\n${job.input}\n\n응답\n${job.result?.text || job.latestText || "응답 대기 중"}` : "이 패널에서 지시한 작업과 응답을 표시합니다.";
    else if (p.binding.view === "activity") text = job?.activity.map(e => `${display?.formatClockKst?.(e.timestamp) ?? e.timestamp}  ${traceEventLabels[e.type] ?? e.type}${e.toolName ? " · " + e.toolName : ""}`).join("\n") || "관측된 실행 기록 없음 · KST";
    else text = detailText(controller.detail(p.id), p.binding.view) ?? `${viewLabels[p.binding.view]} · 조회 버튼을 누르세요.\n검증 완료는 실제 근거를 확인한 경우에만 표시합니다.`;
    if (n.transcript.textContent !== text) { const bottom = n.transcript.scrollHeight - n.transcript.scrollTop - n.transcript.clientHeight < 70; n.transcript.textContent = text; if (bottom) n.transcript.scrollTop = n.transcript.scrollHeight; }
    if (p.binding.view === "files") { try { const d = JSON.parse(controller.detail(p.id) ?? "null"); if (d?.files) choices(n.files, [["", "파일 내용 보기"], ...d.files.map(f => [f.path, f.path])], ""); } catch { /* Text/error content is not a file inventory. */ } }
    n.files.hidden = p.binding.view !== "files" || !n.files.options.length;
    n.receipt.textContent = controller.message(p.id);
    n.pause.textContent = entry?.profile.paused ? "대기열 재개" : "대기열 정지";
    n.pause.disabled = !entry || busy || !!entry.profile.needsReconciliation;
    n.cancel.disabled = !job || busy || !["running", "queued"].includes(job.status);
    n.inspect.hidden = ["chat", "activity"].includes(p.binding.view); n.inspect.disabled = !entry || busy;
    const draft = controller.draft(p.id); if (n.draft.value !== draft) n.draft.value = draft;
    n.draft.disabled = !entry; n.send.disabled = !entry || busy || controller.isUncertain(p.id);
    n.steer.disabled = busy || job?.status !== "running" || !job?.runId;
    n.check.hidden = n.retry.hidden = !controller.isUncertain(p.id); n.check.disabled = n.retry.disabled = busy;
  }
  function tree(node) {
    if (node.kind === "pane") return panels.get(node.id).box;
    const box = el("div", undefined, `fleet-split ${node.axis}`), divider = el("div", undefined, "fleet-divider");
    divider.tabIndex = 0; divider.setAttribute("role", "separator"); divider.setAttribute("aria-label", "패널 크기 조절");
    divider.setAttribute("aria-orientation", node.axis === "horizontal" ? "vertical" : "horizontal");
    divider.setAttribute("aria-valuemin", "20"); divider.setAttribute("aria-valuemax", "80"); divider.setAttribute("aria-valuenow", String(Math.round(node.ratio * 100)));
    const size = () => { box.style[node.axis === "horizontal" ? "gridTemplateColumns" : "gridTemplateRows"] = `${node.ratio}fr 6px ${1-node.ratio}fr`; };
    divider.onkeydown = e => { if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) { e.preventDefault(); controller.layout.resize(node.id, node.ratio + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -.05 : .05)); } };
    divider.onpointerdown = e => {
      e.preventDefault(); dragging = true;
      const move = e => { const r = box.getBoundingClientRect(); const value = node.axis === "horizontal" ? (e.clientX-r.left)/r.width : (e.clientY-r.top)/r.height; node.ratio = Math.max(.2, Math.min(.8,value)); size(); };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel",up); dragging = false; if (controller) run(() => controller.layout.resize(node.id,node.ratio)); };
      window.addEventListener("pointermove",move); window.addEventListener("pointerup",up,{once:true}); window.addEventListener("pointercancel",up,{once:true});
    };
    box.append(tree(node.first), divider, tree(node.second)); size(); return box;
  }
  // Focus/binding changes only update existing controls. Reattaching their pane
  // during focusin can cancel the browser's pending pointer click or text input.
  function shape(node) {
    return node.kind === "pane" ? [node.id] : [node.id, node.axis, node.ratio, shape(node.first), shape(node.second)];
  }
  function render() {
    if (!controller?.overview) return;
    const c = controller, active = document.activeElement, selection = active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : undefined;
    for (const p of c.layout.allPanes()) { if (!panels.has(p.id)) panels.set(p.id,newPanel(p)); updatePanel(p,panels.get(p.id)); }
    for (const id of panels.keys()) if (!c.layout.allPanes().some(p=>p.id===id)) panels.delete(id);
    const narrow = !fitsLayout(c.layout.active.root, stage.clientWidth, stage.clientHeight, 340, 245);
    const focusedOnly = c.layout.active.zoom || narrow;
    const next = JSON.stringify([c.layout.active.id, focusedOnly ? [current()] : shape(c.layout.active.root)]);
    const nextTabs = JSON.stringify(c.layout.data.tabs.map(t => [t.id, t.title, t.id === c.layout.active.id]));
    if (nextTabs !== tabSignature) {
      tabSignature = nextTabs;
      tabs.replaceChildren(...c.layout.data.tabs.map(t => { const group=el("span",undefined,"fleet-tab"); const b=button(t.title,()=>c.layout.selectTab(t.id)); b.setAttribute("aria-pressed",String(t.id===c.layout.active.id)); b.ondblclick=()=>{const name=window.prompt("탭 이름",t.title);if(name!==null)c.layout.renameTab(t.id,name);}; const close=button("×",()=>c.layout.closeTab(t.id));close.setAttribute("aria-label",`${t.title} 탭 닫기 · 작업 유지`);group.append(b,close);return group;}));
    }
    if (next !== signature && !dragging) {
      signature = next;
      stage.replaceChildren(focusedOnly ? panels.get(current()).box : tree(c.layout.active.root));
      if (active?.isConnected) { active.focus({preventScroll:true}); if (selection) active.setSelectionRange(...selection); }
    }
    choices(panelPicker,c.layout.panes.map((p,i)=>[p.id,`${i+1} · ${c.entry(p.id)?.profile.name ?? "미연결"} · ${viewLabels[p.binding.view]}`]),current());
    choices(swapPicker,[["","자리 바꾸기"],...c.layout.data.tabs.flatMap(t=>paneList(t.root).filter(p=>p.id!==current()).map((p,i)=>[p.id,`${t.title} / ${c.entry(p.id)?.profile.name ?? "미연결"} ${i+1}`]))],"");
    choices(source,c.overview.personaSources.sources.map(s=>[s.id,s.label]),source.value || c.overview.personaSources.defaultSourceId);
    splitH.disabled = splitV.disabled = c.layout.panes.length >= 4;
    toolbar.firstChild.disabled = c.layout.data.tabs.length >= 8;
    zoom.textContent = c.layout.active.zoom ? "분할로 복귀" : "패널 확대";
    hint.textContent = `${narrow && c.layout.panes.length>1 ? "좁은 화면 · 초점 패널만 표시. 배치는 유지됩니다. " : ""}최대 8탭 · 탭당 4패널 | 패널 닫기는 실행을 취소하지 않습니다. | 배치 저장 · 미전송 지시는 이 창에만 유지`;
    warning.textContent = c.error || c.storageError;
  }
  const resize = new ResizeObserver(() => render()); resize.observe(stage);
  root.addEventListener("keydown",e=>{ if (!controller) return; if(e.altKey && e.key==="z"){e.preventDefault();controller.layout.zoom();} if(e.altKey && e.key==="]"){e.preventDefault();controller.layout.nextFocus();panels.get(current())?.draft.focus();} });
  return {
    async connect() {
      controller?.close(); panels.clear(); signature=tabSignature=""; ++generation;
      controller = new AgentWorkspaceController(client, {loadLayout:scope=>localStorage.getItem(`pida-fleet:${scope}`) ?? undefined,saveLayout:(scope,json)=>localStorage.setItem(`pida-fleet:${scope}`,json)});
      controller.onChange = render;
      try { await controller.start(); render(); } catch(e) { warning.textContent=e.message; throw e; }
    },
    reset() { ++generation; controller?.close(); controller=undefined; panels.clear(); stage.replaceChildren(); tabs.replaceChildren(); signature=tabSignature=""; createDialog.close(); name.value=role.value=createError.textContent=""; },
  };
}
