# Real-time health metrics

Derived from [spec.md](./spec.md).

## Goal

Store anonymous `/rtc/metrics` samples, show them on an admin page with relay outcomes, notify admins once a day, and document shared-hosting capacity for five PHP-FPM children.

## Budget

No extra budget. Uses the tables from #1085.

## Non-goals

- A migration or a change to the sample schema.
- External telemetry.

## What exists

- `POST /rtc/metrics` validates and returns 202 without writing a row. `path: packages/api/app/Http/Controllers/Api/V1/Rtc/MetricsController.php:1`
- `rtc_session_metrics` and 30-day pruning already exist. `path: packages/api/app/Models/RtcSessionMetric.php:1`
- Relay requests already write `rtc_relay_events`, including `unavailable`. `path: packages/api/app/Services/Rtc/RtcRelayService.php:1`
- Admin notices go through `NotifyListener`. `path: packages/api/app/Events/NotifyListener.php:1`

## Considered

Considered: stuffing health into `GET /admin/state` — rejected because the state payload is the settings form, and the health read is its own admin route. Considered: a third sample channel for presence — rejected because the #1085 schema enum is `meet` and `collab` only.

## Affected packages

- packages/api
- packages/apps
- docs
- tools/load

## Dependencies

Ingest and the health read come first. The notice hooks the existing relay write. The client reporter and the admin page can follow the API. The k6 script and the sizing note do not depend on a live host.

## Open decisions

None.

## Invariants

- A stored sample has no room name, address, ticket, or user id. A wrong change leaks them into `rtc_session_metrics`. Proof: `path: packages/api/tests/Feature/Rtc/RtcMetricsEndpointTest.php` assertion `test_a_signed_in_report_is_stored_without_room_or_address`.
- A minted session key cannot multiply inserts. Proof: `path: packages/api/tests/Feature/Rtc/RtcMetricsEndpointTest.php` assertion `test_minted_keys_cannot_multiply_the_address_budget`.
- One admin notice per day, with usernames and Meet or Docs, and no network class. Proof: `path: packages/api/tests/Feature/Rtc/RtcDirectConnectNotificationTest.php` assertion `test_unavailable_outcomes_bundle_into_one_admin_notice_per_day`.
- `peer-mesh.ts` stays at or under 800 lines. Proof: `cmd: wc -l packages/apps/src/lib/rtc/session/peer-mesh.ts`.

## Chunks

### Chunk A: ingest, health, notice

- **id:** `rtc-metrics-api`
- **Skill:** api
- **Inputs:** the 202-only controller — `path: packages/api/app/Http/Controllers/Api/V1/Rtc/MetricsController.php:1`
- **Done when:** samples persist, the admin JSON matches the windows, and unavailable outcomes notify once a day.
- **Verify with:** `composer test -- --filter 'RtcMetricsEndpointTest|RtcRealtimeHealthTest|RtcDirectConnectNotificationTest|MeetRelayTest'`
- **Parallel with:** none

### Chunk B: client, admin page, capacity note

- **id:** `rtc-metrics-ui`
- **Skill:** apps-ui
- **Inputs:** `RtcPeerMesh` — `path: packages/apps/src/lib/rtc/session/peer-mesh.ts:1`
- **Done when:** the client posts at most once a minute, the admin page renders the callout, and the sizing table is in the install docs.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/rtc/telemetry/session-metrics-reporter.test.ts src/admin-core/src/admin-realtime-health-pane.test.tsx src/notifications-core/src/format-notification-copy.test.ts`
- **Parallel with:** none

## Test plan

- [ ] API feature tests for ingest, health, and the notice
- [ ] Vitest for the reporter, the pane, and the notice copy
- [ ] Focused PHPUnit only; the full API suite stays on CI
