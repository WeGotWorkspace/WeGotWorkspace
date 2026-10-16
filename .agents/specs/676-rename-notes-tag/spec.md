Source: #676 (body-hash: 932755b2)
Goal: #676

# Rename a notes tag across every loaded note

Technical translation of GitHub issue #676 and the implementation-plan comment on that issue. A tag is not a stored entity. It is a string on each note. Renaming it rewrites every loaded writable note that carries the old name.

## Goal

A person edits an existing tag name in the Notes sidebar. Every loaded writable note that had the old tag, including archived notes, gets the new name in one undoable action. The sidebar and the open tag view show the new name. Notes that did not have the tag stay unchanged. Renaming onto a tag that already exists merges the two, after the dialog says so. Read-only notes are skipped and the toast counts them.

## Non-goals

- A new server endpoint, bulk route, or tag table
- Creating a tag that no note uses
- Deleting a tag from every note at once
- Nested tag taxonomies or a workspace-wide tag admin
- Task tags (#561)
- Design-language consistency as its own outcome
- A dedicated offline outbox op for paired tag renames

## Affected packages

- packages/apps
- packages/api (one feature test only; no production PHP change)

## Technical constraints

- Client fan-out via the existing `{tagsAdd, tagsRemove}` delta on `PATCH /notes/items/{noteId}`. Do not send a full `categories` replace.
- Writable set matches `noteAllowsTagAssignment(note, true)`, the same flag `assignTagToNotes` passes.
- Per-note Dexie upsert. Do not rewrite the notes bootstrap cache.
- `use-notes-mutations.tsx` is baselined at 937 lines and must not change length.
- `notes-workspace.tsx` stays at or under 800 lines. The rename dialog and mutation live in new files.
- Tag view matching is case-insensitive, same as the sidebar list, so a legacy mixed-case tag can be opened and renamed.

## Edge cases

- New name equal to the old name aside from case: no write.
- Invalid new name (not letters a-z and hyphen): error toast, no write.
- No loaded writable note carries the tag: silent return.
- A note that already has the target tag is a merge. Undo does not strip the target from that note.
- Two overlapping tag edits queued offline can coalesce in `mergeNoteTagDeltas` and may not equal either intent. Accepted.
