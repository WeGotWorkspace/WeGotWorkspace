# Calendar collection ACL sharing

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor calendar-sharing plan.

## Goal

Implement Task #606: personal-calendar `shareWith` (user or group, read | write), recipient list + show/hide, event ACL, bidirectional CalDAV interop, suite share UI. Close Bug #489 on the same branch (organizer lock). Product context: Goal #403 / Epic #494.

## Non-goals

- Single-event ACL, delegation (#492), guest links (#388), invites (#478 / #479)
- iCloud-native sharing, Apple public/webcal publish
- Reopening #500 / #163 / #157; auto-closing Goal #403

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

1. **setup** first (this chunk) — Task filed, worktree + `feat/calendar-sharing` from `origin/main`, spec/plan/tasks with body-hash.
2. **api-sharewith (A)** before **dialog-acl (B)** — live `mayShare` must exist; UI fallback is a safety net only, do not race it.
3. **caldav-share-interop (D)** after A (needs `updateInvites` / `share_href` mapping). D may run **parallel with B**.
4. **calendar-share-ui (C)** after A **and** B (needs A contract + B write helper).
5. **verify (V)** after A–D merge.

## Chunks

### Chunk 0: Setup

- **id:** `setup`
- **Skill:** developer, plan-feature, git-workflow
- **Inputs:** Goal #403, Epic #494, parked #500 / #163 / #157
- **Done when:** Task #606 filed under #494; `feat/calendar-sharing` worktree from `origin/main`; `spec.md` / `plan.md` / `tasks.md` written with `Source: #606 (body-hash: …)`
- **Verify with:** `gh issue view 606`; parent of #606 is #494; specs exist in this worktree
- **Parallel with:** none

### Chunk A: API `shareWith` + event ACL

- **id:** `api-sharewith`
- **Skill:** api, testing
- **Inputs:** `CalendarRepository`, `CalendarSetMethod`, Sabre `updateInvites` / `getInvites`, `CalendarPrincipalAddresses`
- **Done when:** Task AC for share / read-denied / write / revoke / group; `mayShare` true for personal owners; `access === 2` cannot mutate events; old ignore-`shareWith` test replaced; grants written via `updateInvites` with `mailto:` hrefs
- **Verify with:** targeted PHPUnit then `pnpm test:api-done-gate`
- **Parallel with:** none — **A before B**

### Chunk D: CalDAV / Apple sharing interop

- **id:** `caldav-share-interop`
- **Skill:** api, testing
- **Inputs:** Chunk A `updateInvites` / `share_href` mapping
- **Done when:** JMAP share visible on CalDAV `invite` + recipient home; CalDAV `CS:share` / `DAV:share-resource` visible in `Calendar/get`; revoke both ways; read-only CalDAV write denied; `calendarserver-sharing` advertised
- **Verify with:** CalDAV sharing feature tests + `pnpm test:api-done-gate`
- **Parallel with:** `dialog-acl` (after A)

### Chunk B: #489 dialog ACL

- **id:** `dialog-acl`
- **Skill:** workspace, testing
- **Inputs:** Chunk A `mayShare` / `mayWrite` on `CalendarInfo`; `calendar-event-dialog.tsx`
- **Done when:** group member can edit/delete another member's event; invitee RSVP lock on owned personal calendars still passes; popover Edit and surface drag respect per-calendar `mayWrite`
- **Verify with:** `vitest run calendar-event-dialog.test.tsx` (+ workspace / popover tests)
- **Parallel with:** `caldav-share-interop` (after A). Helper must keep RSVP lock when `mayShare` is undefined on personal calendars

### Chunk C: Calendar share UI

- **id:** `calendar-share-ui`
- **Skill:** workspace, apps-ui, storybook
- **Inputs:** A contract + B helper; `share-ui` primitives
- **Done when:** owner share / change / revoke; recipient list + show/hide; write vs read gating; mock-tier story; suite share primitives
- **Verify with:** targeted Vitest/Storybook then `pnpm test:apps-done-gate`
- **Parallel with:** none (after A+B)

### Chunk V: Verify

- **id:** `verify`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged A–D; Task #606 AC; Bug #489; Goal #403 success signals
- **Done when:** verify-issue PASS on #606 + #489 expected behavior + Goal #403 **success signals** (do not auto-close the Goal); api/apps done gates green; smells scan on touched files
- **Verify with:** `pnpm test:api-done-gate`, `pnpm test:apps-done-gate`, verify-issue
- **Parallel with:** none

PR (when asked) closes Task #606 + #489, links Epic #494 / Goal #403 — **never** `fixes #403` alone.

## Test plan

- [ ] API: failing JMAP feature tests first (share, read-denied write, write, revoke, group share, group-member update/delete) → `pnpm test:api-done-gate`
- [ ] CalDAV: JMAP→PROPFIND invite / recipient home; CS:share→JMAP `shareWith`; revoke both ways; read-only PUT denied
- [ ] UI: invitee lock preserved; group-member / write-share editable; Share dialog mock-tier story → `pnpm test:apps-done-gate`
- [ ] Browser (when implementing UI): owner share → second user sees calendar → read cannot edit → write can edit → revoke hides access
- [ ] Manual (optional): CalDAV account in Apple Calendar on this instance — share to a teammate email that matches `principals.email`

## Doc updates (only if user wants)

- Flip stub docs that say `shareWith` is always null: `packages/api/docs/calendars/jmap-calendars-summary.md`, `packages/api/docs/contacts/jmap-collection-crud.md`
- Document Apple Calendar caveats (this-instance CalDAV only, `mailto:` match, auto-accept, group share is JMAP-only)
