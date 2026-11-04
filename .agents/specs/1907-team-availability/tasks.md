# Engineering tasks — Team availability

**Not** a copy of a GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-availability-calculator` (#1908) | builder | api, security | `packages/api/app/Services/Calendars/Availability/*`, `CalendarCollectionAccess.php` (read-only accessor), `CalendarEventQuerySupport.php` (opt-in columns), `config/cache.php` (`availability` store), `app/Console/Commands/*AvailabilityPruneCache*`, `bootstrap/app.php` (schedule), `database/migrations/wgw/*availability*`, `tests/Feature/Calendars/Availability*Test.php` | `pnpm test:api-done-gate` |
| `chunk-b-availability-contract` (#1909) | builder | api, security | `openapi/openapi.json`, `openapi/schemas/calendars/availability*.json`, `app/Services/Jmap/Capabilities/AvailabilityCapabilityProvider.php`, `app/Services/Jmap/Methods/TeamMember*Method.php`, `app/Http/Controllers/Api/V1/Calendars/CalendarAvailabilityController.php`, `routes/api.php`, `app/Dav/Server/WgwSchedulePlugin.php` (switch and completeness, with #1923), mock JMAP server | `pnpm test:api-done-gate` |
| `chunk-c-availability-sidebar` (#1910) | builder | workspace, apps-ui, client-transport, accessibility | `packages/apps/src/lib/jmap-client/availability/*`, `lib/offline/calendars/calendars-schema.ts`, `lib/offline/calendars/availability-cache.ts`, `calendar-core/src/calendar-availability-sidebar.tsx`, `calendar-core/src/use-team-availability.ts`, `calendar-core/src/calendar-availability-notice.ts`, `notice-bar/src/notice-bar.tsx` (optional action), `calendar-sidebar-order.ts` | `pnpm test:apps-done-gate` |
| `chunk-d-availability-render` (#1911) | builder | apps-ui, workspace | `packages/apps/src/lib/calendar-elements/EventCard/*`, `calendar-core/src/calendar-availability-popover.tsx`, `calendar-labels.ts`, `calendar-events-api.ts` | `pnpm test:apps-done-gate` |
| `chunk-e-availability-settings` (#1912) | builder | apps-ui, workspace, client-transport | `packages/apps/src/settings-core/src/settings-calendar-availability-section.tsx`, `lib/api/wgw/calendar-availability.ts` | `pnpm test:apps-done-gate` |
| `chunk-f-availability-docs` (#1913) | builder | document | `docs/architecture/calendar-availability.md`, `packages/api/docs/*` | `pnpm run check:agent-docs` |
| `chunk-g-allday-free-default` (#1927) | builder | apps-ui | `packages/apps/src/calendar-core/src/calendar-editor-model.ts`, `calendar-alerts.ts`, `calendar-event-form-show-as.tsx` | `pnpm test:apps-done-gate` |
| `chunk-h-invitee-availability` (#1614) | builder | apps-ui, workspace, client-transport | `packages/apps/src/calendar-core/src/calendar-invitees-card.tsx`, `calendar-core/src/calendar-invitee-availability.ts` | `pnpm test:apps-done-gate` |
| `chunk-v-availability-verify` | verifier | testing | read-only; two-user browser e2e | done-checklist + e2e |

## Notes

- Chunk `id` values match `plan.md`.
- C, D, E and H start after B's OpenAPI and mock JMAP commit. D and H only touch `calendar-labels.ts` in separate label groups; C owns `calendar-sidebar-order.ts`.
- H uses C's client; if H starts first it uses the mock directly and switches when C lands.
- Visible UI (C, D, E, G, H) waits for the product owner's screenshot review before merge.
- On scope change: update the Epic first, then re-sync spec, plan and tasks and the `Source:` body-hash.
