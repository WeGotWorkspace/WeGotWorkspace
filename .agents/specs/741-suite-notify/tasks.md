# Engineering tasks — Suite notify pipeline

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-0-write-paths` | builder | api | `packages/api/tests/Architecture/WritePathContractTest.php` | `composer test:architecture` | done |
| `chunk-a-dispatch` | builder | api | `packages/api/app/Events/WorkspaceEvent.php`, `EventDispatch.php`, `EventDispatchPlugin.php` | Feature + unit tests | done |
| `chunk-p-schedule` | builder | api | `packages/api/bootstrap/app.php`, artisan commands, docs | console tests | done |
| `chunk-n-inbox` | builder | api, apps-ui | migrations, OpenAPI, `NotifyListener`, tray UI | API feature + Storybook | done |
| `chunk-v-vapid` | builder | api, apps-ui | VAPID keys, `push_subscriptions`, `src/sw.ts` | Feature + SW unit | done |
| `chunk-s-alarms` | builder | api | AlertDueScheduler | frozen-time feature tests | done |
| `chunk-share-docs` | builder | api | `DriveShareService::createShare` | Feature test | done |
| `chunk-chat-messages` | builder | api | `ChatMessageRepository::create`, `rosterUsernames` | Feature tests | done |
| `chunk-format-at-edge` | builder | api, apps-ui | `notifications.data`, `NotificationCopyFormatter`, `formatNotificationCopy` | Unit + VAPID feature + Storybook | done |

## Notes

- Chunk `id` values must match `plan.md`.
- Spec `Source:` is Epic #741, not Goals #390 / #548 / #493.
- Do not close #493. Do not close #390 / #548 unless producer AC is fully met (#548 comments remain a gap).
- Format-at-edge: structured `data` is source of truth; tray TS and VAPID PHP formatters share copy rules; legacy title/body kept for rows without `data`.
