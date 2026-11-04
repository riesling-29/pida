# 0.8.9 — 일반 / Persona 연결 에이전트 혼합 운영

날짜: 2026-11-04 KST · 범위: Pida만
기준: 로컬 `4dad3c20c3f83050b5bfdebf624cb2a53952bce9`, Pida 0.8.8 → 0.8.9, Pi 1.2.0 유지.

## 목적과 구현

하나의 `my-agent` 워크스페이스에서 일반 에이전트와 외부 Persona 연결 에이전트를 함께 등록한다.
기존 AgentSupervisor/Pi 세션/기억 저장소/PersonaProvider를 재사용했다. 실행 엔진이나 Persona 원장을 추가하지 않았다.

- 호스트가 이름 붙인 연결과 사용 가능한 principal을 등록한다. 사용자/모델은 임의 URL·코드·자격증명을 제출하지 않는다.
- 프로필 생성 시 `personaSourceId`를 고정하고 저장한다. 기본은 `local`; 외부 연결은 실제 설치된 선택지만 노출한다.
- 로컬 agent의 기억 도구와 HTTP 편집은 유지하고, 외부 agent의 로컬 canonical writer는 제외한다.
- 메인 runtime은 새 혼합 모드에서 로컬 기억을 유지한다. 기존 workspace-wide `personaProvider` 설정도 호환한다.
- 외부 연결 제거·실패를 일반 기억으로 대체하지 않는다. 다른 agent 실행과 기존 작업 결과 조회는 유지한다.
- 이전 버전의 source 없는 세션은 기존 context authority를 확인한다. 외부 → 로컬의 암묵적 전환을 차단한다.
- Web 생성 화면에 연결 선택과 현재 연결 표시를 추가했다. 외부 agent의 memory 404 때문에 작업 목록까지 막히던 결함을 수정했다.
- 비동기 기억 해석·세션 복원 전에 HTTP 기억 권한을 확인한다.

독립 작업공간의 병렬 실행은 기존 한도를 사용한다. 같은 checkout의 프로젝트 작업은 기존처럼 직렬화한다.
이번 변경은 탭·분할 패널, 자동 왕복 위임, 에이전트별 모델/프로젝트 선택을 구현하지 않는다.

## 시험

환경: Linux, Node v24.22.1, Pi SDK 1.2.0. 별도 유료 API나 회사 자격증명은 사용하지 않았다.
시험의 외부 Persona는 명시적 합성 계약 fixture이고, 모델은 scripted faux/mock이다.
실제 Pi 루프·HTTP·디스크·세션 복원·동시성 게이트는 그대로 실행했다.

| 명령 | 실제 결과 |
| --- | --- |
| `node scripts/task.mjs build` | 통과 |
| `node --test --test-timeout=20000 test/workspace-persona-pi.test.mjs test/agent-supervisor.test.mjs test/agents-http.test.mjs test/agent-tools.test.mjs test/web-run-ui.test.mjs` | 36 통과 |
| `node scripts/task.mjs test` | 363 통과, 실패/skip 0 |
| 리뷰 보완 후 `node scripts/task.mjs build` 및 `node --test --test-timeout=20000 test/agents-http.test.mjs test/workspace-persona-pi.test.mjs` | 빌드 통과, 14 통과 |
| `node --test --test-timeout=20000 --test-name-pattern='agent HTTP routes enforce' test/agents-http.test.mjs` | 권한 거절 전에 기억 resolver가 실행되지 않음을 추가 확인, 1 통과 |
| `node --check examples/web/agents.js`, `git diff --check` | 통과 |

확인한 주요 시나리오:

- 두 종류의 agent가 동시에 running 상태에서 서로 다른 context를 사용하고, 로컬 기억만 수정 가능.
- source allowlist/알 수 없는 ID/경로 입력/외부 persona 덮어쓰기 요청 거절.
- 재시작 뒤 같은 세션·source로 후속 작업, source 제거 뒤 외부 작업만 실패, 로컬 작업 계속 성공.
- 외부 factory 실패 격리, legacy 전체 연결 회귀, 오래된 외부 context의 로컬 전환 차단.
- DOM handler 시험에서 외부 agent의 작업 결과 표시, 로컬 편집 숨김, 생성 payload의 정확한 source,
  source 제거 시 새 생성 대상을 조용히 local로 바꾸지 않음.

초기 재시작 시험은 runtime 생성만으로 세션이 열렸다고 가정해 실패했다. 실제 Supervisor 경로의 후속 작업을
통해 `resumeSession`을 실행하도록 시험을 고쳤고, 같은 session ID 및 외부 context 유지를 확인했다.
통합 자체 리뷰 1회에서 비동기 memory resolver가 권한 확인보다 먼저 호출되는 문제를 보완했다.
그 보완과 관련된 HTTP/Persona 시험만 다시 실행했다.

## 완료 범위

| 단계 | 상태 |
| --- | --- |
| 계획 | 완료 — 기존 외부 factory의 전체 workspace 영향과 Web 조회 결함 확인 |
| 구현 | 완료 — per-agent 선택, 실행·기억 경계, API/SDK, 기존 Web 등록·조회 |
| 프로토콜/회귀 시험 | 완료 — 위 명령과 환경의 결과 |
| 실제 Persona 서비스 / canonical data / 실모델 | NOT_RUN — 호스트의 실제 연결과 권한 필요 |
| 실제 브라우저 레이아웃 / Windows 터미널 | NOT_RUN — 현재 Chromium 실행 파일 없음; DOM 시험으로 대체했다고 주장하지 않음 |

호스트 연결 설치는 [PersonaProvider 문서](PERSONA-PROVIDER.md#mixed-local-and-external-agents--089)를 따른다.
외부 producer의 공개 revalidation/receipt 계약은 기존 [Persona owner CR](change-requests/responses/PERSONA-CR-PIDA-001.md)에 남아 있다.
다른 앱의 저장소·Persona 데이터·PIX 원본은 수정하지 않았다. 기존 개발 브랜치/draft PR에 버전별 커밋하며 병합·릴리스·배포는 하지 않는다.
