# Traffic budget for shared hosting

## Goal

One browser of one user stays inside the per-browser budget in [spec.md](./spec.md) on a shared host: duplicate fetching goes (Calendar reads the Tasks and Contacts caches, Docs threads ride push), polls slow down when nobody works, recovery backs off once per browser, first downloads share one browser-wide pace, and a service-worker governor holds the total to a budget the server announces per install channel. A spike branch (`perf/traffic-governor-spike`) built and measured all of it; each chunk lands that work as its own PR with tests.

## Budget

Draws from the host's per-IP request allowance (the binding limit on shared hosting; one host blocks above 60/min) and from the 5-FPM-children pool in `docs/realtime-capacity.md`. Displaces: a few seconds of latency for a newcomer to a document someone works on alone, and minutes (not seconds) for a full first offline download of a large address book or many documents. Adds no process, connection or table.

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

## Considered

Considered: the existing one-tab model (`jmap-push-hub`, `useSharedInboundSync`) — reused for Calendar instead of a new Calendar-owned Tasks or Contacts sync, because a second sync doubles requests. One combined JMAP `/changes` request for all apps — rejected: push already compares states for every type in one request; the waste was full bootstraps and polls outside push, not separate `/changes` calls. "Active app polls often, others rarely" — folded into idle cadence plus hidden cadence, which already covers background tabs. A server-side 429 limiter — rejected for now: the host's firewall blocks before PHP sees the traffic. Marking bulk requests with a header deep in Docs hydration — rejected in favour of making the existing pacer browser-wide, which needs no plumbing through the collab layer. Calendar downloading contacts itself with pacing — rejected: it duplicates the Contacts app's download; reading the cache and mounting the live sync costs nothing extra. Fixed 2 s offline poll with jitter — rejected: a host that blocks needs exponential backoff, not spread.

## Affected packages

- packages/apps
- packages/api
- docs

## Dependencies

1. Chunk E (loops) and chunk A (Calendar) first: smallest diffs, the host's named paths.
2. Chunk B (DocThread push) needs nothing; chunk C (idle cadence) and chunk D (recovery) are independent.
3. Chunk F (browser-wide pacing) before chunk G (governor) so the governor's bulk class has a client-side twin.
4. Chunk H (harness + docs) last; it measures everything and writes the final numbers.

## Open decisions

- [ ] Chunk G: the Helm chart is not in this repository (no `Chart.yaml` found). To verify: where it lives, and that it sets `WGW_INSTALL_CHANNEL=docker` or `WGW_TRAFFIC_PROFILE=standard`. Chunk G's env work in this repo does not wait on it.

## Invariants

- Calendar never sends a full Tasks bootstrap when a Tasks cache exists, and focus/reconnect send none. A wrong change brings back the host's named `tasks/items` burst. Proof: `path: packages/apps/src/calendar-core/src/use-calendar-task-due-overlay.test.tsx` assertions "paints the cache and sends no full load when there is one", "loads Tasks once without a cache, and showing the tab again reloads nothing".
- Calendar never calls `listCards` while a Contacts cache exists. A wrong change re-downloads the address book per keystroke pause. Proof: `path: packages/apps/src/calendar-core/src/use-calendar-contact-invitees.test.tsx` "refresh re-reads the cache the live sync keeps current, without a download".
- A thread write in a pool the user cannot reach does not change that user's `DocThread` state (no cross-tenant signal). Proof: `path: packages/api/tests/Feature/Jmap/JmapPushDocThreadStateTest.php` (added in chunk B).
- With push down, Docs threads still arrive (poll resumes). Proof: `path: packages/apps/src/docs-core/src/collab/use-docs-threads-source.test.tsx` (chunk B).
- Active users keep today's cadence; only idle or long-alone states slow down. Proof: `path: packages/apps/src/lib/rtc/session/poll-cadence.test.ts` (chunk C).
- A refusing server gets at most 5 probes in 20 s from one browser. Proof: `path: packages/apps/src/hooks/use-connectivity.test.tsx` "waits longer after each failed probe instead of probing every 2 s".
- New channel objects with the same rooms do not restart the Meet room-status poll. Proof: `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.hook.test.tsx`.
- Two tabs sharing the pacer go no faster than one. Proof: `path: packages/apps/src/lib/offline/core/background-sync-pacer.test.ts` "two tabs drawing from one schedule go no faster than one".
- The governor never delays a write or a foreground read, and 0 turns pacing off. Proof: `path: packages/apps/src/lib/traffic/request-governor.test.ts` "brakes background requests after a 503 and lets writes and reads through", "takes the server's budget from the header, and 0 turns pacing off".
- Docker installs get the standard profile, zip installs shared; env overrides are clamped. Proof: `path: packages/api/tests/Unit/Support/TrafficBudgetTest.php`.
- After each chunk, main works without the next one (every chunk is independent of the governor). Proof: `cmd: pnpm --dir packages/apps exec vitest run` and `cmd: composer --working-dir packages/api done-gate` per PR.

