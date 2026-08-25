# Engineering tasks — Calendar collection ACL sharing

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `setup` | setup | developer | `.agents/specs/606-calendar-sharing/` | Task #606 parented under #494; spec header body-hash | done |
| `api-sharewith` | builder | api | `packages/api/app/Services/Calendars/CalendarRepository.php`, `CalendarSetMethod.php`, `CalendarPrincipalAddresses.php`, `tests/Feature/Jmap/JmapCalendarMethodsTest.php`, `tests/Feature/Calendars/` | targeted PHPUnit + `pnpm test:api-done-gate` | done |
| `caldav-share-interop` | builder | api | `packages/api/tests/Feature/Calendars/CalendarsCalDavSharingTest.php`, CalDAV share POST/PROPFIND | CalDAV sharing tests (targeted PHPUnit; full `pnpm test:api-done-gate` is Chunk V) | done |
| `dialog-acl` | builder | workspace | `packages/apps/src/calendar-core/src/calendar-event-dialog.tsx`, `calendar-event-dialog.test.tsx`, `packages/apps/src/lib/api/wgw/calendar.ts`, `calendar-types.ts` | `vitest run calendar-event-dialog.test.tsx` | done |
| `calendar-share-ui` | builder | workspace, apps-ui, storybook | `packages/apps/src/share-ui/`, new `CalendarShareSection`, `calendar-workspace.tsx`, `MockJmapServer` | targeted Vitest/Storybook + `pnpm test:apps-done-gate` | done |
| `verify` | verifier | testing | merged tree; Task #606; Bug #489; Goal #403 | verify-issue + `pnpm test:api-done-gate` + `pnpm test:apps-done-gate` | done |
| `followup-edit-acl` | builder | workspace, apps-ui | edit-calendar combines publish + `CalendarShareSection`; owner-only publish; revoke ingest | targeted Vitest + PHPUnit share/feed | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **#606** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery: Task #606 (this spec `Source:`); Epic #494; Goal #403 (context only). Branch also closes Bug #489 (dialog ACL). Do not reopen #500 / #163 / #157.
- Ordering: A (`api-sharewith`) before B (`dialog-acl`). D after A, parallel with B. C after A+B.
- Chunk V (2026-08-24): spec `SYNC OK` (`bc667788`). #606 / #489 AC evidenced. `pnpm test:api-done-gate` hits Composer `process-timeout` 900s (`COMPOSER_PROCESS_TIMEOUT=0` does not override `composer.json`). Equivalent pieces: greenfield OK; architecture 128/128 OK; PHPUnit `--exclude-testsuite Architecture` 1318/1318 OK (1 pre-existing deprecation). Targeted calendar PHPUnit 19/19 OK. `pnpm test:apps-done-gate` PASSED (typecheck fixture fix: live JMAP 8-property rights in `calendar-share.test.ts`). Goal #403 success signals evidenced; do not mark Fulfilled.
