# Plan — Public availability link

Spec: [spec.md](./spec.md). Epic #2404.

## Budget

Draws from Goal Product#156. Adds one table and one public route, reads the calculator and the week cache; adds no background work.

## What exists

- Busy-time calculator and week cache. `path: packages/api/app/Services/Calendars/Availability/AvailabilityCalculator.php:44`
- Period filter with `include`, dedupe and `details` flag. `path: packages/api/app/Services/Calendars/Availability/AvailabilityPeriodFilter.php:25`
- Published-calendar token, hash lookup, encrypted redisplay and limiter. `path: packages/api/app/Services/Calendars/CalendarFeedService.php:60`
- Settings switch and per-calendar choices. `path: packages/api/app/Services/Calendars/Availability/AvailabilitySettings.php:20`
- Settings pane card. `path: packages/apps/src/settings-core/src/settings-calendar-availability-section.tsx:40`
- Published-calendar UI pattern. `path: packages/apps/src/calendar-core/src/calendar-publish-section.tsx:30`

## Considered

- **`VFREEBUSY` feed:** rejected. Calendar apps subscribed to a URL ignore it; only `VEVENT`s show.
- **Reuse `calendar_feed_tokens`:** rejected. Rows are bound to a calendar id with a cascade; this link belongs to a person and spans calendars.
- **Require the Team switch:** rejected. The Goal's audience includes freelancers without a Team. Calendar choices stay shared.
- **Per-link calendar choices or detail:** rejected for now (Goal: Decisions). Detail is never available to outsiders.
- **Copy real UIDs or keep RRULE:** rejected. A UID or a recurrence rule lets a recipient tell events apart or correlate with invites.
- **Return a partial feed when a week is incomplete:** rejected (503). It would show free time that is not free.
- **Longer-lived `Cache-Control`:** rejected. A revoked link must stop at the next request.
- **Include the owner's name in the calendar name:** decided yes, as "{DisplayName}'s Availability" (Wouter). A web page for the link was dropped: the link is a subscribable feed, and a download of the same `.ics` is enough.

## Dependencies

#2405 first (settings card needs its OpenAPI and mock). #2406 after it.

## Open decisions

None. Decided with Wouter: no web page; the link is a subscribable feed with a file download as an extra.

## Invariants

- Output of the public feed contains only the properties in spec.md. Proof: `path: packages/api/tests/Feature/Calendars/AvailabilityPublicLinkPrivacyTest.php` assertion `test_feed_contains_only_busy_start_and_end`.
- Revoke and rotate end the old URL. Proof: `path: packages/api/tests/Feature/Calendars/AvailabilityPublicLinkTest.php` assertion `test_regenerate_ends_old_url`.
- Free and "Do not add" never show. Proof: `path: packages/api/tests/Feature/Calendars/AvailabilityPublicLinkTest.php` assertion `test_free_cancelled_and_do_not_add_never_show`.
- After chunk A, main still works without chunk B. Proof: `cmd: pnpm test:api-done-gate`.

## Chunks

### Chunk A: server and docs (#2405)
- **Skill:** api, security
- **Inputs:** calculator and filter above
- **Done when:** AC of #2405; privacy and revocation tests pass; OpenAPI and docs updated
- **Verify with:** `pnpm test:api-done-gate`, own curl e2e
- **Parallel with:** none

### Chunk B: settings card (#2406)
- **Skill:** apps-ui, workspace, client-transport, accessibility
- **Inputs:** chunk A's OpenAPI types and mock
- **Done when:** AC of #2406; screenshots reviewed by the product owner
- **Verify with:** `pnpm test:apps-done-gate`, browser e2e
- **Parallel with:** none

## Test plan

- [ ] API: privacy, revocation, rotation, disabled owner, Free, Do not add, Team switch off, incomplete week, rate limit, 304
- [ ] UI: mock-tier story, Vitest for section and operations, browser e2e on a fresh browser
