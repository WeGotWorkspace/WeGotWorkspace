# Engineering tasks — Attach a Meet or meeting URL on a calendar event

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `setup` | setup | developer | `docs/v0.9-sprint-plan.md`, `docs/architecture/meet-reserved-rooms.md`, `.agents/specs/640-calendar-meet-link/` | Task #640 parented under #525; not on Product Project; spec header `body-hash: 9b540e34` | done |
| `meet-reserve-owner` | builder | meet, api | `packages/api/app/Http/Controllers/Api/V1/Meetings/MeetingsController.php`, `MeetSignalingService.php`, `packages/apps/src/meet-core/src/meet-lobby-pane.tsx` | Meet PHPUnit + lobby Vitest, then `pnpm test:api-done-gate` | pending |
| `api-event-links` | builder | api | `LocationConversionSupport.php`, `CalendarEventRepository.php`, `SabreServerFactory.php`, `calendar-event.json`, `ics-jmap-conversion-matrix.md` | targeted PHPUnit + `pnpm test:api-done-gate` | pending |
| `calendar-meet-ui` | builder | workspace, apps-ui, storybook | `calendar-editor-model.ts`, `calendar-event-dialog.tsx`, `calendar-wire.ts`, popover + inbox card | targeted Vitest then `pnpm test:apps-done-gate` | pending |
| `verify` | verifier | verify-issue, code-review | merged tree; Task #640; Goal #525 | verify-issue (Task + Goal modes) + done gates | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **#640** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery: Task #640 (this spec `Source:`); Goal #525 (context only — do not close).
- Ordering: 0 before M/A. M ∥ A after arch review. B after M+A. V last.
- Do not implement M until [`docs/architecture/meet-reserved-rooms.md`](../../../docs/architecture/meet-reserved-rooms.md) is reviewed.
- Worktree: `/Users/woutervroege/Sites/sabre-installer-calendar-meet-link` on `feat/calendar-meet-link` from `origin/main`. Do not pile onto in-flight calendar-scroll or week 26–30 Aug connect-URL work.
