# DeepSeek Harness 소스 분석과 Pida 0.8.x 적용 계획

분석일: 2026-11-02. 상태: **읽기 전용 소스 분석 및 구현 제안**.

이 문서는 DeepSeek이나 Pida의 새 기능을 구현했다는 보고가 아니다. 공식 저장소의 고정 커밋, 핵심 구현, 관련 시험 코드를 읽고 Pida 0.8.0과 비교했다. DeepSeek 설치·테스트 실행, 실제 모델 호출, Windows 실행, 사내 게이트웨이 검증은 이번 분석에 포함하지 않았다.

## 1. 결론

DeepSeek Harness는 Pida가 지향하는 **범용 core + 조립 가능한 개인/코딩 하네스**에 직접 참고할 가치가 높다. 가장 유용한 자산은 프롬프트 자체보다 확장 구성과 해제, 모델별 요청 호환성, 프로세스 수명, 작업 출력, 도구 조합, 재접속 가능한 실행 화면을 연결한 구현이다.

Pida의 Pi 실행 루프·세션·기억을 대체할 이유는 아직 확인되지 않았다. 다음 세 경로를 구분한다.

1. 독립성이 높은 작은 코드와 회귀 사례는 출처를 보존해 직접 가져온다.
2. Pida에 이미 들어온 Pi MCP·Codemode 기능을 실제 제품에 연결한다.
3. PTY·격리·외부 코딩 하네스처럼 결합이 큰 기능은 기존 실행기를 어댑터로 연결한다.

“설계만 참고하고 빈 인터페이스를 만든다”를 완료로 간주하지 않는다. 각 패치의 종료 기준은 실제 사용자 동작과 실패·취소·재시작 시험이다. 반대로 DSH 전체를 종속성 하나로 넣으면 Pida 기능이 자동 완성된다고 보지도 않는다.

## 2. 조사 기준선

| 대상 | 확인한 기준 | 의미 |
| --- | --- | --- |
| Pida | 0.8.0, 로컬 fix/runtime-stabilization, 1638064a7fe8ca23332c5670363fe40ef6eae678 | 현재 구현 비교 기준. 조사 시작 시 working tree clean |
| Pida Pi | @earendil-works/pi-ai 및 pi-coding-agent 1.2.0 | Pi 패키지는 정확한 버전으로 고정 |
| Pida Node | package engines >=22.19.0 | DSH의 Node 요구와 다름 |
| DeepSeek Harness | master, ce7073d51254c26cd63b22a60835b8f948deb447 | 커밋 시각 2026-10-29 16:13:15 UTC |
| DSH root package | 0.2.2-alpha.2, Node >=24.9.0, pnpm 11.28.5, MIT | 개발자 프리뷰. 운영 검증·안정 API 보장 아님 |
| DSH Pi bridge | pi-ai ^1.3.0 의존 | Pida의 1.2.0과 자동 호환을 가정하지 않음 |
| 별도 Superagent prototype | 6337fc823ce20251c8de8085948165c81aaa701e | 2026-10-31 초기 커밋, 0.1.0/private/MIT |
| Prototype 의존 | DSH ^0.2.1-alpha.2 | 위 main HEAD와 검증된 조합이라고 주장하지 않음 |

공식 저장소:
- [DeepSeek Harness 고정 트리](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447)
- [Superagent prototype 고정 트리](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e)

SAFETY.md는 개발자 프리뷰이며 보안 감사를 받지 않았다고 명시한다. 이번에 확인한 BENCHMARK.md는 벤치마크 실행 방법 중심이며, 이것만으로 다른 하네스보다 코딩 성능이 높다고 판단할 수 없다.

## 3. Pida와 맞닿는 설계

