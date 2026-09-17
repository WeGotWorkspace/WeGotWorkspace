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
| `calendar` | `invite` |
| `tasks` | `alert_due` |
| `chat` | `message_posted` |

Recipients come from `$event->data['recipients']`. The actor is never notified. Inbox uniqueness is `(principal, dedupe_key)`. Events may set `supersede` to refresh an existing row (title/body/navigate, unread) or `clear` to delete it (CANCEL).

## Storage (`wgw`)

- `notifications` — inbox row per principal: title, body, in-app `navigate`, `tag`, `read_at`.
- `notification_deliveries` — short-lived `local` / `vapid` attempts (`due_at`, `acked_at`, `sent_at`). Local rows are due ~20s after create so a visible tab can ack before VAPID (grace must stay longer than the 15s inbox poll).
- `push_subscriptions` — principal + endpoint; prune on 404/410.

## LAMP scheduler

Shared hosting: cron `* * * * * php packages/api/artisan schedule:run`. Laravel `withSchedule` runs `wgw:notify:due-alarms` and `wgw:notify:vapid-sweep` every minute (`withoutOverlapping()`). **No** `queue:work` daemon. Docker install and `compose.dev.yml` include a sidecar that loops `schedule:run` every 60 seconds.

## In-app delivery

- **Tier 1 (live JS):** inbox poll (~15s) **local-acks** unread rows so VAPID skips. This includes Meet (`/meet` hides the suite tray but the host still polls) and an installed PWA that is still running. Closing one browser tab is **not** closed if the PWA or another WGW window for that profile is alive. No OS notification when `document.visibilityState === 'visible'`. Open tabs also wake on principal-mesh `notify-hint` (same room as Meet chat acceleration): targeted `sendTo` after chat post; recipients re-GET the inbox — mesh payload is never inbox SoT.
- **Tier 2 (tab/PWA hidden, JS still running):** Notification API toast, then the same local-ack.
- **VAPID:** install-scoped keypair (`wgw-content/keys/vapid-*.txt` or `WGW_VAPID_*`). Custom service worker (`injectManifest` + `src/sw.ts`) handles `push` / `notificationclick`. Vite dev on localhost registers that worker (`devOptions.enabled`, `type: "module"`) so sweep payloads reach `http://127.0.0.1:5173`; Docker HTTPS (`*.localhost`) is also a secure origin. Payload shape is `application/notification+json` (`title`, `body`, `navigate`, `tag`, `renotify`, `app_badge`). The signed-in host requests Notification permission once (`default` only) and then `pushManager.subscribe`s (reusing `getSubscription()` when present) so a `push_subscriptions` row exists for this origin. Permission granted is **not** enough — Safari in particular must persist a `web.push.apple.com` endpoint. VAPID subject defaults to `mailto:noreply@example.com` (Safari Web Push rejects `@localhost`). PHP needs `gmp` or `bcmath` for VAPID signatures; without them `minishlink/web-push` warns and Laravel debug used to abort the send. Failed HTTP sends do not mark `sent_at`, so the next sweep retries. Closed-tab Web Push requires **Quit** of the PWA and every other WGW client for that profile, then ~20–80s for the sweep (20s local-ack grace, then up to one 60s cron tick).

Chat-push (VAPID + `chat.message_posted`) is the beta closed-tab promise. Calendar closed-tab delivery is **not** — that remains Goal #493.

## Producers

