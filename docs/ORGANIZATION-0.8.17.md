# 조직 실행과 독립 검사 · 0.8.17

기존 상주 에이전트에 목표·참여자·작업·시도·하위 결과 합류 기록을 붙이는 첫 구현이다. Pi의 실행 루프는 그대로 사용한다. 조직 생성과 검사 기준 선택은 **호스트 API/SDK**에서 하며, 모델에게 조직 생성이나 검사 기준 변경 도구를 주지 않는다.

## 무엇이 달라졌나

| 기능 | 동작 |
| --- | --- |
| 조직 목표 | 소유자, 참여 에이전트, 검사 ID, 수정 시도·시간 한도를 저장 |
| 작업과 시도 | 최초 입력 해시를 보존하고 후속 실행·수정 시도에 별도 ID 부여 |
| `agent_join` | 필수·선택 하위 작업 ID를 등록한 뒤 즉시 반환. 부모는 현재 실행을 정상 종료 |
| 후속 실행 | 하위 작업이 정리되면 부모의 기존 세션에 후속 작업 하나를 접수 |
| 독립 검사 | 호스트가 읽은 정확한 workbench 파일 내용에 호스트 설정 검사를 수행 |
| 수정 한도 | 필수 검사 실패 때만 0~3회의 새 수정 시도 허용. 매 시도 후 다시 검사 |
| 재시작 | 완료 결과와 접수 ID를 재사용. 실행 중이던 작업은 중단·복구 확인 상태이며 자동 재실행하지 않음 |

하위 실행이 끝났다는 사실과 산출물이 맞다는 판정은 다르다. 부모에게 전달되는 하위 응답은 출처·입력·결과 해시가 있는 **보고 내용**이며 권한이나 검증 영수증이 아니다. 중첩 합류에서는 하위 작업의 최초 위임 실행이 아니라 마지막 후속 실행 결과를 사용한다.

## 1. 검사 기준 설정

`pida.config.json`의 최상위에 다음 항목을 추가하고 서버를 정상 종료한 뒤 다시 시작한다. 아래는 기존 설정에 병합하는 예시이며, 전체 설정 파일을 대체하는 내용이 아니다.

```json
{
  "acceptanceChecks": [
    {
      "id": "answer-json",
      "kind": "json-equals",
      "path": "answer.json",
      "expected": "{\"answer\":42}",
      "required": true
    }
  ]
}
```

- `json-equals`: JSON을 해석한 값이 일치해야 한다. 객체 키 순서와 서식 차이는 허용한다.
- `file-contains`: 지정한 문자열을 파일이 포함하는지 검사한다. 이 좁은 조건의 통과가 프로그램 전체의 정확성을 뜻하지는 않는다.
- 경로는 **루트 담당 에이전트의 workbench 상대 경로**다. 일반 프로젝트 저장소나 다른 에이전트의 workbench를 검사하지 않는다.
- 최대 32개 기준이며, `required: true`인 기준이 하나도 없으면 `UNKNOWN`이다. 선택 기준의 실패는 기록하지만 필수 기준이 모두 통과하면 `PASS`가 될 수 있다.

검사기는 셸·네트워크·모델을 실행하지 않는다. 기존 파일 제한·소유권·읽기 권한을 적용한다. 검사에 필요한 내용이 없거나 JSON이 잘못됐으면 `FAIL`, 읽기 권한·검사기·검사 환경이 없거나 일치하지 않으면 `UNKNOWN`이다.

## 2. 조직 생성

먼저 Web/TUI에서 사용할 에이전트를 만든다. SDK에서는 기존 `createAgent()`도 사용할 수 있다. 다음은 Node ESM 예시다. 접속 토큰은 서버가 발급한 토큰이며 소스 파일에 저장하지 않는다.

```js
import { PidaClient } from "pida-core/client";

const client = new PidaClient({
  baseUrl: "http://127.0.0.1:8787",
  token: () => process.env.PIDA_API_TOKEN,
});

const { agents } = await client.listAgents();
const lead = agents.find(agent => agent.name === "개발");
const reviewer = agents.find(agent => agent.name === "검토");
if (!lead || !reviewer) throw new Error("개발·검토 에이전트를 먼저 등록하세요.");

const organization = await client.createOrganization({
  requestId: "answer-task-001",
  goal: "answer.json에 answer: 42를 기록하세요. 필요하면 검토 에이전트에 위임하고 agent_join으로 결과를 모으세요.",
  agentId: lead.id,
  participants: [lead.id, reviewer.id],
  criterionIds: ["answer-json"],
  maxRepairAttempts: 1,
  timeoutMs: 300_000,
});

console.log(organization.id);
console.log(await client.getOrganization(organization.id));
```

