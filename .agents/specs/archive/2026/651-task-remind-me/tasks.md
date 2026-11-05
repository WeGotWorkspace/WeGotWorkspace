# Engineering tasks — Task Remind me via shared alarm rows

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-api-clear` | builder | api | `packages/api/openapi/schemas/tasks/task.json`, `TaskPatchRequest.php`, `TasksCalDavInteropTest.php`, `tasks-api-source.ts`, `tasks-patch-merge.ts` | `composer test -- --filter TasksCalDavInteropTest` + Vitest mock/offline | done |
| `chunk-b-ui-wire` | builder | workspace / apps-ui | `calendar-alarms-card.tsx`, `tasks-alert-mapping.ts`, `tasks-remind-picker.tsx`, `tasks-labels.ts`, `tasks-task-form.tsx`, `use-tasks-mutations.tsx`, `tasks-main-view.tsx`, stories | `pnpm --dir packages/apps exec vitest run src/tasks-core src/calendar-core` | done |
| `chunk-c-verify` | builder | testing | — | verify-issue #651; apps + api done gates; browser :5174 | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
