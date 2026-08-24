# ICS / webcal subscribe and publish

Derived from [spec.md](./spec.md). Chunk layout for parallel or sequential implementation of Epic #601 (Goal #522).

## Goal

Ship live ICS / webcal **subscribe** (server fetch + refresh into a read-only collection) and **publish** (hashed-token public feed) so Goal #522 success signals are met. Closing issues: #602 / #603 / #604; Epic #601.

## Non-goals

- File import (#461), CalDAV URL copy (#524), ACL (#403), invites, guest JWT (#388)
- Overloading `Calendar.isSubscribed`
- Browser-side remote ICS fetch

## Affected packages

- `packages/api`
- `packages/apps` (`calendar-core`, mock JMAP, stories)

## Dependencies

1. OpenAPI + Calendar JMAP marker (`subscriptionId`) before any UI consumer
2. Subscribe API and publish API may proceed in parallel after the contract chunk (separate route groups; do not edit the same OpenAPI path objects)
3. UI after both API chunks merge (or against a mocked contract if the parent keeps one branch)
4. Cross-chunk verify after merge

This plan assumes **one branch** (`feat/calendar-ics-webcal`) unless a later split is requested. If parallel worktrees are used, give each chunk its own `tools/worktree-agent.sh` branch and merge contract-first.

## Chunks

### Chunk A: OpenAPI contract

- **id:** `api-ics-webcal-contract`
- **Skill:** api
- **Inputs:** Epic #601; Tasks #602 / #603; `packages/api/openapi/openapi.json`; `openapi/schemas/calendars/calendar.json`; RSVP token + `x-wgw-access` patterns
- **Done when:** Paths and schemas exist for subscriptions, owner feed, public feed; `Calendar` gains optional `subscriptionId` (or equivalent) without changing `isSubscribed`; `x-wgw-access` set (`user` / `guest`); typegen regenerates; no implementation yet except contract fixtures if required
- **Verify with:** `pnpm --filter @wgw/api run openapi:build-json` and `pnpm --filter @wgw/api run typegen`; OpenAPI architecture tests
- **Parallel with:** none

### Chunk B: Subscribe API

- **id:** `api-ics-webcal-subscribe`
- **Skill:** api
- **Inputs:** Chunk A; Task #602 AC; `CalendarRepository`, `CalendarEventSetService` / calendarobjects; ICS converters; existing ICS size guard
- **Done when:** #602 AC pass — SSRF-safe fetch, personal read-only collection, UID refresh, 4xx on bad ICS, DELETE unsubscribes, `Calendar/get` exposes `subscriptionId`, `isSubscribed` unused as the feed flag; red-green feature tests in the same chunk
- **Verify with:** `cd packages/api && composer test -- --filter Calendars`; `pnpm test:api-done-gate`; [verify-issue](../../skills/verify-issue/SKILL.md) on #602
- **Parallel with:** `api-ics-webcal-publish` (after A; do not touch the same OpenAPI path nodes)

### Chunk C: Publish API

- **id:** `api-ics-webcal-publish`
- **Skill:** api
- **Inputs:** Chunk A; Task #603 AC; `calendar_rsvp_tokens` hashed-token pattern; `CalendarRsvpController` unauthenticated GET
- **Done when:** #603 AC pass — hashed token, public `text/calendar`, webcal URL advertised, revoke 404, rate limit, reject subscription calendars, personal owned only; red-green feature tests in the same chunk
- **Verify with:** `cd packages/api && composer test -- --filter Calendars`; `pnpm test:api-done-gate`; [verify-issue](../../skills/verify-issue/SKILL.md) on #603
- **Parallel with:** `api-ics-webcal-subscribe` (after A)

### Chunk D: Calendar UI

- **id:** `apps-ics-webcal-ui`
- **Skill:** workspace
- **Inputs:** Chunks B + C (or mock operations matching OpenAPI); Task #604; `calendar-workspace.tsx`, `calendar-calendar-dialog.tsx`, `calendar-types.ts`, `use-calendar-controller.ts`
- **Done when:** #604 AC pass — subscribe from Calendar, distinct read-only subscribed calendars, unsubscribe, publish + copy https/webcal + revoke, suite primitives, mock-tier stories, no browser ICS fetch; smells checklist on touched hooks
- **Verify with:** `pnpm --dir packages/apps exec vitest run calendar-core`; Storybook coverage for new exports; `pnpm test:apps-done-gate`; [verify-issue](../../skills/verify-issue/SKILL.md) on #604
- **Parallel with:** none (needs B + C)

### Chunk V: Cross-chunk verify

- **id:** `verify-ics-webcal`
- **Skill:** testing
- **Inputs:** merged A–D; [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md); [done-checklist](../../skills/developer/done-checklist.md)
- **Done when:** verifier `PASS` or `PASS_WITH_NITS`; [verify-issue](../../skills/verify-issue/SKILL.md) on Epic #601 (and Goal #522 success signals via children); API + apps done gates; `isSubscribed` still means JMAP visibility
- **Verify with:** `pnpm test:api-done-gate`; `pnpm test:apps-done-gate`; issue AC report
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature tests → implement → `pnpm test:api-done-gate`
- [ ] Subscribe: happy path, `webcal://` normalize, SSRF rejects, invalid ICS, refresh UID sync, unsubscribe
- [ ] Publish: create/get URLs, public GET ICS, revoke 404, rate limit, reject subscription calendar
- [ ] UI: mock-tier Storybook (subscribe dialog, publish section, read-only row); Vitest on operations; optional `play` for copy/revoke
- [ ] verify-issue #602 #603 #604 then Epic #601

## Doc updates (only if user wants)

- None unless asked. Installer cron for `wgw:calendars:refresh-subscriptions` can wait; Calendar-load refresh is enough for an active user.