| DeepSeek에서 확인한 구현 | Pida에 주는 의미 | 현재 Pida를 과소·과대평가하지 않을 기준 |
| --- | --- | --- |
| Cordis 기반 Service Definition / Provider / Consumer, profile/bundle 합성 | core가 코딩·UI·특정 모델에 종속되지 않도록 조립 | Pida도 임베딩/ProviderFactory가 있으나 main과 persistent agent 구성 코드가 중복됨 |
| scope 소유 등록·해제와 부분 시작 실패 정리 | 에이전트마다 도구 상태를 분리하고 확장을 확실히 종료 | 별도 runtime은 있지만 상태를 가진 tool 객체는 공유될 수 있음 |
| prepared call, 명시적 모델 capability, native replay metadata | 모델·API 변경에도 요청 설정과 이력의 일관성 확보 | Pida는 Pi 세션을 이미 사용함. 이력 손상이 확인된 것은 아니며 호환성 증명이 부족 |
| transient stream와 settled session event 분리 | 새로고침·실패·재시도에도 실제 진행 상태 표시 | 관측·trace·persistent job이 이미 있으므로 새 이벤트 엔진은 불필요 |
| filesystem/subprocess 실행 제공자 분리 | 로컬/격리/원격 실행기를 교체 가능 | 현재 program proxy와 project shell은 OS sandbox가 아님 |
| MCP 연결 supervisor와 generation 교체 | 서버 장애·도구 변경에도 재시작 없이 복구 | pi-mcp는 설치 트리에 있지만 Pida 관리 기능으로 연결되지 않음 |
| tool introspection + programmatic tool calling | 허용된 도구를 찾아 짧은 프로그램으로 조합 | 저장소 scan/manifest draft/host enable은 구현돼 있음. 조합 실행은 별도 기능 |
| Codex·Claude Code·ACP 등의 subagent provider | 좋은 외부 하네스를 독립 실행자로 교체 사용 | 현재 Pida persistent agent는 Pi 기반. 외부 하네스 연동은 미구현 |
| Goal, Schedule, 별도 proactive prototype | 필요할 때 깨우는 persistent agent로 발전 | 현재 durable job queue는 달력 예약이나 메시징 채널이 아님 |

## 4. 우선 패치: 이미 있는 기능을 실사용 가능하게 다듬기

### DS08-01 — 추가 지시·작업 진행·사용자 질문을 같은 화면 계약으로 연결

**현재:** src/runtime.ts의 steer/followUp과 expectedRunId, pendingInput은 구현돼 있다. 상주 에이전트 화면은 일부 사용하지만 일반 작업 공간과 Studio는 실행 중 입력을 막는다. 세 화면이 진행·폴링을 따로 처리한다.

**변경 제안:**
- 기존 추가 지시/다음 요청 API를 일반 화면과 Studio에 연결한다. 접수 영수증과 대기 상태를 표시하고 거절 시 입력을 보존한다.
- 공통 run-state projection을 두고 run ID, attempt ID, sequence로 중복·지연 갱신을 걸러낸다.
- trace 조회에 afterSequence, earliestSequence, nextSequence, truncated를 추가한다. 누락 시 authoritative snapshot으로 재동기화한다.
- 도구 이름뿐 아니라 실제 명령 요약·종료 코드·결과 일부·변경 파일·검증 근거를 접어서 표시한다. 원문은 권한 있는 상세 조회에서만 반환한다.
- 별도 작은 후속 패치로 ask_user와 pendingInteractions를 연결한다. 사용자 질문과 권한 승인은 별도이며, 이미 허용된 호출마다 승인을 새로 요구하지 않는다.

**수용 조건:** 도구 실행 중 새로고침, 중복/누락 이벤트, 이전 run의 늦은 응답, 취소 직후 입력, 응답 거절 시 초안 보존. 모델이 성공을 말해도 실제 exit code가 실패면 실패로 표시. 질문은 다른 사용자/run 응답·늦은 답을 거부.

**예상 수정:** src/runtime.ts, src/http.ts, src/client.ts, examples/web/app.js, studio.js, agents.js 및 새 공통 UI 상태 모듈.

**근거:** [연결 세대 관리](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/client/connection/src/client/connection.ts), [stream 병합](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/api/session-controller/src/client/sessions/assistant-stream.ts), [terminal 표시 모델](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts), [질문 서비스](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/interaction/user-questions/src/index.ts).

### DS08-02 — 모델 capability·추론 설정·실제 요청·캐시 계측

**현재:** endpoint model에는 reasoning:false, runtime에는 thinkingLevel:off가 고정돼 있다. 관측에는 총 토큰 중심 정보가 있으며 cache read/write, 첫 토큰까지 시간, prefix 변경 근거가 없다. Provider generation으로 idle agent 갱신은 이미 구현했으므로 같은 결함을 다시 고친다고 설명하지 않는다.

