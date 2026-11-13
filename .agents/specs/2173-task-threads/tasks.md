# Engineering tasks — Discussion thread and activity log on a task

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-shared-thread-module` | builder | api | `packages/api/app/Services/Threads/*` (new), `app/Services/Chat/Conversion/ChatMessageJournalConverter.php`, `app/Services/Chat/ChatMessageRepository.php`, `app/Services/Docs/Conversion/DocsThreadJournalConverter.php`, `app/Services/Docs/DocsThreadRepository.php`, `database/migrations/wgw/*thread_index*` (new), `tests/Unit/Threads/*` (new) | `pnpm test:api-done-gate` |
| `chunk-b-task-thread-api` | builder | api, security | `packages/api/app/Services/Calendars/CollectionKind.php`, `app/Services/Tasks/Threads/*` (new), `app/Services/Tasks/TaskRepository.php`, `app/Services/Tasks/TaskListRepository.php`, `app/Http/Controllers/Api/V1/Tasks/TaskThreadController.php` (new), `routes/api.php`, `openapi/openapi.json`, `openapi/schemas/tasks/thread*.json` (new), `tests/Feature/Tasks/TaskThread*Test.php` (new), `tests/Feature/Dav/ChatCollectionsDavExposureTest.php`, `docs/architecture/tasks.md` | `pnpm test:api-done-gate` |
| `chunk-c-thread-push` | builder | api, client-transport | `packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php`, `tests/Feature/Jmap/JmapEventSourceThreadTest.php` (new), `packages/apps/src/lib/jmap-client/push/*` | `pnpm test:api-done-gate`, `pnpm test:apps-done-gate` |
| `chunk-d-thread-notify` | builder | api | `packages/api/app/Services/Notify/TaskThreadNotify.php` (new), `app/Events/NotifyListener.php`, `app/Services/Notify/NotificationCopyFormatter.php`, `packages/apps/src/notifications-core/src/format-notification-copy.ts`, `tests/Feature/Notify/TaskThreadNotifyTest.php` (new), `docs/architecture/notifications.md` | `pnpm test:api-done-gate` |
| `chunk-e-thread-panel` | builder | apps-ui, workspace, accessibility | `packages/apps/src/tasks-core/src/tasks-thread-panel.tsx` (new), `use-task-thread.ts` (new), `tasks-detail-view.tsx`, `lib/models/tasks-types.ts`, `lib/offline/tasks/*` (thread read cache), mock API, stories | `pnpm test:apps-done-gate` |
| `chunk-f-activity-writer` | builder | api, security | `packages/api/app/Services/Tasks/Threads/TaskActivityWriter.php` (new), `app/Dav/Server/TaskChangeObserverPlugin.php` (from #2172), `app/Services/Tasks/TaskRepository.php`, `app/Services/Tasks/TaskImportService.php`, `tests/Feature/Tasks/TaskActivity*Test.php` (new) | `pnpm test:api-done-gate` |
| `chunk-g-activity-rows` | builder | apps-ui | `packages/apps/src/thread-ui/*` (new: `format-thread-activity.ts`, `thread-activity-row.tsx`), `tasks-core/src/tasks-thread-panel.tsx` | `pnpm test:apps-done-gate` |
| `chunk-v-threads-verify` | verifier | testing | read-only; two-user browser e2e, move to a private list, Chat and Docs smoke test | done-checklist + e2e |

## Notes

- Chunk A must land on its own and keep Chat and Docs byte-identical before any task-thread code builds on it.
- Chunks B and F extend #2172's `TaskChangeSet` and `TaskChangeObserverPlugin`; they do not fork them.
