# Cross-App ChangeRequest — CR-PIDA-001

## 요청 식별
- request_id: CR-PIDA-001
- 작성일: 2026-11-03
- requester_app / 담당: VeraSubstrate / local continuity provider
- owner_app / 담당: pida / runtime host owner
- 관련 보고서 요구 ID: INT-PS-01,02,05,06,12,13
- 목적과 owner 경계: pida가 agent bootstrap, 실행 FSM, 실제 입력 경계와 task 완료를 소유한다. 본 앱은 그 loop/scheduler/prompt를 수정하지 않았다.

## 현재 확인 상태
- consumer: Vera-Substrate local baseline `7378040533b0333c3a24b01fbe8614c1de7b52f1`; 새 source/build digest는 `../evidence/manifest.json`.
- producer: pida PR #1 head `e08edcfc98b0ca7e3450714865eaae294b1c1c3f` / fix/runtime-stabilization-00-02. 설치 build 없음.
- contract: core BindingInput/ContextUseReceipt 1.0.0; VeraContext `vera-continuity/0.2.0`, renderers vera-json/1, vera-reference-text/1. 이 버전에 대한 pida 지원은 제안/미합의다.
- 근거: PR/source 문서 read-only 조사, Schumpeter handoff 문서 참고. 실제 pida 호출·실행 없음. 로컬 test consumer 실행만 완료.

## 최소 재현과 기대
- synthetic input: evidence/examples.json의 context와 consumer_input. fixture scope만 있으며 private Vera data 없음.
- 실제 호출: `ConsumerAdapter(ContinuityProvider(...), RecordingConsumer()).submit(...)`.
- 실제 output: `context_use_receipt.boundary = consumer_input_accepted`, context_digest와 actual input_digest 일치. context 생성만 한 경우 receipt 0건. `test_full_chain_actual_consumer_input_and_no_implicit_receipt`로 재현.
- 기대: pida가 persistent/worker/subagent/verifier 첫 run 전에 생성 또는 bind하고, 고정 context를 실제 입력에 포함한 경계에서 자신의 host receipt를 발행한다. `context_snapshot_loaded` 같은 준비 이벤트만으로 사용을 확정하지 않는다. host/phase revisions와 WorkingState writer가 pida임을 보존한다.
- 정상: run/binding/identity/model revisions 및 input digest가 같은 입력을 가리킨다. task 완료는 pida verdict이며 receipt가 대신하지 않는다.
- 실패: context 만료·grant 철회·model withdrawal·tampering·다른 binding이면 model 입력 전 거절. accept 뒤 durable receipt 유실은 UNKNOWN/readback 대상이고 자동 재실행 금지.
- 권한: host가 trusted principal/grant를 주입하며 persona 이름이 권한을 바꾸지 않는다.
- 동시성: 동일 branch expected head 경쟁 중 하나만 성공. 다른 writer는 explicit branch를 열어야 한다.
- 호환성: runtime event/exported bootstrap descriptor 경계는 owner가 확인해 달라. Schumpeter handoff는 runtime event에는 descriptor가 있고 closed exporter schema에는 없을 가능성을 지적하지만, 여기서는 실제 재현하지 않았다.
- 직접 확인: synthetic local input 수락/receipt/경쟁/만료. NOT_RUN: real pida, model semantic use, durable remote crash recovery.

## 변경 영향과 진행
- 기존 API 호환: core opaque context slot/receipt는 유지. 신규 VeraContext 지원은 명시적 negotiation/consumer adapter 변경 여부를 owner가 결정한다.
- migration: 본 요청에서 운영 migration 없음. pida owner가 자기 bootstrap/runtime에 적용 범위를 정한다.
- fallback/손실: RecordingConsumer로 입력 경계까지 재현하되 LLM 실행·성과를 주장할 수 없다.
- 차단 경로: 실제 pida persona continuity와 model-input receipt.
- 계속 가능한 작업: local provider, source/model scope, CAS, evidence와 계약 실패 예제.
- 합의 artifact: producer-owned bootstrap/event/receipt schema와 정상/만료/중단 fixture; owner 실행 결과/commit/build.

## Owner 응답(별도 기입)
- status: PENDING — accepted / needs-evidence / alternative / rejected 중 owner가 선택
- 결정 근거와 책임 경계: 미기입
- producer 계약 revision / fixture / 검증 결과: 미기입
- consumer 재검사 범위: bootstrap bindings, context negotiation, exact input receipt, writer/phase refs, uncertain-effect recovery