현재는 조직 생성 전용 Web/TUI 화면이 없다. 생성된 개별 실행은 기존 에이전트 작업 목록에 나타나며, 조직 전체의 합류·시도·검사 기록은 위 API로 조회한다. 단순 에이전트 작업에 `agent_join`을 사용하는 경우에는 검사 기준이 없는 조직이 자동으로 생기므로 후속 실행은 가능하지만 독립 수용 결과는 `UNKNOWN`이다.

같은 `requestId`와 같은 입력으로 다시 요청하면 기존 조직을 반환한다. 입력을 바꾼 채 같은 ID를 쓰면 충돌 오류다. 새 작업에는 새 ID를 쓴다.

## 3. 합류와 취소

모델은 기존 `agent_delegate`로 작업을 맡긴 뒤 반환받은 ID를 `agent_join`에 등록한다.

```json
{
  "required": ["필수 하위 작업 ID"],
  "optional": ["선택 하위 작업 ID"],
  "timeoutMs": 300000
}
```

실제 API에는 유효한 작업 UUID를 넣는다. `agent_join`은 기다리는 도구가 아니다. **부모가 현재 실행을 끝내야** 같은 작업공간의 하위 에이전트가 실행될 수 있다. 성공한 필수 작업과 종료된 선택 작업의 결과가 모이면 호스트가 부모를 이어 실행한다. 필수 실패·취소·중단은 합류를 막으며, 선택 실패는 결과에 남긴다. 알 수 없는 외부 효과나 아직 실행 중인 콜백의 잠금은 합류로 해제하지 않는다.

```js
const view = await client.getOrganization(organization.id);
// 조직의 현재 작업과 대기 중인 후속 작업을 취소한다.
await client.cancelOrganization(organization.id);

// 특정 합류만 취소할 때는 조회한 revision을 함께 보낸다.
// await client.cancelJoin(view.joins[0].id, view.joins[0].revision);
```

조직 취소는 해당 조직에 속한 작업만 대상으로 한다. 합류만 취소하면 해당 후속 실행을 막지만 별도로 실행 중인 하위 작업까지 취소하지는 않는다. 이미 진행 중인 외부 효과는 기존 복구 절차로 확인한다.

## 4. 판정 읽기

`getOrganization()`은 `organization`, `tasks`, `attempts`, `joins`, `currentAcceptance`를 반환한다.

| 필드 | 의미 |
| --- | --- |
| `organization.status` | 저장된 조직 실행 결과. `accepted`는 당시의 검사 결과 |
| `tasks[].receipts[]` | 특정 작업·시도·산출물 해시·검사 정의·환경에 묶인 과거 영수증 |
| `currentAcceptance` | 조회 시 다시 읽은 내용과 검사 정의·환경이 같을 때만 과거 판정을 적용. 다르면 `UNKNOWN` |
| `joins[].results[]` | 최초 하위 할당, 실제 최종 시도, 입력·결과 해시, 실행 상태 |

`PASS`는 이 호스트에서 설정한 좁은 검사 범위에 한정한다. 기존 `ResultManifest.verification_status`를 임의로 `VERIFIED`로 바꾸거나 Schumpeter의 기업 수준 수용 판정으로 승격하지 않는다. 검사 후 파일이 바뀌면 이전 영수증은 남지만 새 버전에 대한 `currentAcceptance`는 `UNKNOWN`이다.

## 한도와 검증 범위

- 조직당 최대 32개 참여자, 합류당 최대 16개 하위 작업, 작업당 최대 16개 시도. 기존 전체 작업 수·위임 깊이·실행 슬롯 한도도 적용한다.
- 조직 시간 한도 1초~24시간, 합류 시간 한도 1초~1시간. 기본 한도는 1시간이다.
- workbench 캡처는 최대 64개 텍스트 파일, 파일당 128 KiB, 합계 2 MiB다. 호스트 캡처 응답은 최대 5초 또는 남은 조직 시간으로 제한한다.
- supervisor 저장 형식은 v2다. v1의 에이전트·작업은 유지하고 조직 목록을 빈 값으로 옮긴다. 알 수 없는 미래 버전은 읽기를 거절한다. v2로 저장한 상태를 0.8.16 이하 실행 파일에서 그대로 여는 다운그레이드는 지원하지 않으므로, 이전 버전으로 돌아갈 때는 업데이트 전 작업공간 백업을 사용한다. 파일 교체는 원자적이지만 여러 파일에 걸친 트랜잭션이나 전원 장애까지의 완전한 내구성을 주장하지 않는다.
- 실제 Pi·HTTP·파일 기반 자동 시험은 모델 결정을 스크립트로 고정한다. 실제 LLM이 적절히 위임하고 목표를 해결하는 능력, Windows 환경, 다른 앱과의 실제 통합은 별도 검증 대상이다.

관련 기록: [순차 개발 기록](ORDERED-DEVELOPMENT-20261105.md), [원래 설계와 후속 범위](PI-NATIVE-ORG-GAPS.md).