**변경 제안:**
- Pi가 지원하는 모델/API capability와 reasoning 설정을 host config로 명시한다. 미지원 조합은 실행 전에 거절한다.
- 한 model attempt에 실제 바인딩된 route, model, reasoning, limits, provider generation의 비밀값 없는 식별자를 기록한다.
- input/output/cache usage는 공급자가 보고한 범위만 기록하며 누락은 unknown으로 둔다. retries도 attempt별로 합산한다.
- 시스템·도구 정의의 순서를 안정화한다. 캐시 진단용 fingerprint는 비밀키를 포함하지 않으며 필요하면 배포별 keyed digest를 사용한다.
- tool turn→저장/재시작→후속 turn, A→B→A API 전환, 병렬 tool call·reasoning signature의 public-behavior fixture를 추가한다.

**프로토콜 구분:** 현재 DSH native DeepSeek adapter는 /messages와 native thinking/signature 형식이다. 별도 Pi bridge의 Chat Completions 경로와 다르다. native in-history system/tool update를 회사 Chat Completions 게이트웨이에 그대로 보내면 안 된다. LightLLM, LiteLLM, 회사 private connector를 서로 구별한다.

**수용 조건:** unsupported reasoning 거절, 한 attempt 설정 혼합 없음, raw credential/prompt 미노출, usage 누락/모순 처리, A→B→A 후 외부 native metadata 유출 없음. 회사 KV-cache 문제는 반복 요청/한 요소 변경 요청의 TTFT·서버 보고값으로 진단하며 “토글 하나로 해결”했다고 주장하지 않는다.

**예상 수정:** src/providers.ts, runtime.ts, observation.ts, provider-connector.ts, 설정·상태 화면, test/provider.test.mjs 및 새 wire fixture.

**근거:** [prepared call](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm/src/index.ts), [native adapter](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm-deepseek/src/adapter.ts), [protocol roundtrip 시험](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm-pi-ai/tests/protocol-roundtrip.spec.ts), [usage 합산](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/token-meter/src/turn-usage.ts).

### DS08-03 — 제한된 오류 회복과 맥락 출처

**현재:** 숨은 SDK retry는 비활성화돼 있고, httpIdleTimeoutMs와 전체 runMs가 같다. Pi compaction과 unknown effect 차단은 이미 있다. pida-run-context는 저장하지만 persona revision·information-state head·선택한 경험 revision의 묶음을 별도로 식별하지 않는다.

**변경 제안:**
- 스트림 무응답 timeout과 전체 실행 deadline을 분리한다.
- retry 소유자를 하나로 두고 오류 유형, 횟수·시간 예산, 취소 가능한 backoff, attempt 사건을 제공한다. 외부 tool effect를 중복 실행할 수 있는 전체 작업 재시도는 하지 않는다.
- context overflow는 실제 저장된 compaction 진행이 확인된 경우만 별도 예산 안에서 재시도한다. no-progress면 중단한다.
- context 문자열과 같은 snapshot에서 persona revision, memory head, experience refs, renderer version의 descriptor를 만든다.
- handoff에 source session/run, 전달 방식, filesRestored:false를 드러낸다. 저장 형식 변경 시 Pida 소유 metadata만 원본 보존 방식으로 이동하고 Pi transcript는 Pi에 맡긴다.

**수용 조건:** stalled SSE, abort 무시, partial EOF, retry 소진, 취소 우선, tool effect 중복 없음. compaction의 tool-call/result 짝과 restart 연속성 유지. 실행 중 기억 수정 시 현재 run attribution은 바뀌지 않고 다음 run부터 적용. future metadata version은 원본을 바꾸지 않고 거절.

**예상 수정:** src/runtime.ts, observation.ts, agent-memory.ts, workspace.ts, 복구·지속성 시험.

**근거:** [retry 구현](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm-retry/src/index.ts), [transport 회복 시험](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/llm/llm-retry/tests/transport-recovery.spec.ts), [overflow guard](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/compaction/compaction-basic/src/index.ts), [request 재구성 시험](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/agent-loop/tests/request-reconstruction.spec.ts).

## 5. core의 확장성을 완성하는 패치

### DS08-04 — 공통 구성·에이전트별 확장 수명·실제 적용 상태

**현재:** workspace.ts가 main/agent 도구·지침 구성을 중복 조립한다. 승인 모듈은 BusinessTool을 import하지만 별도 disposer 계약이 없다. 같은 tool 객체 배열을 여러 runtime에 넘길 수 있다.

