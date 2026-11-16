# Push delivery matrix (manual audit)

One test plan for Web Push on every browser and device we support. Tracked on [#1608](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1608) (epic [#1600](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1600)). The pipeline itself is described in [suite-notify.md](../architecture/suite-notify.md) ("In-app delivery") and [notifications.md](../architecture/notifications.md).

The expected results below describe the behaviour **once the epic's fixes have landed**:

| PR | Issue | Behaviour this matrix expects | State on 2026-10-28 |
| -- | ----- | ----------------------------- | ------------------- |
| [#1652](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1652) | [#1601](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1601) | The sweep takes up to 100 due deliveries, oldest `due_at` first. A failed send (no response, 413, 429, 5xx) moves `due_at` back by the delivery's age (at least 60 s). A delivery still unsent one hour after it was created is deleted. 400, 403, 404 and 410 prune the subscription | Open |
| [#1647](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1647) | [#1602](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1602) | On app load, a browser subscription made with another VAPID key is deleted on the server, unsubscribed, and replaced by one on the current key | Open |
| [#1651](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1651) | [#1603](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1603) | Every refused send logs `vapid_send_rejected` (status, host). A sweep run with failures logs one `vapid_sweep_failures` summary. Logs carry the push-service host only, never the endpoint | Open |
| [#1700](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1700) | [#1604](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1604) | The service worker handles `pushsubscriptionchange`: it signs itself in with the refresh cookie and posts the new subscription, even with no window open | Merged |
| [#1702](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1702) | [#1605](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1605) | Only a visible window, or a window in a Meet call (`in-call`, not the lobby), local-acks. A hidden window shows no page notification of its own; the service-worker push is the only OS notification path | Open |

On 2026-11-13 all five PRs above are merged, and per-app push scope for installed apps ([#1606](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1606)) has landed: only an iOS Home Screen app posts its own scope; browser tabs and desktop or Android installed apps post `/` and receive every domain.

## How delivery works, in one paragraph

Every inbox row gets one `local` delivery in `notification_deliveries`, due 20 s after it is created. Any window of that user that is visible, or in a Meet call, calls `POST /api/v1/notifications/local-ack` with the ids it has not acked yet on its next inbox poll (about every 15 s, sooner after a mesh `check-now` while push is down). That sets `acked_at`, and the sweep then skips push on **every** device. When nothing acks within the 20 s, `wgw:notify:vapid-sweep` (cron, once a minute) sends Web Push to every `push_subscriptions` row of that user and sets `sent_at`. So push lands about 20–80 s after the event. Exception (#1670): a meeting start (`meet.started`) has no grace. Its push goes out right after the request that started the meeting, so it lands within a few seconds; the sweep only sends to subscriptions that did not get it then. In Chromium and Firefox desktop, a browser with a visible WGW window shows the meeting in the bell instead of an OS notification; Safari and every iOS browser show both.

## Prerequisites

- An install every test device can reach over **HTTPS**. Desktop browsers on the same machine may use a local origin such as `http://127.0.0.1:5190`. Phones need a trusted certificate. Do not write the host of a live install in a run record.
- A **disposable** install for P7. Changing the VAPID key stops push for every subscriber until each one opens the app again.
- PHP has `gmp` or `bcmath`, and VAPID keys exist (`php artisan wgw:vapid-keys`).
- Two users: **A** receives (for example `member`), **B** sends (for example `admin`). Unless a case says otherwise, the event is **B sends A a chat DM** (`chat.message_posted`).
- On each device under test: A is signed in, notifications are allowed for the site, and the OS shows banners (macOS Focus or iOS Focus off, system notification permission granted to the browser).
- Before the first case on a device, check that it has its own `push_subscriptions` row (see [Verify](#verify)). Permission "granted" alone is not enough.
- One browser profile per row. A tab and an installed app of the same Chrome, Edge or Android Chrome profile share one service worker at `/` and one subscription.

## Verify

Run each step **20 s or more after the event**, from `packages/api`.

1. **Sweep by hand:**

   ```bash
   php artisan wgw:notify:vapid-sweep
   ```

   It prints `Swept VAPID fallback; sent N payload(s).` `N` counts subscriptions that accepted the push or were pruned for good. When a send failed it also prints `N push send(s) failed; see vapid_sweep_failures in the log.` If the scheduler already swept, `N` is 0; the columns below still show what happened.

2. **Delivery columns** (`php artisan db wgw` opens the `wgw` database):

   ```sql
   SELECT n.principal, n.domain, n.action, n.created_at,
          d.channel, d.due_at, d.acked_at, d.sent_at
   FROM notification_deliveries d
   JOIN notifications n ON n.id = d.notification_id
   WHERE n.principal = 'member'
   ORDER BY n.created_at DESC
   LIMIT 5;
   ```

3. **Subscriptions** (record the host only; the full endpoint is a secret):

   ```sql
   SELECT principal, substr(endpoint, 1, 40) AS endpoint_start,
          user_agent, created_at, updated_at
   FROM push_subscriptions
   WHERE principal = 'member'
   ORDER BY created_at;
   ```

   Hosts: Chrome Stable and Android Chrome Stable `fcm.googleapis.com`. Chrome Beta, Dev, Canary and unbranded Chromium `jmt17.google.com` (#1891). Edge `*.notify.windows.com`, Firefox `updates.push.services.mozilla.com`, Safari and iOS `web.push.apple.com`. The server only stores endpoints on these hosts; any other host answers 400 and leaves no row.

4. **Log** (`storage/logs/laravel.log`): look for `vapid_send_rejected` (one per refused send; 404/410 at info, others at warning), `vapid_send_failed` (no response) and `vapid_sweep_failures` (one summary per sweep run with `sent`, `failed`, `by_status`, `by_host`).

How to read the delivery row:

| `acked_at` | `sent_at` | Meaning |
| ---------- | --------- | ------- |
| set | NULL | A visible window or a Meet call acked it. No push on any device |
| NULL | set | The sweep handled it. Push went to every subscription, **or** A had no subscription at all (check step 3) |
| NULL | NULL, `due_at` in the past | Not swept yet. Run step 1 |
| NULL | NULL, `due_at` moved later | A send failed for a reason that is worth a retry. The log has `vapid_send_rejected` or `vapid_send_failed` |
| row gone | | Older than one hour and never sent (given up), or acked or sent and cleaned up two hours after it was created |

## Cases

| ID | Case | Steps | Pass criteria |
| -- | ---- | ----- | ------------- |
| P1 | Window visible | A's window is on screen. B sends a DM. Wait 20 s, run the sweep | Bell updates with the chime. No OS notification on any device of A. Row: `acked_at` set, `sent_at` NULL |
| P1b | Visible + hidden second tab | A has two tabs in one browser: one on screen, one in the background. B sends a DM | As P1. The background tab shows nothing of its own |
| P2 | Window hidden | Switch A's window to another tab or app (or minimize it) and wait 10 s. B sends a DM. Wait 20 s, run the sweep | Exactly **one** OS notification on this device (from push), and one on every other subscribed device. Clicking it opens the chat. Row: `acked_at` NULL, `sent_at` set |
| P2b | Hidden, then visible within the grace | As P2, but bring the window back within about 5 s of the DM | The window re-fetches at once and acks. No OS notification anywhere. If you come back after 20 s or more, push may already have gone out; that is expected |
| P2c | Hidden, no subscription | On a device with no `push_subscriptions` row (for example permission denied, or the row deleted), hide the window. B sends a DM | No OS notification on this device; the window shows no toast of its own (#1702). The bell shows the DM when the window is visible again. Row: `acked_at` NULL, `sent_at` set. Other devices of A with a row get push as in P2 |
| P2d | Reload after push | After P2 (DM still unread), reload the window while it is on screen | The tray still lists the DM. No new OS notification on any device |
| P3 | App closed | Close every WGW tab and installed app of A on this device (iOS and Android: swipe it away). B sends a DM. Wait 20 s, run the sweep | OS notification within about 80 s; clicking it opens the app on the chat. Row: `sent_at` set |
| P4 | Two devices | **a)** A's device 1 visible, device 2 closed. **b)** Both hidden or closed. B sends a DM each time | **a)** Device 1 acks; device 2 stays silent (an ack holds push back on every device). **b)** Both devices show one OS notification. `push_subscriptions` has one row per device |
| P5 | Meet call, window hidden | A joins a Meet call (admitted, `in-call`) with B or a second user, then switches to another app so the call window is hidden. B sends a DM | No OS notification on any device of A. Row: `acked_at` set. The bell shows the DM when A comes back. If the hidden call window polls too late and push wins the race, record it as a finding |
| P5b | Meet lobby, window hidden | A waits in a Meet lobby (knocking, not admitted) with the window hidden. B sends a DM | The lobby does not count as a call: push goes out as in P2 |
| P6 | Subscription rotated | Browsers do not let you fire a real `pushsubscriptionchange` on demand. Run both parts. **a) Window path:** with the app open, run `(await navigator.serviceWorker.ready).pushManager.getSubscription().then((s) => s?.unsubscribe())` in the page console. Close the app. B sends a DM, wait 20 s, sweep. Open the app, close it, B sends another DM, sweep. **b) Worker sign-in:** with every app window closed, open the worker console (Chromium: `chrome://inspect/#service-workers`) and run `(await fetch("/api/v1/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "same-origin" })).status` | **a)** First sweep: `vapid_send_rejected` with 404 or 410 (info), the old row is pruned, no notification. After reopening: `POST /api/v1/notifications/push/subscriptions` 2xx and a new row with a different endpoint. Second DM arrives as an OS notification. **b)** `200`, and A is still signed in when the app opens. Record a real `pushsubscriptionchange` only when one is observed; otherwise mark that part "not proven" |
| P8 | Meeting started, app closed | Close every WGW window of A on this device. B starts a meeting A is invited to (a meeting chat channel shared with A, B joins). Do **not** run the sweep | OS notification within a few seconds. Log: one `urgent_push_sent` line. Rows: one `vapid` row per subscription that got it, local row `sent_at` set |
| P8b | Meeting started, window visible | A's window is on screen. B starts a meeting as in P8 | The bell shows the meeting at once, with one chime. Chromium and Firefox desktop: **no** OS notification on this device (other devices of A: one each). Safari and iOS: the bell **and** an OS notification (accepted duplicate). Chrome must not show "This site has been updated in the background" |
| P8c | Meeting started, installed Android app on screen | As P8b in an installed Chrome app (WebAPK) on Android | As P8b for Chromium. If Chrome shows "This site has been updated in the background", record it: the visible-tab exemption does not cover installed apps there |
| P7 | VAPID key changed | Disposable install only. Note A's `push_subscriptions` rows. Move `wgw-content/keys/vapid-public.txt` and `vapid-private.txt` aside and run `php artisan wgw:vapid-keys` (or change `WGW_VAPID_*` and clear the config cache). With A's app closed, B sends a DM; wait 20 s, sweep. Then open A's app, close it, B sends another DM, sweep | First sweep: `vapid_send_rejected` (FCM answers 403), the old row is pruned, `sent_at` set, no notification. On app open (#1647): a `DELETE` of the old endpoint (sent as POST with `X-HTTP-Method-Override`), then `POST …/push/subscriptions`, and a new row. Second DM arrives. A push service that answers another 4xx (for example 401) is **not** pruned: it is retried with backoff and given up after one hour. Record the status it returned |

## Platform notes

| ID | Platform | Install | Notes |
| -- | -------- | ------- | ----- |
| D1 | Chrome desktop, tab | — | Shares one subscription with D2 in the same profile. Stable uses `fcm.googleapis.com`; Beta, Dev and Canary use `jmt17.google.com` |
| D2 | Chrome desktop, installed | Install from the address bar | "Hidden" = minimized or behind another app. Closing the app while a D1 tab is still open is P2, not P3. Installing needs a hand click: the DevTools protocol `PWA.install` command is not available in Chrome 157 Stable or Chrome 160 Canary on macOS |
| D3 | Edge desktop, tab | — | Push host `*.notify.windows.com`. Edge was not installed on the Mac used for M3 |
| D4 | Edge desktop, installed | Apps → Install this site as an app | As D2 |
| D5 | Firefox desktop, tab | — | Push host `updates.push.services.mozilla.com`. Firefox may answer a VAPID mismatch with a status other than 403; record it in P7 |
| D6 | Firefox desktop, installed | Only where Firefox can install a web app | Record N/A on a Firefox build without web-app install. Firefox 158 on macOS has none. Firefox answers a push signed with another VAPID key with `401` (errno 109), not `403` |
| D7 | Safari desktop, tab | — | macOS Safari 16+. Push host `web.push.apple.com`. P6b: no worker console path like Chromium; mark "not proven" if it cannot be run. The "Allow notifications" prompt needs a hand click: `safaridriver` answers the WebDriver Set Permission command with `501` |
| D8 | Safari desktop, installed | File → Add to Dock | Own storage and own subscription, separate from D7 |
| A1 | Android Chrome, tab | — | "Hidden" = another app in front, or the screen off |
| A2 | Android Chrome, installed | Install app / Add to Home screen | Shares one subscription with A1 in the same profile |
| I1 | iOS, suite PWA | Safari → Share → Add to Home Screen from `/` | iOS 16.4+. Push only works in a Home Screen app. Check for a `web.push.apple.com` row before the cases. Receives every domain, also after #1606 |
| I2 | iOS, single-app PWA | Add to Home Screen from an app path, for example `/docs` | Own storage and own subscription. Before #1606: expect its own row, and possibly the same alert in I1 and I2; record what you see. After #1606: it only gets push for its own domain (for example `docs.*`), and a click opens inside that app. The bell stays suite-wide |
| I3 | iOS, Safari tab | — | **No push.** Safari tabs on iOS have no Web Push, so no `push_subscriptions` row comes from this device. P1 must pass (bell and chime while visible); P2, P3, P6 and P7 have no OS notification on this device, and other devices of A still get push. Mark the push columns N/A |

## Result notation

Same as [rtc-network-matrix.md](rtc-network-matrix.md): **pass (M#)**, **fail (M#, issue)**, **partial (M#)** with the missing part named, **not proven** (tried, could not be reached), **N/A** (the platform cannot do it), **not run** (empty cell). `M#` links to a dated run below with the build under test.

## Scorecard

| Row | P1 visible | P2 hidden | P3 closed | P4 two devices | P5 Meet hidden | P6 rotated | P7 key changed |
| --- | ---------- | --------- | --------- | -------------- | -------------- | ---------- | -------------- |
| D1 Chrome tab | pass (M1, M3), incl. P1b | pass (M1, M3), incl. P2b, P2c, P2d | pass (M2, M3) | pass (M3) | fail (M3, [#2129](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/2129)): call acked after the grace in 4 of 9; pass with [#2131](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2131). P5b pass (M3) | partial (M3): a and b pass, no real `pushsubscriptionchange` seen | pass (M2, M3) |
| D2 Chrome installed | not proven (M3): install needs a hand click | | | | | | |
| D3 Edge tab | not run: Edge not installed on the test Mac (M3) | | | | | | |
| D4 Edge installed | not run: Edge not installed on the test Mac (M3) | | | | | | |
| D5 Firefox tab | pass (M3) | pass (M3), incl. P2b, P2d | pass (M3) | pass (M3), with D1 as device 2 | not proven (M3): the window joined the team room, not the meeting | partial (M3): a pass, b not proven | pass (M3): `401`, row kept until the app reopened |
| D6 Firefox installed | N/A (M3) | N/A | N/A | N/A | N/A | N/A | N/A |
| D7 Safari tab | not proven (M3): the permission prompt needs a hand click | | | | | | |
| D8 Safari installed | not proven (M3): Add to Dock and the permission prompt need hand clicks | | | | | | |
| A1 Android tab | | | | | | | |
| A2 Android installed | | | | | | | |
| I1 iOS suite PWA | | | | | | | |
| I2 iOS single-app PWA (after #1606) | | | | | | | |
| I3 iOS Safari tab | | N/A | N/A | | | N/A | N/A |

<a id="manual-runs-2026-10-28"></a>

## Manual runs — 2026-10-28 (Chrome desktop, partial, M1)

Build under test: [#1702](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1702) at `c72e0f721`, on a local test install. Chrome desktop, browser tab, A = `member`. Only the cases #1702 changes were run; this is not the full run.

### Passed (M1)

| ID | Setup | Result |
| -- | ----- | ------ |
| P1 | Tab on screen | Passed: acked, no OS notification |
| P1b | Two tabs, one on screen | Passed: acked, no toast from the background tab |
| P2 | Tab hidden | Passed: one OS notification, from push |
| P2b | Hidden, then visible within the grace | Passed: acked on becoming visible, no push |
| P2c | Hidden, no push subscription | Passed: no OS notification and no page toast |
| P5 | Meet call, window hidden | Passed: acked, no push |

### Not proven (M1)

| ID | Why |
| -- | --- |
| P5b | The Meet lobby could not be reached as a signed-in member, so the "lobby does not count" rule was not exercised by hand. A unit test covers it |

### Not run (M1)

P2d, P3, P4, P6, P7, and every row other than D1. P3 and P7 were run later in [M2](#manual-runs-2026-10-28-m2).

<a id="manual-runs-2026-10-28-m2"></a>

## Manual runs — 2026-10-28 (Chrome desktop, partial, M2)

Build under test: `main` of that day plus [#1652](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1652), [#1647](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1647) and [#1651](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1651) merged together on a local test install. [#1702](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1702) was **not** included. Chrome for Testing desktop, browser tab, A = `member`. Only P3 and P7 were run; this is not the full run.

### Passed (M2)

| ID | Setup | Result |
| -- | ----- | ------ |
| P3 | App page closed, browser left running. B sent a DM | After 20 s, the manual sweep printed `sent 1`. One OS notification with the DM text, shown by the service worker |
| P7 | Moved `vapid-*.txt` aside; the sweep created new keys. App closed, B sent a DM | FCM answered 403. The log had `vapid_send_rejected` (status 403, host `fcm.googleapis.com`, reason `Forbidden`) at warning and one `vapid_sweep_failures` summary; the command printed `push send(s) failed`. The row was pruned and no notification was shown. On reopening: POST with `X-HTTP-Method-Override: DELETE` for the old endpoint (204), then POST of the new subscription (201), leaving one row. The next DM arrived as an OS notification |
| Log hygiene | `grep` of the log after P7 for `/fcm/send/`, long `/wp/` tokens and `web.push.apple.com/` paths | 0 matches: no endpoint paths in the log |

### Note (M2)

In a brand-new Chrome for Testing profile, the first push after the first subscribe was not shown. Chrome replaced that subscription at once. The new endpoint was posted on the next app load. On the next sweep the old row answered 410 and was pruned (`vapid_send_rejected` at info). In an existing profile every push was delivered. This is not a failure, but watch for it in the full run on real Chrome.

### Not run (M2)

P1, P2, P4, P5, P6, and every row other than D1. P1, P2 and P5 depend on #1702, which was not in this build; see [M1](#manual-runs-2026-10-28).

<a id="manual-runs-2026-11-13-m3"></a>

## Manual runs — 2026-11-13 (desktop, partial, M3)

Build under test: `main` at `3e52763eb` (production build, `vite build` + `vite preview`), API on the PHP built-in server with SQLite, on a local test install. macOS 26.6.2. A = `member`, B = `admin`; B sends every DM over the REST API, so no mesh `check-now` reaches A. The sweep was run by hand 25 s after each event; no cron ran. Every browser had its own fresh profile; notification permission was set to "Allow" in the profile before launch (Chromium: profile preferences, Firefox: `permissions.default.desktop-notification`), which stands in for a hand click on Allow.

Browsers: Chrome 157.0.8103.51 Stable (driven over the DevTools protocol, no automation flags), Firefox 158.0 (WebDriver BiDi), Safari 26.6.2 (`safaridriver`). Edge is not installed on this Mac.

"OS notification shown" means `registration.getNotifications()` listed it: the service worker called `showNotification`. The macOS banner itself and a click on it were not checked in M3.

### Passed (M3)

| Row | ID | Setup | Result |
| --- | -- | ----- | ------ |
| D1 | P1 | Tab on screen | Acked in the same second, no notification |
| D1 | P2 | Window minimized | One notification, `sent_at` set. The first push after the first subscribe in a new profile was shown (the M2 note did not repeat for this profile) |
| D1 | P2b | Hidden, back on screen 4 s after the DM | Acked when it came back, no push |
| D1 | P2d | Reload after P2 while on screen | The bell lists the DMs, no new notification |
| D1 | P3 | All WGW tabs closed, Chrome running | One notification, from the worker |
| D1 | P3, Chrome quit | Chrome quit before the DM, sweep sent it, Chrome started 20 s later | The notification showed when Chrome started again (the push service kept it) |
| D1 | P4a | Profile 1 on screen, profile 2 closed | Acked, no notification in either profile |
| D1 | P4b | Profile 1 minimized, profile 2 closed | One notification in each profile; one `vapid` row per subscription |
| D1 | P5b | Lobby ("Waiting to be let in"), window minimized | Not acked, one notification: the lobby does not count |
| D1 | P6a | `unsubscribe()` in the page, app closed | Sweep: `410` (info), row pruned, no notification. Reopen: new row with another endpoint; the next DM arrived |
| D1 | P6b | Worker console, every WGW tab closed | `/api/v1/auth/refresh` answered `200`; the app opened signed in |
| D1 | P7 | Keys moved aside, new keys, app closed | `403` from FCM (warning), row pruned, no notification. Reopen: new row; the next DM arrived |
| D5 | P1 | Tab on screen | Acked within 3 s, no notification |
| D5 | P2, P2b, P2d | As D1 | As D1 |
| D5 | P3 | All WGW tabs closed | One notification |
| D5 | P4 | Firefox as device 1, Chrome profile as device 2 | a) Firefox on screen: acked, nothing on either. b) Firefox minimized, Chrome closed: one notification on each |
| D5 | P6a | As D1 | `410` from `updates.push.services.mozilla.com`, pruned, new row on reopen, next DM arrived |
| D5 | P7 | As D1 | Mozilla answered `401` ("VAPID public key mismatch", errno 109) at warning. As documented, the row was **not** pruned: the delivery moved its `due_at` for a retry. On reopen the client deleted the old endpoint and posted a new one; the next DM arrived, and the window acked the retried DM |

### Failed (M3)

| Row | ID | Result |
| --- | -- | ------ |
| D1 | P5 | Member in a call with admin (2 in call), window minimized. Acks came 10, 22, 29, 26, 6, 11, 22, 11 and 6 s after the DM: four of nine after the 20 s grace. While every tab is hidden the push stream reconnects every 30 s, so the call window sees the row late, and a sweep in that gap alerts during the call. Filed as [#2129](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/2129); [#2131](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2131) keeps the stream at the visible pace during a call. With that branch, 15 DMs were acked 0–6 s after the event, also after more than 6 minutes hidden, and no sweep found an un-acked row. A colleague in the same call who sends from the app wakes the stream at once over the mesh; the gap shows for other senders |

### Not proven (M3)

| Row | ID | Why |
| --- | -- | --- |
| D1 | P6, real event | No real `pushsubscriptionchange` was observed |
| D2 | all | Installing needs a hand click; `PWA.install` is not available in Chrome Stable 157 or Canary 160 |
| D5 | P5 | Opening the meeting link in Firefox joined the team room call ("1 in call"), not the meeting the host held, so the case could not be set up. In that state the hidden window did not ack for minutes. Recheck by hand |
| D5 | P6b | WebDriver BiDi lists the worker realm but cannot evaluate in it, and there is no worker console otherwise |
| D7 | all | Signed in over `safaridriver`, but the "Allow notifications" prompt needs a hand click (WebDriver Set Permission answers `501`), so the tab has no subscription. The automation session then ended before P1 was recorded |
| D8 | all | Add to Dock and the permission prompt need hand clicks |

### Odd, not a failure (M3)

- A brand-new Chrome profile replaced its first subscription within a minute, as in M2. The old row stayed until a later sweep got `410` and pruned it.
- A `safaridriver` click on "Sign in" did not submit the form; `form.requestSubmit()` did. An automation quirk, not seen by hand.

### Not run (M3)

D3, D4 (Edge not installed), every phone row (A1, A2, I1, I2, I3), P8.

## Still to run

The last acceptance criterion of [#1608](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1608) is one full run of this matrix. After M3 these rows wait for a person:

- D2 Chrome installed, D7 and D8 Safari: hand clicks on Install, Allow and Add to Dock. D5 P5 in Firefox.
- D3 and D4 on a machine with Edge.
- A1, A2, I1, I2, I3 on real phones. The iOS simulator cannot get a Web Push subscription.

Record them as M4 with the commit under test, and update the scorecard.

<a id="hand-run-script"></a>

### Hand run script

Setup, once:

1. Use an HTTPS test install the phone trusts. Never a live install, and a disposable one if you run P7. On the Mac: a terminal in `packages/api` for the sweep and the SQL from [Verify](#verify).
2. B (`admin`) sends from the Mac, in a browser where A is not signed in, or over the API.
3. On each device: Focus off, banners allowed for the browser (iOS: for the Home Screen app once it asks).

Per row, before the cases: sign in as A, allow notifications when asked, then check that `push_subscriptions` has a new row with the host the [Verify](#verify) list gives for that platform. Write down the time of each DM, and run the sweep 25 s after it.

| Row | Install | Allow notifications |
| --- | ------- | ------------------- |
| D2 | Chrome: the install icon in the address bar, Install | Already allowed when D1 ran in the same profile; it shares that row |
| D7 | — | Safari asks on the first click in the app; click Allow |
| D8 | Safari: File → Add to Dock, open it from the Dock, sign in | Allow when it asks; expect a second `web.push.apple.com` row |
| A1 | — | Chrome on Android asks on the first tap; Allow |
| A2 | Chrome menu → Install app (or Add to Home screen), open it | Shares the A1 row; no new row expected |
| I1 | Safari → Share → Add to Home Screen from `/`, open from the Home Screen, sign in | Tap anywhere in the app, then Allow |
| I2 | As I1, but from `/docs` | Expect its own row with scope `/docs` |
| I3 | — (Safari tab) | No prompt and no row: expected |

Cases, per row (P1–P4 and P6a are enough on phones; P5 needs a second person in the call):

1. **P1, on screen.** Keep the app on screen. B sends a DM. Expect: the bell updates with a chime, no OS alert on any device of A, row `acked_at` set.
2. **P2, hidden.** Switch to another app (phone: home screen; Mac: minimize). Wait 10 s. B sends a DM. Sweep. Expect: exactly one alert on this device; tapping it opens the chat; row `sent_at` set. I3: no alert.
3. **P3, closed.** Close the app (phone: swipe it away in the app switcher). B sends a DM. Sweep. Expect: one alert within about 80 s; tapping opens the app on the chat.
4. **P4, two devices.** A on the Mac (on screen) and on the phone (closed). B sends a DM: nothing on either. Then both hidden or closed: one alert on each.
5. **P6a, rotated.** Desktop only, in the console: `(await navigator.serviceWorker.ready).pushManager.getSubscription().then((s) => s?.unsubscribe())`. Close the app, DM, sweep: the log has `vapid_send_rejected` 404 or 410, no alert. Open and close the app, DM, sweep: the alert arrives.
6. **I2 only, per-app scope.** With I1 and I2 both installed and closed: a DM (chat) shows once, from I1, not from I2. A Docs share or comment shows in I2 and opens inside it; I1 shows it too. The bell in I2 still lists every app.
