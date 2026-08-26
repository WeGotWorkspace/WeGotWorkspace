# Attach a Meet or meeting URL on a calendar event

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor calendar-meet-link plan (Goal #525 / Task #640).

## Goal

Reserve principal-owned Meet rooms, persist CalDAV-compatible conference fields, and show Join — including before the host is in-call. Architecture lock: [`docs/architecture/meet-reserved-rooms.md`](../../../docs/architecture/meet-reserved-rooms.md).

## Non-goals

- Named reusable rooms (#579), auto-Meet, Zoom/Teams APIs, writing `X-MICROSOFT-SKYPETEAMSMEETINGURL`
- Changing iMIP `ORGANIZER` to the group; auto-closing Goal #525
- Stealing week 26–30 Aug connect-URL + Block B capacity

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

1. **setup (0)** first — sprint-plan reopen, architecture note, Task #640, this spec. Do not implement M until the note is reviewed.
2. **meet-reserve-owner (M)** and **api-event-links (A)** may run in parallel after 0 + arch review. A’s hook calls M’s POST/PATCH internally.
3. **calendar-meet-ui (B)** after M + A.
4. **verify (V)** after M + A + B.

## Chunks

### Chunk 0: Setup

- **id:** `setup`
- **Skill:** developer, plan-feature, git-workflow
- **Inputs:** Goal #525; Cursor plan `calendar_meet_link_1ea5c23c`
- **Done when:** `docs/v0.9-sprint-plan.md` records the 2026-08-26 reopen; architecture note locks clocks / GC / hook / origin-equality / `createdBy`; Task #640 filed under #525 (`type:task`, `area:calendar` + `area:meet`, milestone `v0.9`, not on Product Project); `feat/calendar-meet-link` from `origin/main`; spec/plan/tasks with `Source: #640 (body-hash: 9b540e34)`
- **Verify with:** `gh issue view 640`; parent is #525; projectItems empty; spec header body-hash
- **Parallel with:** none

### Chunk M: Reserved Meet rooms + principal owner

- **id:** `meet-reserve-owner`
- **Skill:** meet, api, testing
- **Inputs:** [`docs/architecture/meet-reserved-rooms.md`](../../../docs/architecture/meet-reserved-rooms.md) (reviewed), `MeetingsController`, `MeetSignalingService`, `meet-lobby-pane.tsx`
- **Done when:**
  - `POST /meetings/rooms` accepts `room` + `ownerPrincipal` (+ optional nullable `expiresAt`) and records `createdBy`
  - Guest GET `{ reserved, active }` only; full body for owner-principal member **or** `createdBy`
  - Guest lobby: reserved+empty → wait-for-host; **404** → dead-link copy
  - Ad-hoc `/meet` Start **writes** a row (`ownerPrincipal = createdBy = acting user`, start+30d)
  - Sweeper skips `expiresAt = null`; due never-activated rows are pruned
  - Authenticated PATCH can set `expiresAt` (`createdBy` or owner-principal member); callable from the calendar write service
- **Verify with:** Meet PHPUnit + lobby Vitest/stories, then `pnpm test:api-done-gate`
- **Parallel with:** `api-event-links` (after Chunk 0 review)

### Chunk A: Conference field mapping + ICS-write hook

- **id:** `api-event-links`
- **Skill:** api, testing
- **Inputs:** `calendar-event.json`, `LocationConversionSupport.php`, `CalendarEventRepository::persistEventMutation`, `SabreServerFactory` (CalDAV PUT uses `CalPDO` directly), `ics-jmap-conversion-matrix.md`
- **Done when:**
  - `links` on `CalendarEventPatch` and `CalendarEventRecurrenceOverride`
  - Write `URL` + `CONFERENCE` + `X-GOOGLE-CONFERENCE`; **never** write `X-MICROSOFT-SKYPETEAMSMEETINGURL`
  - Read those three plus Microsoft X-prop into `links`
  - Shared hook from **both** `persistEventMutation` **and** CalDAV after-write: (1) single / this-instance end change → `expiresAt = newEnd + 7`; (2) inbound same-origin WGW guest/join URL → idempotent reserve; insert `createdBy` = authenticated DAV/JMAP actor; existing owner/`createdBy` kept; **`expiresAt` always event/scope clock** (upgrade draft `now+30d`)
  - Feature tests: JMAP + CalDAV reschedule; CalDAV inbound reserve with `createdBy` = PUT principal; blur-draft then Save upgrades clock; mapping-only GET does not POST
- **Verify with:** targeted PHPUnit then `pnpm test:api-done-gate`
- **Parallel with:** `meet-reserve-owner`

### Chunk B: Form, wire, editor, popover

- **id:** `calendar-meet-ui`
- **Skill:** workspace, apps-ui, storybook
- **Inputs:** Chunks M + A
- **Done when:**
  - `meetingUrl` on `CalendarEventFormValue`; form/wire map to `links`
  - Add Meet: one session-stable room code; button disabled in-flight; series / this-and-future → `expiresAt = null`; this-instance → new room, occurrence-end+7
  - Remove and **scope-change after reserve** clear staged code and PATCH `expiresAt = now + 30 days`
  - Dialog save / drag do **not** PATCH Meet for reschedule and do **not** own inbound reserve
  - Paste: origin-equality on blur as draft (`now+30d`); Save upgrade is Chunk A
  - Popover, invitee dialog, inbox card show Join; GET 404 uses dead-link copy
- **Verify with:** targeted Vitest then `pnpm test:apps-done-gate`
- **Parallel with:** none (after M + A)

### Chunk V: Verify Goal signals

- **id:** `verify`
- **Skill:** verify-issue, code-review
- **Inputs:** merged M + A + B; Task #640 AC; Goal #525 success signals
- **Done when:** Task AC `ISSUE_SATISFIED`; Goal #525 success signals evidenced (**not** closed); smells scan; done gates green
- **Verify with:** [verify-issue](../../skills/verify-issue/SKILL.md) (Task mode + Goal mode separately)
- **Parallel with:** none

## Test plan

- [ ] Meet: reserve + owner principal + reserved-empty wait; GET 404 = not-reserved; Remove / scope-change PATCH now+30d; ad-hoc start writes a user-owned row
- [ ] Server hook (JMAP + CalDAV): recompute single / this-instance `expiresAt`; inbound WGW reserve; draft-clock upgrade; series / this-and-future `null` while attached
- [ ] API: write-set present; Microsoft X-prop absent on write; Microsoft X-prop read into `links`; iMIP + inbox URL
- [ ] UI: series vs this-instance; Add Meet one code per session; paste WGW vs generic; popover Join
- [ ] Browser (after week 26–30 Aug): personal Add Meet → Join while host not in call; group (other member starts); recurring one URL

## Doc updates

- [`docs/v0.9-sprint-plan.md`](../../../docs/v0.9-sprint-plan.md) — reopen #525 (Chunk 0)
- [`docs/architecture/meet-reserved-rooms.md`](../../../docs/architecture/meet-reserved-rooms.md) — Chunk M / A lock (Chunk 0)
- [`packages/api/docs/calendars/ics-jmap-conversion-matrix.md`](../../../packages/api/docs/calendars/ics-jmap-conversion-matrix.md) — write-set vs Microsoft read-only (Chunk A)
- [`packages/api/docs/meet-signaling.md`](../../../packages/api/docs/meet-signaling.md) — reserved rooms (Chunk M)
- Goal #525 Delivery → Task #640 (filed in Chunk 0)
