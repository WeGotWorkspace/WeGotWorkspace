# JMAP REST API — CalDAV/CardDAV parity gaps

> **Epic:** [GitHub #137](https://github.com/WeGotWorkspace/wegotworkspace/issues/137)  
> **Baseline PRs:** Contacts [#132](https://github.com/WeGotWorkspace/wegotworkspace/pull/132), Calendars [#135](https://github.com/WeGotWorkspace/wegotworkspace/pull/135), Tasks [#136](https://github.com/WeGotWorkspace/wegotworkspace/pull/136)  
> **Tasks architecture:** [docs/architecture/tasks.md](../../../docs/architecture/tasks.md) ([#330](https://github.com/WeGotWorkspace/wegotworkspace/issues/330))

This document summarizes what the v1 JMAP-shaped REST layers implement versus full CalDAV/CardDAV (and JMAP spec) expectations. Use it for planning; **track work in GitHub issues** linked below.

## Domain summary

| Domain | v1 scope | Biggest gaps | Issues |
|--------|----------|--------------|--------|
| **Contacts** (CardDAV) | JSContact conversion; REST CRUD; blob upload; localizations; JSCOMPS; matrix gaps closed in [#151](https://github.com/WeGotWorkspace/wegotworkspace/issues/151)–[#156](https://github.com/WeGotWorkspace/wegotworkspace/issues/156) | `/queryChanges`, advanced query filters | — |
| **Calendars** (VEVENT) | Event CRUD, full converter parity (alerts, overrides, RRULE BY*, participants, locations, VTIMEZONE, RDATE/EXRULE), event `/changes` + `/set` + `/query` | Converter matrix closed in [#138](https://github.com/WeGotWorkspace/wegotworkspace/issues/138)–[#145](https://github.com/WeGotWorkspace/wegotworkspace/issues/145) (PR [#350](https://github.com/WeGotWorkspace/wegotworkspace/pull/350), merged 2026-07-08) | — |
| **Tasks** (VTODO) | Title, dates, status, priority | **Recurrence**, **alerts**, participants, `icsProps` | [#146](https://github.com/WeGotWorkspace/wegotworkspace/issues/146)–[#150](https://github.com/WeGotWorkspace/wegotworkspace/issues/150) |
| **Platform** | Collection CRUD + collection `/changes`; contacts card + calendar event item `/changes` / `/set` / `/query`; task `/query` | Task item `/changes` + `/set`, sharing (RFC 9670) | [#157](https://github.com/WeGotWorkspace/wegotworkspace/issues/157), [#158](https://github.com/WeGotWorkspace/wegotworkspace/issues/158) |

## RFC 8620 conformance

Calendar event endpoints now follow RFC 8620 core method response semantics ([#429](https://github.com/WeGotWorkspace/wegotworkspace/issues/429) follow-up review):

- **Calendars conform** on `/set` (§5.3: `created` maps creation id → `{id, state}` object, `updated` maps id → `{state}`, top-level `oldState`/`newState`, camelCase SetError types `notFound`/`invalidProperties`/`forbidden`/`serverFail`), `/changes` (§5.2: `hasMoreChanges`, `maxChanges` accepted), and `/query` (§5.5: `queryState`, `canCalculateChanges`).
- **Contacts and tasks still use the legacy shapes** (string-valued `created`/`updated` maps, snake_case error types, no set-level states / `hasMoreChanges` / `queryState`) — they have shipped consumers; alignment is a follow-up.
- **RecurrenceRule BY\* wire types (calendars)**: now conform to RFC 8984 §4.3.3 — `byMonth` is `String[]` (leap-month suffix `"3L"`), `byDay` is `NDay[]` objects (`{"@type":"NDay","day":"mo","nthOfPeriod":2}`), `byHour`/`byMinute`/`bySecond` are `UnsignedInt[]`; `byMonthDay`/`byYearDay`/`byWeekNo`/`bySetPosition` were already correct as `Int[]`. **Tasks keep the legacy shapes** (`byMonth` `Int[]`, `byDay` iCal strings, no `byHour`/`byMinute`/`bySecond`) via a legacy-mode flag on the shared converter — shipped consumers; alignment is a follow-up.
- **Per-record `ifInState`** on calendar `/set` update/destroy entries (instead of RFC's single request-level `ifInState`) is a **deliberate divergence**: item state tokens are per event, so preconditions are resolved per record. Stale tokens yield SetError type `stateMismatch`.
- **`maxChanges` never truncates** (`hasMoreChanges` always `false`): Sabre's changes-log truncation cannot produce a safe intermediate sync token (per-uri dedup can skip lower-token changes), so the full delta is always returned.

## JMAP transport envelope (calendars)

The full JMAP protocol envelope — previously an explicit non-goal of the REST layer — now exists for calendars as an **additive third adapter** over the same services: `GET /api/v1/jmap/session` (RFC 8620 §2) plus `POST /api/v1/jmap` batched method calls with ResultReferences, dispatching `Core/echo`, `Calendar/get|changes|set`, and `CalendarEvent/get|changes|set|query|queryChanges`. See [docs/calendars/jmap-envelope.md](./calendars/jmap-envelope.md). Remaining envelope-level deviations (documented there):

- **Event id charset:** composite multi-VEVENT ids (`{objectId}#{veventUid}`) contain `#`, outside the RFC 8620 §1.2 `Id` charset; ids pass through unchanged for parity with REST.
- **`Calendar/changes` over-reports:** Sabre bumps a calendar's synctoken on event activity, so event-only changes also mark the calendar `updated` (harmless refetch); pure metadata updates **are** reported (empirically pinned in `JmapChangesTest`).
- **No Push** (RFC 8620 §7): `eventSourceUrl` is a 501 stub; clients poll. Blob upload/download are **real** since #438 (RFC 8620 §6, content-addressed envelope store + reference-protected GC).
- **Contacts are behind the envelope** (#437): `AddressBook/get|changes|set` and `ContactCard/get|changes|set|query|queryChanges` per RFC 9610, with the legacy REST shapes normalized at the adapter layer (REST untouched). Tasks are **not** — and the tasks envelope is explicitly out of scope (`draft-ietf-jmap-tasks-06` is an expired, immature draft). Remaining roadmap (files draft-ietf-jmap-filenode-14, phased mail RFC 8621): [.agents/specs/000-jmap-envelope-multidomain/](../../../.agents/specs/000-jmap-envelope-multidomain/spec.md).

## Priority

| Priority | Scheduling / interop impact |
|----------|----------------------------|
| **P0** | [#146](https://github.com/WeGotWorkspace/wegotworkspace/issues/146), [#147](https://github.com/WeGotWorkspace/wegotworkspace/issues/147) — calendar P0s [#138](https://github.com/WeGotWorkspace/wegotworkspace/issues/138)/[#139](https://github.com/WeGotWorkspace/wegotworkspace/issues/139) closed |
| **P1** | Converter fidelity, OpenAPI alignment ([#148](https://github.com/WeGotWorkspace/wegotworkspace/issues/148)–[#156](https://github.com/WeGotWorkspace/wegotworkspace/issues/156)) — calendar rows [#140](https://github.com/WeGotWorkspace/wegotworkspace/issues/140)–[#145](https://github.com/WeGotWorkspace/wegotworkspace/issues/145) closed |
| **P2** | Platform features ([#151](https://github.com/WeGotWorkspace/wegotworkspace/issues/151), [#157](https://github.com/WeGotWorkspace/wegotworkspace/issues/157), [#158](https://github.com/WeGotWorkspace/wegotworkspace/issues/158)) |

## Calendars (VEVENT)

**All closed** — implemented on `main` via PR [#350](https://github.com/WeGotWorkspace/wegotworkspace/pull/350) (merged 2026-07-08), issues closed 2026-08-11 with evidence (commit SHAs, ancestry, file/test links). Lossy VALARM sub-properties (DESCRIPTION, EMAIL ATTENDEE) remain a documented, test-pinned limitation in `docs/calendars/ics-jmap-conversion-matrix.md`.

| Gap | Issue | Docs / converters |
|-----|-------|-------------------|
| VALARM ↔ `alerts` | [#138](https://github.com/WeGotWorkspace/wegotworkspace/issues/138) — closed | `docs/calendars/ics-jmap-conversion-matrix.md`, `Calendars/Conversion/*` |
| `recurrenceOverrides` / RECURRENCE-ID | [#139](https://github.com/WeGotWorkspace/wegotworkspace/issues/139) — closed | same |
| RRULE BY* write (`byYearDay`, `byWeekNo`, `bySetPosition`) | [#140](https://github.com/WeGotWorkspace/wegotworkspace/issues/140) — closed | `CalendarConversionSupport.php` |
| Participant ROLE, CUTYPE, RSVP | [#141](https://github.com/WeGotWorkspace/wegotworkspace/issues/141) — closed | `VEventToJmapEventConverter.php` |
| Locations, links, attachments | [#142](https://github.com/WeGotWorkspace/wegotworkspace/issues/142) — closed | `jmap-calendars-summary.md` |
| VTIMEZONE / `timeZones` | [#143](https://github.com/WeGotWorkspace/wegotworkspace/issues/143) — closed | same |
| RDATE / `excludedRecurrenceRules` | [#144](https://github.com/WeGotWorkspace/wegotworkspace/issues/144) — closed | `ics-jmap-conversion-matrix.md` |
| OpenAPI ↔ runtime drift | [#145](https://github.com/WeGotWorkspace/wegotworkspace/issues/145) — closed | `openapi/schemas/calendars/calendar-event.json` |

## Tasks (VTODO)

| Gap | Issue | Docs / converters |
|-----|-------|-------------------|
| Recurrence | [#146](https://github.com/WeGotWorkspace/wegotworkspace/issues/146) | [docs/tasks/](./tasks/) — [ics-jmap-task-conversion-matrix.md](./tasks/ics-jmap-task-conversion-matrix.md) |
| VALARM ↔ alerts | [#147](https://github.com/WeGotWorkspace/wegotworkspace/issues/147) | `Tasks/Conversion/*` |
| Assignees / participants | [#148](https://github.com/WeGotWorkspace/wegotworkspace/issues/148) | same |
| `icsProps` escape hatch | [#149](https://github.com/WeGotWorkspace/wegotworkspace/issues/149) | parity with calendars |
| TZID / all-day due dates | [#150](https://github.com/WeGotWorkspace/wegotworkspace/issues/150) | `TaskConversionSupport.php` |

## Contacts (CardDAV)

| Gap | Issue | Docs / converters |
|-----|-------|-------------------|
| Media `blobId` + upload | [#151](https://github.com/WeGotWorkspace/wegotworkspace/issues/151) | `rfc9610-summary.md` |
| `localizations` | [#152](https://github.com/WeGotWorkspace/wegotworkspace/issues/152) | `rfc9555-conversion-matrix.md` |
| JSCOMPS ordered components | [#153](https://github.com/WeGotWorkspace/wegotworkspace/issues/153) | same |
| GEO/TZ/ADR grouping | [#154](https://github.com/WeGotWorkspace/wegotworkspace/issues/154) | §2.8.3 |
| Group `members` resolution | [#155](https://github.com/WeGotWorkspace/wegotworkspace/issues/155) | `rfc9610-summary.md` |
| Partial matrix (TEL, titles, anniversaries, …) | [#156](https://github.com/WeGotWorkspace/wegotworkspace/issues/156) | `rfc9555-conversion-matrix.md`, `rfc9982-conversion-matrix.md` |

## Platform

| Gap | Issue |
|-----|-------|
| Address book / calendar / task list CRUD + sharing | [#157](https://github.com/WeGotWorkspace/wegotworkspace/issues/157) — **CRUD done** for all three collection types; **sharing stub** (`shareWith` null, PATCH rejects) |
| JMAP `changes` / `query` sync | [#158](https://github.com/WeGotWorkspace/wegotworkspace/issues/158) — **collection `/changes` done** (contacts, calendars, task lists); **contacts card `/changes` + `/set` + `/query` done**; **calendar event `/changes` + `/set` + `/query` done** ([#429](https://github.com/WeGotWorkspace/wegotworkspace/issues/429)); tasks `/items/query` done; task item `/changes` + `/set` deferred |

## External interop fixtures

Adopt **Fastmail** (Text::JSCalendar / Text::JSContact normative goldens) and **Audriga** (real-world PHP/Sabre stack exports) as complementary conversion conformance fixtures alongside WGW’s 27 contact golden pairs. Fastmail cases use strict golden match where WGW owns expected JSON; Audriga/cozy cases assert parse + round-trip stability only.

**Tracking:** [#160](https://github.com/WeGotWorkspace/wegotworkspace/issues/160) — feat(api): adopt Fastmail + Audriga conversion interop fixtures (parent epic [#137](https://github.com/WeGotWorkspace/wegotworkspace/issues/137)).

## v1 explicitly implemented (reference)

### Contacts
- vCard ↔ JSContact for core properties (name, email, phone, address, org, notes, media URI, members, online services, crypto keys, calendaring URIs)
- `vCardProps` / `vCardParams` preserve-only properties (e.g. `GENDER`)
- REST: address book list, contact CRUD, CardDAV interop

### Calendars
- Calendar list, event CRUD, multi-VEVENT composite ids
- Full ICS ↔ JMAP converter parity (alerts, recurrenceOverrides, RRULE BY*, participants, locations/links, timeZones, RDATE/EXRULE); `icsProps` for unknown VEVENT properties
- Event item sync: `GET /calendars/events/changes`, `POST /calendars/events/set` (`ifInState` → `stateMismatch`), `POST /calendars/events/query`
- Client-side recurrence expansion (no server instance expansion)

### Tasks
- Task list list, task CRUD, multi-VTODO composite ids
- STATUS, PRIORITY, PERCENT-COMPLETE, CLASS, CATEGORIES, DTSTART/DUE/COMPLETED

## Platform hardening (v1)

| Area | Status | Notes |
|------|--------|-------|
| ICS/vCard payload bounds | Done ([#162](https://github.com/WeGotWorkspace/wegotworkspace/issues/162)) | 512 KiB max serialized size; component/property caps before VObject parse |
| Cross-user ACL tests | Done ([#163](https://github.com/WeGotWorkspace/wegotworkspace/issues/163)) | `JmapRestCrossUserAclTest` matrix for contacts/calendars/tasks |
| Search index on CRUD | Done ([#164](https://github.com/WeGotWorkspace/wegotworkspace/issues/164)) | Best-effort sync with structured `search_index_sync_failed` logs; admin reindex for recovery |
| OpenAPI Error responses | Done ([#165](https://github.com/WeGotWorkspace/wegotworkspace/issues/165)) | 400/403/404/412/413 on `/contacts/*`, `/calendars/*`, `/tasks/*` |
