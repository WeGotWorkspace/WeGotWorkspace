# Engineering tasks — Urgent Web Push for "meeting started"

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-spike` | builder | document | `docs/architecture/notifications.md` | `pnpm run check:agent-docs` |
| `chunk-api` | builder | api | `packages/api/app/Services/Notify/{UrgentPushService,VapidPushService,MinishlinkWebPushSender,PreparedWebPush}.php`, `packages/api/app/Events/NotifyListener.php`, `packages/api/database/migrations/wgw/*_notification_delivery_endpoint.php`, `packages/api/tests/Feature/Notify/UrgentPushTest.php` | `pnpm test:api-done-gate` |
| `chunk-sw` | builder | workspace | `packages/apps/src/sw.ts`, `packages/apps/src/notifications-core/src/{push-delivery,pushed-inbox-items,parse-notification-push-payload,notifications-provider}.ts*` | `pnpm --dir packages/apps exec vitest run src/notifications-core` |
| `chunk-k6` | builder | testing | `tools/load/rtc-shared-hosting.k6.js`, `docs/realtime-capacity.md` | `URGENT_ONLY=1 k6 run tools/load/rtc-shared-hosting.k6.js` |

## Notes

- One builder, sequential: spike → api → sw → k6.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