**변경 제안:**
- host-owned composition 결과를 main/persistent/headless가 공유한다.
- coding/personal/headless preset에 실제 model/tool/권한/프로젝트/검증기와 구성 출처·revision을 둔다. 기존 설정은 호환 유지한다.
- workspace/agent 수명을 명시하고 agent-scoped 도구는 factory로 생성한다.
- extension activation handle에 tools와 close를 두고 시작 실패는 역순 정리한다. 반복 close는 같은 Promise를 기다린다.
- configured/active/restart-required/failed를 분리한다. 초기 적용은 idle 재생성 경계로 제한한다.

**수용 조건:** 같은 preset의 SDK/main/agent 기능 일치, sibling agent 상태 분리, 부분 시작 실패 cleanup, close 경합, 이전 listener 잔존 없음, 실행 중 구성 교체 거절 또는 다음 적용 표시.

**재사용:** scope/store의 작은 등록·undo 유틸과 시험은 좁게 vendor할 후보. dsh-scope 자체는 Cordis peer를 필요로 한다. app-boot/plugin-manager 전체 도입에는 loader·profile·pnpm·서비스 구조가 따라온다. PluginManager의 changed/application 구분은 좋지만 전체 설치·업데이트가 원자적 rollback인 것은 아니다.

**근거:** [profile 합성](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/boot/app-boot/src/profile.ts), [scope 저장소](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/scope/src/store.ts), [생성·종료 수명](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/agent-loop/src/index.ts), [plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/boot/plugin-manager/src/index.ts).

### DS08-05 — MCP를 설치 가능한 기능으로 연결하고 실제 API를 조회

**현재:** 로컬 pi-mcp 1.2.0은 stdio/Streamable HTTP, 취소·progress·OAuth 등을 제공하지만 Pida 소스에서 관리 계층을 사용하지 않는다. 프로그램 scan/draft/enable은 구현돼 있다.

**변경 제안:**
- pi-mcp를 재사용하고 server별 connection generation, 제한된 backoff, ready/disconnected/failed 상태, tool inventory를 관리한다.
- namespace와 raw tool name 매핑은 안정적으로 보존한다. 정규화 충돌을 탐지한다.
- discovery 성공 후 한 세대의 도구를 교체하고 이전 transport의 종료를 기다린다. fetch 실패와 registration 충돌은 다르게 처리한다.
- 연결 재시도와 외부 tool call 재시도를 구분한다. 결과 불명인 쓰기 호출은 자동 반복하지 않는다.
- Pida catalog에 available/configured/active/permitted/adapter-required와 정확한 입력·출력·설정 schema를 표시한다.
- 에이전트는 읽기 전용 inspect로 API를 확인하고 manifest/adapter 초안을 만들 수 있다. 발견만으로 설치·권한·호환성이 자동 확보되지는 않는다.

**수용 조건:** stdio 서버 crash/reconnect, 짧은 성공을 반복하는 crash loop도 최종 상한 도달, 종료 중 reconnect 금지, 오래된 generation 응답 배제, 같은 도구 이름 충돌, schema 변경, 권한 차단, 민감값 미노출. 최소 MCP 서버 하나를 실제로 추가→호출→중단→복구→제거.

**예상 수정:** 새 MCP extension/manager, src/workspace.ts, program-catalog.ts, program-registry.ts, HTTP/client·설정 UI.

**근거:** [MCP supervisor](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/mcp/mcp-client/src/connection.ts), [도구 세대 교체](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/mcp/mcp-client/src/tools.ts), [runtime API inspect](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/extensions/tool-cordis/README.md).

### DS08-06 — 허용 도구를 짧은 프로그램으로 조합

현재 프로그램 프록시는 승인한 실행 파일을 도구로 만든다. PTC(programmatic tool calling)는 그 위에서 모델이 작성한 짧은 코드로 여러 도구를 반복·병렬·조건부 호출하는 기능이다. 기존 QuickJS JavaScript 구문 검사와도 다르다.

