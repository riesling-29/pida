# ChatGPT provider authentication patch

Date: 2026-10-28 KST. Unreleased change on package 0.6.1; Pi packages stay pinned at 1.2.0. Apply on the Web Studio baseline delivered as `bb2a8c1e6fec82d4d6465dd5dc3a2872e25aaa12`. This patch implements local ChatGPT provider authentication; it does not replace Pida application authentication or integrate the Codex/OMP execution engine.

## Use

1. Rebuild the updated checkout with `npm run build`, then start the existing workspace. For the previously used layout: `npm start -- ./my-agent --open` (or `node dist/cli.js start ./my-agent`).
2. Open **모델 설정 → OpenAI → 인증 방식 → ChatGPT 계정 · 구독 사용**.
3. Choose **Continue with ChatGPT**, then open the displayed official login link and complete sign-in and ChatGPT-plan consent yourself.
4. Pida receives Pi's loopback callback. If the last browser address does not complete automatically, expand the fallback section and paste that complete callback URL into Pida's dedicated field. Do not post it in chat or logs. Only the matching pending login accepts it.
5. Select an available model and choose **연결 확인 후 적용**. This sends a short inference request and can consume plan usage. Only successful verification changes the selected provider/model.

Pi listens on `127.0.0.1:1455` by default. An unfinished Pi/Codex login on that port must finish or be cancelled before another login. This patch primarily targets a browser and Pida running on the same machine. Remote hosting, proxies and enterprise deployment have not been accepted by these tests. Do not expose the unaudited local demo as a public authentication service.

Login writes/replaces this workspace's ChatGPT credential; it does not change the selected provider/model. If ChatGPT is already selected, a successful re-login supplies the new credential for subsequent requests. Active runs block account replacement and local disconnect. Failed/denied/cancelled login retains the previous credential. **연결 해제** removes local tokens, keeps the stable host ID and selected configuration, and never switches to an API key. Manage remote app authorization separately in [ChatGPT usage settings](https://chatgpt.com/settings/usage).

## Configuration and integration

### Live acceptance using the selected account

After selecting and applying a ChatGPT model in settings, stop the workspace server with Ctrl+C before running this separate process. The OAuth store serializes refresh inside one process only; do not run another Pida instance against the same credentials during the test.

```powershell
cd D:\pida
npm run build
node scripts/real-model-e2e.mjs .\my-agent > chatgpt-e2e.json
```

The runner and its sequential restart child use the original workspace credential store, including rotated refresh tokens. Credentials are not copied into its disposable test directory or report. Tests make actual model calls and consume plan usage. They cover tool use, JavaScript repair/checks, successive UI edits/browser checks, manual compaction and process restart. These are bounded workbench tests, not general repository coding tests. A browser must be available through Playwright or `PIDA_BROWSER_EXECUTABLE`; otherwise the browser case is `NOT_RUN`.

For a later internal OpenAI-compatible API trial, configure a separate workspace for that endpoint and pass its path to the same runner. Provider compatibility, internal model tool calling and closed-network browser/dependency installation must be verified there. This OAuth trial does not establish those results. Keep the ChatGPT trial on non-sensitive sample data.

Existing configurations remain valid; API-key authentication is the default. OAuth is allowed only for the native OpenAI provider:

