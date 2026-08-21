# Calendar scheduling (iTIP)

Same-instance meeting invites use Sabre’s `ITip\Broker` and CalDAV Scheduling (RFC 6638). Event writes from JMAP `CalendarEvent/set` and CalDAV PUT share that path: a REQUEST (or CANCEL) lands in the attendee’s `schedulingobjects` inbox and a tentative VEVENT is copied to their default calendar.

## REST inbox

| Method | Path | Effect |
|--------|------|--------|
| GET | `/calendars/scheduling/notifications` | Own inbox only; omits events that have entirely ended (one-off DTEND/DTSTART before now, or recurring series with no remaining instances) |
| POST | `/calendars/scheduling/notifications/{id}/respond` | RSVP (`accepted` / `tentative` / `declined`) and send REPLY |
| DELETE | `/calendars/scheduling/notifications/{id}` | Dismiss without REPLY |

Another user’s notification id is **404**. Local delivery never emails instance users.

## External attendees (iMIP)

Mailto addresses that do not match a local principal are sent through `MailDeliveryService` as multipart iMIP (`text/calendar; method=REQUEST|REPLY|CANCEL`). Each REQUEST includes a public RSVP URL. REPLY is a status notification (no new token). When `canSubmit` is false, the participant is still stored and no mail is sent.

SEQUENCE follows the iTIP Broker `significantChange` flag (RFC 5546). Description/color edits and attendee PARTSTAT-only writes do not bump SEQUENCE or send a new REQUEST. Significant updates revoke outstanding RSVP tokens before issuing a replacement. Tokens are stored as SHA-256 hashes; the public RSVP routes are rate-limited.

| Method | Path | Access |
|--------|------|--------|
| GET | `/calendars/scheduling/invitees` | User — instance users plus `canSubmitEmail` |
| GET | `/calendar/rsvp/{token}` | Guest |
| POST | `/calendar/rsvp/{token}` | Guest — `{ participationStatus }` |

Expired or unknown RSVP tokens are **404**. Duplicate POSTs with the same PARTSTAT are idempotent. Significant updates and CANCEL invalidate outstanding tokens.

## Tasks inbox URI

Sabre `CalendarHome::getChild('inbox')` is always the schedule-inbox. The Tasks VTODO collection is `tasks-inbox` (`role: inbox` on REST).
