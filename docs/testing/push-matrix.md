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

Per-app push scope for installed apps ([#1606](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1606)) is still being built. Rows that depend on it say "after #1606".

## How delivery works, in one paragraph

Every inbox row gets one `local` delivery in `notification_deliveries`, due 20 s after it is created. Any window of that user that is visible, or in a Meet call, calls `POST /api/v1/notifications/{id}/local-ack` on its next inbox poll (about every 15 s, sooner after a chat `notify-hint`). That sets `acked_at`, and the sweep then skips push on **every** device. When nothing acks within the 20 s, `wgw:notify:vapid-sweep` (cron, once a minute) sends Web Push to every `push_subscriptions` row of that user and sets `sent_at`. So push lands about 20–80 s after the event.

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

   Hosts: Chrome and Android Chrome `fcm.googleapis.com`, Edge `*.notify.windows.com`, Firefox `updates.push.services.mozilla.com`, Safari and iOS `web.push.apple.com`.

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
| P7 | VAPID key changed | Disposable install only. Note A's `push_subscriptions` rows. Move `wgw-content/keys/vapid-public.txt` and `vapid-private.txt` aside and run `php artisan wgw:vapid-keys` (or change `WGW_VAPID_*` and clear the config cache). With A's app closed, B sends a DM; wait 20 s, sweep. Then open A's app, close it, B sends another DM, sweep | First sweep: `vapid_send_rejected` (FCM answers 403), the old row is pruned, `sent_at` set, no notification. On app open (#1647): a `DELETE` of the old endpoint (sent as POST with `X-HTTP-Method-Override`), then `POST …/push/subscriptions`, and a new row. Second DM arrives. A push service that answers another 4xx (for example 401) is **not** pruned: it is retried with backoff and given up after one hour. Record the status it returned |

## Platform notes

| ID | Platform | Install | Notes |
| -- | -------- | ------- | ----- |
| D1 | Chrome desktop, tab | — | Shares one subscription with D2 in the same profile |
| D2 | Chrome desktop, installed | Install from the address bar | "Hidden" = minimized or behind another app. Closing the app while a D1 tab is still open is P2, not P3 |
| D3 | Edge desktop, tab | — | Push host `*.notify.windows.com` |
| D4 | Edge desktop, installed | Apps → Install this site as an app | As D2 |
| D5 | Firefox desktop, tab | — | Push host `updates.push.services.mozilla.com`. Firefox may answer a VAPID mismatch with a status other than 403; record it in P7 |
| D6 | Firefox desktop, installed | Only where Firefox can install a web app | Record N/A on a Firefox build without web-app install |
| D7 | Safari desktop, tab | — | macOS Safari 16+. Push host `web.push.apple.com`. P6b: no worker console path like Chromium; mark "not proven" if it cannot be run |
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
| D1 Chrome tab | pass (M1), incl. P1b | pass (M1), incl. P2b, P2c | pass (M2) | | partial (M1): call pass, lobby (P5b) not proven | | pass (M2) |
| D2 Chrome installed | | | | | | | |
| D3 Edge tab | | | | | | | |
| D4 Edge installed | | | | | | | |
| D5 Firefox tab | | | | | | | |
| D6 Firefox installed | | | | | | | |
| D7 Safari tab | | | | | | | |
| D8 Safari installed | | | | | | | |
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

## Full run — pending

The last acceptance criterion of [#1608](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1608) is one full run of this matrix. It waits for:

- [#1652](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1652), [#1647](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1647), [#1651](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1651) and [#1702](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1702) on `main` ([#1700](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1700) is merged);
- real devices for the Safari, Android and iOS rows;
- [#1606](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1606) for the per-app expectations in I2.

A person runs it on their own devices. Record it as M3 with the commit under test, and update the scorecard.
