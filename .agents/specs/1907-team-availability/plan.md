# Team availability

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `82bd51d` (2026-11-04), the same commit as spec.md. API paths are relative to `packages/api/`, app paths to `packages/apps/src/`.

## Goal

Teammates see each other's busy times in the Calendar sidebar and next to invitees in the event editor. The server computes busy periods on request from each user's own and Team calendars, under the Team rule and the owner's settings. Owners decide per calendar whether it counts and whether titles show.

## Budget

- **Draws from:** the Calendar slice of the Pioneer programme milestone, where #1614 sits today.
- **Displaces:** nothing extra. #1614 moves under this Epic and uses its API instead of building its own endpoint. Goal Product#43 was cut to P3 for beta on 2026-08-21; taking this on moves it ahead of that decision (Goal Adopted 2026-11-04).

## Non-goals

See spec.md, Non-goals.

## What exists

**Teams**

- "Team" is a Sabre group principal; membership is `groupmembers`. `path: app/Services/Admin/AdminConstants.php:9`, `path: app/Services/Drive/DriveGroupResolver.php:14`, `path: app/Services/Settings/GroupMembershipResolver.php:14`
- Personal and group instances come from two private helpers. `personalInstances` filters only principal and kind (no `access` filter); `groupInstances` calls `ensureForGroupPrincipal`, which inserts missing Team collections. Neither fits a read-only calculator as-is. The `ACCESS_SHAREDOWNER` constant is how the codebase names owner access elsewhere. `path: app/Services/Calendars/CalendarCollectionAccess.php:301`, `path: app/Services/Calendars/CalendarCollectionAccess.php:315`, `path: app/Dav/Server/WgwCalendarBackend.php:167`
- Teams visibility (#1915) adds `TeamColleagues::sharesTeamIgnoringAdminRole` in #1917, the one check for presence and free/busy. Its spec is not on main yet; see [#1917](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1917).

**Calendar storage and reads**

- Collection kinds live in `calendar_collection_meta`. `path: app/Services/Calendars/CollectionKind.php:16`
- The event query narrows objects by Sabre's `firstoccurence` / `lastoccurence` in `candidateObjects`, which loads full rows with `->get()`. Its only caller is `CalendarEventRepository::query()`. `path: app/Services/Calendars/CalendarEventRepository.php:102`. `path: app/Services/Calendars/CalendarEventQuerySupport.php:89`, `path: app/Services/Calendars/CalendarEventQuerySupport.php:101`
- The default cache store is `file`. `path: config/cache.php:20`
- Recurrence expansion within a window, overrides included. `path: app/Services/Calendars/CalendarEventExpansionService.php:36`. Oversized recurrences are skipped on the query path. `path: app/Services/Calendars/CalendarEventRepository.php:54`
- Size guard for stored ICS. `path: app/Services/VObject/VObjectPayloadGuard.php:22`
- Owner addresses for matching `ATTENDEE`. `path: app/Services/Calendars/CalendarPrincipalAddresses.php:23`
- Invites to instance users land straight in the attendee's calendar, so an invite is also in the attendee's own busy time. `path: app/Services/Calendars/CalendarSchedulingService.php:363`
- Published feeds redact on the fly with `BUSY_KEEP`, keep `UID`, and set `SUMMARY` to "Busy". `path: app/Services/Calendars/CalendarFeedIcsBuilder.php:21`, `path: app/Services/Calendars/CalendarFeedIcsBuilder.php:117`

**Push and polling**

- Calendar push state is one part per accessible instance with its synctoken, so every extra shared calendar grows it and every write by its owner changes it. `path: app/Services/Calendars/CalendarRepository.php:545`
- The scheduler is a `schedule:run` loop with `sleep 60`; there is no queue worker. `path: ../../docker/install/docker-compose.release.yml:85`

**CalDAV free/busy**

- `DAVACL\Plugin` and `CalDAV\Schedule\Plugin` are registered. `path: app/Dav/SabreServerFactory.php:120`, `path: app/Dav/SabreServerFactory.php:127`
- The outbox free/busy path checks `schedule-query-freebusy` on the target's inbox ([`Schedule/Plugin.php`](https://github.com/sabre-io/dav/blob/4.7.1/lib/CalDAV/Schedule/Plugin.php#L873)), and `Inbox::getACL` grants `schedule-deliver`, which includes it, to `{DAV:}authenticated` ([`Schedule/Inbox.php`](https://github.com/sabre-io/dav/blob/4.7.1/lib/CalDAV/Schedule/Inbox.php#L157)). Sabre also grants `read-free-busy` on every calendar ([`Calendar.php`](https://github.com/sabre-io/dav/blob/4.7.1/lib/CalDAV/Calendar.php#L272)). All links are sabre/dav 4.7.1, the version in `composer.lock`. Nothing in `app/` restricts either (`cmd: git grep -n -e read-free-busy -e schedule-query-freebusy -- packages/api/app` finds nothing). So on main today any authenticated user can read any other user's free/busy through an outbox VFREEBUSY request, with no Team check. This is current behaviour, not something this Epic adds.

**API surface**

- Vendor JMAP capabilities exist (`urn:wgw:jmap:chat`). `path: app/Services/Jmap/JmapCapabilities.php:51`, `path: app/Services/Jmap/Capabilities/ChatCapabilityProvider.php:10`
- REST calendar routes exist for subscriptions and feeds. `path: routes/api.php:238`, `path: routes/api.php:246`

**Web app**

- `loadRange` fetches events of every calendar for the visible range, ticked or not. `path: lib/jmap-client/adapter/JmapEventsAdapter.ts:91`
- Background poll every 10 s. `path: calendar-core/src/calendar-refresh.ts:6`
- Free/busy is Busy or Free only; anything else maps to Busy. `path: calendar-core/src/calendar-alerts.ts:50`. Every new event defaults to Busy. `path: calendar-core/src/calendar-alerts.ts:7`, `path: calendar-core/src/calendar-editor-model.ts:143`, `path: calendar-core/src/calendar-event-form-show-as.tsx:51`
- Sidebar sections and partitioning. `path: calendar-core/src/calendar-workspace.tsx:885`, `path: calendar-core/src/calendar-sidebar-order.ts:64`. Rows: `path: collection-sidebar/src/collection-sidebar-row.tsx:94`. Hidden state: `path: collection-sidebar/src/collection-hidden-ids.ts:17`
- Writes onto non-writable calendars are blocked. `path: calendar-core/src/calendar-events-api.ts:85`
- The invitee list renders an RSVP tag per participant. `path: calendar-core/src/calendar-invitees-card.tsx:80`, `path: calendar-core/src/calendar-invitees-card.tsx:117`
- Shared notice bar for things to settle, used by Tasks for writes parked after access changed; every notice has an action today. `path: notice-bar/src/notice-bar.tsx:8`, `path: rescue-ui/rescue-notice.ts:10`
- Offline calendars domain tables. `path: lib/offline/calendars/calendars-schema.ts:3`. A last-synced time precedent. `path: lib/offline/docs-listing-offline-store.ts:21`
- Avatars. `path: user-avatar/src/user-avatar.tsx:118`. Settings calendar pane schema. `path: settings-core/src/settings-calendar-form-schema.ts:22`

**Issues**

- #1614 (open, Pioneer programme) asks for busy information in the attendee section with the same Team rule. Excerpt from `gh issue view 1614`:
  > The caller gets busy periods only for users who share at least one Team with them

## Considered

- **Materialized projection** (one read-only "availability calendar" per user, shared with their Teams, fed from the change log): the first design, filed 2026-11-04. **Dropped** after the external review the same day:
  - every viewer's push state grows by one part per teammate, and every write by any teammate changes it (`CalendarRepository.php:545`)
  - `loadRange` would pull every teammate's events even when unticked
  - it needs a new collection kind, share sync on Team changes (removal emits nothing today), an opaque UID mapping, a change-log cursor, catch-up triggers with locks, and owner write refusal (`assertCollectionWritable` only checks share access)
  - the scheduler is a `sleep 60` loop with no queue, so freshness was "about a minute" and hard to test
  - #1614 and #1914 need a range query anyway
- **Chosen: computed on request** through one vendor JMAP method. Nothing is copied. Access is checked per request, so Team removal and the switch apply at once. The client only fetches ticked people and the visible range, so any range (also next year) works online. The cost is a small client cache for offline and a virtual-calendar layer in the grid.
- **Standard JMAP `Principal/getAvailability`**: not now. The codebase has no `Principal` type, and #1915 is reshaping who can see whom. The vendor period shape stays close to the standard `BusyPeriod`.
- **CalDAV VFREEBUSY outbox** (`Schedule\Plugin`): no web rendering path; #1923 only gates it.
- **Reusing the feed redactor**: rejected. It keeps `UID`, hardcodes `SUMMARY:Busy`, and its full mode is a denylist. The calculator builds periods from a fixed list of fields instead, and the feed stays untouched.
- **Settings on JMAP `Calendar`** (`includeInAvailability`, a vendor detail property): rejected. A side table is invisible to `/changes`, so other devices would show stale values, and it would touch OpenAPI `calendar.json`, three client mappers and the Dexie calendar rows. One REST resource read fresh by the settings pane avoids all of that. REST already hosts per-calendar sharing settings (feeds).
- **Settings device-local like #981**: rejected. These decide what others may see, so the server must own them.
- **A "Tentative" state**: dropped. WGW stores Busy or Free only (`calendar-alerts.ts:50`).
- **A day strip in the event editor** (#1614's first idea): replaced by one Free/Busy tag next to the RSVP tag, at the product owner's request (2026-11-04). The grid is where to look around.
- **Team calendars by participation, or narrowed by invite list**: rejected by the product owner, 2026-11-04. Every Team calendar event counts for the whole Team.
- **Team calendars time-only**: kept. Team members can read the Team calendar anyway; time-only protects against teammates from *other* Teams of the same user (the cross-Team case).
- **New all-day events default to Free**: kept as decided, 2026-11-04, but as its own Task (#1927) with a hint for time off, instead of hidden in the rendering slice.
- **Review round 2 (2026-11-04), technical choices:**
  - **Cache unredacted, redact after read.** Keying the cache on `excludeUid` would make every invitee-tag request miss; storing redacted output would make exclusion impossible. The cache keeps an internal list with an HMAC of the UID, never the raw UID, for 5 minutes.
  - **Cap the product, not only each dimension.** `ids × weeks ≤ 540` bounds the work; the period cap only bounds the output.
  - **`complete: false` instead of a silent cut.** A skipped recurrence or a cut list must not read as free.
  - **Own `TeamMember/get` state with a per-person `version`.** #1917's Team-set fingerprint misses switch, detail and name changes; a detail downgrade must clear cached titles.
  - **Whole-week runs in one call per batch**, not one call per week and not arbitrary ranges, so cache keys stay canonical and a year view is a few calls.
  - **60-second availability tick.** Availability does not need the 10-second calendar poll.
  - **`excludeEventId` only for events the caller may edit or takes part in.** On a read-only shared calendar, comparing results would reveal whether a teammate has that event.
  - **Offline text in the shared notice bar**, at the product owner's request: one `info` notice instead of lines in the sidebar header and popover. `Notice` gets an optional action for it.
- **Review loop on PR #1932 (2026-11-04):**
  - **Whole UTC weeks only, one cache entry per owner per week.** Arbitrary ranges let a caller mint unlimited keys and full expansions, and a one-week invitee request never hit a multi-week sidebar entry. The cap is 54 weeks because a calendar year in whole UTC weeks is sometimes 54.
  - **Include, dedupe, exclusion and detail after the read**, with the source calendar id cached per occurrence. Detail is per calendar, so the kind alone was not enough, and unchecking must show on the next fetch.
  - **A settings stamp from `updated_at` on both tables** drives `version`; the fingerprint is only source synctokens and the app key.
  - **Fingerprint read before and after the objects**; a changed fingerprint is not stored, so a mid-read write is never cached as free.
  - **A dedicated cache store with an hourly prune**, because Laravel's file store deletes an expired file only when that key is read again.
  - **A read-only accessor that never provisions**, because `groupInstances` inserts missing Team collections.
  - **Every skipped object sets `complete: false`**, and CalDAV answers as for an unknown address when incomplete, never with a partial VFREEBUSY.
  - **Switch off covers the owner's own preview.**
  - **Ids are usernames** across the API, cache, virtual calendars and invitee matching.
- **Server-side clash check for #1914**: no longer needed. `excludeEventId` lets the client ask the same API without its own invite copy counting.

## Affected packages

- packages/api
- packages/apps
- docs (`docs/architecture/calendar-availability.md`)

## Dependencies

1. Filed 2026-11-04: Epic #1907 under Product#43; Tasks #1908 (A), #1909 (B), #1910 (C), #1911 (D), #1912 (E), #1913 (F), #1927 (G); #1614 (H) moved under the Epic; follow-up #1914. Re-scoped the same day for the computed-on-request design.
2. #1917 (`sharesTeamIgnoringAdminRole`) before B. If B is ready first, B adds that one method to the resolver from #1917's spec and #1917 adopts it.
3. CalDAV free/busy is open to every authenticated user on main today (What exists, CalDAV free/busy). #1923 closes that with the Team rule and should land ahead of this Epic, not ride along with it; that ordering belongs to the Teams visibility Epic. B then adds the switch to the same `WgwSchedulePlugin` (or adds the subclass, if B is first). E (#1912) does not merge before both hold, because its switch promises that nobody sees anything while it is off.
4. A → B. B lands OpenAPI and the mock JMAP methods first; then C, D, E and H run in parallel against the mock tier. G has no dependency.
5. F with or after B. The architecture doc names Epic #1907, so `check-architecture-spec` needs this spec on main first; the spec lands with A.
6. #1914 after C (it uses the client and cache).
7. V last.

## Open decisions

None — every choice is made.

Decided:

- Computed on request instead of a projected calendar (option B). Confirmed by the product owner, 2026-11-04, on the condition that any range, also next year, is fetched online.
- Invitee list shows Free/Busy next to the RSVP status; #1614 moves under this Epic. Visible UI is reviewed together. Product owner, 2026-11-04.
- Team calendar events count for the whole Team, always, time only. "Show as: Free" opts out; each member can uncheck a Team calendar. 2026-11-04.
- New all-day events default to "Show as: Free" and stay editable. 2026-11-04.
- Privacy first: the switch is off by default; when on, every own personal and Team calendar starts checked, time only. 2026-11-04.
- Admins get no extra availability visibility. 2026-11-04.
- Subscriptions never count. "Details" is title and location only. 2026-11-04.
- Offline: cache what was fetched, prefetch the current week plus 4 weeks for ticked teammates, show "Offline · updated …". 2026-11-04.
- The offline clash notice is #1914, not built here. 2026-11-04.
- Offline: "updated …" stamp plus a hint when a visible week was never fetched, shown as one notice in the shared notice bar. Invitee tags offline: nothing. 2026-11-04 (review round 2).
- Projects (#810): a member joins a Project in the UI; joining is not access (Teams are) but it is the switch that makes that Project's calendar count toward their availability. Until Projects land, every Team event calendar counts by default. 2026-11-04 (review round 2).
- One detail level per calendar for every Team, not per Team. 2026-11-04.
- CalDAV free/busy follows the same switch. With the switch off by default, external CalDAV clients (Apple Calendar, Thunderbird) stop getting free/busy for a colleague when they add them as attendee, until that colleague opts in. Today they get an answer for everyone. Accepted as a deliberate change to interop for one privacy rule everywhere. Product owner, 2026-11-04 (PR review round 2).

## Invariants

- **Published feeds do not change.** This work does not touch the feed builder. Proof: `path: tests/Feature/Calendars/CalendarsIcsWebcalPublishTest.php` assertions `test_busy_mode_hides_every_event_and_ignores_a_query_mode`, `test_private_and_confidential_events_become_busy_placeholders`.
- **`CalendarEvent/query` is unchanged** after `candidateObjects` gains its opt-in column list and lazy iteration (A). Proof: `path: tests/Feature/Jmap/JmapCalendarMethodsTest.php` assertions `test_calendar_event_query_time_range_title_sort_and_recurrence`, `test_calendar_event_query_multi_vevent_isolation_and_after_without_before`.
- **Calendar push state keeps its shape.** No new collection joins the VEVENT set. Proof: `path: tests/Feature/Jmap/JmapEventSourceTest.php` assertion `test_first_request_sends_every_type_with_an_id_and_retry`.
- **Read-only sharees still cannot write.** Proof: `path: tests/Feature/Calendars/CalendarsShareWithTest.php` assertion `test_sharee_cannot_change_owner_fields_on_a_shared_calendar`.
- **Sidebar sections stay intact** (C). Virtual availability calendars never land in My calendars or Shared with me. Proof: `path: calendar-core/src/calendar-sidebar-order.test.ts` assertion `unifies owned, team, and subscription calendars A–Z and keeps ACL sharees out`.
- **Hidden-by-default keeps the user's choice** (C). Proof: `path: calendar-core/src/use-calendar-hidden-ids.test.tsx` assertion `keeps a server-default-hidden calendar visible after the user un-hides it`.
- **Main still works after A without B, and after B without the UI.** The calculator and the API have no caller until the client lands. Proof: `cmd: pnpm test:api-done-gate`, `cmd: pnpm test:apps-done-gate`.

## Chunks

### Chunk A: Availability calculator and settings storage

- **id:** `chunk-a-availability-calculator`
- **Issue:** #1908
- **Skill:** api, security
- **Inputs:**
  - Range narrowing. `path: app/Services/Calendars/CalendarEventQuerySupport.php:101`
  - Expansion. `path: app/Services/Calendars/CalendarEventExpansionService.php:36`
  - Owner addresses. `path: app/Services/Calendars/CalendarPrincipalAddresses.php:23`
  - Group calendars. `path: app/Services/Calendars/CalendarCollectionAccess.php:315`
  - Size guard. `path: app/Services/VObject/VObjectPayloadGuard.php:22`
  - Range query and its only caller. `path: app/Services/Calendars/CalendarEventQuerySupport.php:89`, `path: app/Services/Calendars/CalendarEventRepository.php:102`
  - Instance lists are private today; add one public accessor. `path: app/Services/Calendars/CalendarCollectionAccess.php:301`
- **Builds:**
  - migrations for `calendar_availability_owners` and `calendar_availability_prefs` (keyed on `calendarid`), schema parity test updated, cleanup on calendar delete
  - `AvailabilitySettings` (read and write the switch and per-calendar prefs; list own personal and Team event calendars)
  - `updated_at` on `calendar_availability_prefs`, set on every include or detail write; the settings stamp
  - `AvailabilityCalculator::busyPeriods(owner, weekStarts, excludeUid?)` per spec.md, Calculator: sources, filters, expansion, dedupe, period building, bounds, `complete` per week
  - an opt-in column list and lazy iteration on `candidateObjects`; the current caller unchanged
  - a read-only public accessor on `CalendarCollectionAccess` that selects existing personal (`ACCESS_SHAREDOWNER` under `principals/{owner}`, no subscription) and Team instances, without any provisioner
  - fingerprint (source synctokens and an app-key identifier), read before and after the objects
  - a dedicated `availability` cache store: one 5-minute entry per `(owner, weekStart, fingerprint)` with the unredacted occurrences (source calendar id, kind, private flag, title, location, UID HMAC) and the week's `complete`; include, dedupe, exclusion, detail and field list applied after the merge
  - `wgw:availability:prune-cache`, hourly, deleting expired files in that store
  - slow-call log
- **Done when:**
  - Feature tests prove:
    - nothing for a user with the switch off
    - personal and Team sources; subscriptions, shared-in calendars and non-event kinds never count; an unchecked calendar never counts
    - "Show as: Free" never counts, for a series and for one occurrence; a free series with one busy occurrence gives only that occurrence
    - cancelled events skipped; declined skipped on personal sources only; a declined Team event still counts
    - overrides moved out of the range or into it are handled (no orphans)
    - the same UID in a personal and a Team source counts once, time only
    - `excludeUid` drops that event
    - busy vs details fields; `CLASS:PRIVATE` time only; a URL location dropped; no UID or other field in the output
    - a cut at 2000 periods, a skipped oversized recurrence, an object over the size limit and an unparseable object each give `complete: false`
    - two calls with different `excludeUid` share one cache entry; a one-week call and a multi-week call share the week's entry; no raw UID is stored in the cache
    - a cache hit after an incomplete first run still says `complete: false`; a changed app key misses the cache
    - two personal calendars, one `details` and one `busy`: only the first gives titles; the same UID on both gives the stricter copy
    - unchecking a calendar removes its periods on the next call, without waiting for the TTL
    - a write between the two fingerprint reads is returned but not cached
    - a busy-period read inserts no `calendarinstances` rows (no provisioning)
    - the prune command removes expired entries that are never read again and keeps live ones
    - a Team calendar is never classified as personal (decline does not free, `details` never applies)
    - a write through plain `CalPDO` shows on the next call (fingerprint miss)
    - floating and all-day events keep wall-clock time
  - The feed and `CalendarEvent/query` invariants stay green.
- **Verify with:** `cmd: pnpm test:api-done-gate`
- **Parallel with:** G

### Chunk B: JMAP and REST contract

- **id:** `chunk-b-availability-contract`
- **Issue:** #1909
- **Skill:** api, security
- **Inputs:**
  - Vendor capability pattern. `path: app/Services/Jmap/Capabilities/ChatCapabilityProvider.php:10`, `path: app/Services/Jmap/JmapCapabilities.php:51`
  - REST calendar routes. `path: routes/api.php:238`
  - `sharesTeamIgnoringAdminRole` from #1917. Epic #1915, Chunk B (#1917)
- **Builds:**
  - OpenAPI first: capability `urn:wgw:jmap:availability`, `TeamMember/get`, `TeamMember/getAvailability`, `GET|PUT /calendars/availability`
  - the access rule per spec.md, Who may see whom, with one `notFound` for every refusal
  - `excludeEventId` resolved only from events the caller may edit, or where the caller is the organizer or an attendee; anything else is `invalidArguments`
  - week-aligned ranges enforced before any read
  - CalDAV: switch and completeness checks in `WgwSchedulePlugin::getFreeBusyForEmail`
  - REST settings controller with 422 validation
  - mock JMAP server methods and fixtures for the web app
- **Done when:**
  - Feature tests prove:
    - same Team → listed and readable
    - no shared Team → `notFound`, also for an instance admin
    - switch off, disabled user, unknown id → the same `notFound`
    - removed from the Team → `notFound` on the next request
    - `TeamMember/get` state and the person's `version` change on a membership, switch, detail or name change
    - `excludeEventId` of an event the caller only reads on a read-only shared calendar → `invalidArguments`; own, editable and attended events work
    - limits: 50 ids, 54 weeks, 540 person-weeks; a `utcStart` that is not Monday 00:00 UTC, or a length that is not whole weeks, is `invalidArguments`
    - the caller's own id with the switch off is in `notFound`; ids are usernames
    - the settings route is declared next to `calendars/subscriptions`, above the feed routes
    - CalDAV outbox VFREEBUSY for a target with the switch off answers as for an unknown address (`3.7`); with the switch on it returns the calculator's periods without titles, clipped to the requested window; an incomplete result or a window over 54 weeks also answers `3.7`
    - REST: defaults, round trip, 422 for details on a Team calendar and for foreign calendars, choices kept while off
  - OpenAPI contract test is green; `pnpm run check:api-types` is green.
- **Verify with:** `cmd: pnpm test:api-done-gate`
- **Parallel with:** none. C, D, E and H start once B's OpenAPI and mock commit is on the branch.

### Chunk C: Client, cache and sidebar section

- **id:** `chunk-c-availability-sidebar`
- **Issue:** #1910
- **Skill:** workspace, apps-ui, client-transport, accessibility
- **Inputs:**
  - Sidebar. `path: calendar-core/src/calendar-workspace.tsx:885`, `path: calendar-core/src/calendar-sidebar-order.ts:64`
  - Hidden state. `path: collection-sidebar/src/collection-hidden-ids.ts:17`
  - Poll tick. `path: calendar-core/src/calendar-refresh.ts:6`
  - Offline tables. `path: lib/offline/calendars/calendars-schema.ts:3`
  - Avatar. `path: user-avatar/src/user-avatar.tsx:118`
- **Builds:**
  - `lib/jmap-client/availability/` client
  - `calendars_availability` cache (per person per UTC week, `fetchedAt`) and the cached teammates list, in a new schema version
  - whole-UTC-week runs of at most 54 weeks, one call per batch within 540 person-weeks; a person's `complete: false` written to every week of the run
  - fetch at once on range change; a 60-second availability tick for the state check, the visible range and the prefetch (current week + 4 weeks); the 10-second calendar tick is untouched
  - drop a person's cached weeks when their `version` changes or they leave the list; evict weeks older than 30 days outside the prefetch window, at most 60 per person
  - virtual read-only calendars `availability:{username}` feeding the grid; cache keyed `[username+weekStart]`
  - **Team availability** section in `calendar-availability-sidebar.tsx`: own row first, avatar rows, hidden by default, collapsible, filter above 8 rows
  - Calendar hosts the shared `NoticeBar`; one `info` notice while offline with ticked teammates ("updated …" stamp, plus the uncached-weeks sentence when it applies); `Notice` action made optional with a test
  - row marker for `complete: false`
  - no growth of `calendar-workspace.tsx` or `use-calendar-controller.ts`
- **Done when:**
  - Vitest covers: only ticked people fetched; a jump to next year fetches that range in one call per batch; a 54-week year is one run that the server accepts; a period across Monday 00:00 UTC is stored under both weeks and still shows busy offline in the second week; batching under the budget; prefetch window on the 60-second tick; a `version` change clears that person's weeks; eviction; the offline notice with and without the uncached sentence; the incomplete marker; partitioning never puts a virtual calendar in other sections; hidden by default.
  - Storybook mock-tier story with 3 and 12 teammates and an offline state; accessibility checks pass (checkbox labels "Show/Hide {name}'s availability").
  - Screenshots reviewed with the product owner before merge.
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** `chunk-d-availability-render`, `chunk-e-availability-settings`, `chunk-h-invitee-availability`

### Chunk D: Busy rendering and popover

- **id:** `chunk-d-availability-render`
- **Issue:** #1911
- **Skill:** apps-ui, workspace
- **Inputs:**
  - Event card variant precedent: the reflected `rsvp` property (dashed and tinted for needs-action and tentative). `path: lib/calendar-elements/EventCard/EventCard.ts:72`
  - Write block. `path: calendar-core/src/calendar-events-api.ts:85`
- **Builds:**
  - "Busy" label for periods without a title, in day, week, month and year views
  - read-only popover in `calendar-availability-popover.tsx`: person, time, title and location when present
  - all-day periods cover their dates in the viewer's time zone
  - no growth of `calendar-workspace.tsx` or `use-calendar-controller.ts`
  - drag, resize and create blocked on virtual calendars
- **Done when:** Vitest covers the label, the popover content with and without details, and the write block. Storybook shows week and month views with time-only and details people. Screenshots reviewed with the product owner before merge.
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** `chunk-c-availability-sidebar`, `chunk-e-availability-settings`, `chunk-h-invitee-availability`

### Chunk E: Owner settings

- **id:** `chunk-e-availability-settings`
- **Issue:** #1912
- **Skill:** apps-ui, workspace, client-transport
- **Inputs:**
  - Settings calendar pane. `path: settings-core/src/settings-calendar-form-schema.ts:22`
  - Online-only pattern for share changes. `path: lib/offline/calendars-hybrid-operations.ts:280`
- **Builds:**
  - REST client for `/calendars/availability` with typed errors
  - Availability section in `settings-calendar-availability-section.tsx` per spec.md, Owner settings, including both hints and the footer line
  - save, then `notifySettingsSliceSaved`; offline error toast
- **Done when:** Vitest covers row defaults, the disabled select, the fixed "Time only" on Team rows, the save mapping and the offline rejection. Storybook covers switch off, on with 0 Teams, and on with 2 Teams and 3 calendars, one unchecked. Screenshots reviewed with the product owner before merge.
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** `chunk-c-availability-sidebar`, `chunk-d-availability-render`, `chunk-h-invitee-availability`

### Chunk F: Architecture doc

- **id:** `chunk-f-availability-docs`
- **Issue:** #1913
- **Skill:** document
- **Inputs:** this spec; the existing doc set. `path: ../../docs/architecture/jmap-push.md:1`
- **Builds:** `docs/architecture/calendar-availability.md`: the calculator, the access rule, the period fields, settings, the cache (unredacted, HMAC UIDs, 5 minutes, file store at rest), the `excludeEventId` rule, why the cache is viewer-independent (per-Team detail would break that), and why there is no projection.
- **Done when:** `pnpm run check:agent-docs` is green, including `check-architecture-spec`.
- **Verify with:** `cmd: pnpm run check:agent-docs`
- **Parallel with:** C, D, E, H

### Chunk G: All-day events default to Free

- **id:** `chunk-g-allday-free-default`
- **Issue:** #1927
- **Skill:** apps-ui
- **Inputs:** `path: calendar-core/src/calendar-alerts.ts:7`, `path: calendar-core/src/calendar-editor-model.ts:143`, `path: calendar-core/src/calendar-event-form-show-as.tsx:51`
- **Builds:** the all-day Free default, the default following the all-day toggle until the author touches "Show as", and the time-off hint when an all-day event is Free.
- **Done when:** Vitest covers the new all-day default, the timed default, the toggle, a manual choice surviving the toggle, the hint, and an existing event keeping its stored value. Screenshots reviewed with the product owner before merge.
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** A–F, H

### Chunk H: Availability next to invitees

- **id:** `chunk-h-invitee-availability`
- **Issue:** #1614
- **Skill:** apps-ui, workspace, client-transport
- **Inputs:** `path: calendar-core/src/calendar-invitees-card.tsx:80`, `path: calendar-core/src/calendar-invitees-card.tsx:117`; C's client (or B's mock until C lands)
- **Builds:**
  - Free/Busy tag next to the RSVP tag for invitees who are teammates sharing availability, for the event's own time (occurrence being edited, or first occurrence of a new series)
  - `excludeEventId` for saved events; requests snap to the containing UTC week(s) to share the server cache; answers are not written to the client cache
  - debounced refresh on time, all-day and invitee changes
  - no tag when the invitee's result is `complete: false`; a busy all-day period on a date the event touches means "Busy"
  - no growth of `calendar-workspace.tsx` or `use-calendar-controller.ts`
  - "Busy" tooltip with overlapping times (and titles when shared)
  - offline: no tags and no text; never blocks saving
- **Done when:** Vitest covers free, busy, no tag for non-teammates, external guests and incomplete results, all-day busy, `excludeEventId` on edit, week snapping, the debounce, and offline. Storybook shows the invitee card with mixed tags. Screenshots reviewed with the product owner before merge.
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** `chunk-c-availability-sidebar`, `chunk-d-availability-render`, `chunk-e-availability-settings`

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-availability-verify`
- Read-only verifier subagent with the prompt from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md).
- **Done when:** the verifier returns `PASS` or `PASS_WITH_NITS`, the parent ran [done-checklist](../../skills/developer/done-checklist.md), and an own browser e2e passes with two users in one Team:
  - A turns the switch on and creates an event; B ticks A and sees "Busy"
  - **Reload:** B reloads the calendar; A is still ticked and the block is still shown
  - B jumps to a month next year; A's event there shows
  - A switches the calendar to details; B sees the title
  - B invites A to a new event at that time; the invitee list shows A as "Busy"; moved to a free slot it shows "Free"
  - **Second tab, same account:** B has two calendar tabs open. A switches details back to time only. Both tabs drop A's titles on the next availability tick, also in weeks B opened before. **Do not drop this step** if the run is trimmed: it is the only end-to-end proof that a `version` change clears cached titles.
  - **Offline:** B views A's next weeks and goes offline. A adds an event. B still sees the old blocks, and the notice shows the "updated …" stamp. Moving to a week never fetched adds "Some weeks in view are not available offline." Back online, the notice clears and B sees the new block within one availability tick.
  - A is removed from the Team; A disappears for B on the next availability tick

## Test plan

- [ ] API: OpenAPI → failing feature tests (A and B lists above) → implement → `pnpm test:api-done-gate`
- [ ] Security review of A and B with [security](../../skills/security/SKILL.md): field list of periods, access rule (admins included), `excludeEventId` probing, Team rule
- [ ] UI: mock-tier Storybook → Vitest → `pnpm test:apps-done-gate`
- [ ] E2E: the two-user run from Chunk V, including a refresh in the middle and a second tab
- [ ] E2E offline: B views A's next weeks, goes offline, A adds an event; B still sees the old blocks and the notice bar shows the "updated …" stamp; scrolling to a week never fetched adds the uncached sentence; back online, the notice goes and B sees the new block within one availability tick

## Removed since previous revision

- **Projection engine and sharing** (old Chunks A and B): replaced on 2026-11-04 by the calculator and the JMAP methods. Reason: see Considered, Materialized projection. Issues #1908 and #1909 were re-scoped, not closed.
- **Busy rendering with Tentative** (old Chunk D): Tentative dropped; the all-day default moved to its own Chunk G (#1927).
- **Chunk G: Offline clash notice**: removed earlier on 2026-11-04 and filed as #1914.

## Doc updates (only if user wants)

- `docs/architecture/calendar-availability.md` (Chunk F)
- `packages/api/docs` JMAP summary: the `urn:wgw:jmap:availability` capability
