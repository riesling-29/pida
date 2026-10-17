// Deterministic integration demonstration. Only the model decisions are scripted.
// Usage: node scripts/workbench-demo.mjs /path/to/new-workspace
import { resolve, join } from "node:path";
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall as call } from "@earendil-works/pi-ai/providers/faux";
import { PidaRuntime, PidaWorkbench, workbenchPermissions, workbenchPrompt } from "../dist/index.js";
import { initWorkspace } from "../dist/workspace.js";
const directory = resolve(process.argv[2] ?? "./demo-workbench");
initWorkspace(directory); // Never overwrite another workspace.
const workbench = new PidaWorkbench(join(directory, ".pida/workbench"));
const principal = { id: "local-user", permissions: workbenchPermissions };
const request = (name, args) => answer(call(name, args), { stopReason: "toolUse" });
const render = `eval(pida.readText("total.js"));
const values = pida.input?.values ?? [120, 180, 240];
const sum = total(values);
pida.writeText("artifacts/dashboard.html", \`<!doctype html><html lang="ko"><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;background:#f1f5f3;color:#173b2c;padding:28px}h1{font-size:26px}.card{padding:24px;background:white;border-radius:16px}.number{font-size:52px;font-weight:700}.bar{background:#387958;color:white;padding:10px;margin:10px 0;border-radius:6px}small{color:#52675d}</style><small>PIDA · SCRIPTED INTEGRATION TEST</small><h1>매출 집계 대시보드</h1><div class="card"><small>합계</small><div class="number">\${sum}</div>\${values.map((v,i)=>\`<div class="bar" style="width:\${Math.max(10,v/Math.max(...values)*90)}%">\${i+1}월 · \${v}</div>\`).join('')}</div><p>Pi 파일 도구 + QuickJS 실행으로 생성한 정적 HTML</p></html>\`);
console.log("HTML created, total=" + sum);`;
const runtime = new PidaRuntime({
  tools: workbench.tools(), storageDir: join(directory, ".pida"), systemPrompt: workbenchPrompt,
  maxTurns: 24, maxToolCalls: 48,
  provider: () => {
    const f = fauxProvider();
    f.setResponses([
      request("workspace_write", { path: "total.js", content: "globalThis.total = values => values.reduce((a,b) => a-b, 0);" }),
      request("workspace_write", { path: "total.test.js", content: 'eval(pida.readText("total.js")); assert(total([120,180,240]) === 540, "Expected 540"); assert(total([]) === 0, "Empty total"); console.log("2 assertions passed");' }),
      request("workspace_test", { path: "total.test.js" }),
      request("workspace_edit", { path: "total.js", edits: [{ oldText: "a-b", newText: "a+b" }] }),
      request("workspace_test", { path: "total.test.js" }),
      request("workspace_write", { path: "render.js", content: render }),
      request("workspace_run", { path: "render.js" }),
      request("skill_save", { name: "sales-dashboard-v1", description: "Build a static dashboard from input.values", instructions: "Use skill_run with input.values containing finite positive numbers. The saved total.test.js checks the aggregation.", scriptPath: "render.js", testPath: "total.test.js" }),
      answer("[스크립트형 통합 테스트 · 실제 LLM 사용 아님] 합계 테스트의 실패를 확인하고 Pi edit로 수정한 뒤 2개 assertion을 통과했습니다. QuickJS로 artifacts/dashboard.html을 생성하고 sales-dashboard-v1 스킬을 저장했습니다. 작업 파일 패널에서 결과물을 열어보세요."),
    ]);
    return { provider: f.provider, modelId: f.getModel().id };
  },
});
try {
  const { sessionId } = await runtime.createSession(principal);
  const result = await runtime.run(sessionId, principal, "[통합 테스트] 대시보드 코드를 작성하고 실패한 테스트를 고친 뒤 스킬로 저장해줘.");
  if (result.status !== "completed" || !(await workbench.status(principal)).skills.length) throw new Error("Demonstration failed");
  console.log("PASS: scripted model → actual Pi tools → failed assertion → repair → passed tests → HTML → saved Pi skill. No real LLM used.");
} finally { await runtime.close(); }
