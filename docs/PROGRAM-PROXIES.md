# 저장소 프로그램을 Pida 도구로 연결하기

Pida의 프로그램 프록시는 외부 프로그램을 다시 구현하지 않고 **기존 실행기와 입출력 계약을 BusinessTool로 감싸는 기능**입니다. Pi 모델은 등록된 도구 이름과 입력 스키마를 보고 호출합니다. 권한 검사, 실행 기록, 취소, 시간 제한, 변경 영수증은 기존 Pida 경로를 통과합니다.

이번 구현은 Chanta-Core에서 이야기한 ‘외부 도구·프로그램 지배’의 실행 부분입니다. 저장소를 관찰하고 호출 가능한 어댑터를 만들어 쓰는 역할이며, 조직 제어 시스템이나 PI 분석기를 추가하지 않습니다.

## 발견 → 프록시 → 실제 실행

프로젝트가 설정되어 있으면 개발자 탭의 **프로그램 · 연결된 도구와 저장소 후보**에서 후보와 활성 도구를 확인하고 계약 초안을 내려받을 수 있습니다. 모델도 `programs_discover`로 동일한 호스트 지정 저장소를 읽을 수 있습니다. 발견한 프로그램이 자동 실행되거나 권한을 얻지는 않습니다.

| 발견 대상 | 가능한 동작 |
| --- | --- |
| `pida.program.json` | 명시적 실행·입출력 계약 검증, 활성화 후 프록시 실행 |
| `package.json`의 Node `bin` | `$node`와 고정 entrypoint로 프록시 생성·실행 |
| `package.json`의 `scripts` | 설치된 npm CLI를 `$npm`으로 연결, 고정 script 실행 |
| `pyproject.toml`의 entrypoint | 선언 발견; 실행 환경과 입출력 계약은 별도 명시 필요 |
| 기타 네이티브 실행 파일 | 절대 실행 경로·스키마를 명시한 manifest로 연결 |

`ready`는 **프록시 초안을 만들 수 있다**는 뜻입니다. 설치됨·시험 통과·실행 허가는 별도입니다. 검색은 기본 깊이 4, 항목 1,000개로 제한되며 의존성/빌드 폴더, 링크, `.env*`, 호스트 보호 경로는 제외합니다. HTTP와 화면에 표시한 후보에는 소스 digest가 붙고, 초안 생성 시 변경 여부를 다시 확인합니다.

```powershell
# 읽기만 수행합니다. 프로그램이나 npm lifecycle을 실행하지 않습니다.
node dist/cli.js programs scan D:\tools\my-tool

# 위 결과의 candidate ID를 사용합니다. my-agent/programs/에 JSON 초안을 저장합니다.
node dist/cli.js programs draft D:\tools\my-tool program_CANDIDATE_ID .\my-agent

# 내용 확인 후 호스트가 실행 경로/코드 해시를 고정하고 도구 권한을 등록합니다.
node dist/cli.js programs enable D:\tools\my-tool .\my-agent\programs\PROGRAM_ID.json .\my-agent
npm start -- .\my-agent --open
```

`program_CANDIDATE_ID`와 `PROGRAM_ID`는 실제 출력값으로 바꿉니다. `draft`는 기존 파일을 덮어쓰지 않습니다. 이미 준비된 manifest는 `draft` 없이 바로 `enable`할 수 있습니다. 서버가 실행 중이었다면 종료 후 다시 시작합니다. `enable` 자체는 프로그램을 실행하지 않습니다.

이후 모델에 해당 프로그램을 사용해 달라고 요청합니다. 프록시는 `program_<id>` 도구, `program:<id>` 권한으로 등록됩니다. 메인 세션과 상주 에이전트 모두 사용할 수 있습니다. 연결 해제는 `programs disable ID .\my-agent` 후 재시작입니다.

## JSON 입출력 예시

`sum.mjs`가 stdin의 한 JSON 문서를 읽고 stdout에 한 JSON 문서를 출력한다고 가정합니다. 아래 계약은 모델이 두 수를 보내 실제 프로그램의 결과를 받게 합니다.

