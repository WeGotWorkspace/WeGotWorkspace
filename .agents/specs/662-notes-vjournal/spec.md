Source: #662 (body-hash: 14483cc6)
Goal: #661

# Notes as CalDAV VJOURNAL notebooks

Technical translation of Epic #662. Product context: Goal #661 (notes are first-class shared notebooks, not Drive files).

## Goal

Move Notes from Drive markdown / FileNode + Yjs sidecars to CalDAV **VJOURNAL** in VJOURNAL-only notebooks. REST is JMAP-shaped and cloned from Tasks, but `noteId` = `UID` (never object-uri). Collection ACL via `CalendarShareInvites`. Live collab stays an ephemeral Yjs session that seeds from `DESCRIPTION` and commits with `If-Match`. Stars stay a per-user table with FK cascade. One-way `.md` import then FileNode teardown.

## Non-goals

- JMAP Notes wire protocol
- Dual-write with files / FileNode projection
- `ATTACH` / upload pipeline
- Mixing VJOURNAL into event calendars or task lists
- Inviting unknown emails / guest principals
- Server-side collab kick on ACL revoke
- Task comments as VJOURNALS; hidden meta collections
- A third sidebar pattern besides `@/collection-sidebar`
- Last-write-wins collab; object-uri as REST id

## Affected packages

- `packages/api` — provisioners, converters, REST, stars table, move helper, migrator, OpenAPI
- `packages/apps` — `notes-core`, collection-sidebar gaps, collab join/save, offline
- `docs/architecture` — `notes.md`; Notes row in `tasks.md`

## Technical constraints

- **Canonical id = `UID`.** REST, collab room, stars, migration map. Lookup `calendarobjects.uid`. Never filename, never `calendardata` scan.
- **`UNIQUE (calendarid, uid)`.** Duplicate → 409. Pre-index duplicate report fails migration (no silent winner).
- **Stars:** `(username, calendar_object_id, note_uid)` FK cascade on `calendarobjects.id`. Unique `(username, calendar_object_id)`. Optional `INDEX (note_uid)`.
- **Move:** one helper — in-place `calendarid` + source/dest `calendarchanges` + both synctokens. REST and CalDAV MOVE use it. No bare Eloquent `calendarid` save.
- **Concurrency:** `If-Match` / 412. Dirty + stale etag → conflict dialog, never silent reseed.
- **ACL:** notebook only. Persist 403 → client leaves room + visible “no access / not saved.” No server kick in v1.
- **ICS size:** soft 2 MiB markdown cap → 413. Migrator skip/fail + log; no silent clip.
- **Search:** index `SUMMARY` + `DESCRIPTION` on write; archived (`CANCELLED`) stay findable; chunk 5 bulk-reindexes.
- **Sidebar:** `@/collection-sidebar` only. No Notes-owned/shared fork.
- OpenAPI → failing tests → implement. Isolation migrator owns `calendars.components` with Calendar create — single owner.

## Edge cases

- GET by uid when `uri` ≠ `{uid}.ics` (foreign href, same UID).
- Second object with same UID in one notebook → 409 (REST and, if easy, CalDAV PUT).
- Move: `calendarobjects.id` + star row unchanged; source `/changes` = removed; dest = created.
- Delete item or notebook leaves no star rows (cascade; no app UID scan after delete).
- Persist 403 mid-session: leave mesh, stop updates, visible message, editor read-only or navigate away.
- Import image count > 0: still copy verbatim; log count + note id.
- Import over-limit body: skip or fail that row; no clip.
- Star paths not in the map: skip + log; do not star by filename stem.
