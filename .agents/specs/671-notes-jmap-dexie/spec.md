Source: #671 (body-hash: 3924279e)
Goal: #661

# Notes JMAP + Dexie inbound sync

Technical translation of [#671](https://github.com/WeGotWorkspace/wegotworkspace/issues/671). VJOURNAL stays the document of record. Dexie becomes the Notes working set. Inbound `/changes` (then vendor `Note/*` on `POST /jmap`) updates that cache. The workspace must not remount from a full live GET.

## Goal

Calendar-shaped Notes sync: CalDAV VJOURNAL on Sabre, JMAP-shaped sync into Dexie, UI reads only the cache. P0 uses existing REST `/notes/*/changes`. P1 adds `urn:wgw:jmap:notes` and switches inbound to the envelope.

## Non-goals

- FileNode / `.notes` / `PUT /files/collaboration` as a notes store
- Journals on `CalendarEvent` or `urn:ietf:params:jmap:calendars`
- IETF URN `urn:ietf:params:jmap:notes`
- Tasks envelope, JMAP Push, offline share/owner-transfer
- Solo editor without a collab session (P2)
- Reopening #225 whole-entity body-in-outbox as the only persist path

## Affected packages

- packages/api (envelope methods wrapping existing Notes repositories)
- packages/apps (Dexie inbound, remount, body UID path, docs)
- docs/architecture, packages/api/docs

## Technical constraints

- REST `GET /notes/items/changes` requires `notebookId`. P0 client fans out per visible notebook. P1 `Note/changes` is account-wide (copy `CalendarEventChangesMethod` + `JmapAccountStateCodec`).
- Inbound GET **changed** ids only — do not re-list every notebook’s full bodies on the poll.
- Skip pending outbox ids on ingest (Calendar `calendars-jmap-inbound` pattern).
- `successVersion` must not remount `NotesWorkspace` on cache→live follow-up.
- Title/tags/star/notebook: Dexie `pendingSync` immediately; network may stay debounced.
- Body cache + y-indexeddb crash buffer keyed by **UID**, never Drive path.
- Envelope handlers call `NoteRepository` / `NotebookRepository` only — no second writer.
- REST `/notes/*` stays for non-sync CRUD after P1.

## Edge cases

- `cannotCalculateChanges` → one full resync, then resume tokens
- Newly visible notebook: all current note ids are `created`
- Removed notebook: cached notes for that collection are `destroyed` unless pending
- Dirty Y.Doc + stale etag → existing conflict dialog (Decision 6); do not silent-reseed
- `local-*` creates stay in Dexie until flush remaps UID
