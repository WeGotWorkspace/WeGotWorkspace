# Engineering tasks — Assign people to a task

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-audience-ids` | builder | api, security | `packages/api/app/Services/Tasks/Conversion/TaskConversionSupport.php`, `app/Services/Tasks/TaskListAudience.php` (new), `app/Http/Requests/Api/V1/TaskUpsertRequest.php`, `TaskPatchRequest.php`, `app/Http/Controllers/Api/V1/Tasks/*` (members route), `routes/api.php`, `openapi/openapi.json`, `openapi/schemas/tasks/*`, `tests/Feature/Tasks/TaskListMembersTest.php` (new), `tests/Unit/Tasks/TaskRoundTripLossTest.php` | `pnpm test:api-done-gate` |
| `chunk-b-change-set-notify` | builder | api, security | `packages/api/app/Services/Tasks/TaskChangeSet.php` (new), `app/Services/Tasks/TaskRepository.php`, `app/Services/Notify/TaskAssignedNotify.php` (new), `app/Events/NotifyListener.php`, `app/Services/Notify/NotificationCopyFormatter.php`, `app/Dav/Server/TaskChangeObserverPlugin.php` (new), `app/Dav/SabreServerFactory.php`, `packages/apps/src/notifications-core/src/format-notification-copy.ts`, `tests/Unit/Tasks/TaskChangeSetTest.php` (new), `tests/Feature/Tasks/TaskChangeObserverPluginTest.php` (new), `tests/Feature/Notify/TaskAssignedNotifyTest.php` (new) | `pnpm test:api-done-gate` |
| `chunk-c-assignees-ui` | builder | apps-ui, workspace, accessibility | `packages/apps/src/tasks-core/src/tasks-detail-view.tsx`, `tasks-assignees-field.tsx` (new), `tasks-assignee-picker.tsx` (new), `tasks-list-row.tsx`, `tasks-labels.ts`, `lib/models/tasks-types.ts`, `lib/offline/tasks/*` (audience cache), mock API, stories | `pnpm test:apps-done-gate` |
| `chunk-d-assigned-to-me` | builder | apps-ui | `packages/apps/src/tasks-core/src/tasks-task-utils.ts`, `use-tasks-sidebar-model.tsx`, `tasks-route-search.ts`, `use-tasks-shell.tsx`, `tasks-task-utils.test.ts` | `pnpm test:apps-done-gate` |
| `chunk-e-interop-docs` | builder | testing, document | `packages/api/tests/fixtures/Interop/RealClients/*`, `tests/Feature/Tasks/TasksCalDavInteropTest.php`, `docs/architecture/tasks.md`, `docs/architecture/notifications.md` | `pnpm test:api-done-gate`, `pnpm run check:agent-docs` |
| `chunk-v-assignees-verify` | verifier | testing | read-only; two-user browser e2e plus one CalDAV PUT | done-checklist + e2e |

## Notes

- Chunk B owns `TaskChangeSet` and `TaskChangeObserverPlugin`. Epic #2173 extends them; it does not fork them.
- `TaskListAudience` is the single answer to "who can see this list" for assignees, mentions (#2173) and their notifications.
