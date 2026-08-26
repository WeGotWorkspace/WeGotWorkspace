# Engineering tasks — In-grid double-click and header + create

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-grid-create` | builder | workspace | `TimeLine.ts`, `CalendarTimelineView.ts`, `CalendarWeekdayHeader.ts` | `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/TimeLine/TimeLine.create-click.test.tsx src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.month-create.test.tsx src/lib/calendar-elements/CalendarWeekdayHeader/CalendarWeekdayHeader.create-button.test.tsx src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.header-create.test.tsx` | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery choice (2026-08-26): **double-click** + header **+**. Day-number is navigate-only. Issue #629 body-hash `efb46151`.
