// Capture the real Pi renderer with explicit synthetic presentation data.
// This is visual layout evidence, not a live LLM or Windows screenshot.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { TuiController } from '../dist/tui-controller.js';
import { createTuiView } from '../dist/tui.js';

const output = process.argv[2];
if (!output) throw Error('Usage: node scripts/tui-view-capture.mjs OUTPUT_DIRECTORY');
class ScreenTerminal {
  columns = 112; rows = 36; kittyProtocolActive = false;
  start(input, resize) { this.input = input; this.resize = resize; }
  stop() {} async drainInput() {} write() {} moveBy() {} hideCursor() {} showCursor() {}
  clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {} setProgramStatus() {}
}
const terminal = new ScreenTerminal(), controller = new TuiController({});
const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', runId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
Object.assign(controller.state, {
  connected: true, notice: '레이아웃 검사용 예시 데이터 · 실제 모델 실행 아님',
  info: { provider: { model: 'fixture-model', mode: 'mock' }, tools: [{ name: 'project_read', permitted: true }, { name: 'project_edit', permitted: true }, { name: 'project_test', permitted: true }], capabilities: { instructions: { files: 1, scope: 'project-root' }, skills: 1 } },
  session: { sessionId, title: '설비 검색 필터 개선', running: true, activeRunId: runId, runs: 1, tools: [], autoCompaction: true, context: { percent: 24 }, messages: [
    { role: 'user', text: '설비 검색에 상태 필터를 추가해 주세요.\n기존 검색과 상태 변경을 유지하고 테스트 결과를 보여 주세요.' },
    { role: 'assistant', text: '기존 검색 함수와 상태 변경 경로를 확인했습니다.\n\n변경 범위\n• 검색 조건에 설비 상태를 함께 적용\n• 기존 이벤트 연결을 유지\n\n필터 동작 검사를 실행하고 있습니다.\n브라우저 동작은 아직 확인하지 않았습니다.' },
  ] },
  trace: [
    { sequence: 1, timestamp: '2026-11-04T09:00:00Z', sessionId, runId, type: 'run_started' },
    { sequence: 2, timestamp: '2026-11-04T09:00:03Z', sessionId, runId, type: 'tool_completed', toolName: 'project_read' },
    { sequence: 3, timestamp: '2026-11-04T09:00:06Z', sessionId, runId, type: 'tool_started', toolName: 'project_test' },
  ],
});
const clock = Date.now; Date.now = () => Date.parse('2026-11-04T09:00:07Z');
const view = createTuiView(controller, { terminal, workspace: 'D:/pida/my-agent', target: 'D:/pida/demo-project', color: true });
const captures = [];
async function capture(name) {
  await delay(35);
  const ansi = view.getScreenLines(), text = ansi.map(stripTerminalSequences);
  if (!text.every(l => visibleWidth(l) <= terminal.columns)) throw Error('WIDTH_OVERFLOW');
  captures.push({ name, columns: terminal.columns, rows: terminal.rows, ansi, text });
}
try {
  view.start(); await capture('wide-running');
  terminal.input('\x1bOP'); await capture('menu'); terminal.input('\x1b');
  terminal.columns = 64; terminal.rows = 24; terminal.resize(); await capture('narrow-running');
  terminal.input('\x1b[18~'); await capture('narrow-overview'); terminal.input('\x1b');
  terminal.columns = 112; terminal.rows = 36; terminal.resize();
  Object.assign(controller.state.session, { running: false, activeRunId: undefined, lastStatus: 'completed' });
  controller.state.trace.push({ sequence: 4, timestamp: '2026-11-04T09:00:08Z', sessionId, runId, type: 'run_finished' });
  controller.state.manifest = { session_id: sessionId, run_id: runId, verification_status: 'UNKNOWN', verification_results: [{ status: 'PASSED', current_at_run_end: true }] };
  controller.state.evidenceState = 'available'; controller.onChange(); await capture('wide-result');
} finally { view.stop(); controller.close(); Date.now = clock; }
await mkdir(resolve(output), { recursive: true });
await writeFile(resolve(output, 'screens.json'), JSON.stringify({ kind: 'real-pi-renderer/synthetic-presentation-data', captures }, null, 2) + '\n');
console.log(JSON.stringify({ captures: captures.length, output: resolve(output, 'screens.json') }));
