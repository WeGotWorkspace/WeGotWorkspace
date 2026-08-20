# Engineering tasks — Compact event-details popover

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-event-details-popover` | builder | workspace | `packages/apps/src/calendar-core/src/calendar-event-preview.ts`, `calendar-event-details-popover.tsx`, `calendar-workspace.tsx`, `use-calendar-controller.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-preview.test.ts src/calendar-core/src/calendar-event-details-popover.test.tsx` | done |

## Notes

- Extract `resolveCalendarEventPreview` so editor + popover share occurrence anchoring.
- Preview state lives outside the 1k-line controller hook.
