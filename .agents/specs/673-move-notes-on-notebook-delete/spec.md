Source: #673 (body-hash: b38df3b1)
Goal: #673

# Move notes when deleting a notebook

Technical translation of Goal #673 and the implementation-plan comment on that issue. The comment, written against commit `38953d7`, is the build contract.

## Goal

Deleting a notebook that still has notes offers the owner a choice: move every note to a writable notebook in one request, or permanently delete the notes with the notebook. An empty notebook still deletes in one step. The server move is atomic. The client no longer loops per note, and a move no longer drops the moved notes from the local cache.

## Non-goals

- Moving notes without deleting the source notebook
- Notebook create, rename, share, or the delete of the notebook record itself (#661)
- Archive or hide of an empty notebook
- The same delete-time move for task lists (#674) or calendars (#675)
- CalDAV clients deleting a notebook outside this app
- A note count on the Notebook payload
- JMAP `Notebook/set` and the MCP notebook tool (they keep purge-or-409)

## Affected packages

- packages/api
- packages/apps
- packages/openapi-types

## Technical constraints

- `DELETE /api/v1/notes/notebooks/{notebookId}` gains `moveNotesTo` on the body schema and as a query parameter. Query is the client path. `moveNotesTo` and `onDestroyRemoveContents` are mutually exclusive.
- "Has notes" is the existing 409 `notebookHasContents`, including archived notes. The client does not count notes.
- Destinations are writable notebooks other than the source, including group notebooks. Read-only sharee notebooks are not offered.
- Sharee removal stays a share dismissal and does not move notes.
- Bulk move reuses `NoteMoveHelper` (object id, uid, star foreign key, dual changelog) and checks uid uniqueness before moving any row.
- `DeleteNotebookAction` becomes `{ kind: "move"; target: string } | { kind: "purge" } | { kind: "purge-if-empty" }`. `target` is a notebook id.
- One chunk: `notebook-delete-move`.

## Edge cases

- A notebook that holds only archived notes still 409s and opens the choice.
- Move to the source, to an unknown id, or to a read-only notebook moves nothing.
- General and provisioned group notebooks still 403 before any move.
- A sharee delete with `moveNotesTo` dismisses the share and leaves the owner's notes in place.
- A uid already present in the destination aborts the whole move.
