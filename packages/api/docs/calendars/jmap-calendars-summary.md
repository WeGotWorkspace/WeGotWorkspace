# JMAP Calendars field subset (REST API)

This API exposes a **subset** of the [JMAP Calendars draft](https://jmap.io/spec.html) types over REST, including JMAP-shaped event sync endpoints (`/changes`, `/set`, `/query` below). The full JMAP protocol envelope (`/jmap` session, batched method calls) **now exists as a separate, additive adapter** in front of the same services — see [jmap-envelope.md](./jmap-envelope.md); nothing in this REST document changed for it.

## Calendar

Returned by `GET /calendars/calendars` and `GET /calendars/calendars/{calendarId}`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `calendarinstances.uri` for the authenticated principal |
| `name` | string | `{DAV:}displayname` or uri fallback |
| `description` | string \| null | Instance description |
| `timeZone` | string \| null | VTIMEZONE or TZID reference when set |
| `color` | string \| null | `calendarcolor` |
| `sortOrder` | integer | `calendarorder` |
| `isDefault` | boolean | `true` when uri is `default` |
| `isSubscribed` | boolean | Always `true` for owned instances in v1 |
| `shareWith` | object \| null | Owner map of JMAP id (`alice`, `groups/{slug}`) → rights. Recipients and unshared calendars are `null`. Null grant on `Calendar/set` revokes. Same grants are visible over CalDAV `{CS:}invite` / `{DAV:}invite`; inbound `CS:share` / `DAV:share-resource` with `mailto:` maps back to the JMAP id. Apple Calendar: this-instance CalDAV account only (not iCloud), `principals.email` must match the sharee `mailto:`, invites auto-accept, group share is JMAP-only. |
| `myRights` | object | Derived from CalDAV `access` (1 owner / 2 read / 3 read-write). Personal owners have `mayShare: true`. |

## CalendarEvent

Returned by event endpoints. `@type` is always `"Event"`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Object uri without `.ics`, or `{objectUri}#{veventUid}` for multi-VEVENT ICS |
| `uid` | string | VEVENT UID |
| `calendarIds` | map | Enabled calendar uri → `true` |
| `title` | string | SUMMARY |
| `description` | string | DESCRIPTION |
| `start` / `end` | string | ISO 8601 or date for all-day |
| `duration` | string | iCalendar DURATION when no DTEND |
| `showWithoutTime` | boolean | All-day events |
| `timeZone` | string | TZID when floating/local |
| `recurrenceRules` | array | Master RRULE — **not** expanded instances |
| `excludedRecurrenceDates` | array | EXDATE values |
| `recurrenceOverrides` | map | RECURRENCE-ID override VEVENTs keyed by instance start |
| `locations` | map | LOCATION → `Location` |
| `participants` | map | ORGANIZER / ATTENDEE |
| `status` | string | `confirmed` \| `cancelled` \| `tentative` |
| `freeBusyStatus` | string | TRANSP mapping |
| `privacy` | string | CLASS mapping |
| `categories` | array | CATEGORIES |
| `created` / `updated` | string | CREATED / LAST-MODIFIED |
| `sequence` / `priority` | integer | SEQUENCE / PRIORITY |
| `state` | string | Opaque per-event JMAP state token (from `jmap_calendar_event_states`), attached on REST reads/writes; use as `ifInState` on `/set` |
| `icsProps` | object | Unmapped VEVENT properties preserved round-trip |

## Event sync endpoints

JMAP-shaped REST equivalents of `CalendarEvent/changes`, `/set`, `/query`. Response shapes follow RFC 8620 core method semantics (§5.2 /changes, §5.3 /set, §5.5 /query); contacts `/cards/*` and tasks `/items/query` still use the older legacy shapes (alignment is a documented follow-up in `docs/jmap-rest-parity-gaps.md`).

| Endpoint | JMAP analogue | Notes |
|----------|---------------|-------|
| `GET /calendars/events/changes?calendarId=&since=&maxChanges=` | `CalendarEvent/changes` | Reads Sabre `calendarchanges`; `since` empty/`0` → initial sync (all ids in `created`); invalid/expired token → `400` `cannotCalculateChanges`. Response includes `hasMoreChanges` (always `false` — full delta in one response; `maxChanges` is validated but not used for truncation, see below). Multi-VEVENT objects emit all composite ids — see `docs/contacts/jmap-sync-rest-mapping.md` |
| `POST /calendars/events/set` | `CalendarEvent/set` | Batch `create`/`update`/`destroy`; per-record `ifInState` resolved against the event `state` token, stale → `not*` bucket with `type: stateMismatch` (deliberate divergence from RFC's request-level `ifInState`; the [envelope](./jmap-envelope.md)'s `CalendarEvent/set` implements the genuine top-level form) |
| `POST /calendars/events/query` | `CalendarEvent/query` | `filter.inCalendars` (required), `after`/`before` time range (per-VEVENT occurrence intersection), `title` substring; `sort` on `start`/`title`/`uid`; `position`/`limit`; returns `{ids, position, total, queryState, canCalculateChanges}` |

### `/set` response shape (RFC 8620 §5.3)

```json
{
  "oldState": "5",
  "newState": "7",
  "created": { "new-1": { "id": "abc123", "state": "9f2c…" } },
  "updated": { "abc123": { "state": "1d40…" } },
  "destroyed": ["def456"],
  "notCreated": { "bad-1": { "type": "invalidProperties", "description": "start is required.", "properties": ["start"] } },
  "notUpdated": { "ghi789": { "type": "stateMismatch", "description": "…" } },
  "notDestroyed": { "jkl012": { "type": "notFound", "description": "…" } }
}
```

- **`created`** maps the client-chosen creation id (the `create` map key) to the server-set properties `{id, state}`.
- **`updated`** maps event id to the server-changed properties — the rotated `state` token.
- **`oldState`/`newState`** are the same per-calendar sync state `/changes` uses, scoped to the calendars touched by the request: a single calendar's plain synctoken, or the collection-style `{count}:{uri:token,...}` composite (sorted by uri) when the request spans calendars. When nothing was mutated, the scope falls back to every owned VEVENT calendar and `oldState` equals `newState`.
- **SetError types** (`not*` buckets): `notFound`, `invalidProperties` (with `properties` listing the offending paths), `forbidden`, `serverFail`, plus `stateMismatch` for the per-record `ifInState` divergence.

### `/changes` and `maxChanges`

`hasMoreChanges` is always `false`: Sabre's limit-based truncation dedupes changes per uri keeping the latest synctoken at the uri's first position, so a truncated response could return an intermediate token that skips lower-token changes to other objects. `maxChanges` is therefore validated (positive integer) but the full delta is always returned — correctness over pagination.

### `/query` state

`queryState` composes the queried calendars' sync tokens the same way `/set` states do (single calendar → plain synctoken, multiple → composite sorted by uri). `canCalculateChanges` is always `false` (no `CalendarEvent/queryChanges`).

Request validation failures render as `400` with `code: bad_request` app-wide (not 422).

## Non-goals (v1)

- Server-side recurrence instance expansion (except optional `expandRecurrences` query on list — see [#159](https://github.com/WeGotWorkspace/wegotworkspace/issues/159))
- `VTODO`, `VJOURNAL`
- Single-event ACL, delegation, guest links, iCloud-native sharing (collection `shareWith` is implemented for personal owners)

**Implemented (platform #157 / #158):** calendar collection CRUD, `GET /calendars/calendars/changes`, and event item sync (`/changes`, `/set`, `/query` above) — see `docs/contacts/jmap-collection-crud.md` and `docs/contacts/jmap-sync-rest-mapping.md`.
