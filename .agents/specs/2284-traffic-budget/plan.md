# Traffic budget for shared hosting

## Goal

One browser of one user stays inside the per-browser budget in [spec.md](./spec.md) on a shared host: duplicate fetching goes (Calendar reads the Tasks and Contacts caches, Docs threads ride push), polls slow down when nobody works, recovery backs off once per browser, first downloads share one browser-wide pace, and a service-worker governor holds the total to a budget the server announces per install channel. The organising rule is the push doorbell: one push stream per browser says *that* something changed and the app pulls; polls only as a backup while push is unhealthy or briefly while a WebRTC peer connects. A spike branch (`perf/traffic-governor-spike`) built and measured all of it; each chunk lands that work as its own PR with tests.

## Budget

Draws from the host's per-IP request allowance (the binding limit on shared hosting; one host blocks above 60/min) and from the 5-FPM-children pool in `docs/realtime-capacity.md`. Displaces: nothing visible once the doorbell lands (newcomers seen within one push round, ~3 s, as today); a full first offline download of many documents takes minutes, while contacts arrive first in large photo-less pages. The push stream itself becomes the largest cost (20/min active), so it must stay cheap per request. Adds no process, connection or table.

## Non-goals

- Server-side 429 limiter; native DAV clients; visible UI changes.
- The service-worker update activation bug (no `SKIP_WAITING` handler) — separate issue.

## What exists

