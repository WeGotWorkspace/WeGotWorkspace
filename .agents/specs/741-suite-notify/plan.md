# Suite notify pipeline

Derived from [spec.md](./spec.md). Chunk layout matches Epic #741 child Tasks #742–#748.

## Goal

Land the envelope, LAMP scheduler, inbox + in-app Notification API, VAPID primitives, and three first producers (VALARM, Doc-share, chat message-posted).

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- packages/api
- packages/apps
- docs (architecture note + cron contract)

## Dependencies

1. Issues + spec files
2. Chunk 0 architecture tests
3. Chunk A (envelope + fire) — parallel with P after 0
4. Chunk P (scheduler)
5. Chunk N (inbox) depends on A
6. Chunk V depends on N + P; S depends on A + N + P; Share and Chat depend on A + N
7. V, S, Share, Chat may parallel after N+P

## Chunks

### Chunk 0: Write-path contract tests

- **id:** `chunk-0-write-paths`
- **Skill:** api, testing
- **Inputs:** CalPDO/CardPDO repositories; Drive writers
- **Done when:** architecture tests document (a) Calendar/Contacts/Notes/Tasks mutate only via CalPDO/CardPDO + DAV HTTP, (b) Drive disk I/O is only `WgwStorage::files()`, (c) observation must hook FileNodeSetService **and** DriveService **and** DAV plugin
- **Verify with:** `packages/api/tests/Architecture/` + `composer test:architecture`
- **Parallel with:** none

### Chunk A: Envelope + dual dispatch

- **id:** `chunk-a-dispatch`
- **Skill:** api
- **Inputs:** SearchIndexPlugin, SabreServerFactory, BestEffort call sites + DriveService + CalendarSchedulingService + Chat
- **Done when:** both entry points dispatch exactly once per mutation; listener exceptions do not fail the write; no `tenant_id`
- **Verify with:** Feature tests for plugin + repository `fire`; unit test throwing listener swallowed
- **Parallel with:** `chunk-p-schedule`

### Chunk P: LAMP scheduler

- **id:** `chunk-p-schedule`
- **Skill:** api
- **Inputs:** bootstrap/app.php, docs/env.md, Docker/Apache docs
- **Done when:** `withSchedule` registers minute commands; documented cron; Docker/dev equivalent; commands idempotent when tables empty
- **Verify with:** Feature/console tests
- **Parallel with:** `chunk-a-dispatch`

### Chunk N: Notify inbox + in-app Notification API

- **id:** `chunk-n-inbox`
- **Skill:** api, apps-ui, workspace, storybook, accessibility
- **Inputs:** OpenAPI, tray-only shell (no new first path segment)
- **Done when:** OpenAPI inbox list/ack; feature tests; mock-tier Storybook tray; no VAPID send yet
- **Verify with:** API feature tests + Vitest/Storybook
- **Parallel with:** none (needs A)

### Chunk V: VAPID primitives

- **id:** `chunk-v-vapid`
- **Skill:** api, apps-ui
- **Inputs:** Chunk N + P; VitePWA injectManifest
- **Done when:** keypair, `push_subscriptions`, subscribe REST, custom SW, local-ack race, architecture note, tests
- **Verify with:** API feature tests; SW parse unit tests
- **Parallel with:** `chunk-s-alarms`, `chunk-share-docs`, `chunk-chat-messages`

### Chunk S: VALARM due scheduler

- **id:** `chunk-s-alarms`
- **Skill:** api, apps-ui
- **Inputs:** ICalendarAlarmTrigger, Chunk A + N + P
- **Done when:** due Calendar + Task reminders surface in inbox + Notification API; frozen-time tests; no duplicate on second cron tick
- **Verify with:** Feature tests with frozen time
- **Parallel with:** `chunk-v-vapid`, `chunk-share-docs`, `chunk-chat-messages`

### Chunk Share: Doc share notify

- **id:** `chunk-share-docs`
- **Skill:** api
- **Inputs:** DriveShareService::createShare; Chunk A + N
- **Done when:** sharee (not actor) gets inbox row; navigate opens the Doc; feature test; comments documented as remaining gap
- **Verify with:** Feature test
- **Parallel with:** `chunk-s-alarms`, `chunk-v-vapid`, `chunk-chat-messages`

### Chunk Chat: message-posted notify

- **id:** `chunk-chat-messages`
- **Skill:** api
- **Inputs:** ChatMessageRepository::create; ChatChannelRepository::rosterUsernames
- **Done when:** N-member channel → N−1 inbox rows; DM → 1; author never notified; no @mention parsing
- **Verify with:** Feature tests
- **Parallel with:** `chunk-s-alarms`, `chunk-share-docs`, `chunk-v-vapid`

## Test plan

- [ ] Chunk 0: architecture assertions on write/observation paths
- [ ] Chunk A: DAV `afterMethod` and repository `fire`, each once; throwing listener isolated
- [ ] Chunk P: schedule registered; empty-table commands succeed
- [ ] Chunk N: inbox CRUD/ack; visibility-based local Notification API; Storybook tray
- [ ] Chunk V: ack window vs VAPID; 410 prune; SW fallback parse
- [ ] Chunk S: frozen-clock due alarm → one inbox row; duplicate cron tick does not duplicate
- [ ] Chunk Share: sharee notified, actor not
- [ ] Chunk Chat: N-member channel → N−1; DM → 1; author not notified
- [ ] OpenAPI first; `composer done-gate`; `pnpm test:apps-done-gate` if UI changed
