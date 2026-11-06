# Cross-App ChangeRequest — 현재 pida export와 host 증거 계약

이 문서는 요청이며 pida 수정·커밋·배포 권한을 부여하지 않는다. 외부로 발송하지 않았다.

## 요청 식별
- request_id: CR-PIDA-20261103-01
- 작성일: 2026-11-03 (Asia/Seoul)
- requester_app / 담당: Schumpeter / 본 개발 대화
- owner_app / 담당: pida-core / pida 개발 대화
- 관련 보고서 요구: INT-SC-02, INT-SC-08, INT-SC-16
- 목적: 현재 producer의 관측과 context/로컬 검증 receipt를 소비 가능한 계약으로 고정한다.
  exporter/schema·실제 입력 증거는 producer host인 pida가 소유한다.

## 현재 확인 상태
- consumer: Chanta-Research-Group/Schumpeter, baseline `fa48029870f5b2544e401cbb1846cb2ff1c27f6f`.
  이번 변경/시험은 [slice 보고](../development/INTEGRATED-SLICE-A-2026-11-03.md)를 따른다.
- producer: riesling-29/pida PR #1, 이번 head 조회 `e08edcfc98b0ca7e3450714865eaae294b1c1c3f`.
  pida 설치/실모델 실행은 이번 개발에서 수행하지 않았다.
- 계약: pida.bundle/0.1-draft, pida.observation/0.1-draft, pida.result/0.1-draft.
- 근거: 이전 source 정적 확인에서 runtime의 context_snapshot_loaded는 descriptor를
  전달하지만 integration-contract의 닫힌 payload 목록에는 descriptor가 없다.
  실제 export 경로의 필터링·누락·거절은 아직 재현하지 않았다.

## 최소 재현과 기대
- 비공개 데이터 없는 입력: 테스트 Persona context로 한 run을 수행하고
  context_snapshot_loaded를 포함한 native bundle을 export한다.
- 실제 호출/결과: 최신 producer runtime 호출 **NOT_RUN**. 현재 보유한 구 원본 fixture
  11개는 `5647b0b1...` 기준이며 최신 exporter 호환성 증거를 대신하지 않는다.
- 기대: producer validator와 Schumpeter consumer가 같은 bytes를 검증하며,
  관측 범위·누락·context revision을 정확히 표시한다. context 조회와 실제 입력 포함은 구분한다.
- 정상/실패 사례: 정상/누락 context, 불필요한 private 원문 없음, 동일 event 재전달,
  scope·run 바꿔치기, stale artifact, producer PASSED만 있는 경우, JS 숫자 wire 경계.
- 이번 직접 확인: Schumpeter가 수입하는 JS 1e20 wire 오류는 소비자 코드에서 수정했다.
  producer schema를 완화하거나 타 저장소를 변경하지 않았다.

## 변경 영향과 진행
- 호환성: owner가 실제 export를 확인한 뒤 기존 schema 유지 또는 새 version을 결정한다.
  임의 payload를 허용하거나 호환되지 않는 필드를 조용히 삭제하지 않는다.
- migration: 기존 사건·digest·fixture는 보존. 필요 여부와 승인 주체는 pida owner가 판단한다.
- fallback: 현재 고정된 원본 fixture와 metadata-only 수입을 계속 사용한다.
- 차단되는 경로: 최신 pida 실제 context 적용·제품 통합 인수, 신뢰 가능한 로컬 인수 재사용.
- 계속 가능한 작업: Hub 공통화·자체 제품 runner·외부 하네스 adapter·desktop prototype.
- 요청 artifact: producer 계약/validator revision, 실제 합성 run export와 정상/반례 fixture,
  context의 생성/전달/입력 포함 receipt, 로컬 인수 issuer/scope·artifact 결속 설명.

## Owner 응답
- status: PENDING — accepted / needs-evidence / alternative / rejected 중 owner가 기입.
- 결정 근거·producer revision·fixture·consumer 재검사 범위: 미수신.

응답 전 제안 필드를 구현된 API로 문서화하지 않는다. 이 요청은 전체 pida 재개발을 요구하지 않는다.
