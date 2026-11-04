Source: #607 (body-hash: fe1615ae)
Goal: #461

# Import events from an ICS file

Technical translation of Task #607 — not a copy of the issue AC checklist.

## Goal

One-shot ICS file ingest into a chosen calendar: REST `POST /calendars/events/import` (contacts-shaped `{ list, errors }`) persists UID groups via Sabre `createCalendarObject` (no iTIP), maps them with `toCalendarEvents(..., $username)` so `state` / destroy-expansion work, indexes them for search, and bumps `calendars.synctoken` / `calendarchanges`. Calendar UI extends `CalendarNewMenu` (primary = New event; chevron = Import ICS plus create/subscribe), a file-first destination dialog (existing writable calendar with color swatches, or create-new via #402), and an online-only `importEvents` operation that upserts the 201 list into Dexie.

## Non-goals

- ICS export
- Live ICS/webcal subscribe/publish (#522) — `CalendarIcsSplitSupport` is reusable by that work
- Importing `VTODO` / `VJOURNAL` as items (skip them)
- Implementing CalDAV itself
- Offline-queued import
- UID merge on re-import
- Drag-and-drop onto the Calendar surface
- Stripping `RECURRENCE-ID` from orphan-override blobs (persist as-is)

## Affected packages

- packages/api (OpenAPI, splitter, import persist, feature + unit tests, typegen)
- packages/apps (`calendar-core` import dialog + helpers, `CalendarNewMenu` entry, hybrid `importEvents`, stories + Vitest)

## Technical constraints

- Contract-first: OpenAPI → failing feature tests → implement → typegen.
- Splitter (`CalendarIcsSplitSupport`) has no HTTP, `calendarId`, controller, or persist knowledge: parse ICS → group `VEVENT`s by UID → keep referenced `VTIMEZONE`s.
- Persist only via Sabre `createCalendarObject`. Do not call `CalendarEventRepository::create` (that runs `withOrganizer` + `scheduleAfterWrite`). Do not insert `calendarobjects` rows by hand.
- After each successful UID group: `searchIndexSync` (same as `create`) and `toCalendarEvents(..., $username)` so `attachStateToken` writes `jmap_calendar_event_states`.
- HTTP: missing/blank `calendarId` → `400`; unknown/foreign calendar → `404`; accessible but not writable → `403`; empty / unreadable / no `VEVENT` after skip / every group failed → `400`; at least one persisted group → `201` (errors may be nonempty).
- Orphan `RECURRENCE-ID` (no master in the same file): persist the UID group as a standalone calendar object, raw ICS as-is.
- UI: destination is mandatory; import stays disabled until file + destination exist; online-only (contacts pattern); BEM + `@apply`; keep `use-calendar-controller` thin.
- Calendar event CRUD HTTP is JMAP (`/jmap` `CalendarEvent/*`). Import is a dedicated REST island, same as `POST /contacts/cards/import`. Synctoken/`/changes` proof uses the same Sabre `getChangesForCalendar` log the JMAP `CalendarEvent/changes` method already reads.

## Edge cases

- Mixed `VEVENT` + `VTODO`/`VJOURNAL`: skip non-events; import remaining events
- Partial persist failure: `201` + per-group `{ index, message }` when `list` nonempty
- Recurring master + override in one file: one series object; destroy path lists id(s) in `destroyed`
- `VALARM` → JSCalendar `alerts` via existing `alertFromValarm` (same lossy edges as create)
- Attendees present: no scheduling inbox / iMIP
- Re-import always inserts (duplicates allowed)
- Offline client: clear error, no queue