## Chunks

### Chunk A: calendar-shared-caches (#2285)
- **Skill:** workspace
- **Inputs:** overlay and invitee behaviour above — `path: packages/apps/src/calendar-core/src/use-calendar-task-due-overlay.ts:78`, `path: packages/apps/src/calendar-core/src/use-calendar-contact-invitees.ts:19`; live inbound hooks — `path: packages/apps/src/tasks-core/src/use-tasks-live-inbound.ts:103`
- **Done when:** #2285 AC met; the two live-inbound hooks live under `src/lib` with their tests; no `wgw-boundaries/import-boundaries` warning in calendar-core.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core src/tasks-core src/contacts-core`; `pnpm --dir packages/apps exec eslint src/calendar-core`
- **Parallel with:** B, C, D, E

### Chunk B: docthread-push (#2286)
- **Skill:** api, then workspace
- **Inputs:** `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:147`, `:249`; `path: packages/apps/src/docs-core/src/collab/use-docs-threads-source.ts:165`
- **Done when:** #2286 AC met; OpenAPI lists `DocThread`; `docs/architecture/jmap-push.md` updated.
- **Verify with:** `composer --working-dir packages/api done-gate` (or `php scripts/done-gate.php` locally); `pnpm --dir packages/apps exec vitest run src/docs-core`
- **Parallel with:** A, C, D, E

### Chunk C: idle-cadence (#2287)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/lib/jmap-client/push/event-source-transport.ts:28`; `path: packages/apps/src/lib/rtc/session/poll-cadence.ts:14`
- **Done when:** #2287 AC met; cadence table in `docs/realtime-capacity.md` has idle and long-alone rows.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/rtc src/lib/jmap-client src/presence-core src/calendar-core`
- **Parallel with:** A, B, D, E

### Chunk D: calm-recovery (#2288)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/lib/offline/core/browser-online.ts:29`
- **Done when:** #2288 AC met.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/hooks src/calendar-core src/tasks-core src/meet-core`
- **Parallel with:** A, B, C, E

### Chunk E: request-loops (#2289)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/meet-core/src/use-meet-channel-call-activity.ts:127`; `path: packages/apps/src/sw.ts:33`
- **Done when:** #2289 AC met, including the production-build check (no icon request on app switch).
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/meet-core`; production preview on :4190, Network panel while switching apps
- **Parallel with:** A, B, C, D

### Chunk F: browser-wide-pacing (#2290)
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/lib/offline/core/background-sync-pacer.ts:14`
- **Done when:** #2290 AC met; cold start measured with the harness.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline src/contacts-core`
- **Parallel with:** A–E

### Chunk G: sw-governor (#2291)
- **Skill:** workspace, api, security (cache/limiter key derived from the request: coalesce key includes the Authorization header)
- **Inputs:** `path: packages/apps/src/sw.ts:33`; `path: docker/install/Dockerfile:85`
- **Done when:** #2291 AC met; env vars in the install docs.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/traffic`; `vendor/bin/phpunit tests/Unit/Support/TrafficBudgetTest.php`
- **Parallel with:** none (after F)

### Chunk H: harness-and-docs (#2292)
- **Skill:** testing, document
- **Inputs:** the spike's `packages/apps/e2e/traffic-budget.spec.ts` and `e2e/helpers/traffic-meter.ts` on `perf/traffic-governor-spike`
- **Done when:** #2292 AC met; Epic #2284 table refreshed from a run on main.
- **Verify with:** `WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs`
- **Parallel with:** none (last)

## Test plan

- [ ] API (chunk B, G): failing feature/unit test first → implement → done gate.
- [ ] Apps: Vitest on every changed hook and lib export; regression tests named in Invariants.
- [ ] Each PR: before/after numbers for the scenarios it touches from the harness, cross-checked with the server log.
- [ ] Chunk E: production-build check of the precache.

## Doc updates (only if user wants)

- `docs/realtime-capacity.md`: per-browser budget, idle cadence, env per install channel, office-IP advice (chunks C, H).
- `docs/architecture/jmap-push.md`: `DocThread` type (chunk B).