- **VALARM** — `AlertDueScheduler` scans `calendarobjects` with DISPLAY/AUDIO alarms in a ~now−90s…now+30s window. Actor is `system` so owners are not skipped. Dedupe `(principal, uid, occurrence, alarm_id)`.
- **Doc share** — `DriveShareService::createShare` notifies sharees (users and expanded group members). Comment notify is out of scope (#548 remaining gap).
- **Chat** — `ChatMessageRepository::create` notifies `ChatChannelRepository::rosterUsernames` (Sabre `calBackend()->getInvites`). No @mention parsing.
- **Calendar invite** — `CalendarSchedulingService::deliverLocal` fans out `calendar.invite` when a local iTIP REQUEST lands in the invitee's schedule-inbox (does not replace that inbox). Invitee only; organizer skipped. Dedupe `calendar.invite:{uid}` with `supersede` on reschedule. CANCEL clears the tray row via the same action + `clear`.

## HTTP

OpenAPI-first under `/api/v1/notifications`. Tray-only UI — no new first SPA path segment, so `UiStaticServer` allowlist is unchanged. Deep links reuse existing `?return=` prefixes (`/calendar`, `/tasks`, `/docs`, `/drive`, `/meet`).

## Future: per-event delivery preferences

**Out of scope for #741 and the producer-expansion pass.** No prefs table, API, or UI yet. Keep the pipeline easy to extend so each allow-listed `domain.action` can later toggle **inbox** and **push** independently (e.g. Calendar: access grant → inbox on / push off; event invite → both on; meeting alarm → inbox off / push on).

### Preference key shape

- Scope: per **principal** (signed-in username).
- Event key: `domain.action` (same strings as `NotifyListener` allow-list / envelope — e.g. `calendar.invite`, `calendar.alert_due`).
- Channel: `inbox` | `push` — **independent** booleans.
- Lookup: `(principal, domain.action, channel) → bool`. Missing row → default (below).
- Do **not** key prefs on envelope `eventId`, dedupe key, or navigate path.

### Default matrix (matches today’s behavior)

Until a prefs store exists, treat every allow-listed action as:

| Channel | Default |
|---------|---------|
| `inbox` | **on** |
| `push`  | **on** |

That matches current code: `NotifyListener` always upserts a `notifications` row and schedules a `local` delivery; `VapidPushService::sweepDue` sends VAPID when the local-ack grace expires.

Product may later override **defaults** (not only user overrides) for noisy actions — e.g. `calendar.alert_due` / `tasks.alert_due` → inbox off / push on — without changing the key shape. Expansion catalog actions (`calendar.shared`, `docs.thread_activity`, …) should ship with the same both-on default unless product says otherwise.

### Where to evaluate (two gates)

Today inbox and push are **coupled**: every inbox create schedules local→VAPID; push payload is built from a `notifications` row. Independent toggles need **two** evaluation points:

1. **`NotifyListener` (create / clear path)** — resolve `inbox` for `(principal, domain.action)`.
   - `inbox` on → upsert / supersede / clear inbox rows as today.
   - `inbox` off → do **not** create (or keep) a tray-visible row; still honor `clear` / cancel so stale tray rows can disappear.
2. **`VapidPushService` (send path)** — resolve `push` for `(principal, domain.action)` using the notification’s stored `domain` + `action` (already on the row).
   - `push` off → skip Web Push; mark the due local delivery completed so the sweep does not retry forever.
   - `push` on + `inbox` on → today’s local-ack then VAPID race.
   - `push` on + `inbox` off → must still deliver a payload (title/body/navigate/tag). That implies loosening today’s assumption that every push rides a tray row — e.g. push-only delivery / ephemeral payload facts, or a non-listed row. **Do not invent that schema now**; document it as the required seam when prefs land.

Also gate **scheduling** of the local delivery in `NotifyListener` when `push` is off and `inbox` is on (avoid useless cron work). Prefer one small future helper (e.g. `DeliveryPreference::allows($principal, $domain, $action, $channel)`) called from both sites — defaults-only until storage exists.

### What not to do now vs cheap seams

| Do **not** add now | Keep / prefer |
|--------------------|---------------|
| Prefs table, OpenAPI, settings UI | Stable `domain` + `action` on envelope and inbox rows (already present) |
| Speculative mute / digest / quiet-hours schema | Strict allow-list curation (`domain.action` stays the prefs grain) |
| Filtering the inbox GET as a substitute for “inbox off” (hides rows that should never have been written) | Format-at-edge facts on the row so push-only send can format without re-reading producers |
| Coupling new producers to a prefs API | Document expansion actions with the same key shape so defaults/overrides drop in later |

See also the expansion plan note: [.agents/plans/suite-notify-inbox-expansion.md](../../.agents/plans/suite-notify-inbox-expansion.md) (Future prefs + optional Chore draft).
