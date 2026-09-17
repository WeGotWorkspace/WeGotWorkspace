# Engineering tasks — Show task due dates on every Calendar view

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-overlay-model` | builder | workspace | `calendar-task-due-overlay.ts`, `use-calendar-task-due-overlay.ts`, `CalendarEventEnvelope.ts` | vitest overlay + hydrate | done |
| `chunk-b-sidebar` | builder | apps-ui | `calendar-view-prefs.ts`, `calendar-workspace.tsx`, `calendar-labels.ts` | vitest prefs + sidebar | done |
| `chunk-c-paint` | builder | workspace | `calendar-surface.tsx`, `wgw-calendar-surface.ts`, `CalendarTimelineView.ts`, `TimeLine.ts` | vitest timeline + surface | done |
| `chunk-d-preview` | builder | workspace | `calendar-task-due-popover.tsx`, `tasks-route-search.ts`, `wegotworkspace-routes.tsx` | vitest routes + popover | done |
| `chunk-v-verify` | builder | testing | merged | `pnpm test:apps-done-gate` | done |

## Notes

- Branch `cursor/calendar-task-due-overlay-159c` closes **#790**, not Goal #528.
- Goal #528 milestone stays empty (not v0.9). Task #790 has no milestone.
- `gh issue edit` / labels / project Status were not writable from this agent; Task #790 was created. Product Project Status for #528 may still read Identified until a maintainer sets Adopted.
