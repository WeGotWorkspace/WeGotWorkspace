Source: #2404 (body-hash: e4d65206)
Goal: WeGotWorkspace/Product#156

# Public availability link

Technical translation of Epic #2404 (Tasks #2405 server, #2406 settings UI). Written against `origin/main` at `2ad3d35be` (2026-11-26).

## Goal

A person turns on one public link. Anyone holding it can subscribe in Google, Apple or Outlook Calendar and sees opaque "Busy" blocks for last week and the next 26 weeks. Nothing but start and end of busy time ever leaves the server. The link is off until turned on, and a new link or turning it off ends the old one at once.

## Non-goals

- A web page for browsers (decided: not built; the link is a feed)
- Several links per person, booking pages, titles or places for outsiders
- Colleagues' busy times inside the workspace (Goal Product#43, done by Epic #1907)
- Any change to how the Team API (#1909) answers
- A per-link choice of calendars: the choices of Settings → Calendar apply to every audience

## Affected packages

- `packages/api`: migration, model, services, controller, routes, OpenAPI, tests
- `packages/apps`: `settings-core` card, `lib/api/wgw` operations, mock, stories, e2e
- docs: `docs/architecture/calendar-availability.md`, `packages/api/docs/calendars/availability.md`

## Technical constraints

### What the feed is

- **VEVENT, not VFREEBUSY.** Google Calendar, Apple Calendar and Outlook import `VEVENT`s from a subscribed URL and show nothing for `VFREEBUSY` (a long-standing client gap, e.g. Mozilla bug 415376; Google also says nothing official). The existing "busy" mode of published calendars already uses `VEVENT` + `SUMMARY:Busy`. One `VCALENDAR`, `PRODID:-//WeGotWorkspace//Availability//EN`, `X-WR-CALNAME` and `NAME` set to `{DisplayName}'s Availability` (plain `Availability` when the owner has no display name), `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H`. The calendar name carries the owner's display name (Wouter's decision, #2404): outsiders who have the link learn whose it is, never what the person does. The response is `text/calendar; charset=utf-8` with `Content-Disposition: inline; filename="availability.ics"`, so one URL both subscribes (`webcal://`, Apple, Google, Outlook, Thunderbird) and downloads as a file.
- **Per VEVENT exactly these properties:** `UID`, `DTSTAMP`, `DTSTART`, `DTEND` (UTC `Z`), `SUMMARY:Busy`, `TRANSP:OPAQUE`, `CLASS:PUBLIC`. No RRULE, no VTIMEZONE, no VALARM, no organizer, no attendees, no description, no location.
- **UID is derived**, never copied: `hash_hmac('sha256', "<utcStart>-<utcEnd>", token_hash)` first 32 hex + `@availability`. An event's real UID cannot be derived or compared, and a new link changes every UID.
- **DTSTAMP** is the Monday 00:00 UTC of the current week, so the body is byte-stable between polls and the `ETag` works.
- **Blocks are merged.** All periods are clipped to the window, zero-length ones dropped, and overlapping or touching ones merged, so outsiders cannot count events or see their edges.
- **All-day and floating events** use the calculator's UTC placement (an all-day event is 00:00–24:00 UTC). Documented limitation shared with the Team API.

### Same code path as Teams

- `AvailabilityCalculator` gets `busyPeriodsForPublicLink(owner, weeks)`. It skips the Team switch check, forces time only (the period filter's `details` flag is off for every occurrence) and otherwise runs the same read, cache, `include`, dedupe, Free, cancelled and ICS-subscription rules. A private test asserts it equals the Team result minus titles for the same fixtures.
- The Team switch and the public link are independent: a freelancer with no Team can publish. The calendar choices ("Do not add") are shared. A calendar the owner set to "Do not add" never counts for any audience.
- The public path never asks `AvailabilityAudience` (no viewer exists). Access is the token, the owner being enabled, and the link being on.

### Window and cost

- Window: from Monday 00:00 UTC of last week to the end of week +26: 28 weeks, under the calculator's 54. Week boundaries come from `gmdate`, not the owner's zone.
- An incomplete week (`complete: false`) answers **503** with `Retry-After`, never a feed that shows free time. Why not partial: a subscribed calendar that quietly drops busy time is the exact "falsely free" case the Team API forbids.
- The week cache (5 min, fingerprint of the sources) serves every subscriber; one polling client costs one cache read per week. No second cache.
- `ETag` = sha256 of the body; `If-None-Match` answers `304`. `Cache-Control: no-cache` (intermediaries must revalidate, so a revoked link stops at the next request). `X-Robots-Tag: noindex`.

### Link storage and tokens

- New wgw table `calendar_availability_links`: `principal_uri` (primary, one link per person), `token_hash` (unique, SHA-256 of the lowercased token), `token_cipher` (Laravel-encrypted token for redisplay, same trade-off as `calendar_feed_tokens`), `created_at`, `rotated_at`. A row means "on"; no row means off.
- Token: 48 random characters (`Str::random(48)` lowercased, same generator as feeds, over 200 bits). Lookup by hash. `hash_equals` on the stored hash.
- **Turn on:** creates a row, or returns the existing link (200 vs 201). **New link:** replaces `token_hash` and `token_cipher` in one update; the old token no longer exists anywhere. **Turn off:** deletes the row. Neither touches the Team settings stamp.
- A cipher that cannot be decrypted fails that owner's `GET` with 500 and never the feed (the feed needs only the hash).

### Routes

```
GET    /calendars/availability/public-link      owner: { enabled, httpsUrl?, webcalUrl? }
POST   /calendars/availability/public-link      owner: turn on or return the link
PUT    /calendars/availability/public-link      owner: make a new link (409 when off)
DELETE /calendars/availability/public-link      owner: turn off (idempotent, 204)
GET    /calendars/availability/feeds/{token}    public, `.ics` suffix optional
```

`calendars/availability/public-link` is registered before `calendars/{calendarId}/…` routes and cannot be read as a calendar id. The public route sits beside `calendars/feeds/{token}` outside `wgw.auth`, with `->where('token', '[A-Za-z0-9]+(?:\.ics)?')`, `x-wgw-access: guest`, and no CORS (same-origin only, as the rest of the API).

### Limits and abuse

- Limiter runs **before** the token lookup and any calendar read. Keys are the client address and the token only; neither can be minted by the caller beyond one per address (a new token costs an unknown-token hit).
  - per address, all requests: 120 per hour
  - per address, unknown or revoked token: 30 per hour (guessing)
  - per token: 600 per hour (many subscribers behind a Google or Apple fetcher)
- Shared hosting bans an address above 60 requests a minute. These limits stay well under that for any single address; the ban itself is the host's. Real subscribers poll every few hours, so the feed does not add a polling loop (compare Traffic budget Epic #2284).
- The 429 goes through the existing `ApiHttpException` mapping with `Retry-After`; a test asserts the header.
- Unknown, revoked, rotated and disabled-owner tokens all answer the same 404 body.

### Settings UI (#2406)

- Card "Public availability link" in Settings → Calendar after Availability, built like `CalendarPublishSection`: switch, read-only link with copy, "Make a new link" with a confirm that says the old link stops, confirm when turning off.
- The calendar list of the Availability card shows when either switch is on. Copy says the choices apply to both.
- Offline and error states as the Availability card; saves on change; no cache (read fresh when the pane opens).

## Edge cases

- Revoke while a client holds a cached copy: `no-cache` makes the next poll 404; apps then show an error or the last copy, which is the client's behaviour.
- Owner disabled or deleted: 404 immediately; the row stays until pruned (a later prune task is not needed for correctness).
- Owner sets every calendar to "Do not add": a valid empty `VCALENDAR` (200).
- An event marked private or confidential: time only, same as everything else (no title is ever read).
- "Show as: Free", cancelled, declined (personal) and ICS subscriptions never count (same rules as Teams).
- Recurring series: expanded by the calculator into occurrences; no RRULE leaves the server.
- Second turn-on while on: returns the same link, never rotates (security checklist: a permission update must not rotate a live token).
