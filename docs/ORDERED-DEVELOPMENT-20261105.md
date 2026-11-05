# 순차 개발 기록 · 2026-11-05

기준: `330ad337cfa78f213cc98156a8590ad3e47c7e19` / 0.8.14. 범위는 Pida 저장소다.

## 1. 설치와 재실행 · 0.8.15

- 구현: pnpm importer에 직접 Pi TUI 의존성 반영. npm shrinkwrap 버전 동기화.
- 구현: start/setup/configure가 인증 응답과 로컬 lock nonce를 대조해 기존 서버를 재사용한다. 단순 HTTP 200만으로 다른 작업공간을 선택하지 않는다.
- 구현: live/stale/unverified 잠금과 EACCES/ENOSPC 같은 파일 쓰기 실패를 구분한다. 임의 잠금 삭제나 실행 중인 프로세스 종료는 하지 않는다.
- 시험: Linux Node 24 전체 374건 중 373 통과, PIX 외부 소스가 필요한 1건 skip. 기존 서버 재시작 명령·잠금 분류·파일 오류 회귀 포함.
- 설치 시험: npm offline lock 갱신 성공. pnpm 11의 offline frozen 검사는 로컬 패키지 메타데이터 부재(`ERR_PNPM_NO_OFFLINE_META`)로 완료하지 못했다. CI의 pnpm 12 실제 설치는 별도 확인해야 한다.
- 실환경: Windows/회사 게이트웨이/실모델은 미실행.

## 2. 파일·범위와 공통 기록 · 0.8.16

- WS-01~05의 첫 파일 흐름 구현: 원본 바이트 해시·행 범위, 기존 admission 안의 stale 거절, durable request dedup, 서버 전후 기록과 검사 신선도, Studio와 `--main` TUI 연결.
- 도구 결과 참조·DOM 선택·멀티 탭의 대상 고정 UI는 이 묶음에 포함하지 않는다. 원래 무대상 요청과 기존 TUI/멀티 탭은 유지한다.
- 실제 Pi/API/TUI 통합 11건 통과, Web 핸들러 14건 통과. 전체 회귀에서 발견한 오류 메시지 표시 1건을 수정하고 해당 Web 묶음을 재검증했다. 마지막 통합 전체 결과는 후속 기록을 따른다.
- Chromium은 로컬 OS socket 제약으로 차단. 전용 browser runner와 CI job 추가. Windows와 live LLM은 미실행.
- [사용법과 검증 범위](WORK-SURFACE-0.8.16.md).

## 다음 순서

3. 조직 실행 첫 묶음: durable batch join, 부모 continuation, 정확한 산출물 버전의 독립 검증과 제한된 repair.

화면 요소 DOM 매핑(WS-06), 메신저·스케줄러·외부 runner는 이번 순차 작업의 범위 밖이다.
