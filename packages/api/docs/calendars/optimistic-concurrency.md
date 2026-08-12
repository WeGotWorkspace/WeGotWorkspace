# Optimistic concurrency (Calendars REST)

Calendar events map to CalDAV `calendarobjects` rows. Multi-VEVENT `.ics` blobs share one etag at the object level; composite ids (`objectId#veventUid`) expose the same token for each logical event in the blob.

## GET

- `GET /calendars/events/{eventId}` returns `ETag` header and `etag` on the event JSON.

## Mutations

`PUT`, `PATCH`, and `DELETE` require `If-Match` or `If-Unmodified-Since`.

Patching or deleting one VEVENT inside a multi-event blob validates against the **whole calendar object** etag. After any mutation in the blob, all composite ids receive a new etag.

Stale tokens return **412** with `code: precondition_failed`.

## JMAP state alternative

Events also carry an opaque `state` token (`jmap_calendar_event_states`). Batch writes via `POST /calendars/events/set` accept per-item `ifInState` against that token; stale states land in the `not*` buckets with `type: stateMismatch` instead of a 412. See [jmap-calendars-summary.md](./jmap-calendars-summary.md).
