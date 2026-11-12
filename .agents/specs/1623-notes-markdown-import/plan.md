# Import Markdown files as notes

Derived from [spec.md](./spec.md). One builder, sequential chunks in one PR into `integration/import-export`.

## Goal

See spec.md Goal. One PR: parser, orchestrator, shared image upload, dialog, menu wiring, tests, story.

## Budget

Client only. No new dependency (front matter is read with a small subset parser).

## Non-goals

See spec.md.

## What exists

- Notes new menu has one item. `path: packages/apps/src/notes-core/src/notes-new-menu.tsx:20`
- Contacts and Calendar add import under the same segmented menu. `path: packages/apps/src/contacts-core/src/contacts-new-menu.tsx:31`, `path: packages/apps/src/calendar-core/src/calendar-new-menu.tsx:42`
- Hidden file input + import dialog wiring. `path: packages/apps/src/contacts-core/src/contacts-workspace.tsx:508`
- Direct note create with client uid. `path: packages/apps/src/lib/api/wgw/notes-vjournal.ts:232`
- A repeated create with the same uid returns the existing note. `path: packages/api/app/Services/Notes/NoteRepository.php:462`
- Body PATCH needs `If-Match`. `path: packages/api/app/Services/Notes/NoteRepository.php:173`
- Docs hidden attachment upload. `path: packages/apps/src/text-editor-core/docs-collab/docs-image-upload.ts:93`
- `drive:fn-…` reference helpers. `path: packages/apps/src/text-editor-core/src/text-editor-image-src.ts:11`
- Notes body editor is `DocsCollabEditor` with `format="markdown"`, so `DocsImage` renders `drive:` sources. `path: packages/apps/src/note-detail-view/src/note-text-editor-body.tsx:245`, `path: packages/apps/src/text-editor-core/src/text-editor-extensions.ts:124`
- Server ACL inheritance for `.attachments/<fn-id>/` only applies to Doc FileNodes. `path: packages/api/app/Services/Drive/DriveShareAuthorizer.php:373`
- Tag rule. `path: packages/apps/src/lib/models/note-tag.ts:1`, `path: packages/api/app/Services/Notes/NoteTag.php:16`

## Considered

- Image folder keyed per note under the importer's (or group's) principal — **chosen**. It reuses the Docs upload unchanged and keeps files hidden. Readers are the importer, or every member for a group notebook.
- Server-side read inheritance for `.attachments/note-<uid>/` from note access (like Docs inherits from the Doc FileNode) — **deferred**. It changes `DriveShareAuthorizer`, which is security-sensitive and should get a human review rather than an unattended overnight merge. The folder name `note-<uid>` is chosen so that change can key off it later without moving files.
- A visible Drive folder (for example `Notes images/`) — rejected: clutters Drive, and the product lead asked for the Docs way (hidden folder).
- Keeping data URLs inline in the body — rejected by the product lead; also `serializeDocsImageSrc` drops `data:` on the first collab save, and large images hit the 2 MiB cap.
- Create the note with the full body in one call (upload first, keyed by the client uid) — rejected: the product lead set the order create → upload → write body.
- `yaml` / `js-yaml` for front matter — rejected: only two keys are needed; a dependency would need a license and bundle review for little gain.
- Calendar's `DropdownMenu` + `CalendarPickerMenuItem` picker — rejected for Notes; `NotesNotebookSelect` is the Notes picker (move dialog, action bar). It gets one prop, `createSelected`, so *Create notebook* can show as the chosen value.
- Toast-only result (Contacts) vs a result view in the dialog — both: toast when there is nothing to report, result view when files were skipped, tags dropped or images not imported. The skipped list does not fit a toast.

## Affected packages

- packages/apps

## Dependencies

1. `chunk-shared-upload` (split Docs upload) before `chunk-run` (uses it).
2. `chunk-parser` before `chunk-run`.
3. `chunk-run` before `chunk-ui`.

## Open decisions

None for this PR. Follow-up for the product lead: server read inheritance for note images in shared personal notebooks (see Considered).

## Invariants

- Docs image upload keeps working (same folder, same rename). Proof: `path: packages/apps/src/text-editor-core/docs-collab/docs-image-upload.test.ts` assertion "keys the hidden attachments folder by the Doc FileNode id".
- A retry with the same file does not create a second note. Proof: `path: packages/apps/src/notes-core/src/notes-markdown-import-run.test.ts` assertion "reuses the uid on retry so a network error does not duplicate the note".
- A failing file does not stop the batch. Proof: `path: packages/apps/src/notes-core/src/notes-markdown-import-run.test.ts` assertion "skips bad files with a reason and keeps going".
- New-menu items of Contacts and Calendar are unchanged. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/contacts-core/src/contacts-new-menu.test.tsx src/calendar-core/src/calendar-new-menu.test.tsx`.