```json
{
  "version": 1,
  "id": "sum_tool",
  "name": "Sum tool",
  "description": "Add two numbers using the installed sum program.",
  "command": "$node",
  "args": ["sum.mjs"],
  "entrypoint": "sum.mjs",
  "inputMode": "json-stdin",
  "outputMode": "json",
  "timeoutMs": 10000,
  "effect": "read",
  "inputSchema": {
    "type": "object",
    "properties": { "a": { "type": "number" }, "b": { "type": "number" } },
    "required": ["a", "b"],
    "additionalProperties": false
  }
}
```

일반 CLI의 입출력이 이 형식과 다르면 얇은 로컬 wrapper가 변환을 담당합니다. 자동 발견만으로 임의 CLI의 인자를 추측하지 않습니다. 생성한 Node/npm 초안은 인자가 고정된 `inputMode: none`이 기본입니다. 직접 작성한 JSON-stdin manifest는 제한된 JSON Schema의 객체·배열·기본값 타입·범위·enum 등을 검증합니다. 지원하지 않는 스키마 키는 조용히 무시하지 않고 거절합니다.

## 실행 경계

- 프로그램은 신뢰된 호스트 코드입니다. OS 샌드박스나 파일 접근 격리라고 부르지 않습니다.
- 모델은 실행 파일이나 명령 문자열을 바꿀 수 없습니다. 프록시는 `shell: false`, 고정 argv, 선택된 cwd를 사용합니다. npm 스크립트 내부의 명령은 호스트가 선택한 package script 자체의 동작입니다.
- 실행 파일, manifest, 직접 entrypoint, npm runner의 해시를 활성화 시 설정에 저장하고 호출 때 다시 확인합니다. 수정되면 `PROGRAM_APPROVAL_MISMATCH`로 거절하며, 의도한 업데이트는 다시 `enable`해야 합니다. 가져오는 의존성 전체와 데이터 파일을 해시로 격리하지는 않습니다.
- 기본 환경은 OS 실행에 필요한 일부 값만 포함합니다. Provider API 키를 통째로 상속하지 않습니다. 임베딩 호스트는 필요한 환경값만 `loadProgramProxy`에 명시적으로 전달할 수 있습니다.
- 시간 초과와 취소는 직접 자식 프로세스를 종료합니다. 모든 하위 프로세스의 종료나 외부 변경의 롤백을 보장하지 않습니다. 실행 상태가 불확실하면 변경 영수증을 `unknown`으로 남기고 자동 재실행을 막습니다.
- 프로세스의 exit code 0이나 JSON 응답은 프로그램 실행 결과입니다. 산출물의 독립 검증을 뜻하지 않습니다. 기본 ResultManifest가 이를 `VERIFIED`로 승격하지 않습니다.
- 입력, 출력, stderr, 실행 시간에 상한이 있습니다. JSON 출력이 너무 크면 성공처럼 일부 JSON을 잘라 반환하지 않고 명시적 오류로 처리합니다.

등록 manifest와 `programs/` 경로는 Pida 프로젝트 파일 도구에서 보호합니다. 신뢰된 호스트 셸/프로그램은 원래 호스트 권한을 가지므로 이 보호를 OS 경계로 해석해서는 안 됩니다. GUI 자동 조작, 원격 MCP 세션, OpenClaw/Codex 전체 제어 어댑터는 이 CLI 프록시를 추가했다고 자동 지원되는 기능이 아닙니다.

## 임베딩

`discoverPrograms`, `createManifest`, `inspectProgramProxy`, `loadProgramProxy`를 각각 사용할 수 있습니다. 호스트가 저장한 `ProgramApproval`과 `trustedHost: true`로 로드한 `tool`을 `PidaRuntime.tools`에 넣습니다. 반환된 capability와 permission을 호스트 정책에서 선택합니다. 모델의 프록시 초안 생성과 실행 권한 부여는 분리된 경로입니다.
