# 0.7.0 실사용 시작

MAGI 분석에서 도출한 변경입니다. Pi 1.2.0을 그대로 재사용하며 MAGI 엔진, Council, Fleet, 자동 학습을 설치하지 않습니다. [분석과 패치 계획](MAGI-ADOPTION-PATCH-PLAN.md), [검증 결과](MAGI-ADOPTION-VALIDATION.md)를 함께 보십시오.

## Windows 업데이트

실행 중인 작업을 끝내고 Pida 서버를 Ctrl+C로 종료합니다. 서버 프로세스 종료와 브라우저 창 닫기는 다릅니다. 아래 명령은 기존 개발 브랜치를 사용합니다. 미커밋 변경 때문에 Git이 멈추면 덮어쓰지 말고 변경 내용을 확인합니다.

```powershell
cd D:\pida
git switch fix/runtime-stabilization-00-02
git pull --ff-only origin fix/runtime-stabilization-00-02
npm run build
npm start -- .\my-agent --open
```

이번 변경에 신규 npm 의존성은 없습니다. 기존 의존성이 없는 새 checkout이라면 먼저 `npm ci --ignore-scripts`를 실행합니다.

개발자 탭에서 도구 시작·완료·실패, 모델 응답 대기, 경과 시간과 마지막 신호 시간을 확인할 수 있습니다. 타이머가 흐른다는 것만으로 모델이 정상 동작한다고 판정하지 않습니다. 브라우저 새로고침 후 재로그인하면 기존 세션의 상태를 다시 읽으며, 같은 요청을 자동 재전송하지 않습니다. Studio 요청은 브라우저 연결이 끊겨도 서버가 살아 있는 동안 진행합니다. 작업 중단은 **중단** 버튼을 사용합니다. 서버 종료·실행 시간 한도·프로세스 장애는 별개입니다.

SDK/HTTP의 기본 연결 종료 동작은 기존과 같이 취소입니다. 유지하려면 `client.stream(id, prompt, { disconnectPolicy: "continue" })` 또는 POST runs JSON에 `disconnectPolicy: "continue"`를 지정합니다. 이 모드의 AbortSignal은 관찰 연결만 닫습니다. 실행을 멈추려면 `client.cancel(id)`를 호출합니다. 실행 상태와 trace는 소유권이 확인된 세션 API로 다시 조회합니다. 작업 프로세스 자체가 종료된 뒤 자동 재실행하는 기능은 아닙니다.

## 실제 UI 검사 켜기

서버를 종료한 뒤, 브라우저를 설치할 수 있는 개인 환경에서는:

```powershell
cd D:\pida
npx playwright install chromium
node dist/cli.js browser enable .\my-agent
npm start -- .\my-agent --open
```

폐쇄망에서는 승인된 브라우저 실행 파일을 `PIDA_BROWSER_EXECUTABLE`로 지정할 수 있습니다. 명령은 실제 브라우저 실행 검사를 먼저 수행하고 성공한 경우만 설정을 변경합니다. 브라우저가 없으면 검사 성공으로 처리하지 않습니다. [검사 입력과 범위](UI-CHECKS.md).

시험 요청: “점검 알림 영역이 표시되는지, 점검 대상이 2개인지, 검색 입력과 상태 선택이 동작하는지 ui_check로 확인해줘. 모바일 너비에서도 다시 검사하고 실패한 항목을 보고해줘.”

## 일반 저장소 코딩 켜기

테스트할 저장소를 고른 뒤 서버를 종료하고 다음을 실행합니다. `D:\work\sample-project`를 실제 개발용 저장소로 바꿉니다.

```powershell
node dist/cli.js project enable D:\work\sample-project .\my-agent --trusted-host
npm start -- .\my-agent --open
```

`--trusted-host`는 그 PC의 사용자 권한으로 셸 명령 실행을 허용합니다. OS sandbox가 아니며 파일·네트워크 접근이 가능합니다. 파일 읽기·수정만 허용하려면 이 옵션을 생략합니다. 필요한 Node/Python/PowerShell과 프로젝트 의존성은 해당 PC에 설치되어 있어야 합니다. Pida가 도구를 자동 다운로드하지 않습니다. 검색 도구는 PATH의 ripgrep(`rg`)을 사용합니다.

시험 요청: “선택된 프로젝트의 AGENTS.md와 README를 읽고, 기존 테스트 명령을 확인해. 실패하는 테스트 하나를 재현하고 최소 수정 후 같은 테스트를 다시 실행해. 변경 파일과 실제 명령·종료 코드를 보고해.”

개발자 탭의 `프로젝트 저장소` 대상을 선택하거나 에이전트 작업 공간에서 프로젝트 도구를 명시해 요청합니다. 현재 서비스 미리보기·변경 내역·파일 복원은 별도 UI workbench에 대한 기능입니다. 외부 프로젝트의 React 서버 미리보기나 자동 복원·독립 검증까지 제공한다고 해석하면 안 됩니다. 프로젝트 변경은 해당 저장소에서 Git diff로 확인합니다. [경계와 복구](PROJECT-CODING.md).

끄려면 `node dist/cli.js project disable .\my-agent` 후 서버를 다시 시작합니다.

## 사내 API

모델 설정의 `사내 API · LightLLM / LiteLLM`에서 회사가 제공한 base URL, 모델 ID와 인증을 설정합니다. 헤더 인증과 구버전 요청 형식 설정은 [사내 연결 문서](COMPANY-ENDPOINTS.md)를 따릅니다. LightLLM과 LiteLLM은 다른 제품이며, 회사 서비스의 실제 규격이 기준입니다. 실제 폐쇄망 연결·모델 도구 호출·KV cache는 회사 환경에서 별도 확인해야 합니다.
