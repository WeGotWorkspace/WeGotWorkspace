# Engineering tasks — Align alarm UI with invite UI

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-align-alarm-ui` | builder | apps-ui | `packages/apps/src/calendar-core/src/calendar-alarms-card.tsx`, `calendar-event-dialog.tsx` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-dialog.test.tsx` | done |
