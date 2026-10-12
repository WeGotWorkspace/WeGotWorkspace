# Engineering tasks — Real-time health metrics

**Not** a copy of the GitHub issue acceptance checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `rtc-metrics-api` | builder | api | `packages/api/app/Services/Rtc/RtcSessionMetricIngest.php`, `packages/api/app/Services/Rtc/RtcRealtimeHealthService.php`, `packages/api/app/Services/Rtc/RtcDirectConnectNotifier.php` | `composer test -- --filter 'RtcMetricsEndpointTest\|RtcRealtimeHealthTest\|RtcDirectConnectNotificationTest'` |
| `rtc-metrics-ui` | builder | apps-ui | `packages/apps/src/lib/rtc/telemetry/session-metrics-reporter.ts`, `packages/apps/src/admin-core/src/admin-realtime-health-pane.tsx`, `docs/realtime-capacity.md`, `tools/load/rtc-shared-hosting.k6.js` | `pnpm --dir packages/apps exec vitest run src/lib/rtc/telemetry/session-metrics-reporter.test.ts src/admin-core/src/admin-realtime-health-pane.test.tsx` |

## Notes

- Do not add a migration or change `RtcSessionMetricReport`.
- Do not raise the `peer-mesh.ts` line baseline.