- The Calendar task overlay runs a full Tasks bootstrap on mount and again on `visibilitychange` and reconnect. `path: packages/apps/src/calendar-core/src/use-calendar-task-due-overlay.ts:78`, `:110`, `:135`
- Calendar invitee suggestions call `listCards()` (whole address book, paged `ContactCard/get`) when there is no Contacts cache, and on every refresh after a typing pause. `path: packages/apps/src/calendar-core/src/use-calendar-contact-invitees.ts:19`, `:28`; trigger `path: packages/apps/src/calendar-core/src/calendar-invitees-card.tsx:223`
- Tasks and Contacts already have one-tab-per-browser inbound syncs driven by push. `path: packages/apps/src/tasks-core/src/use-tasks-live-inbound.ts:103`, `path: packages/apps/src/contacts-core/src/use-contacts-live-inbound.ts:41`, `path: packages/apps/src/lib/api/wgw/use-shared-inbound-sync.ts:44`
- Cross-tab cache-changed topics exist per domain. `path: packages/apps/src/lib/offline/core/cache-changed-topic.ts:27`
- Docs threads poll `files/threads/changes` every 4 s. `path: packages/apps/src/docs-core/src/collab/use-docs-threads-source.ts:16`, `:165`
- Push states are computed per caller per type; FileNode already composes per-root state from `rootsAndGrantPairs`. `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:147`, `:249`
- Thread pools are CalDAV collections of kind `DocsThreadPool`. `path: packages/api/app/Dav/Server/WgwCalendarBackend.php:421`, `path: packages/api/app/Services/Calendars/CollectionKind.php:22`
- Push reconnect waits 3 s visible, 30 s hidden; no idle state. `path: packages/apps/src/lib/jmap-client/push/event-source-transport.ts:28`
- A collab room alone polls every 2 s indefinitely. `path: packages/apps/src/lib/rtc/session/poll-cadence.ts:14`, `:82`
- The offline probe polls every 2 s per tab while offline. `path: packages/apps/src/lib/offline/core/browser-online.ts:29`
- The background sync pacer runs 120/min, one schedule per tab. `path: packages/apps/src/lib/offline/core/background-sync-pacer.ts:4`, `:14`
- The Meet call-activity poll restarts whenever the `channels` array identity changes. `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.ts:127`
- The service worker precaches with Workbox defaults (ignores only `utm_*`, `fbclid`), so `?v=` icons miss the precache. `path: packages/apps/src/sw.ts:33`
- Docker images set the install channel. `path: docker/install/Dockerfile:85` (`ENV WGW_INSTALL_CHANNEL=docker`)
- Import boundaries forbid app-to-app imports. `path: packages/apps/scripts/eslint-import-boundaries.mjs`
- Measured on the spike branch, local stack, cross-checked against the PHP server's request log (see Epic #2284 table): before 73–85/min steady and 397 in a cold start's first minute; after 14–33/min and 103 then 25–32. Source: [Epic #2284, section "Measured"](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/2284).

- Push types today: Note, Notebook, CalendarEvent, Calendar, ContactCard, AddressBook, ChatMessage, ChatChannel, FileNode, Task, TaskList, Notification; there is no type for signaling rooms or Meet call activity. `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:59`
- Signaling peers expire after 60–90 s without a poll; a roster signature already exists per room. `path: packages/api/app/Services/Rtc/Signaling/RtcSignalingPolicy.php:67`, `path: packages/api/app/Services/Rtc/Signaling/HttpSignalingMailbox.php:188`
- Meet call activity polls every 5 s. `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.ts:7`
- Inbound syncs keep a backup `/changes` poll while push is connected: Notes, Contacts, Tasks, Calendar 60 s, Meet chat 30 s. `path: packages/apps/src/notes-core/src/use-notes-live-inbound.ts:26`, `path: packages/apps/src/contacts-core/src/use-contacts-live-inbound.ts:19`, `path: packages/apps/src/tasks-core/src/use-tasks-live-inbound.ts:9`, `path: packages/apps/src/calendar-core/src/calendar-refresh.ts:8`, `path: packages/apps/src/meet-core/src/use-meet-chat-live-inbound.ts:30`
- Contacts first download uses 40-card pages, set when a 500-card page with inline photos passed 30 s on `php -S`. `path: packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts:26`
- Measured on the dev stack: push request with all types ~14 ms; `ContactCard/get` 40 cards 0.04 s, 200 cards 0.15 s, 500 cards 0.36 s. Source: [Epic #2284, section "Principle: the push doorbell"](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/2284).

## Considered

Considered: the existing one-tab model (`jmap-push-hub`, `useSharedInboundSync`) — reused for Calendar instead of a new Calendar-owned Tasks or Contacts sync, because a second sync doubles requests. One combined JMAP `/changes` request for all apps — rejected: push already compares states for every type in one request; the waste was full bootstraps and polls outside push, not separate `/changes` calls. "Active app polls often, others rarely" — folded into idle cadence plus hidden cadence, which already covers background tabs. A server-side 429 limiter — rejected for now: the host's firewall blocks before PHP sees the traffic. Marking bulk requests with a header deep in Docs hydration — rejected in favour of making the existing pacer browser-wide, which needs no plumbing through the collab layer. Calendar downloading contacts itself with pacing — rejected: it duplicates the Contacts app's download; reading the cache and mounting the live sync costs nothing extra. Fixed 2 s offline poll with jitter — rejected: a host that blocks needs exponential backoff, not spread. Slower lone-room polls as the end state (spike) — rejected after product review: join latency rose to 6–20 s; the push doorbell restores ~3 s for less traffic. Signaling payloads on push — rejected: push is pull-only short-burst, a WebRTC handshake needs sub-second turns; push carries only the doorbell. A push heartbeat that refreshes all the caller's peers' `seen_at` — rejected: it would keep a dead tab on another device alive. Chosen instead (2026-11-20): the push read refreshes only the peers its browser names, so a closed device still expires; rooms poll their own heartbeat only while push is down. Contacts pages of 500 — rejected for 200: 0.36 s per request and larger bodies with real photos; 200 keeps requests short on shared hosting.

## Affected packages

- packages/apps
- packages/api
- docs

## Dependencies

1. Chunk E (loops) and chunk A (Calendar) first: smallest diffs, the host's named paths.
2. Chunk B (DocThread push) needs nothing; chunk I (rooms) and chunk J (Meet call) follow the same resolver pattern and can run in parallel after B's resolver change lands (same file).
3. Chunk K (backup polls off, push as online check) after D (it feeds D's backoff).
4. Chunk C (idle cadence) after I (idle push 6 s assumes the doorbell).
5. Chunk L (contacts pages) after F (it uses F's shared schedule and priority).
6. Chunk F (browser-wide pacing) before chunk G (governor) so the governor's bulk class has a client-side twin.
7. Chunk M (suite rule + ratchet) after I, J, K so the ratchet lists the final polls.
8. Chunk H (harness + docs) last; it measures everything and writes the final numbers.

## Open decisions

- [x] Chunk G: the Helm chart is not in this repository (no `Chart.yaml` found). Chunk G does not edit a chart. A Helm install that uses the Docker image already gets `WGW_INSTALL_CHANNEL=docker` from `docker/install/Dockerfile`, and chunk G maps that channel to the standard profile; `WGW_TRAFFIC_PROFILE` stays an explicit override.
- [x] Idle budget (chunk C): measured after chunk I, one idle Docs tab made 15 requests/min (push 10, two 30 s room heartbeats 4, notifications 1) against ≤ 10. Decided 2026-11-20 (Wouter): keep idle push at 6 s and the ≤ 10 budget; room heartbeats and the notifications poll ride the push request. A push read refreshes `seen_at` only for the peers this browser sends with it (never other devices' peers), and the notifications poll is replaced by the existing `Notification` push type (pull on change). Target: one idle Docs tab ≈ 10/min, newcomer seen within ~6 s idle.

## Invariants

- Shared by default (Wouter, 2026-11-20): every piece that more than one app can use lives in `src/lib` and apps only declare what they need — the push hub and its types, the room doorbell and heartbeat-on-push (`lib/rtc`, used by every mesh room: Docs, Notes, Tasks, Meet, presence, text editor), the backup-poll-while-push-is-down helper (chunk K), the paced first-download schedule (chunk F), the thread doorbell pull (today in `docs-core`, moves to `src/lib` for Tasks and Meet comments), and the notifications push type. A wrong change grows one app-local copy per app, each with its own cadence and bugs. Proof: `cmd: pnpm --dir packages/apps exec eslint src` (import boundaries forbid app-to-app imports) and `path: tools/network-polls-ratchet.test.mjs` (chunk M lists every remaining poll with its owner).
- Calendar never sends a full Tasks bootstrap when a Tasks cache exists, and focus/reconnect send none. A wrong change brings back the host's named `tasks/items` burst. Proof: `path: packages/apps/src/calendar-core/src/use-calendar-task-due-overlay.test.tsx` assertions "paints the cache and sends no full load when there is one", "loads Tasks once without a cache, and showing the tab again reloads nothing".
- Calendar never calls `listCards`, with or without a Contacts cache. A wrong change re-downloads the address book on open or per keystroke pause. Proof: `path: packages/apps/src/calendar-core/src/use-calendar-contact-invitees.test.tsx` "refresh re-reads the cache the live sync keeps current, without a download", plus a search-with-no-cache case that expects no `listCards` call and a started shared cold download (chunk L, which now also owns `use-calendar-contact-invitees.ts`; chunk A landed the cache reads).
- A thread write in a pool the user cannot reach does not change that user's `DocThread` state (no cross-tenant signal). Proof: `path: packages/api/tests/Feature/Jmap/JmapPushDocThreadStateTest.php` (added in chunk B).
- With push down, Docs threads still arrive (poll resumes). Proof: `path: packages/apps/src/docs-core/src/collab/use-docs-threads-source.test.tsx` (chunk B).
- Active users keep today's cadence. With push healthy a quiet room relies on the doorbell and heartbeat-on-push and never returns to the 2 s poll; the idle and long-alone slowdowns (6 s alone after 30 s, 20 s idle) apply only while push is down. Proof: `path: packages/apps/src/lib/rtc/session/poll-cadence.test.ts` (chunk C).
- A refusing server gets at most 5 probes in 20 s from one browser. Proof: `path: packages/apps/src/hooks/use-connectivity.test.tsx` "waits longer after each failed probe instead of probing every 2 s".
- New channel objects with the same rooms do not restart the Meet room-status poll. Proof: `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.hook.test.tsx`.
- Two tabs sharing the pacer go no faster than one. Proof: `path: packages/apps/src/lib/offline/core/background-sync-pacer.test.ts` "two tabs drawing from one schedule go no faster than one".
- The governor never delays a write or a foreground read, and 0 turns pacing off. Proof: `path: packages/apps/src/lib/traffic/request-governor.test.ts` "brakes background requests after a 503 and lets writes and reads through", "takes the server's budget from the header, and 0 turns pacing off".
- Docker installs get the standard profile, zip installs shared; env overrides are clamped. Proof: `path: packages/api/tests/Unit/Support/TrafficBudgetTest.php`.
- A room activity where the caller has no peer does not change that caller's `RtcRoom` state, and `seen_at` heartbeats do not change it at all. A wrong change leaks presence across tenants, or makes push state change every poll. Proof: `path: packages/api/tests/Feature/Jmap/JmapPushRtcRoomStateTest.php` (chunk I).
- A lone peer behind the doorbell still heartbeats below the peer timeout. A wrong change drops lone users from rosters after 60 s. Proof: `path: packages/apps/src/lib/rtc/session/poll-cadence.test.ts` (chunk I).
- While push is unhealthy every app's backup poll resumes within one interval. A wrong change freezes live updates behind a broken proxy. Proof: `path: packages/apps/src/lib/api/wgw/push-health.test.ts` (chunk K).
- A push request with every type stays ≤ 25 ms on the reference stack. A wrong change makes the most frequent request heavy for 5 FPM children. Proof: `cmd: WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs` (report field `pushMs`, chunk H).
- A new network poll without a listed reason fails CI. Proof: `path: tools/network-polls-ratchet.test.mjs` (chunk M).
- After each chunk, main works without the next one (every chunk is independent of the governor). Proof: `cmd: pnpm --dir packages/apps exec vitest run` and `cmd: composer --working-dir packages/api done-gate` per PR.

## Chunks

### Chunk A: calendar-shared-caches (#2285)
- **Skill:** workspace
- **Inputs:** overlay and invitee behaviour above — `path: packages/apps/src/calendar-core/src/use-calendar-task-due-overlay.ts:78`, `path: packages/apps/src/calendar-core/src/use-calendar-contact-invitees.ts:19`; live inbound hooks — `path: packages/apps/src/tasks-core/src/use-tasks-live-inbound.ts:103`
- **Done when:** #2285 AC met; the two live-inbound hooks live under `src/lib` with their tests; no `wgw-boundaries/import-boundaries` warning in calendar-core.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core src/tasks-core src/contacts-core`; `pnpm --dir packages/apps exec eslint src/calendar-core`
- **Parallel with:** B, D, E

### Chunk B: docthread-push (#2286)
- **Skill:** api, then workspace
- **Inputs:** `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:147`, `:249`; `path: packages/apps/src/docs-core/src/collab/use-docs-threads-source.ts:165`
- **Done when:** #2286 AC met; OpenAPI lists `DocThread`; `docs/architecture/jmap-push.md` updated.
- **Verify with:** `composer --working-dir packages/api done-gate` (or `php scripts/done-gate.php` locally); `pnpm --dir packages/apps exec vitest run src/docs-core`
- **Parallel with:** A, D, E

### Chunk C: idle-cadence (#2287)
- **Skill:** workspace (rescoped: idle push 6 s; room slowdowns are the push-down fallback)
- **Inputs:** `path: packages/apps/src/lib/jmap-client/push/event-source-transport.ts:28`; `path: packages/apps/src/lib/rtc/session/poll-cadence.ts:14`
- **Done when:** #2287 AC met; cadence table in `docs/realtime-capacity.md` has idle and long-alone rows; heartbeat-on-push lands here: the push read refreshes `seen_at` only for the peers its browser names, and a feature test proves a caller cannot refresh another account's or another device's peer (that peer still expires after `peerTimeoutSeconds`); room heartbeat and notifications polls run only while push is down.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/rtc src/lib/jmap-client src/presence-core src/calendar-core`
- **Parallel with:** none (after I)

### Chunk D: calm-recovery (#2288)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/lib/offline/core/browser-online.ts:29`
- **Done when:** #2288 AC met.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/hooks src/calendar-core src/tasks-core src/meet-core`
- **Parallel with:** A, B, E

### Chunk E: request-loops (#2289)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.ts:127`; `path: packages/apps/src/sw.ts:33`
- **Done when:** #2289 AC met, including the production-build check (no icon request on app switch).
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/meet-core`; production preview on :4190, Network panel while switching apps
- **Parallel with:** A, B, D

### Chunk F: browser-wide-pacing (#2290)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/lib/offline/core/background-sync-pacer.ts:14`
- **Done when:** #2290 AC met; cold start measured with the harness.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/contacts-core`
- **Parallel with:** A, B, D, E

### Chunk G: sw-governor (#2291)
- **Skill:** workspace, api, security (cache/limiter key derived from the request: coalesce key includes the Authorization header)
- **Inputs:** `path: packages/apps/src/sw.ts:33`; `path: docker/install/Dockerfile:85`
- **Done when:** #2291 AC met; env vars in the install docs.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/traffic`; `vendor/bin/phpunit tests/Unit/Support/TrafficBudgetTest.php`
- **Parallel with:** none (after F)

### Chunk I: rtc-room-doorbell (#2294)
- **Skill:** api, then workspace, security (a state derived from other users' presence)
- **Inputs:** `path: packages/api/app/Services/Rtc/Signaling/HttpSignalingMailbox.php:188`; `path: packages/api/app/Services/Rtc/Signaling/RtcSignalingPolicy.php:67`; `path: packages/apps/src/lib/rtc/session/poll-cadence.ts:14`
- **Done when:** #2294 AC met; join latency and one-tab idle numbers from the harness in the PR.
- **Verify with:** `php scripts/done-gate.php`; `pnpm --dir packages/apps exec vitest run src/lib/rtc src/presence-core src/docs-core src/meet-core`
- **Parallel with:** J (after B's resolver change), K

### Chunk J: meet-call-push (#2295)
- **Skill:** api, then workspace
- **Inputs:** `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.ts:7`; `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:59`
- **Done when:** #2295 AC met.
- **Verify with:** `php scripts/done-gate.php`; `pnpm --dir packages/apps exec vitest run src/meet-core`
- **Parallel with:** I, K

### Chunk K: push-health (#2296)
- **Skill:** workspace
- **Inputs:** backup polls — `path: packages/apps/src/notes-core/src/use-notes-live-inbound.ts:26`, `path: packages/apps/src/meet-core/src/use-meet-chat-live-inbound.ts:30`
- **Done when:** #2296 AC met; one shared helper replaces the per-app backup interval logic.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/api src/notes-core src/contacts-core src/tasks-core src/calendar-core src/meet-core src/hooks`
- **Parallel with:** I, J (after D)

### Chunk L: contacts-large-pages (#2297)
- **Skill:** workspace, api (projection test)
- **Inputs:** `path: packages/apps/src/lib/jmap-client/contacts/JmapContactsClient.ts:26`; `path: packages/apps/src/calendar-core/src/use-calendar-contact-invitees.ts:35`
- **Done when:** #2297 AC met; 2000 contacts offline in under 60 s in the cold-start scenario; Calendar's invitee hook starts or joins the shared cold download instead of calling `listCards`, and its test "asks the server only without any cache" now expects no `listCards` call.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/jmap-client src/contacts-core src/calendar-core src/lib/offline`; harness cold start
- **Parallel with:** G (after F)

### Chunk M: doorbell-rule (#2298)
- **Skill:** document, testing
- **Inputs:** `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:147`
- **Done when:** #2298 AC met.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/traffic`; `pnpm run check:agent-docs`
- **Parallel with:** none (after I, J, K)

### Chunk H: harness-and-docs (#2292)
- **Skill:** testing, document
- **Inputs:** the spike's `packages/apps/e2e/traffic-budget.spec.ts` and `e2e/helpers/traffic-meter.ts` on `perf/traffic-governor-spike`
- **Done when:** #2292 AC met; Epic #2284 table refreshed from a run on main.
- **Verify with:** `WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs`
- **Parallel with:** none (last)

## Removed since previous revision

None — every heading of the first revision is kept; the doorbell rule was added (2026-11-19). 2026-11-20 (second review): the Calendar invariant drops its "while a Contacts cache exists" exception, the slow lone-room interval is the push-down fallback only, chunk C no longer runs in parallel with A–E, and the Helm item is closed, room push-down cadence is the slow interval, and the Calendar no-cache case is delivered by chunk L (option b).

## Test plan

- [ ] API (chunk B, G): failing feature/unit test first → implement → done gate.
- [ ] Apps: Vitest on every changed hook and lib export; regression tests named in Invariants.
- [ ] Each PR: before/after numbers for the scenarios it touches from the harness, cross-checked with the server log.
- [ ] Chunk E: production-build check of the precache.

## Doc updates (only if user wants)

- `docs/realtime-capacity.md`: per-browser budget, idle cadence, env per install channel, office-IP advice (chunks C, H).
- `docs/architecture/jmap-push.md`: `DocThread`, `RtcRoom`, `MeetCall` types (chunks B, I, J) and the Doorbell pattern section (chunk M).
