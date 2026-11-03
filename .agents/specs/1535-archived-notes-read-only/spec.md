Source: #1535 (body-hash: dac44732)

# Archived notes are read-only

Technical translation of #1535. The redirect from an old URL in #1531 (body-hash: 303a7fb1) ships on the same branch, because it must land on the read-only view this spec adds.

## Goal

An archived note (`STATUS:CANCELLED`) cannot change until it is restored. The API refuses every content and metadata write to it with one error, `409 note_archived`, and still allows restore, delete and the personal star. The Notes UI shows an archived note read-only and keeps restore and delete. An edit queued offline for a note archived elsewhere ends with a notice, the same way a note deleted elsewhere does. A note opened under a non-archive URL moves to the Archived view.

## Non-goals

- A guard on raw CalDAV `PUT` from third-party clients (Decision 17). The choice is open; see "CalDAV".
- Excluding archived notes from search (Decision 13 keeps them findable).
- A bulk restore, or archiving a whole notebook.
- Moving a notebook's notes on notebook delete (`NotebookNotesMover`). That is a notebook operation and still moves archived notes with the rest.

## Affected packages

- packages/api (NoteRepository, NoteCollaborativeWrite, CollabJoinAuthorizer, JmapSetErrors, OpenAPI)
- packages/apps (notes-core, lib/offline notes, text-editor-core docs-collab save)
- docs/architecture/notes.md

## Write paths and the rule

| Path                                   | Entry                                      | Archived note                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /notes/items/{id}`              | `NoteRepository::patch`                    | Refused when the patch carries `title`, `body`, `categories`, `categoriesAdd`, `categoriesRemove`, `notebookId` or `yjs`. A status-only patch (restore, or archive again) passes. An empty patch passes. |
| `PUT /notes/items/{id}` (collab frame) | `NoteCollaborativeWrite::put`              | Refused.                                                                                                                                                                                                 |
| JMAP `Note/set` update                 | `NoteRepository::patch`                    | Same as PATCH. SetError `forbidden`, description `note_archived`. `starred` alone still applies.                                                                                                         |
| MCP `note_write` update                | `NoteRepository::patch`                    | Same as PATCH. Tool error `note_archived`.                                                                                                                                                               |
| `DELETE`, JMAP destroy, MCP delete     | `NoteRepository::delete`                   | Allowed.                                                                                                                                                                                                 |
| Star / unstar                          | `NoteRepository::star`                     | Allowed: a personal flag in its own table, not a change to the note.                                                                                                                                     |
| Collab room join                       | `CollabJoinAuthorizer::accessFor`          | Peer access is `read`.                                                                                                                                                                                   |
| CalDAV `PUT` on the `.ics`             | `WgwCalendarBackend::updateCalendarObject` | Unchanged. See "CalDAV".                                                                                                                                                                                 |

The check reads the stored `STATUS` inside the locked transaction, after the precondition check, so a concurrent archive cannot slip between check and write. A patch that restores and edits in one request is refused: restore first, then edit.

## Error

`409` with `{"error": "note_archived", "code": "note_archived"}`. Same shape and status family as `409 external_write` from #1381: the request conflicts with the current state of the note, nothing is written, and the shared collab client reads `error`. Not `403`: the offline outbox treats 403 as lost access, and the person still has access. Not `423`: that is a WebDAV lock.

## Client

- Read-only view: an archived active note is read-only like a view-only share (body, title, tags), and its notebook switcher is locked. Archive and star stay enabled. Delete stays in the list.
- Batch: a multi-select that holds an archived note offers no move. Drag-to-notebook, tag drops and the tag rename skip archived notes.
- Body: an archived note opens without a collab session, so nothing types into a room the server will refuse.
- Offline metadata edit: the outbox and the online upsert treat `409 note_archived` as "archive wins". They drop the note's queued rows, store the server copy, and announce `noteArchivedElsewhere` on a cross-tab topic. Each tab shows "Changes to “title” were not saved. It was archived elsewhere."
- Offline body edit: `409 note_archived` is a terminal save failure in the shared collab save (`archived`), not a divergence. It is not remerged and not reported as a sync conflict. The pending flag clears, the local buffer for the room is discarded, and the same notice is shown. The background sweep for closed notes does the same.
- #1531: when the server copy of the open note (`data.notes`) is archived and the view is not `archive`, the view moves to `archive` and keeps the note. This covers a deep link and an archive from another tab. An archive made in this tab closes the note first, as today.

## CalDAV

Raw CalDAV is not changed here. Options for the product lead:

1. Keep it open (recommended for v1, matches Decision 17). A CalDAV client is an outside writer. Its edit to an archived journal is kept, and the app shows it as an outside write.
2. Refuse in `WgwCalendarBackend::updateCalendarObject` with `403` when the stored and the new VJOURNAL are both `CANCELLED` and `SUMMARY`, `DESCRIPTION` or `CATEGORIES` differ. A changed `STATUS` (restore) and `DELETE` pass. Generic clients surface a 403 as a sync error and may retry it.

## Edge cases

- Patching `status: CANCELLED` on a note that is already archived: allowed, no content change.
- A queued metadata row that only stars: the PATCH is empty and passes; the star applies.
- An `If-Match` mismatch on an archived note: `412` first, because the precondition runs before the archive check; the retry then gets `409 note_archived`.
- A tag rename across notes (#676) now skips archived notes and counts them with the other read-only notes in the toast. An archived note keeps the old tag until it is restored. #676 included archived notes; this rule replaces that.
- Restore in another tab while this tab shows the note read-only: inbound sync clears `archived`, the view stays `archive`, the note leaves that list and closes as it does today.
