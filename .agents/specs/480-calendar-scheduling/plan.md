# Calendar iTIP scheduling inbox

Derived from [spec.md](./spec.md).

## Goal

Same-instance iTIP on REST + CalDAV, scheduling notifications REST, and Calendar Invitations UI — closing Epic #480 under Goal #478.

## Non-goals

- External iMIP / RSVP links (Epic #481)
- ACL sharing (#403), free-busy, inbound Mail-app iMIP, PHP `mail()`

## Affected packages

- packages/api | packages/apps

## Dependencies

1. Chunk **A** first (CalDAV `/inbox` collision blocks using the scheduling inbox).
2. Chunk **B** after A (implicit iTIP on REST).
3. Chunk **C** after B (notifications REST reads `schedulingobjects` B writes).
4. Chunk **D** after C's OpenAPI exists (UI may mock the contract and overlap C).
5. Chunk **V** after A–D merge.

External iMIP is a **separate** spec: [../481-calendar-imip/](../481-calendar-imip/plan.md) (needs B + #471).

## Chunks

### Chunk A: Tasks inbox URI collision

- **id:** `tasks-inbox-uri`
- **Skill:** api, testing
- **Inputs:** `InboxTaskListProvisioner`, `UserCalendarCollectionsProvisioner`, Tasks REST `role: inbox`, Sabre `CalendarHome`, Task #482
- **Done when:** VTODO uri is not `inbox`; REST still has `role: inbox`; calendar-home has one `inbox` (schedule-inbox); provisioner + migrator + Tasks tests green
- **Verify with:** targeted PHPUnit + `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: Implicit iTIP on REST (local only)

- **id:** `rest-itip-local`
- **Skill:** api, testing
- **Inputs:** `CalendarEventRepository`, `/set`, `ITip\Broker`, Schedule plugin, Task #483
- **Done when:** REST create/update/destroy/`/set` deliver local REQUEST/REPLY/CANCEL; A invites B → inbox + tentative VEVENT; B RSVP updates A's PARTSTAT; no MailDelivery send; CalDAV PUT still works
- **Verify with:** `tests/Feature/Calendars/` scheduling tests + `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk C: Scheduling notifications REST

- **id:** `scheduling-notifications-rest`
- **Skill:** api, testing
- **Inputs:** OpenAPI `calendars/`, `schedulingobjects`, Task #484
- **Done when:** list / respond / dismiss; ACL own-inbox only; OpenAPI + `pnpm check:api-types`; feature tests
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** `calendar-invitations-ui` after contract exists (UI may mock)

### Chunk D: Calendar attendees + Invitations UI

- **id:** `calendar-invitations-ui`
- **Skill:** workspace, apps-ui, storybook
- **Inputs:** `calendar-core`, C contract (or mock), Task #485
- **Done when:** attendee picker + PARTSTAT; Invitations sidebar + badge; Accept/Maybe/Decline; offline RSVP outbox; mock-tier stories
- **Verify with:** targeted Vitest / Storybook; `pnpm test:apps-done-gate`
- **Parallel with:** `scheduling-notifications-rest` (after OpenAPI)

### Chunk V: Verify

- **id:** `verify-calendar-scheduling`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged A–D; Tasks #482–#485; Epic #480
- **Done when:** verify-issue PASS or PASS_WITH_NITS on #480 / #482–#485; done gates; smells on touched files
- **Verify with:** verify-issue, `pnpm test:api-done-gate`, `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature tests (A invites B; B RSVP; A cancels; REST vs CalDAV same inbox; one CalDAV `inbox`) → `pnpm test:api-done-gate`
- [ ] UI: mock-tier Storybook for attendees + Invitations; Vitest for RSVP/outbox → `pnpm test:apps-done-gate`
- [ ] verify-issue against #482–#485 / #480

## Doc updates (when implementing)

- [`packages/api/docs/calendars/jmap-calendars-summary.md`](../../../packages/api/docs/calendars/jmap-calendars-summary.md) — drop “scheduling inbox REST” from v1 non-goals
- Add `packages/api/docs/calendars/scheduling.md` (iTIP path, inbox vs Tasks inbox)
