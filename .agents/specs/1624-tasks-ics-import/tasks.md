# Tasks — Import tasks from an ICS file

Derived from [plan.md](./plan.md).

## chunk-a-api

- Owner: builder session
- `packages/api/app/Services/VObject/ICalendarUidGroupSplitter.php` — split over a component name, TZID property map per component, skipped counts per other component.
- `packages/api/app/Services/Calendars/Conversion/CalendarIcsSplitSupport.php` — delegate.
- `packages/api/app/Services/VObject/VObjectPayloadGuard.php` — `assertIcsImportSize()`, used by both imports.
- `packages/api/app/Services/Tasks/TaskImportService.php`, `packages/api/app/Http/Controllers/Api/V1/Tasks/TaskImportController.php`, `packages/api/routes/api.php`.
- `packages/api/openapi/openapi.json`, `packages/api/openapi/schemas/tasks/task.json`, `packages/api/tests/Support/OpenApiContract.php`.
- `packages/api/tests/Feature/Tasks/TasksImportTest.php`, `packages/api/tests/Unit/VObject/ICalendarUidGroupSplitterTest.php`, `packages/api/tests/Feature/Ownership/TasksOwnershipTest.php`.
- Verify: `composer --working-dir packages/api done-gate`

## chunk-b-shared-ui

- Owner: builder session
- `packages/apps/src/lib/ics-import/ics-file.ts`; the dialog in `packages/apps/src/import-dialog/src/ics-import-dialog.tsx` and `.css`.
- `packages/apps/src/calendar-core/src/calendar-ics-import.ts`, `calendar-import-dialog.tsx` — use the shared pieces.
- Verify: `pnpm --filter @wgw/apps exec vitest run src/calendar-core src/lib/ics-import`

## chunk-c-tasks-ui

- Owner: builder session
- `packages/apps/src/lib/api/wgw/tasks.ts` — `importTasksLive`.
- `packages/apps/src/lib/offline/tasks/tasks-hybrid-operations.ts` — `importTasks`, cache write, online only.
- `packages/apps/src/tasks-core/src/tasks-ics-import.ts`, `use-tasks-ics-import.ts`, `tasks-import-dialog.tsx`, `tasks-new-menu.tsx`, `tasks-labels.ts`, `tasks-types.ts`, `tasks-workspace.tsx`.
- `packages/apps/src/tasks-core/stories/tasks-import-dialog.stories.tsx`.
- Verify: `pnpm test:apps-done-gate`, then the browser e2e in plan.md.
