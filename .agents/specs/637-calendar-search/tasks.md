# Engineering tasks — Calendar event search

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `setup` | builder | developer | `.agents/specs/637-calendar-search/` | Task #637 parented under #523; spec header body-hash `91670a9b` | done |
| `matcher` | builder | workspace, testing | `packages/apps/src/calendar-core/src/calendar-search.ts`, `calendar-search.test.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-search.test.ts` | done |
| `controller` | builder | workspace | `packages/apps/src/calendar-core/src/use-calendar-controller.ts`, `use-calendar-controller.test.tsx` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-controller.test.tsx` | done |
| `workspace-ui` | builder | workspace, apps-ui, storybook | `view-header.tsx`, `calendar-workspace.tsx`, `calendar-labels.ts`, `calendar-workspace.css`, `calendar-app.stories.tsx` | ViewHeader + consumer search Vitest + story play | done |
| `verify` | builder | testing, verify-issue | Task #637; Goal #523 | verify-issue + `pnpm test:apps-done-gate` | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **#637** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery: Task #637 (this spec `Source:`); Goal #523 (context only — do not `fixes` the Goal).
- Ordering: 0 → A → B → C → V. Sequential; do not parallelize.
- Worktree: `/Users/woutervroege/Sites/sabre-installer-calendar-search`, branch `feat/calendar-search`.