**변경 제안:**
- 이미 설치된 pi-codemode 1.2.0의 CodemodeSandbox를 재사용한다. 처음에는 요청마다 독립된 제한 JS 실행으로 제공한다.
- 현재 agent에게 허용된 도구 선언만 노출하며 program proxy·MCP 도구도 같은 방식으로 포함한다.
- 내부 호출은 기존 guarded dispatch를 반드시 통과한다. BusinessTool.execute 직접 연결로 권한·입력 검증·effect receipt·관측을 우회하면 안 된다.
- root/parent/sub-call ID, 호출 수·시간·메모리·출력 한도, 읽기 병렬/쓰기 직렬을 강제한다. 자기 자신 호출은 제외한다.
- 전체 스크립트를 자동 retry하지 않는다. 일부 쓰기 이후 실패는 개별 effect 상태로 처리한다.

**수용 조건:** 미허용 도구·잘못된 인자 거절, 무한 루프 중단, 외부 호출 취소, 쓰기 장벽 유지, 부분 변경 후 실패 복구, source tool 교체 후 stale binding 거절, 자동 재귀 금지.

**재사용 판단:** DSH tool-executor-ptc의 guarded dispatch·scheduler 시험 사례를 가져오되, DSH Node evaluator를 복제할 필요는 없다. DSH Node backend는 Node import/fs/process 사용이 가능한 별도 프로세스이며 접근 제한은 OS sandbox에 의존한다. Pi Codemode의 주입 도구만 사용하는 QuickJS 경계가 현재 Pida에는 더 작은 의존성이다. JS 격리가 주입 도구의 외부 부작용까지 격리하는 것은 아니다.

**근거:** [PTC dispatch와 scheduler](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/tool-executor-ptc/src/ptc.ts), [PTC 경합·권한 시험](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/core/tool-executor-ptc/tests/ptc.spec.ts), [Node evaluator](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/ptc-runtime/ptc-runtime-node/src/evaluators/async-function.ts). Pi 재사용 판단은 로컬 설치본 README/manifest를 확인한 결과이며 아직 Pida 연결 검증은 하지 않았다.

## 6. 일반 코딩 하네스로 쓰기 위한 실행 패치

### DS08-07 — 큰 출력 보존, 명령 handle, 취소의 실제 완료

**현재:** program-proxy.ts는 합계 출력 128KiB를 넘으면 프로세스를 종료한다. 직접 자식에 SIGKILL을 보내고 파이프를 정리하지만 자손 전체 종료를 보장하지 않는다. project_shell은 foreground만 지원한다. AgentSupervisor job과 OS command job은 별개다.

**단계별 변경:**
1. 텍스트 출력은 제한된 tail + 비공개 spill artifact로 바꾼다. 메모리·디스크 한도와 유효성·truncated/lossy를 명시한다. JSON 출력은 잘린 값을 성공으로 만들지 않는다.
2. start/read/wait/cancel의 command handle을 제공한다. waitTimeout과 executionDeadline을 분리한다. UI 읽기는 모델의 출력 커서를 소비하지 않는다.
3. ProcessExecutor에 directExited, rangeExited, outputDrained, containment를 구분한다. 취소 요청과 실제 종료를 별도 표시하며 stopping도 동시성 한도를 차지한다.

**수용 조건:** 128KiB 이상 실제 빌드에서 종료 코드와 마지막 오류 보존, UTF-8 경계, spill 쓰기 실패·용량 초과 시 거짓 파일 참조 없음. 동일 jobId로 새로고침 후 조회, 소유자 접근 차단, 서버 crash 후 interrupted/unknown. 부모 먼저 종료·파이프를 붙잡은 자손·정상 종료/취소 경합의 실제 명령 시험.

**직접 코드 재사용 후보:** DSH OutputCollector는 Node 기본 모듈과 type-only 의존 중심이므로 가장 먼저 검토할 작은 vendor/fork 단위다. 전체 subprocess-local은 Cordis, koffi, node-pty, native helper가 따라오므로 drop-in으로 취급하지 않는다.

**근거:** [OutputCollector](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/subprocess/subprocess-local/src/output.ts), [managed process](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/subprocess/subprocess-local/src/spawn.ts), [jobs](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/jobs/jobs-local/src/index.ts), [native containment 시험](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/subprocess/subprocess-local/tests/native-containment.spec.ts).

### DS08-08 — 기존 실행기 재사용으로 PTY·격리 연결

