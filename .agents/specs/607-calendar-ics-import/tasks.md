# Engineering tasks — Import events from an ICS file

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `api-calendar-ics-import` | builder | api | `packages/api/openapi/openapi.json`, `packages/api/app/Services/Calendars/Conversion/CalendarIcsSplitSupport.php`, `packages/api/app/Services/Calendars/CalendarEventRepository.php`, `packages/api/app/Http/Controllers/Api/V1/Calendars/CalendarEventImportController.php`, `packages/api/tests/Feature/Calendars/CalendarsEventImportTest.php` | `pnpm test:api-done-gate` | done |
| `ui-calendar-ics-import` | builder | workspace + apps-ui | `packages/apps/src/button/`, `packages/apps/src/calendar-core/src/calendar-import-dialog.tsx`, `packages/apps/src/calendar-core/src/calendar-ics-import.ts`, `packages/apps/src/lib/offline/` calendars hybrid | `pnpm test:apps-done-gate` | done |
| `verify-calendar-ics-import` | builder | verify-issue | specs + gates | verify-issue Task mode; both done gates | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
