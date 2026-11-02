# 사내 LLM API 연결: LightLLM / LiteLLM

Pida는 Pi SDK의 OpenAI Chat Completions 어댑터를 사용합니다. 별도 LightLLM 실행 엔진이나 요청 재시도 루프를 만들지 않습니다. **LightLLM**은 모델 추론·서빙 프로젝트이며 **LiteLLM**은 별개의 프로젝트입니다. 사내 서비스가 어느 것을 사용하든 실제로 제공하는 API 형식과 인증 규약을 기준으로 설정합니다.

## 기본 연결

모델 설정에서 `사내 API · LightLLM / LiteLLM`을 선택하고 다음 값을 입력합니다.

- 서버 주소: 회사에서 받은 API base URL. 예: `https://llm.company.example/v1`. 사내 경로 접두사가 있으면 그대로 유지합니다. `/chat/completions`까지 입력해도 설정 화면에서 접미사를 제거합니다.
- API 형식: `OpenAI Chat Completions 호환`.
- API 키: 회사에서 발급한 키. 일반 Bearer 인증은 키 본문만 입력합니다.
- 모델: 서비스가 제공하는 정확한 ID. 목록 조회가 지원되지 않으면 직접 입력할 수 있습니다.
- 문맥·출력 한도: 회사 서비스가 허용하는 값. 모델 이름만 보고 한도를 추정하지 않습니다.

키가 없는 서버는 `API 키가 필요 없는 서버`를 선택합니다. HTTP가 필요한 내부 주소는 해당 주소에 대해 HTTP 허용을 명시합니다. 회사 CA 인증서가 필요한 경우 회사가 제공한 CA 파일을 Node의 `NODE_EXTRA_CA_CERTS`로 지정하고 Pida를 시작합니다. TLS 검증을 비활성화하지 않습니다.

`연결 확인 후 적용`은 모델의 응답까지 확인합니다. 이 검사는 도구 호출·코드 수정·브라우저 검증을 통과했다는 뜻이 아닙니다. LightLLM에서는 사용 중인 모델과 서버의 tool-call parser 설정에 따라 도구 호출 지원 여부가 달라집니다.

## 요청 형식 호환 설정

실제 에이전트 작업공간의 `pida.config.json`에서 `provider`에 선택적으로 `compat`를 추가할 수 있습니다. 아래는 **구버전 또는 제한된 gateway의 예시**이며 현재 LightLLM 전체에 반드시 필요한 값이 아닙니다.

```json
{
  "kind": "endpoint",
  "api": "openai-completions",
  "baseUrl": "https://llm.company.example/v1",
  "modelId": "company-model-id",
  "apiKeyEnv": "PIDA_LLM_API_KEY",
  "authMode": "api-key",
  "contextWindow": 32768,
  "maxTokens": 4096,
  "compat": {
    "maxTokensField": "max_tokens",
    "supportsUsageInStreaming": false,
    "supportsStore": false,
    "supportsDeveloperRole": false
  }
}
```

이는 전체 설정 파일이 아니라 `provider` 항목입니다. 기존 workspace 설정의 나머지 항목은 유지합니다.

| 설정 | 의미 |
|---|---|
| `maxTokensField` | `max_tokens` 또는 `max_completion_tokens` 중 전송할 필드 |
| `supportsUsageInStreaming: false` | 요청의 `stream_options` 생략 |
| `supportsStore: false` | 요청의 `store` 생략 |
| `supportsDeveloperRole: false` | Pi의 developer-role 호환 설정 비활성화 |

생략한 항목은 Pi SDK 기본값을 사용합니다. `compat`는 Chat Completions 형식에만 허용됩니다. 모델 설정을 같은 URL·API에 다시 적용해도 기존 호환 설정은 유지됩니다. 다른 URL이나 API로 변경하면 이전 설정을 자동 전달하지 않습니다.

## 모델 기능과 추론 설정

`provider`에 다음 항목을 선택적으로 추가할 수 있습니다. 값은 실제 회사 모델/API가 지원하는 범위로 운영자가 지정합니다. 이름에서 기능을 추측하지 않습니다.

```json
"reasoning": true,
"input": ["text", "image"],
"thinkingLevel": "high",
"thinkingLevelMap": { "xhigh": null, "max": null }
```

