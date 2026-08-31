Source: #671 (body-hash: 609abe04)
Goal: #661

# Notes JMAP + Dexie inbound sync

Technical translation of [#671](https://github.com/WeGotWorkspace/wegotworkspace/issues/671). **Current truth (JMAP-back iteration):** CalDAV VJOURNAL is the document of record. Dexie is the Notes UI working set. Live inbound is vendor `Note/*` + `Notebook/*` on `POST /jmap` (`urn:wgw:jmap:notes`). REST `/notes/*` stays for CRUD + reconnect / mock / fallback. The workspace must not remount from a full live GET.

Issue #671 AC matches this JMAP-first inbound. REST `/changes` is reconnect / mock / fallback only.

## Goal

Calendar-shaped Notes sync: CalDAV VJOURNAL on Sabre, vendor JMAP envelope into Dexie, UI reads only the cache.

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

- **Live inbound:** `POST /jmap` capability `urn:wgw:jmap:notes` — `Notebook/get|changes|set` and `Note/get|changes|set`. `Note/changes` is account-wide (same fan-out as `CalendarEventChangesMethod` + `JmapAccountStateCodec`).
- **REST `/notes/*`:** non-sync CRUD after the envelope landed. `GET /notes/items/changes` still requires `notebookId` and remains for reconnect / manual refresh / mock-tier fallback when the live JMAP session is missing.
- Inbound GET **changed** ids only — do not re-list every notebook’s full bodies on the poll.
- Skip pending outbox ids on ingest (Calendar `calendars-jmap-inbound` pattern).
- `successVersion` must not remount `NotesWorkspace` on cache→live follow-up.
- Title/tags/star/notebook: Dexie `pendingSync` immediately; network may stay debounced.
- Body cache + y-indexeddb crash buffer keyed by **UID**, never Drive path.
- Envelope handlers call `NoteRepository` / `NotebookRepository` only — no second writer.
- Each principal has a default notebook that cannot be deleted. Provisioned group homes (e.g. Administrators / `group-administrators`) also cannot be deleted — UI hides delete like calendars/tasks.

## Edge cases

- `cannotCalculateChanges` → one full resync, then resume tokens
- Newly visible notebook: all current note ids are `created`
- Removed notebook: cached notes for that collection are `destroyed` unless pending
- Dirty Y.Doc + stale etag → existing conflict dialog (Decision 6); do not silent-reseed
- `local-*` creates stay in Dexie until flush remaps UID
