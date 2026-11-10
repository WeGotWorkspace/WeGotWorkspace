# Import tasks from an ICS file

Derived from [spec.md](./spec.md). One builder, sequential chunks, one PR into `integration/import-export`.

## Goal

See [spec.md](./spec.md#goal): Calendar's ICS import for VTODOs, with the shared code generalised.

## Budget

Draws from the Pioneer programme import/export milestone. Displaces nothing.

## Non-goals

- See [spec.md](./spec.md#non-goals).

## What exists

- Calendar import service: size check, split, one transaction per UID group. `path: packages/api/app/Services/Calendars/CalendarEventMutationSupport.php:84`
- VEVENT-only splitter with VEVENT-only TZID references. `path: packages/api/app/Services/Calendars/Conversion/CalendarIcsSplitSupport.php:25`
- Generic UID grouping. `path: packages/api/app/Services/VObject/ICalendarSeries.php:21`
- Whole-body and per-object caps. `path: packages/api/app/Services/VObject/VObjectPayloadGuard.php:22`
- RRULE guard already covers VTODO. `path: packages/api/app/Services/Calendars/RecurrenceRuleGuard.php:22`
- Single task create: writability, search sync, mutation event. `path: packages/api/app/Services/Tasks/TaskRepository.php:153`
- Calendar client helpers, hook and dialog. `path: packages/apps/src/calendar-core/src/calendar-ics-import.ts:1`, `path: packages/apps/src/calendar-core/src/calendar-import-dialog.tsx:58`
- Picker row already supports a task-list icon. `path: packages/apps/src/lib/calendar-event-calendar-picker.tsx:23`
- Calendar offline import writes the cache. `path: packages/apps/src/lib/offline/calendars-hybrid-operations.ts:204`

## Considered

- Copy `CalendarIcsSplitSupport` into Tasks — rejected by the issue; a component-parameterised `ICalendarUidGroupSplitter` in `App\Services\VObject` is shared, and `CalendarIcsSplitSupport::splitUidGroups()` delegates so its tests stay unchanged.
- Add the import to `TaskRepository` — rejected: it is 755 lines; a `TaskImportService` keeps both under the 800-line cap.
- Calendar's toast-only result — kept for the clean case; a result step is added because the issue asks for per-task reasons and the skipped-events line, which do not fit a toast.
- Client maps error index to a title by parsing the file — rejected; the server already parses it, so error entries carry `uid` and `title`.
- Shared dialog under `calendar-core` — rejected: `lib/` already holds the shared picker, so `lib/ics-import/` holds the dialog and file helpers.

## Affected packages

- packages/api | packages/apps

## Dependencies

1. Chunk A (API) before Chunk C (client) relies on the response shape; Chunk B (shared client extraction) is independent of A.

## Open decisions

None — every choice for this work is made.

## Invariants

- Calendar import keeps its behaviour. A wrong splitter change drops VEVENTs or their time zones. Proof: `path: packages/api/tests/Feature/Calendars/CalendarsEventImportTest.php` and `path: packages/api/tests/Unit/Calendars/CalendarIcsSplitSupportTest.php` pass unchanged.
- An existing UID in the target list is never overwritten. Proof: `path: packages/api/tests/Feature/Tasks/TasksImportTest.php` assertion `test_existing_uid_is_an_error_and_not_overwritten`.
- Read-only and invisible lists stay closed. Proof: `path: packages/api/tests/Feature/Ownership/TasksOwnershipTest.php` cases for `POST /tasks/items/import`.
- Calendar's import dialog keeps its labels and destination flow. Proof: `path: packages/apps/src/calendar-core/src/calendar-import-dialog.test.tsx` passes unchanged.

## Chunks

### Chunk A: API import

- **id:** `chunk-a-api`
- **Skill:** api
- **Inputs:** `path: packages/api/app/Services/Calendars/CalendarEventMutationSupport.php:84`
- **Done when:** route, service, splitter, guard method, OpenAPI, contract + ownership + feature + unit tests are green.
- **Verify with:** `cmd: composer --working-dir packages/api done-gate`
- **Parallel with:** chunk-b-shared-ui

### Chunk B: Shared client extraction

- **id:** `chunk-b-shared-ui`
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/calendar-core/src/calendar-import-dialog.tsx:58`
- **Done when:** `lib/ics-import/` holds the file helpers and `IcsImportDialog`; Calendar uses them; Calendar tests and stories unchanged and green.
- **Verify with:** `cmd: pnpm --filter @wgw/apps exec vitest run src/calendar-core`
- **Parallel with:** chunk-a-api

### Chunk C: Tasks client

- **id:** `chunk-c-tasks-ui`
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/tasks-core/src/tasks-new-menu.tsx:13`
- **Done when:** menu item, dialog with result step, live call, offline op, labels, Vitest and a light/dark story exist; browser e2e passes.
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API feature tests per the issue list, ownership matrix rows, contract query param.
- [ ] Vitest: run helper (existing list, new list), hook result states, dialog result step, live client 400-with-errors parsing.
- [ ] Storybook: Tasks import dialog destination step and result step, light and dark.
- [ ] Browser e2e: VTODO file into an existing list and a new list; mixed file (skipped line); duplicate import (already-exists reasons); after a refresh and in a second tab; Calendar import still works.
- [ ] Live Playwright spec `packages/apps/e2e/tasks-ics-import.spec.ts` (live tier): new-list import with the skipped line, second tab without reload, offline cache, reload, disabled offline item, duplicate import.

## Doc updates (only if user wants)

- None.
