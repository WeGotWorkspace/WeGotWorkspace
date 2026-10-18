Source: #1381 (body-hash: 08fa77bb)
Goal: #1304

# Refuse a Notes save when the note changed outside the app

Technical translation of Task #1381. The acceptance criteria stay in the issue. Reuses the #1380 contract unchanged: 409 `{"error": "external_write"}`, the `X-Wgw-External-Write` acknowledgement, `isExternalWriteRefusal`, `askAboutRefusedSave`, and `externalWriteSeenRef`.

## Goal

A client that has a note open no longer writes over an outside CalDAV edit on its next autosave. `NoteCollaborativeWrite::put()` refuses the save while the journal's SUMMARY or DESCRIPTION is not the text the stored Yjs state was written from, unless the save names that text. The client asks in `NotesExternalWriteDialog`, the same question the read path already asks.

## Non-goals

- The read-path detection from #1314
- Docs (#1380)
- A second header name or error code

## Affected packages

- `packages/api` — `NoteCollaborativeWrite::put()`, `NotesController::putCollaboration`, `NoteYjsProjection` (content tag), `NoteRepository::show()` (`contentEtag` on the Note JSON), OpenAPI
- `packages/apps` — `loadCollabText` (prefers `contentEtag`), `NoteCollabSession` (shared prompt hooks), `NotesExternalWriteDialog` (`keepLocalDisabled`), the conformance table

## Technical constraints

- **Refusal:** inside the existing `lockForUpdate` transaction, after `assertStatePrecondition`. A stored `note_yjs_state` row with `NoteYjsProjection::isExternalContentWrite()` true refuses with 409 and the code `external_write`. The error message is also `external_write`, so the body's `error` field matches the #1380 contract and the shared client classifier. No row, or a metadata-only journal change (same content hash), saves as today.
- **Acknowledgement tag:** the content tag `"<sha1(DESCRIPTION \0 SUMMARY)>"`, the same hash `NoteYjsProjection::hashContent()` stores in `content_etag`. It is not the VJOURNAL ETag, so a tag, move, or archive while the dialog is up does not ask again. The tag must name the current content exactly; `*` and an empty value are refused.
- **Where the client gets the tag:** `GET /notes/items/{id}` adds `contentEtag` to the Note JSON. `loadCollabText` uses a JSON `contentEtag` when present and the response `ETag` otherwise. That is a representation rule, not an app branch, so the #1313 test still holds.
- **Client:** `NoteCollabSession` uses `useDocsExternalWriteRequest` and `useDocsExternalWritePrompt` from `text-editor-core/docs-collab`. The question is tied to its room, a failed answer keeps the dialog and the hold, and Keep my edits is disabled once outside text replaced the local note in the question chain. The refusal, pending-offline, and reconnect handling are the shared #1380 paths.

## Edge cases

- An outside SUMMARY-only edit refuses too: the content hash covers the title.
- A second outside edit while the dialog is up: the answer names the older content tag and is refused again; the dialog shows the new text.
- A pending offline Notes save meets the refusal on reconnect: it ends in the dialog and stays pending.
