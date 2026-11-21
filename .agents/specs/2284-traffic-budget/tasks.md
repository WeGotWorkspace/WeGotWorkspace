# Engineering tasks — Traffic budget for shared hosting

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

Spike reference: branch `perf/traffic-governor-spike` holds a working version of every chunk; each PR re-lands its part with tests.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `calendar-shared-caches` (#2285) | builder | workspace | `packages/apps/src/calendar-core/src/use-calendar-task-due-overlay.ts`, `use-calendar-contact-invitees.ts`, live-inbound hooks → `src/lib/` | `pnpm --dir packages/apps exec vitest run src/calendar-core src/tasks-core src/contacts-core` |
| `docthread-push` (#2286) | builder | api, workspace | `packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php`, `packages/apps/src/docs-core/src/collab/use-docs-threads-source.ts`, `openapi.json` | `php scripts/done-gate.php`; `pnpm --dir packages/apps exec vitest run src/docs-core` |
| `idle-cadence` (#2287) | builder | workspace, api, security | `src/lib/activity/user-activity.ts`, `src/lib/jmap-client/push/event-source-transport.ts`, `src/lib/rtc/session/poll-cadence.ts`, `mesh-poll-loop.ts`, `push-heartbeat-peers.ts`, `src/lib/api/wgw/jmap-push.ts`, `src/notifications-core/src/notifications-provider.tsx`, `src/presence-core/src/presence-rtc-session.ts`, `src/calendar-core/src/use-calendar-api.ts`, `use-calendar-invitations.ts`, `packages/api/app/Http/Controllers/Api/V1/Jmap/JmapEventSourceController.php`, `JmapPushStateResolver.php`, `app/Services/Rtc/Signaling/` (`RtcPushHeartbeat.php`, `HttpSignalingMailbox.php`) | `php scripts/done-gate.php`; `pnpm --dir packages/apps exec vitest run src/lib/rtc src/lib/jmap-client src/presence-core src/calendar-core src/notifications-core` |
| `calm-recovery` (#2288) | builder | workspace | `src/lib/offline/core/browser-online.ts`, `src/hooks/use-offline-reconnect-flush.ts`, `src/jsdom-setup.ts` | `pnpm --dir packages/apps exec vitest run src/hooks src/calendar-core src/tasks-core src/meet-core` |
| `request-loops` (#2289) | builder | workspace | `src/meet-core/src/use-meet-channel-call-activity.ts`, `src/sw.ts` | `pnpm --dir packages/apps exec vitest run src/meet-core` + production preview check |
| `browser-wide-pacing` (#2290) | builder | workspace | `src/lib/offline/core/background-sync-pacer.ts`, `src/lib/api/wgw/contacts.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline src/contacts-core` |
| `sw-governor` (#2291) | builder | workspace, api, security | `src/lib/traffic/request-governor.ts`, `src/sw.ts`, `packages/api/config/wgw.php`, `app/Support/TrafficBudget.php`, `app/Http/Middleware/SendTrafficBudget.php`, `bootstrap/app.php` | `pnpm --dir packages/apps exec vitest run src/lib/traffic`; `vendor/bin/phpunit tests/Unit/Support/TrafficBudgetTest.php` |
| `rtc-room-doorbell` (#2294) | builder | api, workspace, security | `packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php`, `app/Services/Rtc/Signaling/`, `packages/apps/src/lib/rtc/session/`, `src/presence-core/` | `php scripts/done-gate.php`; `pnpm --dir packages/apps exec vitest run src/lib/rtc src/presence-core` |
| `meet-call-push` (#2295) | builder | api, workspace | `JmapPushStateResolver.php`, `app/Services/Meet/`, `src/meet-core/src/use-meet-channel-call-activity.ts` | `php scripts/done-gate.php`; `pnpm --dir packages/apps exec vitest run src/meet-core` |
| `push-health` (#2296) | builder | workspace | `src/lib/api/wgw/use-jmap-state-change.ts`, inbound-sync hooks of Notes, Contacts, Tasks, Calendar, Meet chat, `src/lib/offline/core/browser-online.ts` | `pnpm --dir packages/apps exec vitest run src/lib/api src/notes-core src/contacts-core src/tasks-core src/calendar-core src/meet-core src/hooks` |
| `contacts-large-pages` (#2297) | builder | workspace, api | `src/lib/jmap-client/contacts/JmapContactsClient.ts`, `src/lib/api/wgw/contacts.ts`, `src/lib/offline/core/background-sync-pacer.ts`, `src/calendar-core/src/use-calendar-contact-invitees.ts` | `pnpm --dir packages/apps exec vitest run src/lib/jmap-client src/contacts-core src/calendar-core src/lib/offline` |
| `doorbell-rule` (#2298) | builder | document, testing | `docs/architecture/jmap-push.md`, `src/lib/traffic/network-polls.test.ts`, `.agents/skills/client-transport/SKILL.md` | `pnpm --dir packages/apps exec vitest run src/lib/traffic`; `pnpm run check:agent-docs` |
| `harness-and-docs` (#2292) | builder | testing, document | `packages/apps/e2e/traffic-budget.spec.ts`, `e2e/helpers/traffic-meter.ts`, `playwright.traffic.config.mjs`, `docs/realtime-capacity.md` | `WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs` |

## Notes

- Chunk ids match `plan.md`.
- The harness hardcodes ports 9080/5173: run one stack at a time.
- On scope change: update #2284 first, then re-sync these files and the body-hash in `spec.md`.
