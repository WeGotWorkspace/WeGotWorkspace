# JMAP incremental sync — REST mapping

> **Issue:** [#158](https://github.com/WeGotWorkspace/wegotworkspace/issues/158)  
> **Spec:** [RFC 9610](https://www.rfc-editor.org/info/rfc9610) (Contacts), [RFC 8620](https://www.rfc-editor.org/info/rfc8620) (JMAP core `/changes`, `/query`)

WeGotWorkspace exposes a **REST subset** of JMAP sync methods. Contacts were the pilot; calendars now match at both collection and event level; tasks expose collection `/changes` and item `/query`.

## Sync tokens

| JMAP type | REST endpoint | State token source |
|-----------|---------------|-------------------|
| `AddressBook` | `GET /api/v1/contacts/addressbooks/changes?since=` | Composite `{count}:{uri:synctoken,...}` over owned books |
| `ContactCard` | `GET /api/v1/contacts/cards/changes?addressBookId=&since=` | Sabre CardDAV `addressbooks.synctoken` + `addressbookchanges` |
| `Calendar` | `GET /api/v1/calendars/calendars/changes?since=` | Composite `{count}:{uri:synctoken,...}` over owned VEVENT calendars |
| `CalendarEvent` | `GET /api/v1/calendars/events/changes?calendarId=&since=` | Sabre CalDAV `calendars.synctoken` + `calendarchanges` |
| `TaskList` | `GET /api/v1/tasks/tasklists/changes?since=` | Composite `{count}:{uri:synctoken,...}` over owned VTODO calendars |

### Response shape (collection + card changes)

```json
{
  "oldState": "5",
  "newState": "12",
  "created": ["id"],
  "updated": ["id"],
  "destroyed": ["id"]
}
```

Maps to JMAP `/changes` (`oldState`, `newState`, `created`, `updated`, `destroyed`).

- **`since` omitted or `0`:** initial sync — all current ids appear in `created`.
- **`since` unknown / malformed:** `400` with `cannotCalculateChanges` (JMAP equivalent).
- **Card ids:** REST ids strip the `.vcf` suffix from CardDAV object uris.
- **Calendar responses** (`/calendars/calendars/changes`, `/calendars/events/changes`) additionally include `hasMoreChanges: false` (RFC 8620 §5.2); contacts/tasks changes endpoints still omit it (follow-up).

### WebDAV alternative

Clients may also use CardDAV **sync-collection REPORT** against `/addressbooks/{user}/{book}/` with `{http://sabredav.org/ns}sync-token`. REST `/changes` reads the same underlying `synctoken` / `addressbookchanges` tables.

CalDAV calendar collections expose synctoken on `calendarinstances`; REST collection `/changes` reads the same `calendars.synctoken` values.

## ContactCard/query

| JMAP filter (RFC 9610) | REST support |
|------------------------|--------------|
| `inAddressBook` | **Required** on `POST /contacts/cards/query` and `GET /contacts/cards?addressBookId=` |
| `uid` | **Supported** on query POST body and `GET ?uid=` |
| `text`, `name`, `email`, … | **Deferred** — use unified search or full list + client filter |

### Contact/set (batch writes)

`POST /api/v1/contacts/cards/set` implements JMAP `Contact/set`:

- `create` — map of creation id → ContactCard body
- `update` — map of card id → patch fields plus optional `ifInState`
- `destroy` — id array (force) or map of id → `{ ifInState }`

Responses use `created`, `updated`, `destroyed`, and `not*` buckets. Stale `ifInState` yields `notUpdated` / `notDestroyed` entries with `type: stateMismatch`.

Per-contact opaque `state` tokens are stored in `jmap_contact_states` and returned on `Contact/get` responses (alongside legacy `etag` for REST PATCH).

### Query request (POST)

```json
POST /api/v1/contacts/cards/query
{
  "filter": { "inAddressBook": "default", "uid": "urn:uuid:…" },
  "limit": 50
}
```

Response: `{ "ids": ["…"], "total": 1 }` — fetch full cards via `GET /contacts/cards/{id}`.

## Task/query

| JMAP filter | REST support |
|-------------|--------------|
| `inTaskList` | **Required** on `POST /tasks/items/query` |
| `uid` | **Supported** on query POST body |
| Other filters | **Deferred** |

### Query request (POST)

```json
POST /api/v1/tasks/items/query
{
  "filter": { "inTaskList": "default", "uid": "urn:uuid:…" },
  "limit": 50
}
```

Response: `{ "ids": ["…"], "total": 1 }` — fetch full tasks via `GET /tasks/items/{id}`.

## Events and tasks (item-level sync)

Calendar events and task items use per-calendar synctoken via `calendarchanges`. Calendar events now expose REST item sync; task items are still deferred.

| Store | Token column | Changes table |
|-------|--------------|---------------|
| Calendars / task lists | `calendars.synctoken` (via backend) | `calendarchanges` |
| Events / tasks | per-calendar synctoken | `calendarchanges` rows |

### CalendarEvent/changes

`GET /api/v1/calendars/events/changes?calendarId=&since=&maxChanges=` reads the same `calendars.synctoken` + `calendarchanges` rows as CalDAV sync-collection, so REST and CalDAV clients see identical deltas (mutations made over either protocol appear in both).

**Token semantics:** tokens are the numeric per-calendar Sabre synctoken. `since` omitted, empty, or `0` → initial sync (all current ids in `created`, `oldState: "0"`). Any other value must be numeric and ≤ the calendar's current synctoken, otherwise `400` with `cannotCalculateChanges`.

**`hasMoreChanges` / `maxChanges` (RFC 8620 §5.2):** the response always includes `hasMoreChanges: false` — the full delta is returned in one response. `maxChanges` is validated (positive integer) but not used for truncation, because Sabre's limit-based truncation cannot produce a safe intermediate sync token (its per-uri dedup keeps the latest synctoken at the uri's first position, so a truncated token could skip lower-token changes to other objects).

**Composite-id emission** (multi-VEVENT objects use ids `{objectId}#{veventUid}`):

- **`created` / `updated`:** the endpoint re-reads current object data and emits exactly the ids list/show would produce — the plain objectId for single-VEVENT objects, **all** composite ids for multi-VEVENT objects. When a modification removes a sub-VEVENT, the removed composite ids additionally appear in `destroyed`.
- **`destroyed`:** the object data is gone, so the endpoint emits the plain objectId plus every composite id previously recorded for that uri in `jmap_calendar_event_states` — covering every id a REST client can hold. CalDAV-only objects (never read over REST) have no state rows and fall back to the plain objectId.

### CalendarEvent/set and /query

`POST /calendars/events/set` and `POST /calendars/events/query` follow RFC 8620 §5.3/§5.5 response semantics (unlike the legacy-shaped contacts `/cards/set` and tasks `/items/query` — alignment is a follow-up, see [jmap-rest-parity-gaps.md](../jmap-rest-parity-gaps.md)):

- `/set` — `created` maps creation id → server-set `{id, state}`; `updated` maps id → `{state}`; SetError types are camelCase (`notFound`, `invalidProperties` + `properties`, `forbidden`, `serverFail`, `stateMismatch`). Top-level `oldState`/`newState` compose the touched calendars' sync tokens (single calendar: plain synctoken, same string `/changes` uses; multiple: `{count}:{uri:token,...}` sorted by uri; nothing mutated: all owned VEVENT calendars, `oldState` == `newState`). Per-record `ifInState` (instead of RFC's request-level token) is a deliberate divergence because item state tokens are per event.
- `/query` — returns `queryState` (same composition over `filter.inCalendars`) and `canCalculateChanges: false` alongside `ids`/`position`/`total`.

Per-event `state` tokens live in `jmap_calendar_event_states` (same pattern as `jmap_contact_states`). Field-level notes and example payloads: [jmap-calendars-summary.md](../calendars/jmap-calendars-summary.md).

**Planned REST mapping (deferred):**

- `GET /tasks/items/changes?taskListId=&since=`

**ETag alternative:** `CalendarEvent` and `Task` responses expose `etag` (from `calendarobjects.etag`). Clients may use `If-Match` on PUT/PATCH/DELETE for optimistic concurrency without polling `/changes`.

## Non-goals (v1)

- `ContactCard/queryChanges` (query result pagination sync)
- `ContactCard/copy`
- Full RFC 9610 filter matrix (`text`, `hasMember`, date ranges, …)
- Cross-account shared collection sync (RFC 9670 — see collection CRUD docs)

## Related

- [rfc9610-summary.md](./rfc9610-summary.md) — domain field mapping
- [jmap-rest-parity-gaps.md](../jmap-rest-parity-gaps.md) — epic tracker