- 기본값은 기존과 동일한 `reasoning: false`, `input: ["text"]`, 추론 수준 `off`입니다.
- `thinkingLevel`은 Pi의 `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`를 사용합니다. Pi 모델 선언이 지원하지 않는 명시적 값은 호출 전에 거절합니다. 서버의 실제 지원까지 연결 전에 증명하는 검사는 아닙니다.
- `thinkingLevelMap`은 Pi의 모델별 값 매핑입니다. `null`은 미지원, 문자열은 공급자가 요구하는 값, 생략은 Pi 기본 매핑을 뜻합니다. `xhigh`와 `max`는 명시적 매핑이 있어야 지원됩니다. 사내 API의 임의 필드나 DeepSeek 전용 프로토콜을 추가하는 설정은 아닙니다.
- `input`은 모델 기능 선언입니다. `text`는 필수이며 `image`를 추가해도 HTTP 채팅에 이미지 업로드 기능이 자동 추가되는 것은 아닙니다.
- native provider는 Pi 카탈로그의 기능을 그대로 사용하고 `thinkingLevel`만 지정합니다. 비공개 connector는 `ProviderBinding.thinkingLevel`과 자신의 Pi 모델 선언을 제공합니다. 회사 전용 인증은 여전히 connector의 책임입니다.
- 같은 URL·API·모델에 설정을 다시 적용하면 생략한 기능 설정을 보존합니다. 모델이나 대상이 바뀌면 이전 모델의 기능 선언을 자동 복사하지 않습니다. `reasoning: false`로 끄면 이전 추론 매핑을 제거하고 수준을 `off`로 되돌립니다.

## 호출별 사용량과 캐시 진단

run의 Observation JSON/JSONL에서 `model_request`와 `model_response`를 `request_id`로 연결합니다. `attempt`는 해당 run 안의 모델 호출 순번입니다. 도구 사용 뒤 이어지는 호출도 별도 attempt입니다.

요청에는 Pi가 선택한 API·모델·추론 수준·모델 한도, provider generation과 `effective_config_digest`, `system_digest`, `tools_digest`가 포함됩니다. 지문은 작업공간 내부 키를 사용하는 HMAC이며 `fingerprint_scope`가 같은 자료끼리 비교합니다. 주소·헤더·키·프롬프트 원문은 관측에 저장하지 않습니다. system/tools 지문은 **Pi의 논리적 요청 구성**에 대한 비교값이며, 공급자 어댑터가 만든 최종 HTTP 본문의 byte prefix가 같다는 증명은 아닙니다. `model_max_tokens`는 모델 선언 한도이며 공급자가 실제 적용한 출력 한도의 증거가 아닙니다.

응답의 `input_tokens`는 캐시를 포함한 입력 토큰, `uncached_input_tokens`는 확인 가능한 비캐시 입력, `output_tokens`는 추론을 포함한 출력입니다. `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`는 각각 해당 부분집합이므로 다시 총량에 더하지 않습니다. 누락은 `null`, 명시적으로 보고된 0은 `0`으로 보존합니다.

`usage_status`는 `reported`(공급자 이벤트에서 총량 확인), `partial`, `unknown`, `invalid`(모순·잘못된 수치), `normalized`(원시 사용량을 관측하지 못했지만 Pi가 제공한 일관된 양수 총량)입니다. `normalized`의 0 버킷은 보고 여부를 구별할 수 없어 `null`입니다. 현재 Chat Completions, Responses, Anthropic Messages, Gemini의 공개 usage 형식만 해석하며 회사의 비공개 형식을 추측하지 않습니다. 원시 이벤트는 보존하지 않습니다.

`first_output_ms`는 요청 준비 후 첫 text/thinking/tool-call delta까지 걸린 클라이언트 측 시간입니다. 공급자 내부 TTFT 측정값이 아닙니다. `duration_ms`는 해당 응답 종료까지의 시간입니다. 총량이 없거나 모순이면 토큰 예산을 성공으로 통과시키지 않습니다. 재시도나 후속 호출 비용은 개별 응답을 합산해야 하며, 어떤 attempt의 비용이 미확인이면 전체 비용도 정확하다고 보고할 수 없습니다.

회사에서는 동일 요청 반복과 system/tool 구성을 하나씩 바꾼 요청을 비교하고, 이 지문·시간·서버 보고 캐시 값과 실제 LightLLM/LiteLLM 배포 버전을 함께 기록합니다. 이 계측 자체가 서버 KV-cache 문제를 고치는 기능은 아닙니다.

## 사내 전용 헤더

