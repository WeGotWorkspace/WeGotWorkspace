# Real-client round-trip captures

Captured on 2026-10-18 against the local Docker HTTPS stack (`https://wegotworkspace.localhost`, `main` at `6d9993fa4`). Each pair is what a real client stored over CalDAV/CardDAV (`*.before.*`) and what the server held after one unrelated edit in WGW (`*.after-*`). They back the findings in [jscalendar-conformance.md](../../../../../../docs/architecture/jscalendar-conformance.md) and [jscontact-conformance.md](../../../../../../docs/architecture/jscontact-conformance.md).

| Pair | Client | WGW edit | Findings shown |
|---|---|---|---|
| `apple-calendar-macos26-event` | Apple Calendar, macOS 26.6.2 (`dataaccessd`) | `CalendarEvent/set` title only | RT-1 (URL becomes a WGW Meet `CONFERENCE` + `X-GOOGLE-CONFERENCE`), RT-5 (VALARM `UID`/`X-WR-ALARMUID` dropped), RT-9 (`CALSCALE` dropped, `PRODID` replaced), LAST-MODIFIED not bumped |
| `apple-reminders-macos26-todo` | Apple Reminders, macOS 26.6.2 (`remindd`, CalDAV list) | `PATCH /api/v1/tasks/items/{id}` title only | RT-T6 (VALARM `UID`/`X-WR-ALARMUID` dropped), VTIMEZONE replaced by a generated one with `TZUNTIL:2028…` (RT-T8, #1435) |
| `thunderbird158-card` | Thunderbird 158 (CardDAV) | `ContactCard/set` name only | CT-1 (second ungrouped ADR deleted; it was already invisible in WGW on read), 7-part `N` written to a vCard 3.0 card |

Notes:

- The Thunderbird `before` card is the stored bytes after the server's CardDAV PUT plugins ran (PROP-ID added, Sabre PRODID), not Thunderbird's raw request body.
- Apple Reminders syncs VTODO over CalDAV for non-iCloud lists. Indent (subtasks) is disabled for those lists, so RT-T1 cannot be produced from Reminders; Thunderbird does not create subtasks either.
- Apple Contacts did not upload the test card during the session (no CardDAV PUT after the account's initial sync), so there is no Apple vCard pair yet.
