# Team availability API

Busy periods of teammates, computed on request. Architecture and rules: [docs/architecture/calendar-availability.md](../../../../docs/architecture/calendar-availability.md). OpenAPI: `openapi/schemas/calendars/availability.json` and the `/calendars/availability` path.

## JMAP capability `urn:wgw:jmap:availability`

Advertised while the Calendars module is on. The session-level value is `{}`; the account capability holds the limits:

```json
{ "maxIdsPerCall": 50, "maxWeeksPerCall": 54, "maxPersonWeeksPerCall": 540 }
```

A request must list `urn:wgw:jmap:availability` in `using`.

### `TeamMember/get`

Everyone the caller may read: people who share at least one Team with the caller, have the switch on and are not disabled. The caller is listed (`isSelf: true`) while their own switch is on.

| Argument | Notes |
| --- | --- |
| `accountId` | The caller's account |
| `ids` | `null` for everyone, or a list of usernames |
| `properties` | Optional subset, as in any JMAP `/get`; `id` is always returned |

| Field | Notes |
| --- | --- |
| `id` | Username, the same string as the person's JMAP `accountId` |
| `name` | Display name, or the username |
| `isSelf` | `true` for the caller |
| `version` | Hash of the name and the settings stamp; drop that person's cached weeks when it changes |

The response `state` is a hash of every visible (id, version). There is no `TeamMember/changes`. Anyone the caller may not read is in `notFound`, whatever the reason.

### `TeamMember/getAvailability`

| Argument | Notes |
| --- | --- |
| `accountId` | The caller's account |
| `ids` | 1–50 usernames |
| `utcStart` | A Monday `00:00:00Z`, written exactly as `YYYY-MM-DDTHH:MM:SSZ` |
| `utcEnd` | A whole number of weeks after `utcStart`, at most 54 |
| `excludeEventId` | Optional. A `CalendarEvent` id the caller may edit, organizes or attends; its UID is left out of every result (for "is this person free for this event?") |

`ids × weeks` may not exceed 540. Any broken rule is `invalidArguments` before anything is read; so is an `excludeEventId` on a read-only shared or subscribed calendar.

Response: `{ accountId, list: [{ id, periods, complete }], notFound }`.

| Period field | Notes |
| --- | --- |
| `start` | Read like a `CalendarEvent` start: UTC with `Z` (`timeZone: null`), local plus IANA `timeZone`, floating (local, `timeZone: null`), or a bare date when `showWithoutTime` |
| `timeZone` | IANA id or `null` |
| `duration` | ISO 8601, e.g. `PT1H`, `P1D` |
| `showWithoutTime` | `true` for all-day |
| `title`, `location` | Only for an event on a personal calendar shared with `details` that is not private or confidential. A location holding a URL is dropped; the title is cut at 200 characters. |

`complete: false` means some busy time in the range could not be worked out (an unreadable or oversized event, a recurrence over the limit, more than 2000 periods in a week). A gap is then not proof of free time.

## REST settings

| Method | Path | Description |
| --- | --- | --- |
| GET | `/calendars/availability` | The caller's switch, Teams and calendars |
| PUT | `/calendars/availability` | Partial update; returns the full settings |

```json
{
  "enabled": true,
  "teams": [{ "slug": "eng", "name": "Engineering" }],
  "calendars": [
    { "calendarId": "default", "name": "Calendar", "color": "#8b5cf6", "source": "personal", "include": true, "detail": "busy" },
    { "calendarId": "group-eng", "name": "Engineering", "color": null, "source": "team", "include": true, "detail": "busy" }
  ]
}
```

PUT body: `{ "enabled"?: boolean, "calendars"?: [{ "calendarId", "include"?, "detail"? }] }`, at most 200 calendars. `calendarId` is the JMAP Calendar id.

| Status | When |
| --- | --- |
| 200 | Saved; the full settings come back |
| 400 | A field of the wrong type, an unknown field, or more than 200 calendars |
| 422 | A `calendarId` that is not one of the caller's own personal or Team event calendars, or `detail: "details"` on a Team calendar |

Nothing is written unless the whole body is valid. Choices are kept while the switch is off. There is no push for settings: other devices read them again when their settings pane opens.

## CalDAV

The outbox free/busy report (`POST` a `VFREEBUSY` `METHOD:REQUEST` to `/calendars/{user}/outbox`) follows the same rules. A target the caller may not read, a window covered by more than 54 UTC weeks, or an incomplete result answers `3.7;Could not find principal`. Otherwise the reply holds the busy time clipped to the requested window, merged, without titles.

## Operations

- Cache: file store `availability` under `storage/framework/cache/availability`, one entry per (owner, week, fingerprint), 5 minutes.
- `php artisan wgw:availability:prune-cache` deletes expired entries; the scheduler runs it hourly.
- Logs: `calendar.availability.object_skipped` (an object that could not be read), `calendar.recurrence_limit`, `calendar.availability.slow` (a call over 500 ms).
