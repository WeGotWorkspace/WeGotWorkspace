Source: #1907 (body-hash: 17c4b1b9)
Goal: WeGotWorkspace/Product#43

# Team availability

Each user can share their busy times with everyone who shares a Team with them. Teammates appear in the Calendar sidebar and can be toggled on and off; their busy times render on the grid like a read-only calendar. When you invite a teammate who is busy at that time, their participant tag shows a warning. There is no separate "find a time" UI yet.

Technical translation of Epic #1907 (Tasks #1908–#1913, #1927, #1614; follow-up #1914). Written against `origin/main` at `82bd51d` (2026-11-04); every line reference in plan.md is pinned to the same commit. Revised three times on 2026-11-04, after two external reviews and the PR review loop: busy times are **computed on request**, not copied into a projected calendar (see plan.md, Considered); round 2 settled caching, cost bounds, incomplete results and cache invalidation; the review loop settled whole-week requests, the settings stamp and completeness. Owner settings were simplified on 2026-11-09 after the product owner's screenshot review of #1974.

## Goal

- **Computed on request.** The server works out a person's busy periods for a requested time range when a teammate asks for them. Nothing is copied or stored per viewer. A change in the owner's calendar shows on the teammate's next fetch.
- **One API, three users.** A vendor JMAP capability `urn:wgw:jmap:availability` with `TeamMember/get` (who may I see) and `TeamMember/getAvailability` (busy periods for a range). The sidebar, the invitee list (#1614) and the offline clash follow-up (#1914) all use it.
- **Privacy first.** A master switch, "Share my availability with my Teams", is **off** by default. While it is off, nobody gets anything for that user.
- **Owner settings.** With the switch on, the user sees in Settings → Calendar their own personal event calendars and their Team calendars:
  - **(a) include:** whether the calendar counts. Every calendar starts included.
  - **(b) detail:** for personal calendars, whether teammates see only the time (`busy`, the default) or also the title and location (`details`). Team calendars are always time only.
  - Both choices are one select per calendar: "Do not add", "Time only" or (personal calendars only) "Title and location". Product owner, 2026-11-09.
- ICS subscriptions are never listed and never count.
- **An event in a Team calendar applies to the whole Team.** It counts for every member, whatever the invite list or a member's reply. If it is not for the whole Team, it does not belong on the Team calendar, or it is marked "Show as: Free". Each member can set a Team calendar to "Do not add" for themselves.
- **"Show as: Free" always wins**, in personal and Team calendars, for a series or one occurrence.
- **Calendar sidebar.** A **Team availability** section lists teammates who share with the user. Rows are hidden by default. Ticking one shows that person's busy blocks for whatever range the user is looking at, including months or a year ahead.
- **Invitee list.** In the event editor, an invitee who is a teammate sharing availability and is busy at the event's time gets a warning on their participant tag.
- **Offline.** The client caches what it fetched (per person, per week) and prefetches the current week plus the next 4 weeks for ticked teammates. Offline, cached weeks still paint. One notice in the shared notice bar (the one Tasks uses for offline changes after access changed) states how old the data is, and says when a visible week was never fetched, so empty never passes for free.
- **Never falsely free.** When the server could not work out all of a person's busy time (an event it could not read, a recurrence over the limit, or too many periods), the result says so. The UI then never claims "Free" for that person and range.
- **Project calendars (later, #810).** When Projects land, a member joins a Project in the UI. Joining is not an access rule (Teams are), but it is the switch that makes that Project's calendar count toward the member's availability. Product owner, 2026-11-04.

## Non-goals

- A "find a time" suggestion or a planning grid (later step on Product#43)
- A day strip of busy blocks inside the event editor. The invitee list only warns about a busy teammate at the event's own time; the grid is the place to look around.
- Warning after reconnect about events planned offline that now clash (#1914)
- Sharing availability outside a shared Team, with external guests, or as a public URL
- New availability surfaces over CalDAV. The existing CalDAV outbox free/busy report is brought under this Epic's rules (see API, CalDAV free/busy); nothing else is exposed over CalDAV.
- Per-event privacy UI (Product#42). Events already marked `CLASS:PRIVATE` or `CONFIDENTIAL` are always time only.
- A "Tentative" state. WGW stores Busy or Free only (`freeBusyStatusFromWire`); everything that counts is "Busy".
- Merging overlapping busy blocks into one block
- A Team-level setting for how a Team calendar counts
- One detail level per Team. Detail is per calendar and applies to every Team that can see it. This also keeps the server cache viewer-independent; per-Team detail would need the viewer in the cache key (see #1913).
- Instance-wide admin policy for the feature

## Affected packages

- `packages/api`:
  - availability calculator and settings tables
  - JMAP capability `urn:wgw:jmap:availability`
  - REST settings resource, OpenAPI
  - PHPUnit
- `packages/apps`:
  - JMAP client and Dexie cache for availability
  - Team availability sidebar section and read-only busy rendering
  - availability status in the invitee list
  - Availability section in Settings → Calendar
  - event editor: new all-day events default to "Show as: Free"
  - mock JMAP, Storybook, Vitest
- `docs`: `docs/architecture/calendar-availability.md`

## Technical constraints

### Settings storage

- `calendar_availability_owners(principal_uri PK, enabled, updated_at)`. No row means off.
- `calendar_availability_prefs(principal_uri, calendarid, include, detail, updated_at)`, primary key `(principal_uri, calendarid)`. `updated_at` is set on every include or detail write. `calendarid` is the collection id, not the instance id, so a Team calendar has one row per member. No row means included and `busy`. That covers calendars created later and Teams joined later.
- Choices are kept while the switch is off, so turning it on again restores them. Rows for a deleted calendar are removed with it.
- The **settings stamp** of a person is the latest of `calendar_availability_owners.updated_at` and every `calendar_availability_prefs.updated_at` for that person. Any switch, include or detail change moves it.
- Two migrations, following the `wgw` migration layout, with the schema parity test updated.

### Who may see whom

- A viewer may read a person's availability only if all of these hold:
  - the person has the switch on
  - the person is not disabled
  - they share at least one Team: `TeamColleagues::sharesTeamIgnoringAdminRole` from Teams visibility (#1917). The admin role gives no extra access.
- The caller may read their own availability (preview) without the shared-Team check. The switch and the disabled check still apply: with the switch off, their own id is in `notFound`.
- "Does not exist", "switch off" and "not allowed" all look the same: the id comes back in `notFound`.
- **Ids.** A person's id is their username: the same string as their JMAP `accountId`, not `principals.id` and not `principals/{username}`. `TeamMember/get`, `TeamMember/getAvailability`, the client cache key, the virtual calendar id and the invitee match (`CalendarInvitee.username`) all use that string.
- The check runs on every request. Membership changes and switch changes apply on the next request; nothing has to be revoked.

### Calculator

`AvailabilityCalculator::busyPeriods(owner, weekStarts, excludeUid?)`. It works in whole UTC weeks (Monday 00:00 UTC):

- **Sources.**
  - **Personal:** instances under the owner's own principal `principals/{owner}` with `access = SharingPlugin::ACCESS_SHAREDOWNER`, of kind `EventCalendar`, without `subscriptionId`. The access check is what drops calendars shared with the owner.
  - **Team:** instances under `principals/groups/{slug}` (kind `EventCalendar`) for every Team the owner belongs to. When Projects land (#810), a Project calendar counts only for members who joined that Project; until then every Team event calendar counts by default.
  - **Never:** subscriptions, calendars shared with the owner, chat, docs threads, task lists, notebooks.
  - `include = false` is applied **after** the cache read (see Cost and caching), so unchecking a calendar shows on the next fetch.
  - The two lists come from one new public, **read-only** accessor on `CalendarCollectionAccess`. It never calls a provisioner: today `groupInstances` calls `ensureForGroupPrincipal`, which inserts missing Team collections, and `personalInstances` filters only principal and kind. The accessor therefore selects existing instances itself: personal ones under `principals/{owner}` with `access = SharingPlugin::ACCESS_SHAREDOWNER` and no `subscriptionId`; Team ones under `principals/groups/{slug}` of kind `EventCalendar`. A test pins that a busy-period read inserts no `calendarinstances` rows.
  - The personal/Team classification decides two safety rules (a decline frees only on personal sources; titles show only from personal sources). A test pins that a Team calendar is never classified as personal.
- **Objects.** `calendarobjects` of type VEVENT in the sources, through the existing `candidateObjects` range query (no third range query). `candidateObjects` gets an **opt-in** parameter for a column list and lazy, chunked iteration, so one call never holds every candidate in memory. Its current caller, `CalendarEventRepository::query()`, keeps today's behaviour: no column list, same return type. Objects over `VObjectPayloadGuard::MAX_ICS_BYTES`, or that fail to parse, are skipped and logged, and set `complete: false` for that week.
- **Expansion.** Recurring events are expanded within the range with the existing `CalendarEventExpansionService`, including per-occurrence overrides. A recurrence over the instance limit is skipped and logged, as on the query path, and sets `complete: false` for that week. Because the output is occurrences, overrides never become orphans.
- **What counts as busy**, per occurrence:
  - skip `TRANSP:TRANSPARENT` ("Show as: Free")
  - skip `STATUS:CANCELLED`. This is new logic; the feed builder does not do it.
  - on **personal** sources, skip occurrences where the owner is an `ATTENDEE` with `PARTSTAT=DECLINED`. The owner is matched against `CalendarPrincipalAddresses::addressesForUsername`. A decline from an address the instance does not know for that user is not recognised.
  - on **Team** sources, ignore `ATTENDEE`, `ORGANIZER` and `PARTSTAT`. Declining a Team event does not free a member.
- **Dedupe** by `(UID HMAC, occurrence start)` over the sources that are still included, after the cache read. An invite to a Team event also lands in the attendee's personal calendar (`deliverLocal`). When a Team source has it, the Team rule wins: busy, time only. When two personal copies collide, the stricter one wins: a time-only or private copy is never beaten by a details copy.
- **`excludeUid`** drops every occurrence with that UID (used for the event being edited, so an invitee is not "busy" with this very event). It is applied after the cache read by comparing HMACs.
- **Output is built, not copied.** Redaction runs after the cache read. A period has only:
  - `start` (LocalDateTime), `timeZone` (IANA id or null for floating), `duration`, `showWithoutTime` — the same time fields as a JMAP `CalendarEvent`
  - `title` and `location`, only when the occurrence's own source calendar is personal, that calendar's detail is `details`, and the event is not `CLASS:PRIVATE` / `CONFIDENTIAL`
  - A `location` that is or contains a URL (`scheme://`) is dropped, so meeting links never leak. The title is cut at 200 characters.
  - No UID, id, description, attendees, organizer, alarms, attachments, categories or `X-*`.
- **Bounds.**
  - A range is whole UTC weeks: `utcStart` on a Monday 00:00 UTC, `utcEnd` a whole number of weeks later. Anything else is `invalidArguments`. This keeps cache keys canonical; callers cannot mint new keys by shifting a range.
  - At most 54 weeks per call. A calendar year covered by whole UTC weeks is sometimes 54 weeks (for example 2040, or 2028 and 2029 depending on the viewer's zone).
  - The work per call is capped as a product: `ids × weeks ≤ 540` person-weeks (for example 10 people for a year, or 50 people for 10 weeks). Larger requests are `invalidArguments`, checked before any read; the client splits them.
  - At most 2000 periods per person per week; beyond that the list is cut.
  - A cut list, a skipped recurrence, or a skipped object (too large or unparseable) sets `complete: false` for that week. A person's `complete` in the response is false when any requested week is.
- **No side effects.** The calculator only reads.
- **Cost and caching.**
  - A per-owner **fingerprint** is the eligible source calendar ids with their `synctoken`, plus a short hash of the app key. Sabre bumps the synctoken on every write path, raw `CalPDO` included. Prefs and the display name are not in it, because include and detail are applied after the read and the name is not cached.
  - The cache holds one entry per `(owner, weekStart, fingerprint)`: the **unredacted** occurrence list of every eligible source for that week, each with its source calendar id, source kind, private flag, title, location and an HMAC of the UID (keyed with the app key, never the raw UID), plus the week's `complete` flag. A cache hit can therefore never turn an incomplete week complete.
  - A request reads or fills each requested week, merges them, then applies, in this order: `include`, dedupe, `excludeUid`, detail per source calendar, and the output field list. Because the keys are per week, the invitee tag's one-week request and the sidebar's longer runs share entries.
  - **Consistent snapshot.** The fingerprint is read before and again after the objects. When it changed in between, the result is returned but not stored, so a write that lands mid-read can never be cached as "free" under the new fingerprint.
  - A key rotation changes the fingerprint, so it is a cache miss, not an exclusion that silently matches nothing.
  - **Storage and cleanup.** Entries live 5 minutes in a dedicated cache store (`availability`, its own file directory). Laravel's file store deletes an expired file only when that same key is read again, and old fingerprints are never read again, so a scheduled command `wgw:availability:prune-cache` (hourly, `withoutOverlapping`) deletes every expired file in that directory.
  - The entries are plaintext in the instance data directory. They hold nothing the calendar tables in the same directory do not already hold, and no raw UIDs.
- **Observability.** A call that takes more than 500 ms logs its duration and counts (sources, objects, periods), never content.

### API

- **JMAP capability** `urn:wgw:jmap:availability` (vendor, like `urn:wgw:jmap:chat`), in the session object and OpenAPI.
- **`TeamMember/get`** `{ accountId, ids: null | Id[] }`
  - Returns `{ state, list: [{ id, name, isSelf, version }], notFound }`. `id` is the username (see Ids).
  - `version` is a hash of the person's name and their settings stamp. It changes when they rename, flip the switch, or change which calendars count or how much detail they share.
  - `ids: null` returns everyone the caller may see under the rule above, plus the caller when their switch is on (`isSelf: true`).
  - `state` is a hash of every visible `(id, version)`, computed by this capability (not #1917's Team-set fingerprint, which misses switch, detail and name changes). The client compares it on its availability tick; there is no `/changes`.
  - A user in no Team gets an empty list (or only themselves).
- **`TeamMember/getAvailability`** `{ accountId, ids: Id[], utcStart, utcEnd, excludeEventId?: Id }`
  - Returns `{ list: [{ id, periods: [...], complete }], notFound }`.
  - At most 50 ids, whole UTC weeks, at most 54 weeks, and at most 540 person-weeks per call. Anything else is `invalidArguments`, before any read.
  - `excludeEventId` must be a `CalendarEvent` the caller may edit, or one where the caller is the organizer or an attendee. The server takes its UID and passes it as `excludeUid`. Any other id is `invalidArguments`. This rules out events the caller only reads on a read-only shared calendar, where comparing results with and without the exclusion would tell more than the caller already knows.
  - The period shape stays close to the standard `Principal/getAvailability` `BusyPeriod`, so a later move to the standard method is a rename.
- **CalDAV free/busy.** Today `CalDAV\Schedule\Plugin::getFreeBusyForEmail` checks `schedule-query-freebusy` on the target's **inbox**, and Sabre's `Inbox::getACL` grants `schedule-deliver` (which includes that privilege) to every authenticated user; Sabre also grants `read-free-busy` on every calendar (`Calendar::getACL`). Removing the calendar grant alone would therefore not close the outbox; overriding `getFreeBusyForEmail` does. So the outbox report is live now and ignores the switch, the per-calendar include and the Team rule. This is current behaviour on main that this work helps close, not a new surface. Teams visibility (#1923) adds a `WgwSchedulePlugin` that overrides `getFreeBusyForEmail` and answers as for an unknown address when caller and target share no Team. This Epic extends that override:
  - target's switch off → the same answer as for an unknown address
  - switch on → busy periods from `AvailabilityCalculator`, time only (no titles over CalDAV), computed over the whole UTC weeks covering the requested window and then clipped back to the requested DTSTART/DTEND, so the reply holds nothing outside it
  - a window whose covering UTC weeks number more than 54 (an unaligned 54-week window covers 55), or a result with `complete: false`, gets the unknown-address answer (`3.7`) too, never a partial `2.0` VFREEBUSY that a client would read as free in the gaps
  - **Interop change, decided.** The switch is off by default, so external CalDAV clients (Apple Calendar, Thunderbird) stop getting free/busy for a colleague when adding them as attendee, until that colleague opts in. Today they get an answer for everyone. Product owner, 2026-11-04: one rule everywhere.
  - If #1909 is ready before #1923, #1909 adds the subclass with both checks and #1923 adopts it. Either way, #1912 (the settings UI that promises "off means nobody sees anything") does not ship before this holds.
- **REST settings** (`x-wgw-access: user`), declared next to `calendars/subscriptions`, above the parameterised feed routes:
  ```
  GET /api/v1/calendars/availability
    → { enabled, teams: [{ slug, name }],
        calendars: [{ calendarId, name, color, source: "personal" | "team", include, detail }] }
  PUT /api/v1/calendars/availability
    { enabled?, calendars?: [{ calendarId, include?, detail? }] }
    → same shape
  ```
  - Settings live in one REST resource, not on JMAP `Calendar`. The settings pane is the only reader and needs a connection anyway. `Calendar` objects, push state and the Dexie calendar cache stay unchanged.
  - There is no `/changes` or push for settings: a change on the laptop shows on the phone the next time its settings pane opens. Teammates see it on their next availability fetch.
  - `detail: "details"` on a Team calendar returns 422. A calendar that is not the caller's own personal or Team event calendar returns 422.
  - This is server-side on purpose, unlike the device-local view prefs of #981: it decides what others may see.
- **JMAP `Calendar`** does not change. The client-side type `includeInAvailability` stays unused.
- **Search and MCP** do not see availability.

### Web app

- **Client.** `lib/jmap-client/availability/` wraps both methods.
  - Every request covers a contiguous run of whole UTC weeks (Monday 00:00 UTC), one call per batch of people. The client splits runs longer than 54 weeks, and splits people into batches so `ids × weeks` stays within 540. A year view of 12 ticked teammates is two calls, not 52. A 54-week year is one run.
  - Responses are split into weeks for the cache. A period is stored under every week of that run it overlaps, so an event that runs past Monday 00:00 UTC keeps both weeks busy offline; weeks outside the run get no row. When a view merges cached weeks, identical periods (same start, time zone, duration, `showWithoutTime`, title and location) are drawn once. A person's `complete: false` is written to every week of that run.
- **Cache.** A new offline table in the calendars domain: `calendars_availability` keyed by `[username+weekStart]`, holding the periods JSON, `complete`, the person's `version` and `fetchedAt`. The teammates list (`TeamMember/get`) is cached in the same domain. A new schema version adds them.
  - When a person's `version` changes, or they leave the list, all their cached weeks are dropped at once. This matters for privacy: someone who switches from "Title and location" back to "Time only" must not keep showing titles in a viewer's cache.
  - Eviction: weeks outside the prefetch window that were fetched more than 30 days ago are dropped, and at most 60 weeks per person are kept (oldest first).
- **Fetching.**
  - Only ticked teammates are fetched. Unticked people cost nothing.
  - On every range change (week, month, year, jumping to a date), the visible range is fetched at once for ticked teammates. Any range works online, including next year.
  - A separate **60-second availability tick** compares `TeamMember/get` by `state`, refetches the visible range, and prefetches the current week plus the next 4 weeks. The 10-second calendar tick (`calendar-refresh.ts`) stays for the user's own events only.
- **All-day periods.** A period with `showWithoutTime` covers its whole date(s) in the viewer's time zone, like all-day events on the grid. For the invitee tag, a busy all-day period on any date the event touches makes the invitee "Busy". Because new all-day events default to Free (#1927), this is mostly time off.
- **Rendering.**
  - Each ticked teammate becomes a read-only virtual calendar (`availability:{username}`). It is not stored in `calendars_calendars` and is never offered as a default or invite calendar.
  - Its periods become read-only events. Drag, resize and create are blocked through `blocksCollectionWrite`.
  - A period without a title renders as "Busy".
  - Clicking opens a read-only popover: the person, the time, and the title and location when present. No notes, invitees, alarms, RSVP, Meet or delete.
  - `calendar-workspace.tsx` and `use-calendar-controller.ts` do not grow (file-size ratchet); the popover lives in its own file.
- **Sidebar.**
  - A **Team availability** section after **Shared with me**, in its own file. `calendar-workspace.tsx` and `use-calendar-controller.ts` do not grow (file-size ratchet).
  - Rows show a `user-avatar` and the person's name. The caller's own row comes first, "You (as teammates see you)", when their switch is on.
  - Rows are hidden by default. The section is collapsible, with a filter input above 8 rows.
  - Each teammate gets one colour for the sidebar checkbox, the sidebar avatar, their busy blocks and the busy popover. Start from their avatar colour; when two teammates in the section would share a colour, walk all teammates (also the hidden ones) in username order and give the later one the next free avatar colour. Colours repeat only above 8 teammates. Avatar colours elsewhere in the suite do not change. Product owner, 2026-11-09: a busy block only says "Busy", so colour is how you tell people apart.
  - A row whose visible range came back with `complete: false` shows a small marker with the tooltip "Some busy times could not be loaded."
  - The existing partition helpers (`calendar-sidebar-order.ts`) must never place a virtual availability calendar in My calendars or Shared with me.
- **Invitee list (#1614).**
  - In `calendar-invitees-card.tsx`, an invitee who appears in `TeamMember/get` and is busy at the event's time gets a warning on their own participant tag: a warning colour wash, a trailing warning icon, and "busy at this time" in its accessible name. There is no separate "Free" or "Busy" label; a free teammate's tag looks like any other. Product owner, 2026-11-09, on screenshots of #1962.
  - It is for the event's own time: the occurrence being edited, or the first occurrence of a new series.
  - The busy tag's tooltip shows the overlapping times, and their titles when the owner shares details.
  - Saved events pass their id as `excludeEventId`.
  - It updates (debounced) when the time, the all-day flag or the invitees change.
  - It requests the UTC week (or weeks) containing the event, so the server answers from the same per-week cache entries as the sidebar. Invitees are matched to `TeamMember` ids by `CalendarInvitee.username`. The answer is not written to the client cache, because it carries the exclusion.
  - Invitees who are not teammates sharing availability (switch off, no shared Team, external guests) get no warning.
  - When the result for that invitee is `complete: false`, there is no warning either. With no visible "Free" label, the UI never claims free on partial data.
  - It never blocks saving. Online only: offline, no warnings show and no extra text.
  - `calendar-workspace.tsx` and `use-calendar-controller.ts` do not grow; the logic lives in its own module.
- **Owner settings** in one **Availability** section of Settings → Calendar, in its own file:
  - Master switch "Share my availability with my Teams", off by default. While off, only one explanatory line shows.
  - While on:
    - a **Calendars** list. No list of Teams and no "no Team yet" note: who can see it follows from Teams, and the switch line already says so.
    - one row per own personal event calendar (color, name) with one select and no visible label: "Do not add", "Time only" (default) or "Title and location". "Do not add" stores `include: false`; the other two store `include: true` plus the detail.
    - one row per Team calendar (color, name, a "Team" tag) with the same select limited to "Do not add" and "Time only". The tag has the suite tooltip "Counts for the whole Team". It opens on hover and keyboard focus; tap-to-open is a shared tooltip matter, not handled here.
    - a footer line: "Events marked 'Show as: Free' never count."
    - Simplified by the product owner on screenshots, 2026-11-09 (#1974): no "Who can see it" block, no "Counts toward my availability" checkbox, no "Teammates see" label, and the Team hint moved into the tag's tooltip.
  - Save goes through the REST resource and calls `notifySettingsSliceSaved`. Offline shows an error toast, like share and publish.
- **Event editor: all-day default (#1927).**
  - A new all-day event starts with "Show as: Free". A new timed event keeps "Busy".
  - Toggling all-day in the create dialog moves the default along, until the author touches "Show as".
  - When an all-day event is Free, the Show-as field shows the hint "Set to Busy for time off, so teammates see you as away."
  - Existing events and events from other clients are not changed.
- **Visible UI** (sidebar, busy rendering, invitee tags, settings, all-day default) is reviewed with the product owner on screenshots before merge.

## Edge cases

- **Same event in two of the owner's calendars** (same UID). One period. Copies with different UIDs both count and overlap.
- **Cross-Team case.** X is in Team A only. U is in Teams A and B. Team B's calendar has an event at that time.
  - U is busy for X, as are all other Team B members with the switch on.
  - Marked "Show as: Free", it counts for nobody.
  - X sees only "Busy", never the title, and cannot tell a Team B event from U's own.
  - Known residue: X can infer that several teammates are busy at the same moment. Accepted, because it is time only.
- **Team calendar as a notice board.** All-day entries default to Free. Timed entries that are Busy block every member. A member can set that Team calendar to "Do not add".
- **A member declines a Team event.** They stay busy. The settings screen does not repeat this rule; the "Team" tag's tooltip only says the calendar counts for the whole Team.
- **Time off entered as an all-day event.** It defaults to Free, so it does not block until the author sets Busy. The editor hint says so.
- **Owner turns a calendar off, or the switch off.** The next fetch reflects it. Teammates' caches keep old data until their next online fetch. Turning the switch off makes the person disappear from `TeamMember/get`, and the client then drops their rows and cache.
- **A user removed from a Team.** On the next request they are in `notFound`. The client drops their row and their cached weeks. If they still share another Team with the viewer, nothing changes.
- **A user with no Team.** `TeamMember/get` returns an empty list. The settings pane shows no extra note; with the switch on, nobody sees anything until the user joins a Team.
- **Owner changes their display name.** The `TeamMember/get` state changes and rows update.
- **Recurring events** are expanded per request. An oversized recurrence is skipped and logged and does not fail the call.
- **Floating-time and all-day events** keep their wall-clock time (`timeZone: null`, `showWithoutTime`). Display-zone conversion stays client-side (#981).
- **Invitee edits the event being planned.** With `excludeEventId`, the invitee's own copy of this event never makes them "Busy".
- **Viewer in another time zone.** Periods carry their own time zone. The client converts them like normal events.
- **Offline viewer.**
  - Cached weeks of ticked teammates paint from the cache. A visible week with no cache shows nothing for that person.
  - **Offline notice.** Calendar gets the shared `NoticeBar` (`notice-bar/src/notice-bar.tsx`, today used by Tasks for parked writes), placed between the Calendar header and the grid. While offline with at least one ticked teammate, it shows one `info` notice:
    - "Offline · teammates' availability updated {relative time}." using the oldest `fetchedAt` of the visible weeks. This states the age of the data; it does not promise anything.
    - When a visible week was never fetched for a ticked teammate, the same notice adds: "Some weeks in view are not available offline." So an empty week is not read as free.
    - It disappears when the connection is back. Stamp plus uncached hint confirmed by the product owner, 2026-11-04, in the notice bar at their request.
  - `Notice` gets an optional action (`actionLabel` and `onAction` become optional together), because this notice has nothing to settle. Existing notices keep their action; a test covers a notice without one.
  - The section header and the popover carry no offline text of their own.
  - Planning offline is not blocked. A clash found after reconnect is #1914.
  - The settings pane needs a connection (error toast). Offline, no availability warning shows and there is no extra text.
- **Incomplete result.** A person with `complete: false` for the visible range shows the row marker; their blocks still render. The invitee tag shows no warning; a plain tag never claims free, so no third state is needed. Decided 2026-11-09 with #1962; the sidebar marker is where "could not be loaded" is said.
- **More Team calendars.** A Team with several event calendars makes every member busy for all of them by default. Members set the ones they do not want to "Do not add". With Projects (#810), joining a Project becomes that switch.

## Follow-up issues

- **#1914: Warn after reconnect when an event planned offline now clashes.** After the next sync, the client calls `TeamMember/getAvailability` for the invitees of each event that was created or rescheduled offline, with `excludeEventId`. Any overlap shows a `warning` notice in the same Calendar `NoticeBar` ("1 event you planned offline now clashes…") with a Review action; the review lists each event with Open event and Dismiss. It shows in one tab (Web Lock, as in the Tasks rescue dialog), survives a refresh, and never moves or cancels anything. No new endpoint is needed.
