# Engineering tasks — Change calendar owner

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-change-owner` | builder | api | `packages/api/openapi/schemas/calendars/calendar-sync.json`, `packages/api/app/Services/Calendars/CalendarRepository.php`, `packages/api/tests/Feature/Calendars/CalendarsChangeOwnerTest.php` | `phpunit tests/Feature/Calendars/CalendarsChangeOwnerTest.php` | done |
| `calendar-change-owner-ui` | builder | workspace | `packages/apps/src/calendar-core/src/calendar-calendar-dialog.tsx`, `packages/apps/src/calendar-core/src/calendar-collection-write.ts`, `packages/apps/src/calendar-core/src/use-calendar-controller.ts`, `packages/apps/src/lib/offline/calendars-hybrid-operations.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-calendar-dialog.test.tsx src/calendar-core/src/calendar-collection-write.test.ts src/calendar-core/src/use-calendar-controller.test.tsx src/lib/offline/calendars-hybrid-operations.test.ts` | done |
