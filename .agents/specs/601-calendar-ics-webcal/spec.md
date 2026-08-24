Source: #601 (body-hash: 8c4ac27d)
Goal: #522

# ICS / webcal subscribe and publish

Technical translation of Epic #601 — not a copy of the issue AC checklist. Child Tasks: #602 (subscribe API), #603 (publish API), #604 (Calendar UI).

## Goal

A signed-in user can attach a **live remote ICS / webcal URL** as a read-only calendar collection (server fetches and refreshes) and can **publish** an owned personal calendar as a tokenized ICS / webcal feed. Stop subscribe and revoke publish. Events stay on the existing JMAP `Calendar/*` + Sabre `calendarobjects` store; subscribe/publish are REST resources in the same family as RSVP tokens (`/api/v1/calendar/rsvp/{token}`).

## Non-goals

- One-shot `.ics` **file** import — Goal #461 (share converters later; do not share UX)
- CalDAV account URL copy — Goal #524
- Calendar ACL with instance users — Goal #403
- Event invitations / RSVP — #478 / #479
- Guest Docs/Drive JWT sessions — Goal #388
- Calendly-style booking pages
- VTODO / vCard import
- Overloading JMAP `Calendar.isSubscribed` (visibility; `CalendarRepository` currently hard-codes `true`)
- Browser-side fetch of the remote ICS (CORS + SSRF)
- Re-publishing a subscription calendar as a feed (this slice)
- Group-calendar publish unless the caller already has `mayShare`

## Affected packages

- `packages/api` — OpenAPI, wgw migrations, services, feature tests, artisan refresh command
- `packages/apps` — `calendar-core` sidebar + calendar dialog, operations, mock JMAP, stories

## Technical constraints

### Transport

- Calendar collections and events stay on **JMAP** (`Calendar/get`, `CalendarEvent/*` via `POST /jmap`). REST `/calendars/calendars` is gone (`JmapCapabilityGatingTest`).
- Subscribe and publish are **new REST** under `/api/v1/calendars/…` with `x-wgw-access`. Do not invent a CalDAV subscription protocol.
- Public feed is unauthenticated `GET` (`x-wgw-access: guest`), `Content-Type: text/calendar` — not a guest share session.
- Layers: routes → Form Requests → Resources → `app/Services/Calendars/…` → Eloquent on `wgw` ([api/layers.md](../../skills/api/layers.md)). Persistence is **not** Flysystem (calendars are Sabre PDO / wgw tables).

### Subscribe (#602)

```
POST|GET /calendars/subscriptions
GET|DELETE /calendars/subscriptions/{id}
POST /calendars/subscriptions/{id}/refresh
```

- Body: `{ url, name?, color? }`. Normalize `webcal://` → `https://`. Reject anything other than `http`/`https`.
- **SSRF:** resolve host, block loopback / private / link-local / metadata ranges, re-check after every redirect, cap redirect hops, reuse existing ICS size guard.
- Create a **personal** calendar collection; persist VEVENTs into `calendarobjects` (prefer stored ICS objects so refresh/publish stay UID-faithful). `myRights.mayWrite` is false; `mayDelete` is true (unsubscribe).
- Do **not** set JMAP `isSubscribed` as the remote-feed flag. Add a separate owner-visible marker on `Calendar/get` (e.g. `subscriptionId: string | null`) so the UI can treat the collection as read-only without a second list call. Remote URL and fetch status live only on the subscriptions resource.
- First fetch on `POST`. Later refresh upserts/deletes by VEVENT UID. Invalid URL or unreadable ICS → 4xx, no empty silent calendar.
- `DELETE` destroys the collection and its events.
- Refresh without cron: fetch on subscribe; if `lastFetchedAt` is older than ~1 hour, `POST …/refresh` from Calendar load (owner). Optional `wgw:calendars:refresh-subscriptions` artisan command for hosts that run the scheduler (none is registered today).

### Publish (#603)

```
GET|POST|DELETE /calendars/{calendarId}/feed
GET /calendars/feeds/{token}          # public, also .ics suffix OK
```

- Owner `POST` creates or returns `{ httpsUrl, webcalUrl }`. Lookup uses SHA-256 `token_hash` (same as RSVP). The raw token is also stored Laravel-encrypted as `token_cipher` (APP_KEY) so `GET /calendars/{id}/feed` can re-show the existing URL without regenerating — an intentional tradeoff vs hash-only RSVP tokens. Compromised APP_KEY recovers issued feed URLs. Unknown/revoked → 404.
- Allowed on **owned personal** calendars the user can manage. Reject subscription calendars. No guest JWT.
- Feed body: one `VCALENDAR` of that collection's VEVENTs (stored objects / existing converters).
- `DELETE` revokes; subsequent public GET is 404. Rate-limit the public GET.

### UI (#604)

- Extend `CalendarCalendarDialog` + sidebar in `calendar-core` (create already lives there). Suite primitives only (`Dialog`, `Input`, `Button`, `Callout` / `useAppToast`).
- Subscribe action (URL + optional name/color). Subscribed rows visually distinct; events read-only (no create / drag-edit onto that calendar).
- Owned edit: publish toggle, copy https + webcal, revoke confirm.
- Subscription edit: name/color, source URL read-only, unsubscribe (replaces delete).
- Offline: no remote ICS from the browser. Subscribe/publish need the API. Already-synced subscription events still paint from Dexie (`feat/calendar-dexie-first` path).
- Mock-tier stories + Vitest on new operations. BEM + `@apply`; no long Tailwind in TSX.

## Edge cases

- Redirect to a private IP after a public DNS name → reject
- Huge ICS / timeout → 4xx/5xx with a user-visible error, no partial silent import
- Remote event UID collision with an existing object in the subscription calendar → replace on refresh
- User hides a subscribed calendar (local visibility) — not the same as unsubscribe
- Publish URL must not appear on `Calendar/get` for other principals
- Revoke then re-publish → new token; old URL stays 404
- Offline subscribe/publish → error toast; grid unchanged
- Default / group calendars: subscribe creates a **new** personal collection; do not dump into `default`
