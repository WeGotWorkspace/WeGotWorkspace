# Engineering tasks — Calendar invitee picker from Contacts

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `contact-attendee-map` | builder | apps-ui, testing | `packages/apps/src/contacts-core/src/contacts-display-utils.ts`, `packages/apps/src/calendar-core/src/calendar-contact-attendee.ts`, `packages/apps/src/calendar-core/src/calendar-contact-attendee.test.ts`, `packages/apps/src/calendar-core/src/calendar-attendees.ts` | `pnpm --dir packages/apps exec vitest run src/contacts-core/src/contacts-display-utils.test.ts src/calendar-core/src/calendar-contact-attendee.test.ts` | done |
| `calendar-contact-load` | builder | workspace | `packages/apps/src/lib/offline/contacts-offline-store.ts`, `packages/apps/src/lib/api/wgw/contacts.ts`, `packages/apps/src/calendar-core/src/calendar-api-source.ts`, `packages/apps/src/calendar-core/src/use-calendar-contact-invitees.ts` (or hook next to invitations), `packages/apps/src/calendar-core/src/calendar-workspace.tsx` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-contact-invitees.test.tsx` | done |
| `calendar-contact-picker-ui` | builder | workspace, apps-ui, storybook | `packages/apps/src/calendar-core/src/calendar-invitees-card.tsx`, `packages/apps/src/calendar-core/src/calendar-event-dialog.tsx`, `packages/apps/src/calendar-core/src/calendar-labels.ts`, `packages/apps/src/calendar-core/src/calendar-event-dialog.test.tsx`, `packages/apps/src/calendar-core/stories/calendar-event-dialog.stories.tsx` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-dialog.test.tsx` | done |
| `verify-calendar-contact-picker` | verifier | testing, verify-issue | merged A–C; `#638`; `#568` | verify-issue on #638 + `pnpm test:apps-done-gate` | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- `feat/` branch should close **#638**, not Goal #568. Goal Status stays **Adopted** until product marks Fulfilled.
- On scope change: update **#638** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
