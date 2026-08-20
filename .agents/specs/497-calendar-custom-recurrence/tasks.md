# Engineering tasks — Create and edit custom recurrence rules

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-custom-recurrence` | builder | apps-ui | `packages/apps/src/calendar-core/src/calendar-custom-recurrence.ts`, `calendar-custom-recurrence-fields.tsx`, `calendar-event-dialog.tsx`, `calendar-editor-model.ts`, `calendar-labels.ts`, `.agents/specs/497-calendar-custom-recurrence/` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-custom-recurrence.test.ts src/calendar-core/src/calendar-editor-model.test.ts src/calendar-core/src/calendar-event-dialog.test.tsx` | done |

## Notes

- Do not stack on #496 / #498 / #499 branches.
- Do not reopen Goal #385.
