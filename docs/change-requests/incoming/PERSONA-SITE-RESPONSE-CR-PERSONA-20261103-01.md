# CR-PERSONA-20261103-01 — VeraSubstrate owner response

작성일: 2026-11-03 KST. 상태: **accepted in part / adapter and external integration pending**.
요청 원문: https://github.com/riesling-29/pida/blob/bbc28a39495b0c5d1b5f471ba11927e9ad64b46f/docs/change-requests/CR-PERSONA-20261103-01.md
이 파일은 Vera 쪽 회신 문서이며 pida 저장소 댓글이나 코드를 수정한 기록이 아니다.

## 확인 기준

- incoming pida commit: `bbc28a39495b0c5d1b5f471ba11927e9ad64b46f`.
- 실제로 읽은 consumer 계약: 위 SHA의 `src/persona-provider.ts`, `src/run-context.ts`.
- Vera local provider: `vera-continuity/0.2.0`, source baseline `7378040533b0333c3a24b01fbe8614c1de7b52f1`; 103개 synthetic/local 회귀시험 완료. Python local patch는 아직 미게시다.
- Sites baseline: `68948f7e1a7d7ba0ecd1f1d24387d4a8cc570a4b`; 이번 Site 계약 `vera-site-continuity/2.0.0`. 배포 SHA와 정확한 검증은 Site `docs/behavior-evidence`의 source lock / manifest 및 배포 결과를 따른다.
- canonical identity/기억, Sites 후보 저장소, pida-local authority는 서로 별개다. Sites `vera-site` descriptor를 운영 canonical Vera ID로 자동 동일시하지 않는다.

## 항목별 응답

| pida 요청 | Vera 제공 / 상태 | 남은 일 |
| --- | --- | --- |
| stable persona/binding, scope 검사 | Python local core에 descriptor/binding/principal/grant/expiry 구현. Sites는 authenticated-owner + context 및 source expiry | pida host principal/agent/workspace를 실제 provider grant에 바인딩하는 adapter와 인증 합의 필요 |
| 고정 context/renderer/digest/omissions | Python `project_vera_context`, Sites `behavior_context`; model/state/source revision 고정 | 실제 `resolveContext` transport는 미구현. 다운로드는 호출 receipt가 아님 |
| pida closed descriptor 형식 | Site 내부 `lib/pida-projection.ts` formatter와 source-pinned pida descriptor validator 계약시험 제공 | 실제 pida provider 등록/선택, 요청 principal/session/run binding과 revoke 재검사 필요 |
| contextDigest | pida의 **exact text bytes SHA-256 hex**로 변환. Site frame digest와 text digest를 구별 | `sha256:` prefix 제거는 형식 변환이며 다른 hash를 같은 것으로 쓰지 말 것 |
| contextRevision | formatter에서 선택 frame digest의 hex를 명시적 snapshot token으로 매핑 | 이 token은 현재 **append CAS가 수락하는 revision이 아님**. canonical append용 revision 계약 합의 필요 |
| bounded projection | pida의 16,000 JS chars / 65,536 UTF-8 bytes / descriptor 7,600 chars / experience refs 32개를 검사 | 한도 초과 시 명시적 error. 필드·근거를 조용히 절단하지 않음 |
| informationState/experience IDs | Site UUID node/event/analysis IDs를 그대로 사용 가능 | Python core `state:<id>`/`memory:<id>`는 UUID-only pida descriptor와 다르므로 새 검증된 mapping이 필요. prefix 임의 제거 금지 |
| WorkingState expected head / fork / merge | Python graph ports 및 Sites `fork`/`merge` 제공. Site merge는 양쪽 current head CAS + 명시적 내용/이유 | pida가 external provider를 선택하면 local mirror writer를 비활성화해야 함. execution FSM/task 완료는 pida 소유 |
| `appendAnalysis(expectedRevision,...)` | Python `record_analysis`와 Site `record_analysis`는 explicit refs, 출처, 멱등성 보존 | **요청한 contextRevision 단위 CAS append는 아직 미지원.** 해당 외부 capability를 광고하지 않는다. 조용히 다른 append로 대체 금지 |
| model kind/result/model digest, 학습·평가 구분 | kind/immutable refs/bytes/기간/cohort/반례/해석/검토·활성화·철회 보존 | 실제 PIX native result parser 및 producer authenticity는 미검증. 참조 저장이 모델·identity·정책 활성화가 아님 |
| host input receipt | test consumer에서 exact input acknowledgment 뒤 receipt 생성. Site v2는 live revalidation callback 필수 | 실제 pida/Pi consumer 호출은 이 대화에서 NOT_RUN. 생성/전달을 실제 포함으로 승격 금지 |

## 정상·실패 fixture와 재현

Site checkout에서:

```bash
node --test tests/behavior.integration.mjs
node tests/behavior-d1.integration.mjs
node scripts/verify-behavior.mjs
```

`tests/producer-contracts/pida-run-context.bbc28a3.ts`는 위 producer SHA의 읽기 전용 계약 snapshot이다. 이 validator로 formatter의 descriptor가 허용되는지 실행했다. 이는 **producer validator와의 shape 검사**이며 pida runtime·Pi dispatch·external Persona integration 성공이 아니다.

동일 thread owner, exact source/model refs, explicit branch/merge, context bytes와 prefix mapping, 16k 초과 거절, 타 owner·stale head·idempotency 충돌, model withdrawal, source-thread expiry, 재시작을 합성 fixture로 확인한다. UI에서 내려받는 모델 JSON의 계산 내용은 검증되지 않았으며 `BYTES_ONLY / native_pix_validation: NOT_RUN`을 유지한다.

## Producer-owner 다음 작업

1. append용 authoritative revision을 정의하고 context 선택 revision과 구분한다. 정상/duplicate/conflict/restart/revoke fixture를 제공한 뒤 `appendAnalysis` capability를 공개한다.
2. Python local port 또는 Site candidate authority 중 **하나를 명시적으로 선택**하는 transport/auth adapter를 만든다. 두 저장소를 자동으로 같은 canonical writer로 합치지 않는다.
3. producer의 source/digest/ref 검증과 pida의 host binding을 연결해 실제 첫 입력 → receipt → 허용된 append → 다음 입력의 경로를 공동 실행한다.

## pida owner에게 요청하는 재검사

consumer의 optional append capability 부재를 unsupported로 유지하고, 새 producer mapping을 연결한 후 closed descriptor·첫 Pi 입력·CAS append·restart·revocation을 다시 검증해 주세요. 실제 외부 통합 결과와 live 모델 활용은 별도로 보고해야 합니다. pida 코드·PR·정책을 이 대화에서 변경하지 않았습니다.
