Source: #429 (body-hash: 69e49aec)

# Calendar API: event item sync (changes/set/query) + converter parity close-out

Technical translation of [#429](https://github.com/WeGotWorkspace/wegotworkspace/issues/429) (parent epic #137). Not a duplicate of the issue AC.

## Goal

Bring `/api/v1/calendars/*` to the same offline-support level as contacts: item-level `GET /calendars/events/changes` over Sabre `calendarchanges`, batch `POST /calendars/events/set` with per-item `ifInState` → `stateMismatch`, and `POST /calendars/events/query` (calendar ids, time range, text). Close out converter parity issues #138–#145 via the evidence protocol (audit below shows all are implemented on `main`). All writes keep going through `Sabre\CalDAV\Backend\PDO`, so CalDAV sync-collection and REST `/changes` read identical `calendarchanges` deltas.

## Non-goals

- Frontend work (separate repo)
- Calendar sharing / `shareWith` (RFC 9670, #157)
- Server-side recurrence instance expansion beyond the existing `expandRecurrences` list option
- Full JMAP protocol envelope (`/jmap` session, method calls)

## Affected packages

- packages/api (routes, controllers, `Services/Calendars/`, `Services/Calendars/Conversion/`, migration, OpenAPI schemas, docs, tests)

## Technical constraints

- OpenAPI first: extend `openapi/schemas/calendars/` before implementing; `composer done-gate:contract` must pass
- Reference implementations: `ContactCardRepository::changes` + `mapChangeUris` (contacts `/cards/changes`), `ContactCardSetService` + `JmapContactStateService` + `jmap_contact_states` (contacts `/cards/set`), `POST /tasks/items/query` (tasks query)
- New `jmap_calendar_event_states` table mirrors `jmap_contact_states` (username, event_id, calendar_uri, object_uri, state_token, etag); MySQL parity suite must cover the migration
- Invalid/expired sync token → 400 `cannotCalculateChanges` (Sabre `getChangesForCalendar` returns `null`)
- Cross-user ACL checks for all new endpoints (extend `JmapRestCrossUserAclTest`)

## Edge cases

- Multi-VEVENT composite ids — see decision below
- `since` empty/`0` on `/changes` → all current ids in `created`, `oldState: "0"`
- Update that adds/removes a sub-VEVENT inside an existing object (object-level "modified" in `calendarchanges`)
- Recurring events in `/query` time-range matching (master DTSTART may precede the window while instances fall inside)
- CalDAV-originated mutations (no REST state rows exist) must still surface correctly in `/changes`

---

## Converter audit — hard gate for Chunk D (audited 2026-08-11 on `main` @ 5ec60dbdc)

All implementing commits are confirmed ancestors of current `main` via `git merge-base --is-ancestor <sha> main`. All were authored 2026-06-14 on `feat/calendars-rest-api`, merged into the tasks branch the same day (9e4b24ccd), and landed on `main` on **2026-07-08** via PR #350 (first release: v0.1.72).

**Reopen history:** #140, #141, #145 were closed 2026-06-14 and reopened 2026-07-02 as "not on main". At that moment the reopen was *correct* — PR #350 only merged on 2026-07-08. It is stale now: the code is on `main` today. Chunk D closes all eight with the evidence protocol (commit SHA + ancestry confirmation + file/test links).

| Issue | Status | Main commit SHA(s) | Ancestry (y/n) | Covering file(s) (`packages/api/app/Services/Calendars/Conversion/`) | Covering test(s) (`packages/api/tests/`) | Residual edge cases |
|-------|--------|--------------------|----------------|----------------------------------------------------------------------|-------------------------------------------|----------------------|
| #138 VALARM ↔ alerts | done (documented lossy edges) | 0e514f8bc (impl), 1d7b55e05 (CalDAV interop tests) | y | `CalendarConversionSupport.php` (`alertFromValarm` L374, `writeValarmComponents` L562), `VEventToJmapEventConverter.php`, `JmapEventToVEventConverter.php` | `Unit/Calendars/ICalendarJmapEventConverterTest.php`: `test_relative_valarm_reads_as_jmap_alert`, `test_absolute_valarm_reads_as_jmap_alert`, `test_valarm_action_types_map_to_jmap`, `test_alerts_round_trip_to_valarm`; `Feature/Calendars/CalendarsCalDavInteropTest.php`: `test_rest_create_with_alerts_persists_valarm_in_caldav_blob`, `test_caldav_valarm_readable_via_rest` | VALARM `DESCRIPTION`, EMAIL `ATTENDEE`/`SUMMARY`, AUDIO `ATTACH` not preserved beyond action/trigger — listed as **Non-reversible** in `docs/calendars/ics-jmap-conversion-matrix.md` (L79). Chunk D decides: fix with regression test or keep documented limitation |
| #139 recurrenceOverrides | done | d17fc2c81 (impl), 352620026 (OpenAPI), 635d5bec7 + 64660a84e (tests/docs) | y | `RecurrenceOverrideSupport.php` | `Feature/Calendars/CalendarEventsTest.php`: `test_recurring_with_override_returns_single_event_with_recurrence_overrides`, `test_patch_recurrence_overrides_updates_single_instance_in_ics`; unit coverage in `ICalendarJmapEventConverterTest.php` | none found |
| #140 RRULE BY* write parity | done | c31d0abd4 (impl), 9d8676d5a (fix) | y | `CalendarConversionSupport.php` `recurrenceRuleToIcs` (BYYEARDAY/BYWEEKNO/BYSETPOS written at L240–247) | `ICalendarJmapEventConverterTest.php`: `test_rrule_by_set_position_round_trip` | none found |
| #141 participant scheduling | done | a6a1693e0 | y | `ParticipantConversionSupport.php` (ROLE, CUTYPE, RSVP, DELEGATED-TO/FROM all mapped) | `ICalendarJmapEventConverterTest.php`: `test_participant_scheduling_round_trip`; Fastmail fixtures `participants.ics`, `organizer.ics` via `ICalendarFastmailInteropTest.php` | iMIP/scheduling inbox explicitly out of scope per issue body (follow-up, not this task) |
| #142 locations/links/attachments | done | 3bcb46ce3 | y | `LocationConversionSupport.php` (GEO ↔ coordinates, URL ↔ links, ATTACH) | `ICalendarJmapEventConverterTest.php`: `test_geo_url_and_virtual_location_round_trip`; Fastmail fixture `locations.ics` | none found |
| #143 VTIMEZONE / timeZones | done (minor test gap) | 3bcb46ce3 (impl), 8de651546 (fix: wrap bare VTIMEZONE icsDefinition — shipped **without** a regression test) | y | `TimeZoneSupport.php` (`timeZonesFromCalendar`, `writeTimeZonesToCalendar`, `referencedTimeZoneIds`) | Indirect only: Fastmail/Audriga round-trip fixtures contain VTIMEZONE/TZID (`ICalendarFastmailInteropTest.php`, `ICalendarAudrigaInteropTest.php`). No named unit test targets the `timeZones` map | Add a named unit test for the bare-VTIMEZONE `icsDefinition` wrap path (8de651546) in Chunk D |
| #144 RDATE / excludedRecurrenceRules | done | df3a0569e | y | `VEventToJmapEventConverter.php`, `JmapEventToVEventConverter.php` (RDATE, EXRULE, `excludedRecurrenceRules`) | `ICalendarJmapEventConverterTest.php`: `test_rdate_and_exrule_round_trip` | none found |
| #145 OpenAPI ↔ converter alignment | done | df3a0569e (impl), 1d3da6e70 (contract restore) | y | `openapi/schemas/calendars/calendar-event.json` (declares `alerts`, `recurrenceOverrides`, `coordinates`, `kind`, `excludedRecurrenceRules`, `rdates`) | `composer done-gate:contract` + converter unit suite | Chunk D re-runs the schema-vs-converter inventory to confirm no new drift since June; Chunks A–C add new schemas that must not reintroduce drift |

**Audit verdict:** no issue is genuinely unimplemented. Chunk D shrinks to evidence-protocol close-out plus, at its discretion, two scoped test/fix items: the #138 non-reversible VALARM sub-properties and the #143 untested VTIMEZONE-wrap fix.

---

## Composite-id decision (binding for Chunks A and C)

**Current id scheme, verified in code** (`CalendarEventMapper::toCalendarEvents`): a single-VEVENT object gets the **plain** id `objectUri` minus `.ics` (no `#uid`); an object holding multiple VEVENTs gets one event per VEVENT with composite id `{objectId}#{uid}` (`CalendarConversionSupport::compositeEventId` / `parseEventId`). Both forms must be handled consistently.

### GET /calendars/events/changes

Sabre `getChangesForCalendar` reports **object uris** (added/modified/deleted). Mapping to event ids:

- **created / updated:** read the current `calendardata` for each reported uri and emit exactly the ids `toCalendarEvents` would produce — the plain objectId for single-VEVENT objects, **all** composite ids `{objectId}#{uid}` for multi-VEVENT objects. This keeps `/changes` ids byte-identical to list/show ids, so client cache keys align. If a modification adds or removes a sub-VEVENT, the object-level operation dictates the bucket: all current composite ids go in `updated` (uid-level created-vs-updated history is not derivable from `calendarchanges`); ids of removed sub-VEVENTs additionally go in `destroyed`.
- **destroyed:** the object's data is gone, so emit the union of (a) the plain objectId and (b) all composite ids last recorded for that object uri in `jmap_calendar_event_states` (Chunk B ensures a state row for every id the REST layer has ever emitted, on read and write). This covers every id a REST client can possibly hold; per JMAP semantics, clients ignore destroyed ids they never saw. CalDAV-only objects (never surfaced over REST) have no state rows and fall back to the plain objectId — correct, since no REST client holds a composite id for them.
- **Sequencing caveat:** Chunk A lands before Chunk B's state table. Chunk A ships destroy-expansion behind a lookup helper that returns `[]` until the table exists (destroys emit the plain objectId only); Chunk B makes the expansion effective. A and B run sequentially in one agent, so this is a two-commit window, not a release-visible gap.

**Rationale:** REST clients address sub-events by composite id (show/update/delete all accept `{objectId}#{uid}`), so object-level ids in `/changes` would force clients to re-derive composites themselves. Emitting all composite ids of an affected object is at worst mildly over-inclusive (a client re-fetches an unchanged sibling sub-event) but never misses a change and never invents an id the rest of the API doesn't use.

### POST /calendars/events/query

- **Time-range matching is per sub-VEVENT:** `calendarobjects.firstoccurence` / `lastoccurence` are object-level columns, so use them only as an index-assisted SQL **pre-filter**; then refine in PHP per VEVENT (DTSTART/DTEND/DURATION plus recurrence expansion via the existing `CalendarEventExpansionService` / Sabre iterator). A composite id matches iff its own VEVENT (or one of its recurrence instances) intersects `[after, before)`; plain single-VEVENT ids are the degenerate one-VEVENT case of the same rule.
- **Text match is per sub-VEVENT** (that VEVENT's SUMMARY/title), consistent with the per-VEVENT id model.

**Rationale:** an object-level match would return sibling sub-events that fall entirely outside the window, which is wrong for the calendar-grid use case that time-range query exists for. Per-VEVENT refinement costs one ICS parse per pre-filtered object, bounded by the SQL pre-filter.
