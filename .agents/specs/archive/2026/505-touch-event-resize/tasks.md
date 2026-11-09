# Engineering tasks — Touch resize in day/week timed views

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `touch-event-resize` | builder | apps-ui | `ResizeHandle.*`, `TimeLine.ts`, `CalendarTimelineView.ts`, `calendar-surface.tsx` | `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/ResizeHandle src/lib/calendar-elements/TimeLine` | done |

## Notes

- Chunk `id` matches the worktree chunk-id `touch-event-resize`.
