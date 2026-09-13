Source: #741 (body-hash: fd7d2b61)
Goal: #390

# Suite notify pipeline

Technical translation of Epic [#741](https://github.com/WeGotWorkspace/wegotworkspace/issues/741). Related Goals: [#548](https://github.com/WeGotWorkspace/wegotworkspace/issues/548) (Doc share half), [#493](https://github.com/WeGotWorkspace/wegotworkspace/issues/493) (closed-tab Calendar stays open). Chore [#495](https://github.com/WeGotWorkspace/wegotworkspace/issues/495) closes against VAPID primitives [#745](https://github.com/WeGotWorkspace/wegotworkspace/issues/745). Child Tasks: [#742](https://github.com/WeGotWorkspace/wegotworkspace/issues/742)–[#748](https://github.com/WeGotWorkspace/wegotworkspace/issues/748).

## Goal

One suite-wide mutation envelope (`WorkspaceEvent` PHP DTO) with dual dispatch (DAV plugin + service-layer `EventDispatch::fire`) and a LAMP-safe notify pipeline: inbox, in-app Notification API, and VAPID primitives. First producers: VALARM due alerts, Doc-share, and chat message-posted (channel/DM participants except the author).

## Non-goals

- AuditListener, snapshot/recovery listener, search-index listener, agent-trigger
- Outgoing webhooks, SaaS metering, `tenant_id`
- Chat @mention-parsing and mentions-only preference
- Doc comment notify (#548 comment half) and Doc @mention Goal #549
- Admin notification preferences UI beyond permission + subscribe
- Replacing Calendar/Tasks alert pickers (#557)
- Queue daemon, Redis, extra Docker processes
- Closing Goal #493 (primitives ≠ closed-tab Calendar push)
- Migrating `BestEffortSearchIndexSync` onto the hook
- Mail instrumentation

## Affected packages

- `packages/api` — DTO, dispatch, plugin, migrations, OpenAPI, scheduler, VAPID send, producers, tests
- `packages/apps` — inbox tray, Notification API, custom SW push handler
- `docs/` — architecture note (#495) and cron contract (#743)

## Technical constraints

- Envelope is a PHP DTO at dispatch time. No generic `events` table. Fields: `event_id` (ULID), `actor`, `domain`, `action`, `target`, `timestamp`, `data`, `visibility` (`internal` | `external-safe`). No `tenant_id`.
- Dual entry: DAV HTTP → `EventDispatchPlugin` only; repositories/services → `fire` only. Do not HTTP-proxy services through Sabre. Do not wrap vendor `Sabre\CalDAV\Backend\PDO`.
- `EventDispatch::fire` is best-effort: try/catch all listeners, log `event_dispatch_failed`, never fail the write. Plugin must isolate exceptions (FileNodeIndexPlugin pattern, not SearchIndexPlugin throw-through).
- Listeners are an explicit in-code list, not Laravel event discovery.
- Keep `BestEffortSearchIndexSync` call sites; add `fire` beside them. Drive observation hooks **three** writers: `FileNodeSetService`, `DriveService`, DAV plugin. `WgwStorage::files()` is the disk.
- Chat is DAV-hidden: fire from `ChatMessageRepository::create` only. Publicize `ChatChannelRepository::rosterUsernames` (Sabre `getInvites`, not a Chat API). No @mention parsing.
- LAMP: Laravel `withSchedule` + host cron `* * * * * php artisan schedule:run`. No `queue:work` daemon.
- Notify curation: `NotifyListener` allow-list `(docs, shared)`, `(calendar, alert_due)`, `(tasks, alert_due)`, `(chat, message_posted)`.
- Two `wgw` tables: `notifications` (inbox) and `notification_deliveries` (local|vapid attempts). Send is a scheduled row, never inline in the DAV/REST write.
- VitePWA `generateSW` cannot host a custom `push` handler — switch to `injectManifest` + custom SW that still precaches.
- OpenAPI first for new routes. Tray-only UI (no new top-level SPA segment) unless a route is added, in which case `UiStaticServer` allowlist must update.
- Chat-push (VAPID + chat producer) **is** the beta gap-close for chat. Calendar closed-tab is **not**.

## Edge cases

- DAV actor missing: skip notify-worthy events; do not attribute to a fake user.
- Plugin may emit coarse `written`; services that already loaded old ICS may emit `created` / `updated`. Curation ignores most of these.
- Recurring VALARM: unique `(principal, uid, occurrence, alarm_id)` — duplicate cron ticks must not duplicate inbox rows.
- Local-ack race: channel=`local` ack in 30–60s window skips VAPID; no ack sends; 410/404 prunes the subscription.
- Sharee (not actor) gets Doc-share inbox rows. Group shares expand via existing principal resolution.
- Chat: N-member channel → N−1 rows; DM → 1; author never notified.
- Unauthenticated deep link: existing `?return=` login continue on allowlisted in-app paths.
