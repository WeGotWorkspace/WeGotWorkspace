# Calendars REST API

JMAP-shaped REST endpoints over Sabre CalDAV storage (`calendarinstances`, `calendarobjects`). A genuine RFC 8620 JMAP transport (`/api/v1/jmap` session + batched method calls) fronts the same services as a third adapter — see [jmap-envelope.md](jmap-envelope.md); test it against the real frontend client with [jmap-client-e2e.md](jmap-client-e2e.md).

## Architecture

| Layer | Location |
|-------|----------|
| Routes | `routes/api.php` under `wgw.calendars` middleware |
| Controllers | `app/Http/Controllers/Api/V1/Calendars/` |
| Form requests | `app/Http/Requests/Api/V1/CalendarEvent*Request.php` |
| Repositories | `app/Services/Calendars/*Repository.php` |
| Conversion | `app/Services/Calendars/Conversion/` (iCalendar VEVENT ↔ JMAP CalendarEvent) |
| OpenAPI | `openapi/schemas/calendars/` + paths in `openapi/openapi.json` |

Persistence uses `Sabre\CalDAV\Backend\PDO` for writes (same pattern as contacts CardDAV backend).

## Design decisions

### Multi-VEVENT ICS

CalDAV stores one `.ics` blob per calendar object URI. Some clients upload ICS files with multiple `VEVENT` components.

**Strategy: split with composite event ids**

- **Read:** each `VEVENT` becomes its own JMAP `CalendarEvent`. Single-VEVENT resources use the object id (`team-sync.ics` → `team-sync`). Multi-VEVENT resources use `{objectId}#{veventUid}` (e.g. `imported.ics#uid-abc`).
- **Write:** create/replace always serialize **one** `VEVENT` per new object. Updates/deletes targeting a composite id mutate only the matching `VEVENT` inside the shared ICS blob; deleting the last `VEVENT` removes the CalDAV object.
- **Rationale:** preserves all events from legacy multi-event uploads while keeping a 1:1 JMAP event identity for API consumers. Matches CalDAV URI stability (one resource URI, many components).

See [ics-conversion-matrix.md](ics-conversion-matrix.md) for field mapping.

### Recurring events

**Strategy: RRULE-only (client expands)**

- List/get return `recurrenceRules` (and `excludedRecurrenceDates`) as stored in ICS — **not** expanded instances.
- Clients expand locally, consistent with the JMAP Calendars draft and the contacts REST pattern (return stored representation, no server-side expansion).
- Server-side expansion (e.g. `expand` query param) is out of scope for v1.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calendars` | List calendars |
| GET | `/calendars/{calendarId}` | Show calendar |
| GET | `/calendars/events?calendarId=` | List events |
| POST | `/calendars/events` | Create event |
| GET | `/calendars/events/{eventId}` | Show event |
| PUT | `/calendars/events/{eventId}` | Replace event |
| PATCH | `/calendars/events/{eventId}` | Partial update |
| DELETE | `/calendars/events/{eventId}` | Delete event |

Composite event ids in paths must be URL-encoded (`#` → `%23`).

## Tests

- Feature: `tests/Feature/Calendars/`
- Unit conversion: `tests/Unit/Calendars/ICalendarJmapEventConverterTest.php`
