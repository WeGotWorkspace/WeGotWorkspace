# Urgent Web Push for "meeting started"

Derived from [spec.md](./spec.md).

## Goal

Send the `meet.started` Web Push right after the write's response, bounded in count and time, with per-subscription delivery status so the cron sweep finishes the rest without repeats; let the service worker hand the item to a visible window instead of an OS notification where the browser allows it.

## Budget

Draws from the web worker budget on shared hosting (one PHP-FPM child held for at most about 1.5 s per meeting start). Displaces nothing; the cron sweep keeps its role for everything else and for leftovers.

## Non-goals

- Per-user urgency preferences, a queue worker, the in-app toast (#1669).

## What exists

- Every inbox row gets one `local` delivery due 20 s later. `path: packages/api/app/Events/NotifyListener.php:561`
- The sweep sends due, un-acked local deliveries sequentially, one `send()` per subscription, and marks the row sent when any subscription completed. `path: packages/api/app/Services/Notify/VapidPushService.php:116`
- Scope routing per installed app (#1606) lives in `receivingSubscriptions()`. `path: packages/api/app/Services/Notify/VapidPushService.php:280`
- `notification_deliveries` has one row per notification and channel; `CHANNEL_VAPID` is defined but unused. `path: packages/api/database/migrations/wgw/2026_09_12_000390_wgw_create_notifications.php:34`, `path: packages/api/app/Models/NotificationDelivery.php:30`
- `meet.started` fires from `markActivated()` during the first participant join (`POST /rooms/{room}/participants`). `path: packages/api/app/Services/Meet/MeetReservationService.php:194`, `path: packages/api/app/Services/Meet/MeetSignalingService.php:200`
- `defer()` is already used for after-response work. `path: packages/api/app/Services/Auth/PasswordRecoveryService.php:38`
- minishlink/web-push v11 sends sequentially in `flush()`; its concurrent `flushPooled()` needs an HTTPlug async client that is not installed (`composer show` lists no php-http adapter). `path: packages/api/vendor/minishlink/web-push/src/WebPush.php:161`
- The service worker shows every parsed push and never looks at open windows. `path: packages/apps/src/sw.ts:42`
- The inbox de-duplicates by id through `seenRef`, and plays the chime only for unseen rows. `path: packages/apps/src/notifications-core/src/notifications-provider.tsx:96`
- #1669 (toasts) is open, so the visible window gets the row in its inbox and the toast hooks in later:
  > `gh issue view 1669 --json state,title` → `OPEN In-app toasts for active news`
- The k6 script has a JMAP push scenario but nothing for Web Push. `path: tools/load/rtc-shared-hosting.k6.js:53`

## Considered

- Parallel send: `flushPooled()` with `php-http/guzzle7-adapter` — rejected, a new dependency for one call site. Chosen: a small `WebPush` subclass that exposes the library's own request building (`prepare()`), sent with Guzzle `sendAsync` (curl multi) under one deadline.
- Status per subscription: a new table — rejected; `notification_deliveries` already carries channel `vapid` and the cleanup paths. Chosen: nullable `endpoint_hash` on that table. Endpoint hash, not subscription id, so a pruned and re-posted subscription with the same endpoint is not sent the same push again.
- Partial failure in the sweep: keep "any success marks sent" — rejected, the AC asks that open subscriptions keep getting tried. Chosen: retry while any receiving subscription is open, with the existing back-off and one-hour give-up.
- Cap order: first 20 subscriptions by id — rejected, one recipient with many stale devices would starve the others. Chosen: round-robin over recipients, newest subscription first.
- Visible-client rule: skip the OS notification in every browser — rejected by the spike (WebKit shows the declarative payload anyway on 18.4+ and revokes subscriptions after silent pushes before that; Firefox for Android charges silent pushes against a quota). Chosen: per-browser rule from the spike.
- Client handling of the posted item: refetch the inbox — rejected, it waits for a request and does not work while the API is rate-limited. Chosen: merge the item by id and let the `Notification` push or poll confirm it.
- Testing the after-response path with `withoutDefer()` — rejected (review finding 2026-10-13: it runs deferred work inline). Chosen: assert nothing is sent before the deferred callbacks run, and that the HTTP flow sends after `RequestHandled`.

## Affected packages

- packages/api | packages/apps | tools/load | docs

## Dependencies

1. Spike (chunk-spike) before chunk-sw.
2. chunk-api before chunk-k6 (the scenario drives the urgent send).
3. chunk-api and chunk-sw are independent (payload fields are additive).

## Open decisions

None — every choice is made. The cutoff of 20 and the 1.5 s deadline are the decided values; chunk-k6 measures them and records the numbers.

## Invariants

- Normal actions keep the 20 s grace and are sent only by the sweep. A wrong change sends every notification at once and floods devices that have a visible window. Proof: `path: packages/api/tests/Feature/Notify/UrgentPushTest.php` assertion `test_normal_action_keeps_the_grace_and_sends_nothing_after_the_response`.
- The sweep never sends a notification twice to one subscription. A wrong change repeats a meeting push on every cron tick after a partial urgent send. Proof: `path: packages/api/tests/Feature/Notify/UrgentPushTest.php` assertion `test_sweep_sends_only_to_subscriptions_the_urgent_send_left_open`.
- Scope routing per installed app keeps working for both paths. Proof: `path: packages/api/tests/Feature/Notify/PushScopeTest.php` (unchanged, still green) and `path: packages/api/tests/Feature/Notify/UrgentPushTest.php` assertion `test_urgent_send_respects_push_scopes`.
- Without a visible client, or in WebKit, the service worker still shows the OS notification. A wrong rule silences pushes on closed apps or gets the Safari subscription revoked. Proof: `path: packages/apps/src/notifications-core/src/push-delivery.test.ts`.
- After chunk-api alone, main still works: the new payload fields are ignored by the current service worker. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/notifications-core/src/parse-notification-push-payload.test.ts`.

## Chunks

### Chunk spike: per-browser rule
- **Skill:** document
- **Inputs:** Chromium `PushMessagingNotificationManager::DidCountVisibleNotifications` (visible active tab of the origin → no notification needed); Firefox `PushService._updateQuota` / `PushRecord.getLastVisit` (an open tab resets the quota on desktop; GeckoView reads history); WebKit "Meet Declarative Web Push" (declarative payload shown as fallback; no silent push).
- **Done when:** the rule per browser, with its source, is in `docs/architecture/notifications.md`.
- **Verify with:** `cmd: pnpm run check:agent-docs`
- **Parallel with:** chunk-api

### Chunk api: urgent send and per-subscription status
- **Skill:** api
- **Inputs:** `path: packages/api/app/Services/Notify/VapidPushService.php:170`, `path: packages/api/app/Events/NotifyListener.php:512`
- **Done when:** migration adds `endpoint_hash`; `UrgentPushService` defers one bounded send per event; `WebPushSender::sendMany()` sends in parallel under a deadline; the sweep sends only to open subscriptions; feature tests for urgent vs normal, cap, timeout, no resend, scopes; sender test proves parallel and the hard deadline.
- **Verify with:** `cmd: pnpm test:api-done-gate`
- **Parallel with:** chunk-sw

### Chunk sw: visible-client hand-off
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/sw.ts:42`, `path: packages/apps/src/notifications-core/src/notifications-provider.tsx:96`
- **Done when:** `pushDeliveryPlan()` decides post and show; `sw.ts` uses it; the provider merges a posted item by id; Vitest for the decision, the merge and the provider.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/notifications-core`
- **Parallel with:** chunk-api

### Chunk k6: measure the cutoff
- **Skill:** testing
- **Inputs:** `path: tools/load/rtc-shared-hosting.k6.js:53`
- **Done when:** the `urgent` scenario reports `urgent_write_ms` and `urgent_worker_busy_ms`; a run at 5, 10, 20 and 40 subscriptions is recorded in `docs/realtime-capacity.md`.
- **Verify with:** `cmd: k6 run tools/load/rtc-shared-hosting.k6.js` with `URGENT_ONLY=1`
- **Parallel with:** none

## Test plan

- [ ] API: failing feature tests → implement → `pnpm test:api-done-gate`.
- [ ] UI: Vitest for `pushDeliveryPlan`, `withPushedItems`, payload parsing and the provider message path.
- [ ] Browser: Chromium with a real push service — app closed gets the push in seconds; visible window gets the bell row and no OS notification.

## Doc updates

- `docs/architecture/notifications.md`, `docs/architecture/suite-notify.md`, `docs/realtime-capacity.md`, `docs/testing/push-matrix.md`.
