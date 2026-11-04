Source: #1670 (body-hash: c5093c6a)
Goal: WeGotWorkspace/Product#150

# Urgent Web Push for "meeting started"

Technical translation of Task #1670 under Epic #1600 (also delivers Epic #1659). The design is decided in [docs/architecture/notifications.md](../../../docs/architecture/notifications.md) ("Urgent active news"); this file fixes what an implementer must hold on to.

## Goal

A `meet.started` inbox row reaches the recipient's devices through Web Push within seconds of the write, also when no app is open. The server sends it right after the response of the write that caused it, bounded so a PHP worker is never held for long. A device whose browser has a visible WGW window gets the item in that window instead of an OS notification, where the browser allows that.

## Non-goals

- Choosing per user which news is urgent.
- A queue worker. The after-response callback runs on the web worker that served the write.
- The in-app toast itself (#1669). This task delivers the item to the visible client's inbox; the toast hooks in at the same place when #1669 lands.

## Affected packages

- `packages/api`: urgent send, per-subscription delivery rows, sweep, parallel sender, migration.
- `packages/apps`: service-worker decision, inbox merge of a posted item.
- `tools/load`: k6 urgent scenario.
- `docs`: notifications.md (spike result, built status), suite-notify.md, realtime-capacity.md, testing/push-matrix.md.

## Technical constraints

- **Urgent actions:** `meet.started` only (`UrgentPushService::ACTIONS`). Its local delivery is due at once (no 20 s grace), apart from a short hold (`UrgentPushService::SWEEP_HOLD_SECONDS`) so the cron sweep cannot pick it up while the after-response send is still running.
- **After the response:** Laravel `defer()`; one callback per event, holding the ids of every inbox row it created. No send happens inside the request.
- **Bound:** at most 20 subscriptions per event (round-robin over the recipients, newest subscription first per recipient), all sent at once through Guzzle async requests (curl multi), one hard deadline of 1.5 s from the start of the send, encryption included. Unsent and unfinished subscriptions stay open for the sweep. The cap and the deadline are config values (`wgw.push.urgent.max_subscriptions`, `wgw.push.urgent.timeout_ms`) so the load test can measure other values; the defaults are the decided ones.
- **Per-subscription status:** `notification_deliveries` gains a nullable `endpoint_hash`. A `vapid` row with an `endpoint_hash` records that this notification reached that subscription (2xx). The sweep and the urgent send skip such subscriptions. The `local` row keeps its role (grace, ack, done). The local row is marked `sent_at` only when no receiving subscription is still open; a partial failure is retried for the open ones only, with the existing back-off and give-up.
- **Scope filter:** urgent sends use the same `PushScopes` routing as `VapidPushService` (one code path, `VapidPushService::openSubscriptions()`).
- **Payload:** gains `id` (inbox row id), `domain`, `action` and `created_at`, so a client can show the row before its own inbox fetch.
- **Service worker:** with a visible window client of the origin, post `{ type: "wgw-notification-pushed", item }` to each visible client. Skip the OS notification only where the browser exempts it (rule recorded in notifications.md, decided by the spike): Chromium yes, Firefox desktop yes, Firefox for Android no, WebKit (Safari, every iOS browser) no. Everywhere else, and without a visible client, show it as today.
- **Client de-duplication:** the inbox merges a posted item by id. It stays merged until a list that contains it arrives, or for 10 s; the existing seen-set prevents a second chime when the list later carries the same row.
- **Load test:** the k6 `urgent` scenario starts one meeting per iteration for a recipient with N subscriptions and reports `urgent_write_ms` and `urgent_worker_busy_ms` (write plus the wait of a probe request on a one-worker server). Measured numbers go to `docs/realtime-capacity.md`.

## Edge cases

- Two recipients share one browser endpoint: each recipient's row is its own message; status is per notification and endpoint.
- A permanent rejection (400/403/404/410) prunes the subscription; it is then no longer open.
- A visible window acks the row: the sweep skips the leftovers (existing local-ack meaning).
- The push lands while the window's own inbox fetch is in flight: the merged item survives that fetch.
- An older payload without `id`: no post; the OS notification shows as today.
- The `meet.started` row already exists (same room, not cleared): no new row, no urgent send (unchanged dedupe).
