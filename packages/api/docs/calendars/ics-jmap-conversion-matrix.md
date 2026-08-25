# iCalendar ↔ JMAP CalendarEvent conversion matrix

## Scope

CalDAV stores one `.ics` blob per `calendarobjects` row. The REST API maps each logical `VEVENT` to one JMAP `CalendarEvent`.

## Multi-VEVENT

| Case | REST `CalendarEvent.id` | CRUD |
|------|-------------------------|------|
| ICS with 1 VEVENT | `{objectUri}` without `.ics` | Full object CRUD |
| ICS with N>1 VEVENT | `{objectUri}#{veventUid}` per component | Read all; PUT/PATCH/DELETE target one VEVENT |
| POST create | `{newObjectUri}` without `.ics` | Always writes single-VEVENT ICS |

**Update/delete on composite id:** only the targeted `VEVENT` is changed; siblings are preserved. Deleting the last `VEVENT` removes the `calendarobjects` row.

## Core fields

| iCalendar | JMAP CalendarEvent |
|-----------|-------------------|
| UID | uid |
| SUMMARY | title |
| DESCRIPTION | description |
| DTSTART | start (+ showWithoutTime, timeZone) |
| DTEND | end |
| DURATION | duration (when no DTEND) |
| RRULE | recurrenceRules[] |
| EXDATE | excludedRecurrenceDates[] |
| RECURRENCE-ID override VEVENT | recurrenceOverrides (key = RECURRENCE-ID) |
| LOCATION | locations (single entry) |
| STATUS | status |
| TRANSP | freeBusyStatus |
| CLASS | privacy |
| CATEGORIES | categories |
| ORGANIZER / ATTENDEE | participants |
| VALARM | alerts |
| CREATED | created |
| LAST-MODIFIED / DTSTAMP | updated |
| SEQUENCE | sequence |
| PRIORITY | priority |
| Unknown VEVENT props | icsProps |

## Recurrence

| Direction | Rule |
|-----------|------|
| ICS → JMAP | Parse RRULE into `RecurrenceRule` objects with RFC 8984 §4.3.3 wire types (`byDay` = `NDay[]` objects, `byMonth` = `String[]` incl. leap-month `"3L"`, `byHour`/`byMinute`/`bySecond` = `UnsignedInt[]`); **do not** expand instances |
| JMAP → ICS | Serialize `recurrenceRules` to RRULE properties (all BY* parts); write side also tolerates the legacy shapes (`byDay` iCal strings, `byMonth` integers) still used by tasks |
| RECURRENCE-ID override VEVENT | Merged into master `recurrenceOverrides` (key = RECURRENCE-ID datetime) |
| `recurrenceOverrides.excluded: true` | STATUS:CANCELLED override VEVENT |
| `recurrenceOverrides` time/title patch | Override VEVENT with RECURRENCE-ID + patched fields |
| RDATE | `recurrenceOverrides` empty patch (key = RDATE datetime) |
| EXRULE | `excludedRecurrenceRules` |
| GEO | `locations.coordinates` |
| URL | `links` |
| ATTACH | `attachments` (href) + `icsProps` fallback |
| VTIMEZONE | `timeZones` map (`icsDefinition` for round-trip). Bare IANA `timeZone` without `icsDefinition` synthesizes a VTIMEZONE so every TZID stays RFC 5545 valid. |
| ATTENDEE ROLE/CUTYPE/RSVP/DELEGATED | `participants` scheduling fields |

Clients expand recurrence locally for display unless `expandRecurrences=true` on list (#159).

## Recurrence overrides vs multi-VEVENT

| Case | REST `CalendarEvent.id` |
|------|-------------------------|
| Master + RECURRENCE-ID overrides (same UID) | Single event `{objectUri}` |
| Unrelated VEVENTs (different UID, no RECURRENCE-ID link) | `{objectUri}#{veventUid}` per component |
| Master + overrides + unrelated VEVENT | Multiple logical events; composite ids when N>1 |

## Alerts (VALARM)

| iCalendar VALARM | JMAP Alert |
|------------------|------------|
| TRIGGER duration (e.g. `-PT15M`) | `trigger` → `RelativeAlert` with `offset` |
| TRIGGER;VALUE=DATE-TIME | `trigger` → `AbsoluteAlert` with `when` |
| TRIGGER;RELATED=END | `trigger.relatedTo: "end"` |
| ACTION: DISPLAY / AUDIO / EMAIL | `action: display / audio / email` |

**Non-reversible:** VALARM `DESCRIPTION`, EMAIL `ATTENDEE`/`SUMMARY`, and AUDIO `ATTACH` are not preserved on read beyond action/trigger mapping.

## Non-reversible cases

- Multiple `VEVENT` in one ICS collapsed to composite ids on read — write path always single-VEVENT for POST
- Unknown iCalendar parameters may be dropped unless preserved in `icsProps`
