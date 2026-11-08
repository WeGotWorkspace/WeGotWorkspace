# Team availability

Teammates see when a person is busy, computed on request from that person's own calendars. Epic: #1907 (Goal WeGotWorkspace/Product#43). Spec, plan and chunks: [.agents/specs/1907-team-availability/](../../.agents/specs/1907-team-availability/). Status: **server built** (#1908 calculator, #1909 JMAP, REST and CalDAV); the web app (sidebar, invitee list, settings) follows in the later chunks.

API reference: [packages/api/docs/calendars/availability.md](../../packages/api/docs/calendars/availability.md).

---

## Rules

1. **Off by default.** "Share my availability with my Teams" is off until the person turns it on. While it is off nobody gets anything, the person included.
2. **Teams decide who sees whom.** A viewer reads a person only when they share a Team (or are that person), the person's switch is on, and the person is not disabled. The admin role gives no extra access. `AvailabilityAudience` asks `TeamColleagues::sharesTeamIgnoringAdminRole` (#1917), the same Team check the rest of the suite uses.
3. **Every refusal looks the same.** Unknown, switched off, disabled and "no shared Team" all come back as `notFound` over JMAP and as `3.7;Could not find principal` over CalDAV.
4. **Own calendars only.** A person's own personal event calendars and the event calendars their Teams own count. ICS subscriptions, calendars shared with the person and other kinds (tasks, notes) never count.
5. **Each calendar can be left out**, and a personal calendar can share `details` (title and location) instead of `busy`. Team calendars are always `busy`.
6. **"Show as: Free" and cancelled never count.** A decline frees the time only on a personal calendar; a Team calendar event counts for every member.
7. **Never falsely free.** When the server could not work out all busy time in a week, that week is `complete: false`. CalDAV answers `3.7` instead of a partial reply.
8. **Nothing is copied per viewer.** The server reads the owner's calendars when someone asks; a change shows on the next fetch. Why there is no projected calendar is under "Not built here".

## Flow

```text
  TeamMember/get, TeamMember/getAvailability      CalDAV outbox POST (VFREEBUSY)
  (urn:wgw:jmap:availability)                     WgwSchedulePlugin::getFreeBusyForEmail
                  │                                              │
                  └───────────────┬──────────────────────────────┘
                     AvailabilityAudience::mayRead
                     (shared Team or self, switch on, enabled)
                                  │
                     AvailabilityCalculator::busyPeriods(owner, weeks, excludeUid?)
                                  │
     fingerprint ─► per week: availability cache hit? ─► no: AvailabilityOccurrenceReader
     (synctokens of                 │ yes                     reads the source calendars,
      the sources)                  │                         expands recurrences
                                    ▼                                  │
                     AvailabilityPeriodFilter  ◄───────────────────────┘
                     include, excludeUid, dedupe, busy/details, output fields
                                  │
          JMAP: periods + complete per person        CalDAV: clip to DTSTART/DTEND,
                                                     merge, FREEBUSY lines, no titles
```

## Components

| Part | Where | What it does |
| --- | --- | --- |
| Settings storage | `calendar_availability_owners`, `calendar_availability_prefs`; `AvailabilitySettings` | Switch per person; `include` and `detail` per (person, calendar id). No row means off / included and `busy`. Rows for a deleted calendar cascade with it. |
| Sources | `CalendarCollectionAccess::availabilitySourceInstances` | Read-only list of the owner's own personal and Team event calendars. Never provisions. |
| Reader | `AvailabilityOccurrenceReader` | Reads one UTC week: candidate objects in lazy chunks, payload size guard, recurrence expansion with overrides, the busy rules. Skipped objects, a series over the instance limit or more than 2000 periods make the week incomplete. |
| Cache | `AvailabilityWeekCache`, file store `availability` | One entry per (owner, week start, fingerprint) for 5 minutes, holding unredacted occurrences with HMAC'd UIDs and that week's `complete` flag, so a hit cannot turn an incomplete week complete. The entries are plaintext (unencrypted) files on the dedicated `availability` store (`file` driver, separate from the default cache store) under `storage/framework/cache/availability`. Titles and locations sit there unredacted, but no raw UIDs, and nothing the calendar tables in the same data directory do not already hold. |
| Filter | `AvailabilityPeriodFilter` | Applies `include`, `excludeUid`, dedupe by UID and start (time-only wins), and the `busy` or `details` output. |
| Calculator | `AvailabilityCalculator` | Validates weeks (Monday 00:00 UTC, at most 54), returns `null` while the switch is off, logs reads over 500 ms. |
| Audience | `AvailabilityAudience`, `AvailabilityTeamMembers` | Who the viewer may read; `version` and `state` for `TeamMember/get`. |
| Contract | `TeamMemberGetMethod`, `TeamMemberGetAvailabilityMethod`, `CalendarAvailabilityController` | JMAP methods and the REST settings resource. |
| CalDAV | `WgwSchedulePlugin` | Replaces Sabre's schedule plugin; the outbox free/busy report follows the same rules. |
| Housekeeping | `wgw:availability:prune-cache` (hourly) | Deletes expired cache files that are never read again. |

