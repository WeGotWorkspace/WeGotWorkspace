# Calendar scheduling (iTIP)

Same-instance meeting invites use Sabre’s `ITip\Broker` and CalDAV Scheduling (RFC 6638). Event writes from JMAP `CalendarEvent/set` and CalDAV PUT share that path: a REQUEST (or CANCEL) lands in the attendee’s `schedulingobjects` inbox and a tentative VEVENT is copied to their default calendar.

## REST inbox

| Method | Path | Effect |
|--------|------|--------|
| GET | `/calendars/scheduling/notifications` | Own inbox only |
| POST | `/calendars/scheduling/notifications/{id}/respond` | RSVP (`accepted` / `tentative` / `declined`) and send REPLY |
| DELETE | `/calendars/scheduling/notifications/{id}` | Dismiss without REPLY |

Another user’s notification id is **404**. Local delivery never emails instance users.

## External attendees (iMIP)

Mailto addresses that do not match a local principal are sent through `MailDeliveryService` as multipart iMIP (`text/calendar; method=REQUEST|CANCEL`). Each REQUEST includes a public RSVP URL. When `canSubmit` is false, the participant is still stored and no mail is sent.

| Method | Path | Access |
|--------|------|--------|
| GET | `/calendars/scheduling/invitees` | User — instance users plus `canSubmitEmail` |
| GET | `/calendar/rsvp/{token}` | Guest |
| POST | `/calendar/rsvp/{token}` | Guest — `{ participationStatus }` |

Expired or unknown RSVP tokens are **404**. Duplicate POSTs with the same PARTSTAT are idempotent. CANCEL invalidates outstanding tokens.

## Tasks inbox URI

Sabre `CalendarHome::getChild('inbox')` is always the schedule-inbox. The Tasks VTODO collection is `tasks-inbox` (`role: inbox` on REST).
