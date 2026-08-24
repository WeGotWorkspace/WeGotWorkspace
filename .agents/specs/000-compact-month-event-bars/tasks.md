# Engineering tasks — Compact month event bars

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `tests-browser` | builder | testing | `CalendarTimelineView.css.test.ts`, `EventCard.css.test.ts` | `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/CalendarTimelineView src/lib/calendar-elements/EventCard/EventCard.css.test.ts` | done |
| `compact-css` | builder | apps-ui | `CalendarTimelineView.css`, `CalendarTimelineView.ts` (JSDoc) | same Vitest command | done |
| `density-tokens` | builder | apps-ui | `EventCard.css`, compact tokens on `time-line.timeline-main` | same Vitest command | done |

## Notes

- Chunk `id` values match `plan.md` and the implementation plan todos.
- Update **status** as chunks complete (`pending` → `done`).
- `Source: ad-hoc` — no GitHub Task to re-hash on scope change.