**변경 제안:** 한 개의 선택된 upstream executor에 PTY와 격리를 맡기는 어댑터를 연결한다. DSH 실행 제공자를 채택하려면 관련 서비스 구성까지, Codex 실행기를 채택하려면 그 공식 프로토콜까지 실제로 검증한다. 이번 분석으로 executor 선정을 확정한 것은 아니다.

**필수 계약:**
- PTY send 소유권, 현재 foreground interrupt, 늦은 출력/신호를 구분한다.
- filesystemPolicy, networkPolicy, processContainment, backend, enforcement를 별도 capability로 표시한다.
- 요청한 격리를 제공하지 못하면 실행 전에 거절한다. 단순 sandbox:true로 모든 보장을 묶지 않는다.
- 실제 사용 대상 Windows를 우선 수용 환경에 포함한다.

**한계:** DSH Windows 일반 프로세스 Job Object와 ConPTY 보장은 같지 않다. ConPTY는 Job containment 밖이라는 경고가 있다. Windows ACL backend는 읽기 비격리·hard-link 한계 때문에 partial이다. Linux는 bwrap/Landlock 후보를 probe하지만 모든 OS가 같은 탐색을 수행하는 것은 아니다. DSH jobs registry는 process-local이며 재시작 후 OS 명령 복원을 보장하지 않는다.

**수용 조건:** 실제 REPL 입출력, Ctrl-C 후 후속 명령, 중복 send, 늦은 prompt 경합. 지원 backend의 workspace 외부 쓰기 차단·내부 허용, backend 부재 시 미실행. 네트워크·읽기 제한은 각각 별도 검증.

**근거:** [PTY session](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/terminal/terminal-bash/src/session.ts), [sandbox backend](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/sandbox/sandbox-local/src/index.ts), [플랫폼 containment](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/subprocess/subprocess-local/src/index.ts).

## 7. 선택적 확장 후보

### DS08-09 — 외부 코딩 하네스를 같은 실행 화면에 연결

DeepSeek에는 Codex app-server, Claude Code, ACP 등의 subagent provider가 실제로 존재한다. 확인한 Codex provider는 호출마다 공식 wrapper의 app-server --stdio를 실행하고 ephemeral thread 생성 이후에만 child를 공개한다. 이것을 Codex 세션 전체의 영속 복원이라고 설명하면 안 된다.

**제안:** 선택적 RunnerBackend 계약에 Pi를 기본으로 두고 외부 하네스 하나를 먼저 연결한다. run마다 실행 루프 소유자는 하나다. capabilities, start/cancel/status/result, 관측 가능한 child task/tool/effect 범위, 오류·취소·정리 상태를 매핑한다. 외부 backend의 모델/인증/permission 체계는 그대로 존중한다. Pida 회사 connector가 다른 하네스에서도 자동 사용된다고 가정하지 않는다.

**수용 조건:** 실제 저장소 파일 수정→검사→결과, 취소→관리 프로세스 종료, 오류 상태 및 검증 근거 매핑. 관측 못 한 하위 동작은 unknown으로 남긴다. 기존 Pi 실행과 비교해 사용자 개입·시간·비용·완료 품질을 기록한 뒤 채택 여부를 결정한다.

이 작업은 Codex를 실행기 의존성으로 사용할 수 있으므로 “Codex 의존성까지 제거했다”는 뜻의 대체는 아니다. Pida 사용자 화면에서 여러 엔진을 선택·교체하는 경로다.

**근거:** [Codex child lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/subagent/subagent-codex/src/run.ts), [subagent 패키지 구성](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447/packages/subagent).

### DS08-10 — 예약·입력 영수증·지속 목표는 기존 supervisor 위 확장

**main Harness:** Goal은 session별 목표 revision을 보존하고 생성/복원 시 disarmed로 돌아간다. Schedule은 기존/재사용/새 session 대상을 구분한다. 전달 receipt는 작업 완료가 아니며, 전달과 저장 사이 crash는 중복 가능하다. Host가 실행 중이어야 전달하며 반복 일정의 누락 회차 처리 정책도 명시돼 있다.

**별도 prototype:** GitHub/선택적 Feishu 입력→권한 정책 평가→Ticket/Mandate→Assignment→DSH session 실행 구조다. 단일 저장소용 연구 코드이며 official product/production-ready가 아니라고 명시한다. MemoryRepositories는 repository fake로, persona/장기 기억 시스템이 아니다. cookbook의 가상 webhook 명령을 구현된 서비스로 계산하지 않는다.

