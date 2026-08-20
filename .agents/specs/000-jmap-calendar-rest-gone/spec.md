Source: ad-hoc

# JMAP-only calendar HTTP (REST sunset)

Technical translation of chunk A: drop dual-protocol `/calendars/*` REST after every former REST assertion has a JMAP (or CalDAV) home.

## Goal

Calendar objects are served over `/jmap` (`Calendar/*`, `CalendarEvent/*`) and CalDAV. `/api/v1/calendars/*` is gone.

## Non-goals

- Contacts or files REST deletion (chunks C/E)
- Deleting `CalendarRepository` / `CalendarEventRepository`
- RFC 9670 sharing writes
- Apps changes

## Affected packages

- packages/api

## Technical constraints

- Own only the `wgw.calendars` group in `routes/api.php` and `/calendars/*` OpenAPI paths
- Extract calendar cases from shared `JmapRest*` tests; leave contacts/tasks
- Keep `CalendarsCalDavInteropTest`

## Edge cases

- Group-scoped calendars (membership ACL)
- Cross-user event get/set/query
- ICS component-count payload bounds
- Multi-VEVENT composite ids and recurrence overrides
