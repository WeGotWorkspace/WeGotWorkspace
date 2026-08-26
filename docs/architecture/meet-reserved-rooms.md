# Reserved Meet rooms + calendar ICS-write hook

Architecture lock for Goal [#525](https://github.com/WeGotWorkspace/wegotworkspace/issues/525) Chunk **M** (reservation persistence) and the shared ICS-write hook in Chunk **A**. Review this note **before** implementing M. Do not implement named reusable rooms ([#579](https://github.com/WeGotWorkspace/wegotworkspace/issues/579)).

Related: [`packages/api/docs/meet-signaling.md`](../../packages/api/docs/meet-signaling.md) (today’s in-call signaling). Conversion matrix write-set vs Microsoft read-only lands in Chunk A.

## Why

Meet rooms today exist only while someone is joinable in-call. Guest knock on an empty room is `404 room_not_active` / “This meeting is not active…”. Calendar cannot attach a stable join URL until a reservation row exists with a principal owner.

Chunk M is the missing **stable room identity** that deferred #525 on 2026-08-24. Calendar glue (conference fields, form, Join) is Chunks A and B.

## Reservation row

New (or extended) table behind `POST /meetings/rooms` / `GET /meetings/rooms/{id}` / authenticated `PATCH /meetings/rooms/{id}`.

| Column | Rule |
|--------|------|
| `id` / room code | Meet room-code pattern `xxxx-xxxx-xxxx` (same as [`createMeetRoomCode`](../../packages/apps/src/meet-core/src/meet-room-id.ts)). Idempotent POST on this id. |
| `ownerPrincipal` | Personal calendar → `u:{username}`. Group calendar (`scope === "group"` / `groupSlug`) → `groups/{slug}`, **not** the member who clicked. Ad-hoc `/meet` start → acting user. |
| `createdBy` | **First-class column.** Set on every insert, including inbound ICS-hook inserts. Value = authenticated actor who reserved (Add Meet / ad-hoc start / DAV or JMAP writer). A group-calendar ACL writer need not be a group member — Meet has no calendar-event “organizer” check. |
| `expiresAt` | **Nullable.** `null` = no inactivity GC while the link stays attached. Finite clocks below. |

iMIP `ORGANIZER` stays the acting user ([`withOrganizer`](../../packages/api/app/Services/Calendars/CalendarSchedulingService.php)). That is scheduling identity, not Meet room ownership.

## `expiresAt` clocks (locked)

| Scope | `expiresAt` | When |
|-------|-------------|------|
| **Series master** | `null` | Only while that series **still carries the Meet link**. Not `now+N`. Not first-DTEND+7. |
| **This-and-future** (new continuing series, possibly infinite) | `null` | Same as series master **while the fork still carries the link**. **Not** this-instance (`occurrence end + 7`). |
| **Single event** | `DTEND + 7 days` | At reserve time **and again** whenever DTEND changes (shared ICS write hook). |
| **This-instance override** (one occurrence, a different room than the master) | that occurrence’s end `+ 7 days` | At reserve time **and again** whenever that occurrence end changes. |
| **Abandoned draft** (Add Meet / dialog paste blur, event never saved) | reserve time `+ 30 days` | Draft only. **Must upgrade** on persist of an existing row (see hook). |
| **Ad-hoc `/meet` start** (no Calendar) | start time `+ 30 days` | Always writes a row. Finite. Same table Calendar uses. Peer-prune of active rooms is unchanged and is **not** this clock. |

Do **not** renew-on-occurrence in v1. Null-while-attached is the cheaper equivalent of “one room for the life of the series / fork.”

Optional later: a finite `UNTIL` / `COUNT` last occurrence + 7 days. Not required for v1.

**Join URL lives on the series master.** Every occurrence shares that reserved room. This-instance / this-and-future may override or clear `links`. Do **not** mint a new room per occurrence on Add Meet (this-instance Add Meet is the exception: a **separate** room).

## Five GC triggers

Sweeper deletes **never-activated** rows only when `expiresAt` is **non-null and past**. `expiresAt = null` is never swept for inactivity.

| # | Trigger | Effect |
|---|---------|--------|
| 1 | Sweeper tick | Delete never-activated rows whose `expiresAt` is non-null and past. |
| 2 | Event delete / series destroy | If the stored href is a WGW room, best-effort set that reservation’s `expiresAt` to **now**. |
| 3 | Remove link while the event/series **remains** | Authenticated `PATCH expiresAt = now + 30 days` (including series-master / this-and-future that were `null`). |
| 4 | Recurrence-scope change **after** a successful reserve | Same PATCH as Remove (`now + 30 days`), then clear the staged code. |
| 5 | Ad-hoc / draft finite clock elapses | Same sweeper as (1): start+30d or draft+30d rows that were never activated. |

Active / recently-active rooms keep today’s **peer-prune** (peers, not the reservation row). No public delete-room API. Named reusable rooms (#579) stay out.

PATCH `expiresAt` is callable by `createdBy` **or** an `ownerPrincipal` member. Calendar write service may call POST/PATCH **internally** (not only the browser).

## Shared server-side ICS write hook (Chunk A; not UI)

Every end-change or inbound-conference persist must hit **one** calendar-side service. Today the writers are **not** the same PHP method:

- WGW dialog, drag, Dexie outbox → JMAP `CalendarEvent/set` → [`CalendarEventRepository::persistEventMutation`](../../packages/api/app/Services/Calendars/CalendarEventRepository.php) → Sabre `CalPDO::updateCalendarObject` + `scheduleAfterWrite`
- Apple / Outlook / Google → CalDAV PUT → [`SabreServerFactory`](../../packages/api/app/Dav/SabreServerFactory.php) `CalDAV\Backend\PDO` **directly** — never `CalendarEventPatch` / `CalendarEventSetService`

**Locked:** invoke the hook from **both** `persistEventMutation` **and** a CalDAV after-write (DAV plugin or `CalPDO` decorator). Not only `CalendarEventSetService`. **Not** `calendar-event-dialog` or the Lit persist helper. Chunk B does **not** own this.

The hook does two things via **internal** Meet calls (not browser PATCH):

### 1. Recompute finite `expiresAt` on reschedule

If a single event or this-instance override **end changed** and a same-origin WGW href remains, set reservation `expiresAt = newEnd + 7 days`. Series-master / this-and-future (`null`) are left alone.

### 2. Idempotent inbound WGW reserve

If inbound `CONFERENCE` / `URL` / `X-GOOGLE-CONFERENCE` is a guest/join URL whose **parsed origin equals** the configured workspace origin **and** `room` matches the full Meet room-code pattern:

- Run the same idempotent reserve as dialog paste.
- `ownerPrincipal` = that event’s calendar principal.
- **On insert:** `createdBy` = the authenticated DAV/JMAP actor who performed the write (same identity as iMIP `ORGANIZER` / DAV ACL — not left null, even when `ownerPrincipal` is a group).
- **If a row already exists:** keep `createdBy` / `ownerPrincipal` (do not steal).
- **Always** apply the event/scope clock to `expiresAt` — on insert **and** as an **upgrade** of an existing row. A blur-draft `now+30d` that then persists on Save **must** become DTEND+7, occurrence-end+7, or series/this-and-future `null`. Leaving the draft clock after the event exists is the same premature-sweep bug as a stale reschedule clock.

Incomplete or non-WGW hrefs never reserve. Read-only GET / conversion without persist does **not** POST.

## Origin equality (paste and inbound)

**Parsed origin equality only.** Require `origin === configuredWorkspaceOrigin` (PHP and JS). Reject on parse failure.

**Forbidden:** `includes`, `startsWith`, or any raw-string matching.

Path must be `/meet/guest` or `/meet/join`. Query `room` must match the full `xxxx-xxxx-xxxx` pattern. Partial strings do not POST.

## HTTP contract (Chunk M)

### `POST /meetings/rooms`

Accepts `room` + `ownerPrincipal` (+ optional `expiresAt`; omit/null = no expiry). Records `createdBy` from the authenticated actor. Idempotent on room id: already reserved → keep owner / `createdBy`, and when the calendar hook is the caller, overwrite `expiresAt` with the event/scope clock.

### `GET /meetings/rooms/{id}`

| Caller | Body |
|--------|------|
| Guest / unauthenticated | **`{ reserved, active }` only.** No `ownerPrincipal`, `createdBy`, or `expiresAt`. |
| Authenticated member of `ownerPrincipal` **or** the reservation `createdBy` | Full body including those three fields. |

**GET 404** (no row — including a sweeper-pruned never-activated room whose calendar `links` href still points at it) is **not** an unhandled error. Lobby and calendar Join treat 404 like “not reserved” (existing dead-link / missing-invite copy). Do not treat network failure the same as 404.

Guest lobby: `{ reserved: true, active: false }` → **waiting for the host**. Knock still requires a joinable host. Signed-in owner-principal members can start; non-members stay guest/knock.

### `PATCH /meetings/rooms/{id}`

Authenticated. Sets `expiresAt` (Remove / detach / discarded scope / **reschedule**). `createdBy` or owner-principal member only.

## Ad-hoc `/meet` start

Start meeting on `/meet` (no Calendar) **always** `POST /meetings/rooms` with `ownerPrincipal = createdBy = acting user` and finite `expiresAt` (start + 30 days). Not optional. Not “owner = acting user but no row.”

Paste / inbound of that guest URL into Calendar does **not** transfer ownership to the calendar principal. First successful **complete** reserve (Add Meet, dialog paste, or inbound ICS persist) of a code with **no** row creates one for the **calendar principal**, `createdBy` = the authenticated writer. That is “first persist wins,” not a transfer. Legacy / swept / copied hrefs without a row follow that rule.

## Add Meet — one code per form session (Chunk B)

Generate the room code **once per form session** and keep it in form state. Retry and double-click POST that same code (server idempotent on id). Disable Add Meet while the POST is in-flight.

- **Add Meet:** POST on button click, session-stable code, one in-flight POST. Series / this-and-future → `expiresAt = null`. This-instance → occurrence end + 7 days (a **new** room, not the master).
- **Dialog paste / typed URL:** POST on **field blur** only as an **early draft** reserve (abandoned-draft clock), never per keystroke. Save still goes through JMAP persist; the **server hook is authoritative** and must upgrade the clock.
- Remove (or scope change after reserve) **clears the staged code** and PATCHes `expiresAt` to now + 30 days.

**Scope change after a successful reserve invalidates the staged code.** Treat the previous reservation like Remove, require a new Add Meet / reserve for the new scope. Do not reuse a null-expiry series id on the this-instance path.

## Conference fields (Chunk A; reminder)

Write from `links`: ICS `URL`, RFC 7986 `CONFERENCE`, `X-GOOGLE-CONFERENCE`. **Never write** `X-MICROSOFT-SKYPETEAMSMEETINGURL` (read-only). Do not stuff the join URL into `LOCATION`. Do not adopt JMAP `virtualLocations` in this slice.

## Out of scope

- Goal #579 named reusable rooms / stable studio links
- Auto-Meet on every event
- Zoom / Teams APIs
- Changing calendar iMIP `ORGANIZER` to the group
- Public delete-room API
