# Suite notify pipeline

Canonical reference for the in-process mutation envelope, LAMP-safe notify delivery, and the first producers (VALARM due alerts, Doc share, chat message-posted). Tracker: Epic [#741](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/741). Product Goals: in-app alerts [#390](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/390), Doc share/comment [#548](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/548), closed-tab Calendar push [#493](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/493). VAPID primitives: chore [#495](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/495).

---

## Envelope

`App\Events\WorkspaceEvent` is a PHP DTO at dispatch time. Fields: `eventId`, `actor`, `domain`, `action`, `target`, `timestamp`, `data`, `visibility` (`internal` | `external-safe`).

There is **no** generic `events` table and **no** `tenant_id`. Notify persists inbox rows; nothing else stores the raw envelope.

## Dual dispatch

Two entry points, never mixed:

1. **DAV HTTP** — `EventDispatchPlugin` on `afterMethod:{PUT,PATCH,MKCOL,DELETE,MOVE,COPY}`. Skip non-2xx. Skip empty actor. Isolate exceptions (do not copy `SearchIndexPlugin` throw-through).
2. **REST / JMAP / MCP / Chat** — `EventDispatch::fire` / `fireMutation` beside existing `BestEffortSearchIndexSync` call sites. Chat is DAV-hidden (`ChatMessageRepository::create` only). Mail is not instrumented.

`EventDispatch::fire` is best-effort: listener exceptions are logged as `event_dispatch_failed` and never fail the write. Listeners are an explicit list in `AppServiceProvider` (`NotifyListener` only in this pass).

Search stays on `BestEffortSearchIndexSync`. Do not migrate the indexer onto this hook.

Drive disk I/O is `WgwStorage::files()`. Observation hooks are **three**: `FileNodeSetService`, `DriveService`, and the DAV `FileNodeIndexPlugin` / `EventDispatchPlugin`. Calendar / Contacts / Notes / Tasks mutate via CalPDO / CardPDO only.

## Notify curation

`NotifyListener` allow-list:

| domain | action |
|--------|--------|
| `docs` | `shared` |
| `calendar` | `alert_due` |
| `tasks` | `alert_due` |
| `chat` | `message_posted` |

Recipients come from `$event->data['recipients']`. The actor is never notified. Inbox uniqueness is `(principal, dedupe_key)`.

## Storage (`wgw`)

- `notifications` — inbox row per principal: title, body, in-app `navigate`, `tag`, `read_at`.
- `notification_deliveries` — short-lived `local` / `vapid` attempts (`due_at`, `acked_at`, `sent_at`). Local rows are due ~45s after create so a visible tab can ack before VAPID.
- `push_subscriptions` — principal + endpoint; prune on 404/410.

## LAMP scheduler

Shared hosting: cron `* * * * * php packages/api/artisan schedule:run`. Laravel `withSchedule` runs `wgw:notify:due-alarms` and `wgw:notify:vapid-sweep` every minute (`withoutOverlapping()`). **No** `queue:work` daemon. Docker install and `compose.dev.yml` include a sidecar that loops `schedule:run` every 60 seconds.

## In-app delivery

- **Tier 1 (tab visible):** tray + inbox poll (~30s). No OS notification when `document.visibilityState === 'visible'`.
- **Tier 2 (tab hidden / PWA):** Notification API, then `POST /notifications/{id}/local-ack`.
- **VAPID:** install-scoped keypair (`wgw-content/keys/vapid-*.txt` or `WGW_VAPID_*`). Custom service worker (`injectManifest` + `src/sw.ts`) handles `push` / `notificationclick`. Payload shape is `application/notification+json` (`title`, `body`, `navigate`, `tag`, `renotify`, `app_badge`).

Chat-push (VAPID + `chat.message_posted`) is the beta closed-tab promise. Calendar closed-tab delivery is **not** — that remains Goal #493.

## Producers

- **VALARM** — `AlertDueScheduler` scans `calendarobjects` with DISPLAY/AUDIO alarms in a ~now−90s…now+30s window. Actor is `system` so owners are not skipped. Dedupe `(principal, uid, occurrence, alarm_id)`.
- **Doc share** — `DriveShareService::createShare` notifies sharees (users and expanded group members). Comment notify is out of scope (#548 remaining gap).
- **Chat** — `ChatMessageRepository::create` notifies `ChatChannelRepository::rosterUsernames` (Sabre `calBackend()->getInvites`). No @mention parsing.

## HTTP

OpenAPI-first under `/api/v1/notifications`. Tray-only UI — no new first SPA path segment, so `UiStaticServer` allowlist is unchanged. Deep links reuse existing `?return=` prefixes (`/calendar`, `/tasks`, `/docs`, `/drive`, `/meet`).