**Pida 적용 순서:**
1. 현재 durable job와 durable:false인 Pi steering을 UI에서 명확히 구분한다. stable input receipt와 상태를 먼저 제공한다.
2. Pi의 consumed-message identity/flush 경계가 입증되기 전에는 crash 후 steering을 자동 재전송하지 않는다. JSON 영수증 저장만으로 exactly-once가 되지 않는다.
3. schedule extension은 기존 enqueue(requestId)를 사용하고 scheduleId+occurrence로 dedup한다. 누락 회차 정책, timezone, 일시정지, 재시작을 명시한다.
4. 필요할 때만 명시적으로 armed된 목표의 후속 실행을 허용한다. round 수와 시간·토큰·비용 예산은 별개로 관리한다.
5. 실제 사용하는 외부 채널 하나를 선택하면 수신·외부 응답을 별도 receipt/outbox로 연결한다. 전송별 idempotency를 검증하며 모든 외부 변경에 generic retry를 씌우지 않는다.

프로토타입에서 함께 가져올 작은 운영 계약도 있다. waitingFor를 workspace/child/provider/user/reconciliation으로 구별하고, 자식 완료는 부모에게 한 번만 전달하되 부모가 취소·복구 대기 중이면 결과만 보관한다. 내부 후속 작업에는 generation을 두어 이전 handler가 늦게 끝나도 새 예약을 지우지 못하게 한다. 상태 변경과 필요한 후속 예약의 저장 경계도 함께 검증한다. 현재 shared workspace single-writer와 EffectLedger는 유지하며, 결과 불명인 외부 변경을 이 큐로 자동 재실행하지 않는다. 프로토타입 Effects의 backoff에는 지연 상한만 있고 시도 횟수 상한은 없으므로 그 정책을 그대로 옮기지 않는다.

근거: [입력 delivery](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/delivery.ts), [효과 generation](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts), [outbox](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts), [retry health](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/retry-health.ts).

**기억 경계:** Goal active/paused/complete는 작업 제어 상태다. Pida의 이해·불확실성·관계·다음 행동을 잇는 information-state와 다르다. 장기 목표나 예약 전달 완료로 persona/경험을 자동 사실화하지 않는다. Schumpeter의 조직 Mission Loop를 Pida에 구현하는 작업도 아니다.

**수용 조건:** 동일 occurrence 중복 수신 시 job 하나, 재시작 후 자동 외부변경 중복 없음, 잘못된 입력 출처 거절, steering 유실을 lost/unknown 표시, 목표 복원 후 자동 무제한 실행 없음. 외부 채널 전송이 이미 발생했는데 응답을 잃은 경우 해당 서비스의 조회/receipt로 reconciliation.

**근거:** [goal](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/goal/goal/src/index.ts), [round driver](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/goal/goal-round-driver/src/index.ts), [schedule runtime](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/schedule/schedule/src/runtime.ts), [별도 prototype](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e).

## 8. 이식 방식과 유지보수

| 대상 | 권고 방식 | 가져와야 완료인 부분 |
| --- | --- | --- |
| OutputCollector 등 작은 순수 구현 | 고정 소스 vendor/fork + 얇은 타입 조정 | 출력 오류 회복·한도·시험·원본 notice |
| replay/compaction/reconnect 경합 사례 | Pida 공개 API 회귀 fixture로 적용 | 실제 Pi 결과와 상태를 검증 |
| MCP/제한 JS 조합 | 설치된 pi-mcp/pi-codemode를 먼저 연결 | 설정·권한·호출·상태·취소·재시작 화면 |
| profile/lifecycle | 작은 Pida host 경계 + 필요한 유틸만 차용 | main/agent 일치, scope 격리, close·실패 cleanup |
| PTY/sandbox/process containment | 기존 실행기 어댑터 | 실제 대상 OS의 프로세스·격리 수용 시험 |
| Codex/Claude/DSH 전체 실행 | 공식 SDK/ACP/app-server 등 외부 backend | 한 실행 소유자, 오류·결과·검증·취소 매핑 |
| Cordis plugin manager 전체 | 현재 즉시 도입 보류 | 도입할 경우 Node·로더·패키지 관리·수명 체계까지 책임져야 함 |

