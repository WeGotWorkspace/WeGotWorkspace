# Engineering tasks — Public availability link

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-public-link-server` (#2405) | builder | api, security | `packages/api/app/Services/Calendars/Availability/*PublicLink*`, `AvailabilityCalculator.php`, `AvailabilityPeriodFilter.php`, `app/Http/Controllers/Api/V1/Calendars/CalendarAvailability*Controller.php`, `app/Models/CalendarAvailabilityLink.php`, `database/migrations/wgw/*availability_links*`, `routes/api.php`, `openapi/**`, `tests/Feature/Calendars/AvailabilityPublicLink*Test.php`, `docs/architecture/calendar-availability.md` | `pnpm test:api-done-gate` |
| `chunk-b-public-link-settings` (#2406) | builder | apps-ui, workspace, client-transport | `packages/apps/src/settings-core/src/settings-calendar-public-link-*`, `lib/api/wgw/calendar-availability-public-link.ts`, `lib/api/mock/*`, `e2e/settings-calendar-public-link.spec.ts` | `pnpm test:apps-done-gate` |

## Notes

- Chunk `id` values match `plan.md`.
- Chunk B waits for A's OpenAPI. Visible UI waits for the product owner's screenshot review before merge.
- On scope change: update the Epic first, then re-sync spec, plan and tasks and the `Source:` body-hash.
