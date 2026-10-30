# Scoped browser verification

Pida's optional `ui_check` uses Playwright Chromium with the same isolated renderer as the service preview. It verifies the supplied steps against the current service HTML. A successful check is evidence about those steps, not independent acceptance of every user requirement.

MAGI's completion gate compares the recorded execution with the current workspace before judging completion. Pida reuses that principle through its existing final artifact inspection and revision-bound verification manifest; it does not add an LLM voting gate. Reference: MAGI [`council_advice.go`](https://github.com/sayaya1090/magi/blob/b3b34e75bd38b6b85752355ac8bc04a262e9b597/internal/app/council_advice.go).

## Enable

Set `"browserChecks": true` in the existing `pida.config.json` and restart Pida. Keep the other configuration fields. Install the optional Playwright dependency and a compatible Chromium browser on the server:

```powershell
cd D:\pida
npx --no-install playwright install chromium
npm run build
npm start -- .\my-agent --open
```

On a host with a compatible installed browser, set `PIDA_BROWSER_EXECUTABLE` to its executable path before starting the server. Pida never silently downloads a browser. On a closed network, obtain the dependency and browser through the organization's approved software channel. `BROWSER_UNAVAILABLE` means the check did not run; it is not a pass.

## Check a real interaction

Existing `{ "click": "#button", "visibleText": "Expected text" }` steps continue to work. The extended tool accepts:

```json
{
  "viewport": { "width": 390, "height": 844 },
  "steps": [
    { "visible": "#inspection-alerts", "visibleText": "점검 알림" },
    { "count": "#alert-list button:visible", "equals": 2 },
    { "fill": "#equip-search", "value": "압축기" },
    { "click": "#alert-list button:first-child", "visibleText": "상세" },
    { "select": "#detail-status", "value": "가동" },
    { "count": "#alert-list button:visible", "equals": 1 }
  ]
}
```

The actual selectors and expected values must match the app. `fill` targets an editable input; `select` chooses an option by its value. `visible` waits for a rendered element; `visibleText` can be used on its own or after an action. Visible means rendered visibility, not a guarantee that an element starts above the fold. `count` checks the number of matching elements at that moment, including hidden elements unless the selector includes `:visible`. It does not wait for asynchronous counts to converge.

There are at most 20 steps, selectors/text are at most 500 characters, and viewport bounds are 320–1920 by 320–1200. The default viewport remains 1280 by 820. Tool execution has a 15-second total deadline including browser launch and a 3-second per-action wait. The host helper can set a bounded total deadline for tests; the model cannot expand its own timeout.

## Evidence and failures

- `checks` retains completed steps and the failing step when available. `failedStep` is zero-based.
- `UI_CHECK_FAILED` covers a failed interaction/assertion or script error. `UI_CHECK_TIMEOUT` and `UI_CHECK_CANCELLED` distinguish deadline from user cancellation.
- Checks use a new browser context, no credentials or user profile, downloads/service workers disabled, and all external requests denied. The tool does not accept arbitrary evaluator code or edit source files.
- Check definitions include every step and the normalized viewport in their SHA-256 digest. Desktop and mobile failures have separate recovery keys. A desktop success cannot clear a failed mobile check.
- The manifest records the actual artifact snapshot. Later source edits make earlier checks stale. `verification_status` remains `UNKNOWN` for independent task acceptance even when these scoped checks pass.

## Developer verification

```sh
npm run build
node --test test/ui-check.test.mjs
node scripts/ui-check-check.mjs
```

The Node test checks validation, pre-cancellation, unavailable-browser handling, and evidence/recovery scope. It does not establish browser behavior. The separate script requires actual Chromium and exercises the service renderer, click, fill/filter, select/status update, element count, mobile visibility, script failure, network denial, timeout and cancellation. It exits with code 2 if Chromium is unavailable rather than reporting a pass.
