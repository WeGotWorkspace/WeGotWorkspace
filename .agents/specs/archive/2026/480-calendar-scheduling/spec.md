Source: #480 (body-hash: d013625e)
Goal: #478

# Calendar iTIP scheduling inbox

Technical translation of Epic [#480](https://github.com/WeGotWorkspace/wegotworkspace/issues/480). Product context: Goal [#478](https://github.com/WeGotWorkspace/wegotworkspace/issues/478) (invite team members and RSVP in Calendar). Sibling delivery: Epic [#481](https://github.com/WeGotWorkspace/wegotworkspace/issues/481) / [481-calendar-imip](../481-calendar-imip/spec.md) (external iMIP — not this Source).

## Goal

Same-instance meeting invites use one iTIP engine (`Sabre\VObject\ITip\Broker`, RFC 5546) over CalDAV Scheduling (RFC 6638). REST and CalDAV event writes share that path: local delivery into `schedulingobjects` plus a tentative VEVENT on the invitee's default calendar. Calendar stays on the split shell and adds an Invitations sidebar plus attendee/RSVP UI. No email.

## Non-goals

- External iMIP / HTTPS RSVP — Goal #479 / Epic #481
- Calendar ACL sharing — Goal #403
- Free-busy, COUNTER/REFRESH, delegation, group-expand, iSchedule
- Inbound Mail-app `text/calendar` parsing
- Stock Sabre `IMipPlugin` PHP `mail()`
- Switching Calendar to the Mail collection shell

## Affected packages

- `packages/api` — Tasks inbox uri, implicit scheduling on REST writes, notifications REST, OpenAPI, CalDAV collision tests
- `packages/apps` — `calendar-core` attendees + Invitations sidebar, offline RSVP outbox, Storybook

## Technical constraints

- **One broker.** Reuse `Sabre\VObject\ITip\Broker` and the existing `CalDAV\Schedule\Plugin` (already registered in `SabreServerFactory`). Do not hand-roll METHOD/SEQUENCE.
- **REST must not skip scheduling.** `CalendarEventRepository` writes via `CalDAV\Backend\PDO` today; create/update/destroy and `POST /calendars/events/set` must run the same `schedule` listeners CalDAV PUT uses. Local-only in this epic (external mailto is not emailed).
- **Inbox URI collision.** Sabre `CalendarHome::getChild('inbox')` is always `Schedule\Inbox`. Tasks VTODO uri `inbox` (`InboxTaskListProvisioner`) must be renamed (e.g. `tasks-inbox`); REST keeps `role: inbox`.
- **Storage.** Inbox rows live in `schedulingobjects` (already in installer SQL). Default-calendar copy is a normal VEVENT (PARTSTAT needs-action / tentative).
- **Recipient match.** Local = `principals.email` / calendar-user-address-set. No MailDelivery in this epic.
- **REST surface.** OpenAPI first: `GET /calendars/scheduling/notifications`, `POST …/respond`, dismiss/DELETE. Own inbox only; cross-user 404. Later-mappable to JMAP `CalendarEventNotification`.
- **UI.** Split shell; Invitations above My calendars; event dialog attendees + PARTSTAT; RSVP also from the event. Offline RSVP via calendars outbox.
- **Handoff.** Child Tasks #482–#485; `pnpm test:api-done-gate` / `pnpm test:apps-done-gate`; verify-issue on #480 / #478.

## Edge cases

- Organizer update / cancel (SEQUENCE) must replace a stale accepted copy on the invitee
- REST `/set` batch that touches participants on multiple events
- CalDAV PUT and REST create of the same attendee set must produce equivalent inbox + tentative event
- Two `inbox` children on calendar-home PROPFIND must not exist after #482
- Invitee dismiss without REPLY vs Accept/Decline that sends REPLY
- Own PARTSTAT PATCH on a CalDAV-originated copy remains valid