소스 도입 시 파일별 license/third-party 조건, origin path, commit, local diff를 기록한다. 루트 MIT만 보고 포함된 모든 native/vendor 파일의 조건이 같다고 추정하지 않는다.

Upstream 반영은 **버전/커밋 고정→업데이트 후보→계약 시험→대표 실사용→채택/되돌리기**로 한다. 포크가 자동 충돌 해결이나 API 호환성을 보장하지는 않는다. 후보 수집과 검증을 자동화하되 검증하지 않은 런타임 업데이트를 자동 배포하지 않는다.

DSH의 전체 base bundle을 회사용 기본 구성으로 그대로 가져오지 않는다. 공식 문서상 DeepSeek session-log contributor가 default-on이며 별도 OTel 경로도 feedback 시 저장된 context를 포함한 session prefix를 전송한다. 두 경로를 구분해야 한다. Pida의 원문 기본 비수집 정책과 회사 private connector를 유지하고, 필요한 실행 구성요소만 선택한다.

## 9. 권장 릴리스 묶음과 실제 종료 기준

아래 버전은 제안이다. 기능마다 버전을 올리지 않고 충분히 묶어 세 자리 버전으로 배포한다. 기존 공개 API를 깨는 변경이 필요하면 호환 경로를 먼저 마련하거나 다음 minor로 분리한다.

| 제안 | 우선 범위 | 사용자가 확인할 결과 |
| --- | --- | --- |
| 0.8.1 | DS08-01의 기존 steering 연결·진행 상세, DS08-02, DS08-07의 출력 보존 | 작업 중 지시가 반영되고 실제 명령·결과가 보이며 큰 테스트 출력 때문에 중단되지 않음 |
| 0.8.2 | DS08-03, DS08-04, DS08-05 | 모델 오류·압축 회복이 설명 가능하고 도구/프리셋/MCP 추가·제거가 실제 작동 |
| 후속 0.8.x | DS08-06, DS08-07 command lifecycle, DS08-08 | 여러 도구를 코드로 조합하고 긴 명령·REPL을 관찰·취소 |
| 별도 opt-in 후보 | DS08-09, DS08-10, DS08-01 질문 서비스 | 외부 실행기 또는 예약·채널을 실제 수요에 맞춰 하나씩 검증 |

실사용 수용 과제:
1. 집에서 같은 저장소를 대상으로 다중 파일 수정→검사 실패→수정→재검사→diff 확인.
2. 작업 중 추가 지시, 브라우저 새로고침, 모델 연결 장애, 취소를 각각 재현.
3. 128KiB 이상 출력 및 오래 실행하는 명령의 결과·종료 수거.
4. MCP 서버 하나와 저장소 프로그램 하나를 core 수정 없이 추가하고 호출·중단·제거.
5. 실제 모델에서 compaction과 restart 후 정보 상태·작업 연속성 확인.
6. 사내에서는 비공개 connector를 유지한 채 capability·cache 측정을 사용자가 실행. 인증 내부 규약을 공개 저장소로 수집하지 않음.

각 묶음은 한 번의 통합 리뷰 후 반려 항목만 재검증한다. synthetic protocol/OS integration/실제 모델/실제 브라우저/Windows/회사 환경 결과는 분리 보고한다. 런타임 완료 선언을 VERIFIED로 올리지 않으며 변경 산출물과 실제 검증 결과를 연결한다.

## 10. 이번 분석의 산출물과 제한

- 산출물: 이 문서의 source-to-Pida 비교, 10개 패치 후보, 직접 이식/패키지/어댑터 선택, 수용 기준.
- 구현 변경: 없음. 버전 변경·커밋·push·PR 수정·배포 없음.
- 확인 방식: 연결된 GitHub를 통한 고정 소스·manifest·시험 코드 조회, 로컬 Pida 및 설치 Pi package read.
- 실행 검증: 이번에는 수행하지 않음. DeepSeek 시험 파일이 있다는 사실은 시험 통과 보고가 아니다.
- 미확인: DSH 패키지 실제 설치 가능 조합, 사용자 Windows 격리/PTY, 실제 DeepSeek 성능, 회사 gateway·KV-cache 개선 효과.
- 추가 조사 후보: LSP·browser/computer-use·언어별 편집 도구의 품질. 이번에는 목록의 존재를 코딩 성능 증거로 삼지 않고 실행/확장/core에 집중했다.
