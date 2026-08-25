# Import events from an ICS file

Derived from [spec.md](./spec.md). Sequential chunks — OpenAPI/typegen must land before UI consumers.

## Goal

REST ICS ingest plus Calendar destination-dialog UI, as specified in spec.md.

## Non-goals

- Export, webcal subscribe/publish, CalDAV URL copy, sharing
- Offline outbox for import
- Merging by UID on second import
- Drag-and-drop onto the Calendar surface
- Stripping `RECURRENCE-ID` from orphan-override CalDAV blobs

## Affected packages

- packages/api
- packages/apps

## Dependencies

1. Chunk A (OpenAPI + API + typegen) before Chunk B (UI types / `importEvents`)
2. Chunk C after both

## Chunks

### Chunk A: API import

- **id:** `api-calendar-ics-import`
- **Skill:** api + testing
- **Inputs:** Task #607 AC; contacts `POST /contacts/cards/import` as the HTTP shape; existing calendar fixtures and converters
- **Done when:** OpenAPI path exists; splitter unit tests cover group-by-UID / skip VTODO / orphan override; feature test covers persist, ACL, best-effort, synctoken/changes, destroy-after-import, VALARM, search, no iTIP; typegen regenerated
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: Calendar import UI

- **id:** `ui-calendar-ics-import`
- **Skill:** workspace + apps-ui + storybook + accessibility
- **Inputs:** generated types from Chunk A; existing `createCalendar` + calendar-dialog fields
- **Done when:** `CalendarNewMenu` Import ICS action; `CalendarImportDialog` with swatch destination picker; `importEvents` op (online-only, Dexie upsert); mock-tier stories; Vitest for helpers + controller + dialog
- **Verify with:** targeted Vitest + Storybook a11y, then `pnpm test:apps-done-gate`
- **Parallel with:** none (after A)

### Chunk C: Spec sync + issue verify

- **id:** `verify-calendar-ics-import`
- **Skill:** verify-issue + testing
- **Inputs:** Task #607 body-hash; Chunk A+B diffs
- **Done when:** body-hash matches; every AC has evidence; done gates green; Goal #461 left open
- **Verify with:** verify-issue Task mode + done gates
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing `CalendarsEventImportTest` → implement → `pnpm test:api-done-gate`
- [ ] UI: mock-tier import-dialog stories → Vitest on `calendar-ics-import`, controller, dialog → `pnpm test:apps-done-gate`
- [ ] Browser: New event still creates; chevron → Import; existing + new destination; invalid file error

## Doc updates (only if user wants)

- None beyond `.agents/specs/607-calendar-ics-import/`
