# JSCalendar (RFC 8984) conformance and round-trip audit

Audit of how WeGotWorkspace maps CalDAV iCalendar (RFC 5545) to the JSCalendar objects served over JMAP (`urn:ietf:params:jmap:calendars`) and REST, and back. Date: 2026-10-18. Target spec: [RFC 8984](https://www.rfc-editor.org/rfc/rfc8984) (we do not target the jscalendarbis draft).

**Scope:** `packages/api/app/Services/Calendars/Conversion/*`, `packages/api/app/Services/Tasks/Conversion/*`, `packages/api/app/Services/VObject/*`, the CalendarEvent JMAP methods, and the update paths in `CalendarEventMutationSupport::persistEventMutation` and `TaskRepository::patch`.

**Related:** [packages/api/docs/calendars/ics-jmap-conversion-matrix.md](../../packages/api/docs/calendars/ics-jmap-conversion-matrix.md) (field mapping reference), [tasks.md](tasks.md) (Tasks architecture).

**Evidence:** every round-trip claim below has a test.

- `packages/api/tests/Unit/Calendars/JsCalendarRoundTripLossTest.php` (RT-1 … RT-11)
- `packages/api/tests/Unit/Tasks/TaskRoundTripLossTest.php` (RT-T1 … RT-T7)

These are **characterization tests**. They pass today and assert the current lossy output. The fix for a finding flips that finding's assertions.

---

## Summary

1. **Storage of record is safe only until WGW writes.** The CalDAV store keeps everything an external client wrote. Data is lost when someone edits the item in WGW (web app, REST, MCP, JMAP `/set`).
2. **Root cause: the writer rebuilds, it doesn't patch.** Every update converts ICS → JMAP, merges the patch, and rebuilds the VEVENT/VTODO from the JMAP object. For single-component objects (the normal case from Apple, Thunderbird, DAVx5) it rebuilds the whole VCALENDAR. Anything the JMAP model can't hold is lost: parameters, repeated properties, VALARM sub-properties, override-specific data, and calendar-level properties.
3. **`icsProps` is not a lossless escape hatch.** It is a `name → string` map. It loses parameters, keeps only the last of repeated properties, and re-escapes multi-value lists.
4. **Some losses are not just lossy, they corrupt data:** a plain `URL` becomes a "WeGotWorkspace Meet" video conference, an inline binary `ATTACH` is decoded and rewritten as text, a `urn:uuid:` attendee becomes `mailto:urn:uuid:…`, a DTEND in another time zone moves, subtask links (`RELATED-TO`) collapse, and all-day task overrides get an invalid `RECURRENCE-ID`.
5. **Spec conformance gaps also exist** in the JSON shape (alert trigger types, `categories` vs `keywords`, `roles` as a list, task `progress`). These matter for third-party JMAP clients, not for CalDAV round-trips.

**A items (silent data loss, must fix):** RT-1 … RT-11 and RT-T1 … RT-T6. See [Classification](#classification).

---

## 1. Property matrix

Legend: ✅ supported · ⚠️ partial or non-conformant shape · ❌ not supported · R = ICS → JMAP · W = JMAP → ICS. "icsProps" means the iCalendar property survives only as a lossy `icsProps` string (see RT-2).

Code locations (all under `packages/api/app/Services/`):

- `VEventToJmapEventConverter` = `Calendars/Conversion/VEventToJmapEventConverter.php`
- `JmapEventToVEventConverter` = `Calendars/Conversion/JmapEventToVEventConverter.php`
- `Location…` / `Participant…` / `RecurrenceOverride…` / `TimeZone…` = `Calendars/Conversion/*Support.php`
- `ICalendarRecurrence`, `ICalendarAlarmTrigger` = `VObject/*.php`
- Task R / W = `Tasks/Conversion/IcsToJmapTaskConverter.php` / `JmapToIcsTaskConverter.php` + `TaskConversionSupport.php`

### 1.1 Common properties (RFC 8984 §4) — Event

| Property | § | R | W | iCalendar | Notes / code |
|---|---|---|---|---|---|
| `@type` | 4.1.1 | ✅ | ✅ | — | `VEventToJmapEventConverter::convertVEvent`, `CalendarConversionSupport::normalizeEventMapKeys` |
| `uid` | 4.1.2 | ✅ | ✅ | UID | New uids are `urn:uuid:` |
| `relatedTo` | 4.1.3 | ❌ | ❌ | RELATED-TO | icsProps (repeats collapse, RELTYPE lost) |
| `prodId` | 4.1.4 | ❌ | ❌ | PRODID | Overwritten with `-//WeGotWorkspace//Calendars REST//EN` (RT-9) |
| `created` | 4.1.5 | ✅ | ✅ | CREATED | |
| `updated` | 4.1.6 | ✅ | ⚠️ | LAST-MODIFIED / DTSTAMP | Old value is written back. LAST-MODIFIED is not bumped on edit. |
| `sequence` | 4.1.7 | ✅ | ⚠️ | SEQUENCE | Bumped only when scheduling sees a significant change (`CalendarSchedulingService::persistableIcs`) |
| `method` | 4.1.8 | ❌ | ❌ | METHOD | Dropped (RT-9) |
| `title` | 4.2.1 | ✅ | ✅ | SUMMARY | |
| `description` | 4.2.2 | ✅ | ✅ | DESCRIPTION | |
| `descriptionContentType` | 4.2.3 | ❌ | ❌ | X-ALT-DESC (Outlook HTML) | icsProps |
| `showWithoutTime` | 4.2.4 | ✅ | ✅ | VALUE=DATE | |
| `locations` | 4.2.5 | ⚠️ | ⚠️ | LOCATION, GEO | One location only. ALTREP (a URI) is mapped to `description` (text). `timeZone`, `locationTypes`, `relativeTo` and `links` are not mapped. `LocationConversionSupport` |
| `virtualLocations` | 4.2.6 | ❌ | ❌ | CONFERENCE | CONFERENCE is folded into `links` instead (RT-1) |
| `links` | 4.2.7 | ⚠️ | ⚠️ | URL, CONFERENCE, X-GOOGLE-CONFERENCE, X-MICROSOFT-SKYPETEAMSMEETINGURL | First href only. Always written as a WGW Meet conference (RT-1). |
| `locale` | 4.2.8 | ❌ | ❌ | LANGUAGE param | |
| `keywords` | 4.2.9 | ❌ | ❌ | CATEGORIES | RFC 8984 maps CATEGORIES here |
| `categories` | 4.2.10 | ⚠️ | ⚠️ | CATEGORIES | WGW uses `String[]` of labels. The spec uses `String[Boolean]` of category URIs. |
| `color` | 4.2.11 | ❌ | ❌ | COLOR (RFC 7986) | The web app sends `color`; the server drops it (RT-11) |
| `recurrenceId` | 4.3.1 | ⚠️ | — | RECURRENCE-ID | Emitted only on expanded instances (`CalendarEventExpansionService`) |
| `recurrenceIdTimeZone` | 4.3.2 | ❌ | ❌ | | |
| `recurrenceRules` | 4.3.3 | ✅ | ✅ | RRULE | `ICalendarRecurrence`. See RecurrenceRule below. |
| `excludedRecurrenceRules` | 4.3.4 | ✅ | ✅ | EXRULE | |
| `recurrenceOverrides` | 4.3.5 | ⚠️ | ⚠️ | RDATE, EXDATE, override VEVENTs | Override VEVENTs are diffed against a fixed subset of fields (RT-8). RDATE is lost when overrides exist (RT-7). `RecurrenceOverrideSupport` |
| `excluded` | 4.3.6 | ✅ | ✅ | STATUS:CANCELLED override | Written as a cancelled override VEVENT, not EXDATE |
| `priority` | 4.4.1 | ✅ | ✅ | PRIORITY | |
| `freeBusyStatus` | 4.4.2 | ⚠️ | ⚠️ | TRANSP | Adds a non-spec value `tentative` (spec: `free`, `busy`) |
| `privacy` | 4.4.3 | ✅ | ✅ | CLASS | CONFIDENTIAL ↔ `secret` |
| `replyTo` | 4.4.4 | ❌ | ❌ | ORGANIZER address | The organizer is exposed only as a participant `email` |
| `sentBy` | 4.4.5 | ❌ | ❌ | ORGANIZER;SENT-BY | Dropped (RT-4) |
| `participants` | 4.4.6 | ⚠️ | ⚠️ | ORGANIZER, ATTENDEE | See Participant below |
| `requestStatus` | 4.4.7 | ❌ | ❌ | REQUEST-STATUS | icsProps |
| `useDefaultAlerts` | 4.5.1 | ❌ | ❌ | | |
| `alerts` | 4.5.2 | ⚠️ | ⚠️ | VALARM | Non-conformant trigger types. Most VALARM data is lost (RT-5). |
| `localizations` | 4.6.1 | ❌ | ❌ | | |
| `timeZone` | 4.7.1 | ✅ | ✅ | TZID param | DTEND's own TZID is lost (RT-6) |
| `timeZones` | 4.7.2 | ⚠️ | ✅ | VTIMEZONE | Shape is `{tzid, icsDefinition}`. The spec uses `tzId`, `standard[]`, `daylight[]`. Round-trips via `icsDefinition`. `TimeZoneSupport` |

### 1.2 Event-specific (§5.1) and WGW extensions

| Property | § | R | W | iCalendar | Notes |
|---|---|---|---|---|---|
| `start` | 5.1.1 | ✅ | ✅ | DTSTART | |
| `duration` | 5.1.2 | ✅ | ✅ | DURATION / DTEND−DTSTART | Wrong when DTEND has a different TZID (RT-6) |
| `status` | 5.1.3 | ✅ | ✅ | STATUS | |
| `end` | — (WGW) | ✅ | ✅ | DTEND | Not in RFC 8984. Written in the event's `timeZone`. |
| `attachments` | — (WGW) | ✅ | ✅ | ATTACH | RFC 8984 uses `links` with `rel: enclosure`. Parameters are lost (RT-3). |
| `icsProps` | — (WGW) | ✅ | ✅ | unknown properties | `name → string` (RT-2) |
| `calendarIds`, `etag`, `state` | JMAP | ✅ | — | | |

### 1.3 Task-specific (§5.2) and Task common properties

| Property | § | R | W | iCalendar | Notes |
|---|---|---|---|---|---|
| `due` | 5.2.1 | ✅ | ✅ | DUE | |
| `start` | 5.2.2 | ✅ | ✅ | DTSTART | |
| `estimatedDuration` | 5.2.3 | ❌ | ❌ | DURATION | icsProps |
| `percentComplete` | 5.2.4 | ⚠️ | ⚠️ | PERCENT-COMPLETE | Exposed as `progress` (int) (RT-T7) |
| `progress` | 5.2.5 | ⚠️ | ⚠️ | STATUS | Exposed as `workflowStatus` (RT-T7) |
| `progressUpdated` | 5.2.6 | ❌ | ❌ | | |
| `completed` | — (WGW) | ✅ | ✅ | COMPLETED | Not in RFC 8984 (the spec derives it from `progress`) |
| `isDraft`, `sortOrder` | — (WGW) | ✅ | ❌ | | Not in RFC 8984. Not persisted to ICS. |
| `sequence` | 4.1.7 | ❌ | ❌ | SEQUENCE | Dropped (RT-T2) |
| `relatedTo` | 4.1.3 | ❌ | ❌ | RELATED-TO | icsProps. Subtask links collapse (RT-T1). |
| `locations`, `links` | 4.2.5/7 | ❌ | ❌ | LOCATION, GEO, URL | icsProps |
| `recurrenceRules` | 4.3.3 | ⚠️ | ✅ | RRULE | Legacy wire types (`byDay` strings, `byMonth` ints) |
| `excludedRecurrenceRules`, RDATE | 4.3.4/5 | ❌ | ❌ | EXRULE, RDATE | icsProps. Not expanded. Copied into overrides (RT-T4). |
| `recurrenceOverrides` | 4.3.5 | ⚠️ | ⚠️ | override VTODOs, EXDATE | Fixed field subset. All-day RECURRENCE-ID is invalid on write (RT-T3). |
| `alerts` | 4.5.2 | ✅ | ⚠️ | VALARM | Conformant trigger shapes, including `acknowledged`. DESCRIPTION/UID lost (RT-T6). |
| `participants` | 4.4.6 | ⚠️ | ⚠️ | ORGANIZER, ATTENDEE | Name, email and status only (RT-T5) |
| `timeZones` | 4.7.2 | ❌ | ⚠️ | VTIMEZONE | Not exposed. Written by `TimeZoneSupport` from the IANA id. |
| others (`color`, `keywords`, `locale`, `privacy` ✅, `priority` ✅, `categories` ⚠️, `created`/`updated` ✅) | | | | | Same as Event, except `color`, which lives in icsProps |

### 1.4 Nested types

| Type | Supported | Missing / non-conformant |
|---|---|---|
| **Participant** | `name`, `email`, `roles`, `participationStatus`, `kind`, `expectReply`, `language`, `delegatedTo`, `delegatedFrom` (events). Tasks: `name`, `email`, `roles`, `participationStatus`. | `roles` is a list on read (spec: `String[Boolean]`; write accepts both). `delegatedTo`/`delegatedFrom` are email strings (spec: `Id[Boolean]`). Missing: `description`, `sendTo`, `locationId`, `participationComment`, `scheduleAgent`, `scheduleForceSend`, `scheduleSequence`, `scheduleStatus`, `scheduleUpdated`, `sentBy`, `invitedBy`, `memberOf`, `links`, per-participant `progress`/`percentComplete`. |
| **Location** | `name`, `description`, `coordinates` | `description` holds ALTREP (a URI). Missing `locationTypes`, `relativeTo`, `timeZone` (in OpenAPI, not mapped), `links`. One location only. |
| **VirtualLocation** | — | Not implemented. RFC 8984 maps CONFERENCE here (`uri`, `name` ↔ LABEL, `features` ↔ FEATURE). |
| **Link** | `href`, `rel`, `contentType` | Missing `cid`, `size`, `display`, `title`. Only the first link is written. |
| **Relation** | — | Not implemented |
| **Alert** | `trigger`, `action` (events). Tasks also have `acknowledged`. | Events: trigger `@type` is `RelativeAlert`/`AbsoluteAlert` with `relatedTo` (spec: `OffsetTrigger`/`AbsoluteTrigger` with `relativeTo`). Missing `acknowledged` (events), `relatedTo` (snooze). `UnknownTrigger` is unsupported. Unknown ACTION (e.g. `X-…`, `PROCEDURE`) is coerced to `display`. |
| **RecurrenceRule** | `frequency`, `interval`, `count`, `until`, `byDay`, `byMonth`, `byMonthDay`, `byYearDay`, `byWeekNo`, `byHour`, `byMinute`, `bySecond`, `bySetPosition`, `firstDayOfWeek` | Missing `rscale`, `skip` (RFC 7529). `until` is not a LocalDateTime when UNTIL is a DATE (`YYYY-MM-DD`) or UTC (`…Z`). Tasks use legacy wire types. |
| **NDay** | `day`, `nthOfPeriod` | — |
| **TimeZone / TimeZoneRule** | `tzid`, `icsDefinition` (opaque VTIMEZONE) | Spec shape (`tzId`, `updated`, `url`, `validUntil`, `aliases`, `standard`, `daylight`) not implemented. Round-trip is lossless via `icsDefinition`. |
| **Group** (§5.3) | — | Not implemented (not needed: JMAP serves Events/Tasks) |

### 1.5 JMAP protocol

| Requirement | Status |
|---|---|
| RFC 8620 §5.3 PatchObject (`"alerts/alert2": null`) on `CalendarEvent/set` update | ❌ Pointer keys are ignored (RT-10) |
| Setting a map property replaces it | ❌ Maps (`alerts`, `participants`, `locations`, `links`, `icsProps`) are merged with `array_replace`, so removed entries survive (RT-10). Exception: `recurrenceOverrides` is replaced (`CalendarConversionSupport::deepMergeEventPatch`). |
| Top-level `ifInState` | ✅ `CalendarEventSetMethod` |

---

## 2. Round-trip findings

Every finding replays the real update path. Read the stored ICS, deep-merge a patch (usually just `title`), normalize, write. Inputs are what Apple Calendar, Thunderbird, and DAVx5 / jtx Board / Tasks.org write.

### Calendar events

| ID | Finding | Real-world trigger | Test |
|---|---|---|---|
| **RT-1** | **Conference/URL rewriting.** Any `URL` (even an agenda link) is read as `links.link1` and written back as `URL` + `CONFERENCE;FEATURE=VIDEO;LABEL=WeGotWorkspace Meet` + `X-GOOGLE-CONFERENCE`. Third-party CONFERENCE label and features (Zoom, `FEATURE=AUDIO`) are overwritten. Extra CONFERENCE entries (phone dial-in `tel:`) are dropped. `X-MICROSOFT-SKYPETEAMSMEETINGURL` is replaced. | Thunderbird/Apple `URL`, Google/Zoom invites with dial-in, Teams invites | `test_rt1_*` (3) |
| **RT-2** | **`icsProps` is lossy.** Parameters are dropped (`X-APPLE-STRUCTURED-LOCATION` loses X-TITLE/X-ADDRESS/X-APPLE-RADIUS, so Apple Maps location breaks). `IMAGE;DISPLAY=` is dropped. Repeated properties keep only the last value (COMMENT, RELATED-TO, CONTACT). Multi-value lists are rewritten as one escaped text value (`RESOURCES:Projector\,Whiteboard`, `geo:52.37\,4.89`). | Apple Calendar structured locations, RFC 7986 IMAGE, Outlook RESOURCES | `test_rt2_*` (2) |
| **RT-3** | **ATTACH corruption.** FILENAME, SIZE and MANAGED-ID (CalDAV managed attachments, RFC 8607) are dropped. Inline `ENCODING=BASE64;VALUE=BINARY` attachments are decoded and written back as a text value. | Apple Calendar attachments, Thunderbird inline files | `test_rt3_*` |
| **RT-4** | **Scheduling parameters dropped.** ORGANIZER/ATTENDEE lose SCHEDULE-AGENT, SCHEDULE-STATUS, SCHEDULE-FORCE-SEND, SENT-BY, EMAIL, DIR, MEMBER and X-* params. Dropping `SCHEDULE-AGENT=CLIENT` makes the server send iTIP for a client that wanted to do it itself, so attendees get double invites. Non-`mailto:` addresses (`urn:uuid:`, resources) get a `mailto:` prefix. | Apple (`SCHEDULE-STATUS`, `EMAIL`), Thunderbird (`SCHEDULE-AGENT=CLIENT`), room resources | `test_rt4_*` (2) |
| **RT-5** | **VALARM data loss.** Lost: UID / X-WR-ALARMUID, ACKNOWLEDGED, RELATED-TO (snooze), REPEAT/DURATION, X-APPLE-*/X-* props, DESCRIPTION/SUMMARY/ATTENDEE/ATTACH. EMAIL alarms get `ATTENDEE:mailto:organizer@invalid`. Unknown ACTIONs become DISPLAY. Effect: dismissed alarms fire again on every device, snoozes vanish, and Apple duplicates default alarms. The OpenAPI `CalendarEventAlert` schema (`additionalProperties: false`) currently forbids carrying these fields. | Every Apple/Thunderbird event with a reminder | `test_rt5_*`; also existing `ICalendarJmapEventConverterTest::test_*_valarm_*_lossy_*` |
| **RT-6** | **Cross-zone DTEND.** DTEND's TZID is dropped. The end is rewritten in the DTSTART zone. `duration` is computed from local wall times (PT3H instead of PT9H for 10:00 Amsterdam → 13:00 New York). | Apple/Google flight and travel events | `test_rt6_*` |
| **RT-7** | **RDATE lost with overrides.** `VEventToJmapEventConverter::convertAll` overwrites the RDATE-derived `recurrenceOverrides` with the override-VEVENT map. Extra dates vanish once any instance has been edited. | Any series with an added date and an edited instance | `test_rt7_*` |
| **RT-8** | **Override VEVENTs reduced to a diff subset.** Only title, description, start/end/duration, location name, conference href, status, transp, class and participant PARTSTAT are read. An override's own VALARMs, CATEGORIES, PRIORITY, GEO, ATTACH, attendee params and X-props are lost. On write the override inherits the master's values. | "Remind me differently for this one occurrence" (Apple), per-instance categories | `test_rt8_*` |
| **RT-9** | **Calendar-level data dropped.** A single-VEVENT object is rebuilt (`icsFromEvent`), not updated in place. CALSCALE, METHOD, X-WR-*, the original PRODID and any other component in the object are dropped. Lower impact than RT-1…8, but it is the same root cause. | Thunderbird `X-WR-TIMEZONE`, imported feeds | `test_rt9_*` |
| **RT-10** | **Map edits don't remove entries.** The web app sends the whole event to `CalendarEvent/set`. `deepMergeEventPatch` merges map values, so a participant or alert removed in the UI is silently kept. RFC 8620 PatchObject pointer paths are ignored. | Removing an attendee or reminder in the web app | `test_rt10_*` (2) |
| **RT-11** | **`color` dropped.** The web app reads and writes RFC 8984 `color` (`packages/apps/src/lib/jmap-client/mapping/event.ts`). The server never writes COLOR from it and only reads COLOR into `icsProps.COLOR`, so a per-event color set in WGW disappears and Apple's event colors never show. | Per-event colors in the web app or Apple Calendar | `test_rt11_*` |

### Tasks

| ID | Finding | Real-world trigger | Test |
|---|---|---|---|
| **RT-T1** | **Subtask links collapse.** Multiple `RELATED-TO` keep only the last value and RELTYPE is dropped, so a `RELTYPE=CHILD` link turns into the default PARENT. jtx Board and Tasks.org hierarchies break after any WGW edit. | DAVx5 + jtx Board / Tasks.org subtasks, Thunderbird | `test_rt_t1_*` |
| **RT-T2** | **SEQUENCE dropped.** It is listed in `KNOWN_VTODO_PROPERTIES` but never read or written. Assigned-task iTIP and client conflict detection break. | Any task from a scheduling client | `test_rt_t2_*` |
| **RT-T3** | **Invalid all-day RECURRENCE-ID.** Override VTODOs are written `RECURRENCE-ID:20260720` without `VALUE=DATE`, which is invalid RFC 5545. | Recurring all-day tasks with one edited occurrence | `test_rt_t3_*` |
| **RT-T4** | **Task overrides: own data lost, master data copied in.** An override's X-props, alarms and attendees are lost. The master's icsProps (RDATE, EXRULE, RELATED-TO) are copied into each override VTODO. | Recurring tasks with an edited occurrence | `test_rt_t4_*` |
| **RT-T5** | **Task participant parameters dropped.** ROLE, RSVP, CUTYPE, SCHEDULE-AGENT and every other param except CN/PARTSTAT are lost. CN is filled with the email address when the client sent none. | Assigned tasks (Apple Reminders delegation, Thunderbird) | `test_rt_t5_*` |
| **RT-T6** | **Task VALARM data lost.** DESCRIPTION and UID are dropped, so a DISPLAY alarm is written without the DESCRIPTION that RFC 5545 requires. | Any task reminder | `test_rt_t6_*` |
| RT-T7 | Task wire shape uses pre-RFC 8984 names: `workflowStatus` for `progress`, and `progress` (int) for `percentComplete`. Not data loss. | Third-party JMAP clients | `test_rt_t7_*` |

### What does survive

Pinned by existing tests or confirmed while probing:

- UID, SUMMARY, DESCRIPTION, DTSTART/DTEND/DURATION in one zone, RRULE (all BY* parts), EXRULE, EXDATE, STATUS, TRANSP, CLASS, PRIORITY, CATEGORIES, CREATED, GEO, and single-value X-* properties without parameters (`X-FOO:a\,b\;c` round-trips).
- VTIMEZONE definitions, through `timeZones[*].icsDefinition`.
- Sibling VEVENTs in multi-VEVENT objects (composite ids, `updateVEventInIcs`).

### Notes (VJOURNAL)

Notes do not have the rebuild problem. `NoteJournalConverter::mergeIntoIcs` reads the stored VJOURNAL and touches only SUMMARY, DESCRIPTION, CATEGORIES and STATUS. Both the REST save (`NoteRepository`) and the collaborative save (`NoteCollaborativeWrite`) use it. `NoteRoundTripTest` pins that ATTACH, RELATED-TO, ATTENDEE, COLOR, X-* properties with parameters and calendar-level properties survive a title edit. This is the pattern A0 proposes for events and tasks.

| ID | Finding | Severity |
|---|---|---|
| NT-1 [#1410](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1410) | A body edit collapses several DESCRIPTIONs (allowed in VJOURNAL, RFC 5545 §3.6.3) into one and drops their parameters (LANGUAGE, ALTREP). Pinned by `test_nt1_*`. | Low (few clients write more than one) |

**Not covered here:** the body goes through the TipTap editor and back to markdown in the client. A note written by another app can come back with different markdown syntax (list markers, blank lines) after one WGW edit. No text is lost, but the bytes change. That is a client-side codec question and needs a test in `packages/apps`.

---

## Classification

### A — silent data loss on round-trip (must fix)

| ID | Short name | Severity |
|---|---|---|
| RT-1 [#1393](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1393) | URL/CONFERENCE rewritten as WGW Meet; dial-in and labels lost | High (user-visible corruption) |
| RT-4 [#1394](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1394) | Scheduling params dropped; non-mailto addresses corrupted | High (duplicate iTIP mail) |
| RT-5 [#1395](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1395) | VALARM identity, acknowledgement, snooze and extras lost | High (alarms re-fire on all devices) |
| RT-T1 [#1396](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1396) | Task RELATED-TO collapse | High (subtask trees break) |
| RT-6 [#1397](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1397) | Cross-zone DTEND moved | High (wrong times) |
| RT-3 [#1398](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1398) | ATTACH params dropped; binary corrupted | Medium |
| RT-7 [#1399](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1399) | RDATE lost when overrides exist | Medium |
| RT-8 [#1400](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1400) | Override VEVENT extras lost | Medium |
| RT-10 [#1401](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1401) | Map edits don't remove entries; PatchObject ignored | Medium (edit silently not applied) |
| RT-11 [#1402](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1402) | `color` dropped | Medium |
| RT-T2 [#1403](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1403) | Task SEQUENCE dropped | Medium |
| RT-T3 [#1404](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1404) | Invalid all-day RECURRENCE-ID on task overrides | Medium (invalid ICS) |
| RT-T4 [#1405](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1405) | Task override data lost and master data copied in | Medium |
| RT-T5 [#1406](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1406) | Task participant params dropped | Medium |
| RT-T6 [#1408](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1408) | Task VALARM DESCRIPTION/UID lost | Low–Medium (invalid DISPLAY alarm) |
| RT-2 [#1407](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1407) | `icsProps` loses params, repeats and list values | Medium (fixed structurally by A0) |
| RT-9 [#1409](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1409) | VCALENDAR-level properties dropped | Low |
| RT-T8 [#1435](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1435) | Task VTIMEZONE regenerated with `TZUNTIL` 2028 (found in the real-client run) | Low |

### B — properties UI, MCP or clients plausibly need (fix on demand)

| Item | Why |
|---|---|
| Alert trigger conformance (`OffsetTrigger`/`AbsoluteTrigger`, `relativeTo`) + `acknowledged` for events | Any spec-following JMAP client breaks today. Tasks already conform. |
| `virtualLocations` ↔ CONFERENCE | The spec-native home for conference links. It is the clean fix for RT-1. |
| `keywords` ↔ CATEGORIES (keep `categories` as an alias during migration) | Spec mapping |
| `roles`, `delegatedTo`/`delegatedFrom` as maps; `sendTo`, `scheduleAgent`, `scheduleStatus`, `sentBy` on Participant | Needed to carry RT-4 data in JSON |
| `relatedTo` (events and tasks) | Subtasks in the UI and MCP; carries RT-T1 data |
| Task `progress` / `percentComplete` / `estimatedDuration` alignment (RT-T7) | Spec names. Breaking wire change; needs a versioned transition. |
| `descriptionContentType` (X-ALT-DESC HTML) | Outlook invites show raw text |
| `locations` multi-entry + `Location.timeZone` | `timeZone` is already in OpenAPI but not mapped |
| `attachments` → `links` with `rel: enclosure` | Spec shape |
| Bump LAST-MODIFIED/`updated` on edit | Clients that order or merge by LAST-MODIFIED |
| `until` as LocalDateTime | Spec shape for date and UTC UNTIL |

### C — unused corners of the spec (document as intentionally unsupported)

`method`, `prodId` as a writable property, `locale`, `localizations`, `useDefaultAlerts`, `replyTo` beyond the organizer address, `requestStatus`, `recurrenceIdTimeZone`, `rscale`/`skip`, `UnknownTrigger`, structured `TimeZone`/`TimeZoneRule` (`icsDefinition` is lossless), Group objects (§5.3), Link `cid`/`size`/`display`/`title`, Location `locationTypes`/`relativeTo`, Participant `invitedBy`/`memberOf`/`locationId`/per-participant progress. With A0 in place these all survive a CalDAV round-trip as opaque ICS, even though JMAP never exposes them.

---

## Filed

Tracked in milestone [CalDAV interop hardening](https://github.com/WeGotWorkspace/WeGotWorkspace/milestone/11): Goal [Product#138](https://github.com/WeGotWorkspace/Product/issues/138), Epic #1391, A0 #1392. Spec-conformance Tasks B1–B6: #1411–#1416 (no milestone). NT-1 is #1410.

The drafts below are what was filed.

## Proposed milestone: `calendar interop hardening`

Follows [issue-filing.md](../../.agents/skills/developer/issue-filing.md).

- **One Goal** (Product Project, Status **Identified**, no milestone until adopted).
- **A items** are **Bugs** (`bug-report.yml`, GitHub type Bug, no Goal required). They carry the milestone and link to the Goal in *Additional context*.
- **Selected B items** are **Tasks** (`type:task`, parent = the Goal).
- Labels: `area:calendar`, plus `area:tasks` where it applies.

**A0 is the structural fix.** It removes most of RT-2/3/4/5/8/9/T4 at once. Per-finding Bugs stay so each loss has its own failing-to-passing test. Several of them close together with A0.

### Goal — Edit events and tasks in WeGotWorkspace without breaking them in other calendar apps

- **Outcome:** An event or task created in Apple Calendar, Thunderbird or an Android CalDAV app keeps all its details (reminders, attendees' scheduling settings, conference links, attachments, subtasks, colors) after someone edits it in WeGotWorkspace.
- **Who:** People who use WGW alongside native calendar and task apps on their devices.
- **Success looks like:** Editing the title of any item in WGW changes only the title as seen from every other client. No reminders fire again, no invites are duplicated, and no subtasks detach.
- **Non-goals:** Exposing every RFC 8984 property in the WGW UI. Supporting the jscalendarbis draft.

### A0 (Task, parent Goal) — Update stored iCalendar in place instead of rebuilding it

**Body:** Event and task updates rebuild the VEVENT/VTODO (and for single-component objects the whole VCALENDAR) from the JMAP model, so everything the model can't represent is dropped. Change the writers to patch the stored component. Regenerate only the properties WGW owns whose JMAP value actually changed, and keep all other properties, parameters, sub-components and calendar-level data verbatim.

- [ ] `JmapEventToVEventConverter` and `JmapToIcsTaskConverter` update the existing VCALENDAR/VEVENT/VTODO in place for both single- and multi-component objects
- [ ] A property whose JMAP value is unchanged is written back byte-identical, including parameters and repeated instances
- [ ] Unmodelled VALARM, ATTACH, ATTENDEE and ORGANIZER parameters and sub-properties survive an unrelated edit
- [ ] Override components keep their own unmodelled data; master-only properties are not copied into overrides
- [ ] `JsCalendarRoundTripLossTest` RT-2, RT-3 (params), RT-8, RT-9 and `TaskRoundTripLossTest` RT-T4 assertions flipped to "preserved"
- [ ] Fastmail/Audriga interop fixtures still pass

### A-bugs

Format: **Title** · What is going wrong · What should happen · Acceptance criteria.

**RT-1 — Editing an event turns any URL into a "WeGotWorkspace Meet" conference**
- Wrong: A `URL` (agenda link) or third-party `CONFERENCE` is rewritten as `CONFERENCE;LABEL=WeGotWorkspace Meet` + `X-GOOGLE-CONFERENCE`. Zoom/Teams labels and dial-in entries are lost.
- Expected: URL stays a plain link. Every CONFERENCE keeps its URI, FEATURE and LABEL. WGW only emits its Meet conference for a WGW Meet link.
- AC:
  - [ ] `URL` round-trips as a `links` entry, not a conference
  - [ ] Multiple CONFERENCE entries round-trip with their params (prefer `virtualLocations`, see B1)
  - [ ] X-MICROSOFT-SKYPETEAMSMEETINGURL is preserved unchanged
  - [ ] `test_rt1_*` flipped

**RT-2 — Unknown iCalendar properties lose their parameters and repeated values on edit**
- Wrong: `icsProps` holds one string per name, which loses parameters, repeats and list values.
- Expected: Unknown properties round-trip byte-identical (via A0). If `icsProps` stays on the wire, it carries params and multiple values.
- AC:
  - [ ] X-APPLE-STRUCTURED-LOCATION with params, IMAGE;DISPLAY, two COMMENTs and multi-value RESOURCES round-trip unchanged
  - [ ] `test_rt2_*` flipped

**RT-3 — Event attachments lose metadata and inline files get corrupted on edit**
- AC:
  - [ ] FILENAME, SIZE and MANAGED-ID params preserved
  - [ ] Inline BASE64 binary ATTACH preserved byte-identical
  - [ ] `test_rt3_*` flipped

**RT-4 — Editing an event drops attendee scheduling settings and corrupts non-email addresses**
- Wrong: SCHEDULE-AGENT, SCHEDULE-STATUS, SENT-BY, EMAIL and X-* params are dropped. `urn:uuid:` attendees become `mailto:urn:uuid:`.
- Expected: Params preserved. Calendar-user addresses are written as received.
- AC:
  - [ ] `SCHEDULE-AGENT=CLIENT` survives an edit and the server sends no iTIP for that attendee
  - [ ] Non-mailto addresses round-trip unchanged
  - [ ] `test_rt4_*` flipped

**RT-5 — Reminders re-fire and snoozes vanish after an event is edited in WGW**
- Wrong: VALARM UID, ACKNOWLEDGED, RELATED-TO, REPEAT/DURATION, DESCRIPTION and X-* are dropped. EMAIL alarms get a placeholder attendee.
- Expected: Alarms the user did not change are written back unchanged. Edited alarms keep their UID.
- AC:
  - [ ] Unchanged VALARMs are byte-identical after an unrelated edit
  - [ ] `acknowledged` read and written for events (with B2)
  - [ ] No `organizer@invalid` placeholder when the original had attendees
  - [ ] `test_rt5_*` and the `*_lossy_*` alarm tests in `ICalendarJmapEventConverterTest` updated

**RT-6 — Events whose end is in another time zone move after an edit**
- AC:
  - [ ] DTEND keeps its own TZID on write
  - [ ] `duration` is computed from absolute instants when zones differ
  - [ ] `test_rt6_*` flipped (expects PT9H)

**RT-7 — Extra dates (RDATE) disappear from a series once one occurrence is edited**
- AC:
  - [ ] `convertAll` merges RDATE keys with override-VEVENT keys
  - [ ] RDATE written back
  - [ ] `test_rt7_*` flipped

**RT-8 — Per-occurrence reminders and details are replaced by the series' values on edit**
- AC:
  - [ ] Override VALARMs, CATEGORIES, PRIORITY and X-props preserved (A0)
  - [ ] Overrides do not inherit master alarms they didn't have
  - [ ] `test_rt8_*` flipped

**RT-9 — Editing an event drops calendar-level properties from its file**
- AC:
  - [ ] Single-VEVENT updates go through the in-place path
  - [ ] CALSCALE, X-WR-* and METHOD preserved
  - [ ] `test_rt9_*` flipped

**RT-10 — Removing an attendee or reminder in the web app doesn't stick**
- Wrong: `CalendarEvent/set` update merges map properties, and RFC 8620 pointer paths are ignored.
- Expected: Setting a property replaces it. `a/b` pointer keys patch nested values per RFC 8620 §5.3.
- AC:
  - [ ] Full-map values replace `alerts`, `participants`, `locations`, `links`, `icsProps`
  - [ ] PatchObject pointer paths applied, with `invalidPatch` on bad paths
  - [ ] Web app removal flow verified end-to-end
  - [ ] `test_rt10_*` flipped

**RT-11 — Event colors set in WGW or Apple Calendar are lost**
- AC:
  - [ ] `color` ↔ COLOR (RFC 7986) on read and write, including overrides
  - [ ] Added to the OpenAPI CalendarEvent schema
  - [ ] `test_rt11_*` flipped

**RT-T1 — Subtasks detach after a task is edited in WGW**
- Wrong: Multiple RELATED-TO collapse to one and RELTYPE is dropped.
- AC:
  - [ ] All RELATED-TO with RELTYPE preserved (A0)
  - [ ] Optionally exposed as `relatedTo` (B5)
  - [ ] `test_rt_t1_*` flipped

**RT-T2 — Task SEQUENCE is dropped on edit**
- AC:
  - [ ] SEQUENCE read into `sequence` and written back
  - [ ] Bumped on significant changes, like events
  - [ ] `test_rt_t2_*` flipped

**RT-T3 — Recurring all-day tasks get an invalid RECURRENCE-ID after an edit**
- AC:
  - [ ] Override RECURRENCE-ID written with VALUE=DATE (and TZID where relevant) via `ICalendarDateTime::writeProperty`
  - [ ] `test_rt_t3_*` flipped

**RT-T4 — Edited task occurrences lose their own data and gain the series' RDATE/EXRULE**
- AC:
  - [ ] Master-only properties excluded from overrides
  - [ ] Override X-props and alarms preserved
  - [ ] `test_rt_t4_*` flipped

**RT-T5 — Task assignees lose role, RSVP and scheduling settings on edit**
- AC:
  - [ ] Task participants share event participant mapping (`ParticipantConversionSupport`)
  - [ ] Unmodelled params preserved
  - [ ] CN not synthesized from the email
  - [ ] `test_rt_t5_*` flipped

**RT-T6 — Task reminders lose their text and become invalid after an edit**
- AC:
  - [ ] VALARM DESCRIPTION/UID preserved
  - [ ] New DISPLAY alarms get a DESCRIPTION
  - [ ] `test_rt_t6_*` flipped

### Selected B Tasks (parent: Goal)

**B1 — Expose conference links as RFC 8984 `virtualLocations`**
- AC:
  - [ ] CONFERENCE ↔ `virtualLocations` (`uri`, `name` ↔ LABEL, `features` ↔ FEATURE)
  - [ ] Web app reads and writes them
  - [ ] Meet hook (`CalendarMeetLinkWriteHook`) uses them
  - [ ] OpenAPI updated

**B2 — Make event alert triggers RFC 8984 conformant**
- AC:
  - [ ] Emit `OffsetTrigger` / `AbsoluteTrigger` with `relativeTo`
  - [ ] Accept the old names on write for one release
  - [ ] `acknowledged` on events
  - [ ] Web app and MCP updated
  - [ ] OpenAPI updated

**B3 — Map CATEGORIES to `keywords`**
- AC:
  - [ ] `keywords` (`String[Boolean]`) on read/write
  - [ ] `categories` list accepted on write during transition
  - [ ] Documented

**B4 — Carry scheduling details on Participant**
- AC:
  - [ ] `roles` emitted as a map
  - [ ] `sendTo`, `scheduleAgent`, `scheduleStatus`, `sentBy`, `delegatedTo`/`delegatedFrom` as `Id[Boolean]`
  - [ ] Organizer `replyTo`

**B5 — Expose `relatedTo` for events and tasks**
- AC:
  - [ ] RELATED-TO ↔ `relatedTo` with `Relation.relation` from RELTYPE
  - [ ] Tasks UI/MCP can read parent/child

**B6 — Align Task progress fields with RFC 8984**
- AC:
  - [ ] `progress` (string) and `percentComplete` (int) alongside the legacy names behind a documented deprecation
  - [ ] `estimatedDuration` ↔ DURATION
  - [ ] Task RecurrenceRule uses RFC 8984 wire types

Other B items (`descriptionContentType`, multi-location, `attachments` → `links`, LAST-MODIFIED bump, `until` shape) can be filed when a consumer needs them.
