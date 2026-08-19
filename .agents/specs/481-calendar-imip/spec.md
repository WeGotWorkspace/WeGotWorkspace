Source: #481 (body-hash: d0c394df)
Goal: #479

# Calendar iMIP and RSVP links

Technical translation of Epic [#481](https://github.com/WeGotWorkspace/wegotworkspace/issues/481). Product context: Goal [#479](https://github.com/WeGotWorkspace/wegotworkspace/issues/479) (invite people outside the instance by email). Depends on the shared iTIP broker from Epic [#480](https://github.com/WeGotWorkspace/wegotworkspace/issues/480) / [480-calendar-scheduling](../480-calendar-scheduling/spec.md) and platform mail Goal [#471](https://github.com/WeGotWorkspace/wegotworkspace/issues/471) (PR #475).

## Goal

External attendees (mailto not matching a local principal) receive the same iTIP payload via iMIP (RFC 6047) through `MailDeliveryService` — multipart HTML + `text/calendar; method=REQUEST|CANCEL` (and REPLY when we send one). Each mail includes a signed HTTPS RSVP URL so the organizer's PARTSTAT updates without parsing inbound mail.

## Non-goals

- Same-instance invitations / Calendar inbox UI — Goal #478 / Epic #480
- Platform email delivery itself — Goal #471 / #473
- Inbound Mail-app iMIP REPLY parsing (later)
- Inbox placement at Gmail/Outlook as an AC
- A second SMTP path or stock `IMipPlugin::mail()`
- Free-busy, COUNTER, delegation, iSchedule

## Affected packages

- `packages/api` — iMIP emitter on the existing `schedule` path, RSVP token + public route, `UiStaticServer` allowlist, feature tests
- `packages/apps` — disable/hide send when `canSubmit` is false; RSVP landing if it is a suite route (allowlist + `FrontRoutingTest`)

## Technical constraints

- **Consumer of #471.** `MailDeliveryService::send()` only. No PHP `mail()`, no Mail-app SMTP, no new transport.
- **Routing.** After #480, local principals stay on `schedulingobjects`; everyone else is iMIP. Do not email instance users.
- **RSVP.** Token binds event uid + attendee mailto + expiry. Public `/calendar/rsvp/{token}` on `UiStaticServer` + `FrontRoutingTest`. Success updates organizer PARTSTAT and may emit iTIP REPLY to the organizer (local inbox if they are local).
- **Capability.** When `canSubmit` is false, do not silently send; Calendar states that email delivery is unavailable.
- **CI.** Mail fake / transport spy asserts `text/calendar; method=` + RSVP URL. No live inbox assert.
- **Handoff.** Task #486; `pnpm test:api-done-gate`; SPA allowlist architecture test; verify-issue on #481 / #479.

## Edge cases

- Organizer cancel after send → iMIP CANCEL (and RSVP token invalidated)
- Duplicate RSVP submissions are idempotent on the same PARTSTAT
- Expired / reused token → 4xx, no PARTSTAT change
- External attendee added while `canSubmit` is false → event may store the participant; no send
- SEQUENCE bump: new REQUEST mail + new token
