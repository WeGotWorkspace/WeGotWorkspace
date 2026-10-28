# Calendar scheduling (iTIP)

Same-instance meeting invites use Sabre’s `ITip\Broker` and CalDAV Scheduling (RFC 6638). Event writes from JMAP `CalendarEvent/set` and CalDAV PUT share that path: a REQUEST (or CANCEL) lands in the attendee’s `schedulingobjects` inbox and a tentative VEVENT is copied to their default calendar.

## Which object a message changes

UID lookups for scheduling never search a read-only shared calendar. Delivery to an attendee and the attendee's inbox copy only use calendars the attendee owns (own calendars first, then group calendars). The organizer's event, for a REPLY or a guest RSVP link, is looked up in the organizer's own calendars, then group calendars, then calendars shared to the organizer with write access. A REQUEST or CANCEL updates the attendee's copy only when its ORGANIZER is the sender. A REPLY updates the organizer's own event only for an attendee already on it. When the attendee already owns an object with that UID that does not qualify, the message is not delivered to that attendee and the object stays unchanged (CalDAV: schedule status `3.8`). The inbox RSVP answers the attendee's own copy; a guest RSVP link answers the organizer's own event.

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