## Cache and freshness

- **Fingerprint.** sha256 of every source calendar's id and `synctoken`, plus a hash of the app key. Sabre bumps the synctoken on every write over CalDAV, JMAP or REST, so any write misses the cache on the next call.
- **Read before and after.** The fingerprint is read before the objects and again after. When it moved during the read, the result is returned but not stored, so a half-old week is never cached.
- **Settings are applied after the cache.** The cache holds every occurrence of every source, so a change to `include` or `detail` takes effect on the next call without a miss. This also keeps the entry independent of the viewer: the key is owner, week and fingerprint, and `detail` is per calendar, so it applies to every teammate who can see the person. A per-Team (per-viewer) detail level would put the viewer in the cache key. Do not add one casually.
- **Version and state.** A person's `version` is a hash of their name and settings stamp (the latest `updated_at` of their switch and calendar choices, with microseconds). `TeamMember/get` `state` is a hash of every visible (id, version), so joining, leaving, a switch, include, detail or name change all move it. A client drops a person's cached weeks when their `version` changes.

## Period fields

The list is closed. A period is built from `start`, `timeZone`, `duration` and `showWithoutTime`, plus `title` and `location` only when that occurrence's calendar is personal, its detail is `details`, and the event is not private or confidential. A location that contains a URL is dropped, and a title is cut at 200 characters. uid, description, attendees, organizer, alarms and every other property are omitted.

## `excludeEventId`

`TeamMember/getAvailability` takes `excludeEventId` (for "is this person free for this event?"). `AvailabilityExcludedEvent::uidFor` turns it into the event's UID, which the filter applies as `excludeUid`.

- Only a `CalendarEvent` the caller may edit (not on a subscription), or one the caller takes part in (organizer or attendee), qualifies. Any other id is `invalidArguments`.
- **Why:** on a read-only shared calendar, comparing results with and without the exclusion would tell the caller whether a teammate holds that event.

## Time fields

Periods carry the same time fields as a JMAP `CalendarEvent` in this codebase: a UTC start keeps its `Z` with `timeZone: null`, a zoned start is local time plus an IANA zone, a floating start is local time with `timeZone: null`, and an all-day start is a bare date with `showWithoutTime: true`. Floating and all-day events are placed in UTC weeks as if they were UTC, so a client pads its visible range by about 14 hours on each side before it snaps to whole weeks.

## CalDAV free/busy

Stock Sabre answers the outbox free/busy report for every principal: `Inbox::getACL` grants `schedule-deliver` to every authenticated user. #1923 added `WgwSchedulePlugin` with the Team rule; #1909 replaced its answer with the calculator and added the switch. `getFreeBusyForEmail` now works like this:

- The caller comes from the auth plugin, the target from `CalendarPrincipalAddresses::principalForMailto`.
- No access (no shared Team, switch off, or disabled) → `3.7;Could not find principal` (`UNKNOWN_ADDRESS_STATUS`).
- The calculator runs over the whole UTC weeks covering DTSTART–DTEND. More than 54 covering weeks (an unaligned 54-week window covers 55), or an incomplete result → `3.7`.
- Otherwise a `METHOD:REPLY` VFREEBUSY: busy periods clipped to the window, merged, as plain `FREEBUSY` lines, with no titles. `schedule-calendar-transp` and the inbox `calendar-availability` are no longer read; the per-calendar include replaces them.

External CalDAV clients (Apple Calendar, Thunderbird) therefore stop getting free/busy for a colleague until that colleague turns the switch on. This was decided with the product owner on 2026-11-04: one rule everywhere.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| ids per `TeamMember/getAvailability` | 50 | account capability `maxIdsPerCall` |
| weeks per call | 54 | `maxWeeksPerCall` |
| person-weeks per call | 540 | `maxPersonWeeksPerCall` |
| periods per person per week | 2000, then `complete: false` | `AvailabilityOccurrenceReader::MAX_PERIODS_PER_WEEK` |
| cache entry lifetime | 5 minutes | `AvailabilityWeekCache::TTL_SECONDS` |
| calendars per settings PUT | 200 | `AvailabilitySettingsPayload::MAX_CALENDARS_PER_UPDATE` |

Every JMAP limit is checked before anything is read, so a request that is too large never costs a read.

## Not built here

- No `/changes` and no push for settings or availability. Clients poll `TeamMember/get` `state` on their availability tick.
- Search and MCP do not see availability.
- **No projected calendar.** Busy time is computed when someone asks, and nothing is stored per viewer, so a Team removal or switching off applies on the next fetch and any range, including next year, is fetched online. A materialized availability calendar was rejected (confirmed with the product owner on 2026-11-04): it would add one push-state part per teammate, load people whose rows are unticked, and still leave the invitee list and the clash check needing a range query. The longer history is in the spec and plan.