gateway에 별도의 헤더가 필요하면 서버 운영자가 `headersEnv`에 **환경변수 이름만** 지정합니다.

```json
"headersEnv": {
  "X-Company-Gateway": "COMPANY_GATEWAY_TOKEN",
  "X-Project-ID": "COMPANY_PROJECT_ID"
}
```

실제 값은 Pida를 실행하는 프로세스 환경 또는 해당 agent workspace의 `.env`에 둡니다. 자격증명을 저장소에 커밋하지 않습니다. 헤더 값은 모델 목록 조회와 추론 양쪽에 동일하게 적용되며 API 응답과 trace에 설정값으로 반환하지 않습니다.

기본 Bearer 인증 대신 회사의 전체 Authorization 값을 사용해야 한다면 `authMode: "none"`과 다음 참조를 사용합니다. 이 경우 `none`은 **자동 API 키 헤더를 만들지 않는다**는 의미이며 별도 헤더 인증은 적용됩니다.

```json
"headersEnv": { "Authorization": "COMPANY_AUTHORIZATION" }
```

`COMPANY_AUTHORIZATION`에는 회사가 요구하는 전체 값이 들어갑니다. 예: `Bearer <발급받은 값>`. 기본 API 키 인증과 사용자 지정 Authorization/x-api-key를 동시에 설정하면 거부됩니다.

헤더 이름은 대소문자를 구분하지 않고 중복 검사합니다. Host, Content-Length 등 전송 제어 헤더, Cookie, Proxy-Authorization과 줄바꿈·제어문자가 들어간 값은 거부합니다. 헤더는 최대 16개, 값은 각 4096자입니다. 참조한 환경변수가 없으면 요청하지 않고 실패합니다.

`headersEnv`는 호스트 설정 전용입니다. HTTP 모델 설정 API로 임의의 서버 환경변수 이름을 지정할 수 없습니다. 같은 URL·API로 모델을 변경하면 기존 참조를 유지하고, 대상 URL·API를 바꾸면 이전 참조를 제거합니다. 추론과 목록 조회 모두 리다이렉트를 따르지 않으므로 프록시가 반환하는 redirect 대신 최종 API 주소를 설정해야 합니다.

파일을 직접 편집한 후 Pida를 재시작합니다. 프로젝트 저장소 `D:\pida`와 설정이 들어 있는 agent workspace `D:\pida\my-agent`를 구분하십시오.

## 확인된 범위와 남은 실사용 시험

- 자동 테스트: 로컬 HTTP protocol fixture + 실제 Pi 어댑터로 SSE, 도구 호출 후 도구 결과 재전송, 환경변수 헤더, 키/헤더 갱신, 선택적 요청 필드, 목적지 변경, redirect 거부를 검사합니다.
- 연결되지 않은 것: 회사 폐쇄망의 실제 서비스·자격증명·모델. 회사 LightLLM에서의 실제 작업 성공 여부는 아직 미검증입니다.
- 회사에서 먼저 확인할 것: 모델 응답 → 도구 호출 → 작은 파일 수정 → 실행 가능한 검사 → 취소. 일반 대화 성공과 에이전트 작업 성공을 따로 기록합니다.
- KV cache: 이번 패치는 gateway 요청 호환성을 제공합니다. 서버의 KV cache 문제나 LiteLLM/OpenCode에서 관측한 문제를 해결했다고 주장하지 않습니다. 동일 모델·gateway·대화 조건의 비교 기록이 필요합니다.

## 근거

LightLLM `ccf4e33d0ce9895fdbbf70da90e5062bcb6e55b2` 기준 확인:

- [공식 OpenAI API 예시](https://github.com/ModelTC/LightLLM/blob/ccf4e33d0ce9895fdbbf70da90e5062bcb6e55b2/docs/EN/source/tutorial/openai.rst)
- [HTTP 경로: `/v1/chat/completions`, `/v1/models`](https://github.com/ModelTC/LightLLM/blob/ccf4e33d0ce9895fdbbf70da90e5062bcb6e55b2/lightllm/server/api_http.py)
- [요청 모델: 두 token-limit 필드와 streaming 옵션](https://github.com/ModelTC/LightLLM/blob/ccf4e33d0ce9895fdbbf70da90e5062bcb6e55b2/lightllm/server/api_models.py)
- [추론·도구 호출 응답 처리](https://github.com/ModelTC/LightLLM/blob/ccf4e33d0ce9895fdbbf70da90e5062bcb6e55b2/lightllm/server/api_openai.py)
