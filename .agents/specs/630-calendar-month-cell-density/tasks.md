# Engineering tasks — slimmer wide month-cell event cards

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-month-cell-density` | builder | apps-ui | `packages/apps/src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.css`, `CalendarTimelineView.css.test.ts`, `packages/apps/src/calendar-core/stories/calendar-app.stories.tsx` | `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.css.test.ts` | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
