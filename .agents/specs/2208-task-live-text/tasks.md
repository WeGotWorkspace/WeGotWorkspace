# Engineering tasks — Live co-editing of a task's title and description

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-api-task-text` | builder | api, security | `packages/api/database/migrations/wgw/*_task_yjs_state.php`, `packages/api/app/Models/TaskYjsState.php`, `packages/api/app/Services/Tasks/TaskTextCollaboration.php`, `packages/api/app/Services/Tasks/TaskTextProjection.php`, `packages/api/app/Services/Tasks/TaskRepository.php`, `packages/api/app/Http/Controllers/Api/V1/Tasks/TasksController.php`, `packages/api/app/Http/Requests/Api/V1/TaskTextPutRequest.php`, `packages/api/app/Services/Collab/CollabJoinAuthorizer.php`, `packages/api/routes/api.php`, `packages/api/openapi/openapi.json`, `packages/api/tests/Feature/Tasks/TaskTextCollaborationTest.php`, `packages/api/tests/Feature/Collab/CollabJoinAuthorizationTest.php` | `cd packages/api && composer done-gate` |
| `chunk-b-collab-text-fields` | builder | workspace, apps-ui | `packages/apps/src/text-editor-core/docs-collab/docs-collab-text-fields.ts` (seed, `plainTextOps`, `mergeOutsideText`, rebase), `docs-collab-types.ts`, `use-docs-collab-join.ts`, `docs-collab-server-io.ts`, `docs-collab-update-guard.ts`, `packages/apps/src/note-detail-view/src/use-note-title-field.tsx`, `use-note-title-carets.ts`, `note-title-carets.tsx` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab src/note-detail-view` |
| `chunk-c-tasks-room` | builder | workspace, apps-ui | `packages/apps/src/tasks-core/src/use-task-text-collab.ts`, `task-text-rooms.ts`, `tasks-detail-view.tsx`, `use-task-detail-autosave.ts`, `use-task-edit-form.ts`, `use-tasks-live-inbound.ts`, `packages/apps/src/lib/api/wgw/tasks-text.ts`, `packages/apps/src/lib/offline/tasks/tasks-parked-writes.ts`, `packages/apps/src/tasks-core/stories/` | `pnpm --dir packages/apps exec vitest run src/tasks-core src/lib/offline/tasks`, then `pnpm test:apps-done-gate` |
| `chunk-d-disjoint-retry` | builder | workspace | `packages/apps/src/lib/offline/tasks/tasks-outbox-flush.ts`, `tasks-patch-merge.ts`, `tasks-hybrid-operations.ts`, `packages/apps/src/tasks-core/src/use-task-detail-autosave.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/tasks src/tasks-core` |
| `chunk-e-activity-merge` | builder (after #2173 chunk F) | api, workspace | `packages/api/app/Services/Threads/ThreadActivityWriter.php`, `packages/apps/src/thread-ui/format-thread-activity.ts` | `cd packages/api && composer done-gate`; `pnpm --dir packages/apps exec vitest run src/thread-ui` |
| `chunk-f-docs` | builder | document | `docs/architecture/tasks.md`, `docs/architecture/jmap-push.md` | `pnpm run check:agent-docs` |
| `chunk-v-verify` | verifier | testing | `packages/apps/e2e/tasks-live-text.spec.ts` (two browser contexts), all chunk paths read-only | the Playwright spec, `pnpm test:apps-done-gate`, `composer done-gate` |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- A, B and D start in parallel. C starts once A and B are merged. E waits for #2173's activity writer on main; until then it is a change to #2173's spec. F goes with C. V runs last.
- B and C both touch the title binding: B generalises it, C only consumes it. C must not edit `note-detail-view`.
- C and D both touch `use-task-detail-autosave.ts`: D lands first, or they run in sequence on that file.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