```json
{
  "kind": "native",
  "providerId": "openai",
  "authMode": "chatgpt",
  "modelId": "<model selected from the account list>",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

`apiKeyEnv` remains part of the native configuration shape for compatibility and is ignored in ChatGPT mode. The binding has **OAuth only**, so missing/expired/revoked subscription credentials cannot fall back to an ambient or saved API key. Other provider modes retain their original auth handling.

- Pi owns PKCE, state validation, callback exchange, consent-scope validation and refresh. Pida owns the authenticated UI, pending-flow lifecycle, workspace store and settings application. No OAuth protocol or runtime loop is copied.
- `ProviderBinding.credentials` is an optional host-owned Pi `CredentialStore`; runtime-created `ModelRuntime` instances receive it. Existing bindings still receive their original in-memory default.
- Credentials live at `<stateDir>/provider-chatgpt/credential.json`, installation UUID at `host.json`. Writes use private temporary files and rename; POSIX file mode is 0600. Existing links/hardlinks and oversized/corrupt credential files fail closed. Files are not encrypted; native Windows ACL behavior is not verified.
- Locks are shared per resolved credential directory inside one Node process. Pi refresh, new login and local disconnect serialize through that store. The existing workspace runtime lock remains required; this is not a distributed credential service. Refresh failures preserve the last credential, with raw token-endpoint errors removed before reaching Pi transcripts.
- Login expires after ten minutes and supports explicit cancellation/server-close cleanup. The browser stores only a pending-flow ID in sessionStorage, resumes polling after reload and clears callback input/auth links on completion. Access/refresh tokens and host/client registration values are never returned in settings/status, prompts or observation exports.
- Account model discovery uses authenticated `GET https://api.openai.com/v1/models`, filters visible models and intersects them with Pi's supported chat catalog. No unknown model's metadata is invented. The bundled API-key catalog remains offline. A successful probe establishes access for that request, not future entitlement.
- Pi 1.2.0 already implements Responses transport for ChatGPT tokens but emits flat function tools. A small public `onPayload` adapter groups those tools under the `pida` namespace, preserves tool-call history, converts system message items to developer items and removes fields unsupported by this route. Both streaming entry points use it. It leaves the API-key route unchanged and is covered by an actual Pi → Responses fixture → tool → follow-up cycle.

The account uses the public Responses endpoint. The legacy `openai-codex` / `backend-api` provider is not enabled. The returned ID token is not used as an application identity: the existing Pida token and `pida:configure` permission still authorize all settings changes. One ChatGPT credential per local workspace is supported, not a multi-user account manager.

## HTTP / client

Every route below requires ordinary Pida authentication and `pida:configure`; pending flows additionally belong to the principal who started them. Bodies reject unknown fields. Login URLs/callbacks are ephemeral exchange data; deployments must not log them.

| Method / path | Body / result | Client method |
| --- | --- | --- |
| `POST /v1/provider/chatgpt/login` | `{}` → ID, pending status and expiry | `startChatGPTLogin()` |
| `GET /v1/provider/chatgpt/login/:id` | Safe status; official auth URL/manual-input flag while pending | `getChatGPTLogin(id)` |
| `POST /v1/provider/chatgpt/login/:id/input` | `{value: fullCallbackUrl}` | `submitChatGPTLogin(id, value)` |
| `DELETE /v1/provider/chatgpt/login/:id` | Cancel and release the callback listener | `cancelChatGPTLogin(id)` |
| `POST /v1/provider/chatgpt/logout` | `{}` → local credential removed | `disconnectChatGPT()` |

Existing `/v1/provider/models`, `/test` and provider-apply routes accept native OpenAI `authMode: "chatgpt"`. Settings include safe `chatgpt.connected`/error metadata; this means credential presence, not a live entitlement check. Missing plan consent, callback-port conflict, expiry, ownership mismatch and storage errors have stable messages. A model request that fails later retains the runtime's existing failed-run behavior; no automatic billing-path fallback or repeated OAuth loop is added.

## Verification and remaining gates

`npm test`: **105 passed**, including six new auth cases. The new tests exercise real upstream OAuth code with intercepted token/model endpoints, loopback and manual callback, wrong state, cancellation, denied grant, owner/permission isolation, concurrent rotated-token refresh, refresh failure, failed-apply retention, actual Pi tool dispatch, restart, local logout, invalid files and account-change rejection during an active run.

`node scripts/chatgpt-browser-check.mjs`: actual browser/Pida/Pi callback with synthetic OpenAI responses; auth selection, reload during login, model discovery/apply, cancellation retaining credentials, disconnect/no fallback, no secrets in browser storage and mobile width. Existing `browser-check.mjs` and `studio-browser-check.mjs` pass. See [VALIDATION.md](VALIDATION.md).

**Not verified:** real OpenAI login/consent, account eligibility/plan limits, production model behavior, native Windows callback/ACLs, corporate network, remote/multi-user use and OpenAI authorization revocation. No real credentials or paid inference requests were used. The patch supplies the integration; actual-account acceptance is still required.

## Official contract references

Checked against the installed Pi implementation and current OpenAI documentation on 2026-10-28:

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Tools and namespaces](https://developers.openai.com/api/docs/guides/tools)

The official flow covers eligible accounts and supported local/open-source integrations; offering a paid or remotely hosted app has separate access conditions. This patch does not establish enterprise or commercial approval.
