# Engineering tasks — Toasts with undo for key Calendar actions

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-action-toasts` | builder | workspace | `use-calendar-controller.ts`, `calendar-workspace.tsx`, `calendar-rsvp-scope.ts`, `calendar-labels.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-controller.test.tsx src/calendar-core/src/calendar-rsvp-scope.test.ts` | done |
