Source: #1623 (body-hash: 746f6898)
Goal: WeGotWorkspace/Product#136

# Import Markdown files as notes

Technical translation of Task [#1623](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1623), with the product lead's changes from 2026-11-10 (posted as a comment on #1623). Where those changes differ from the issue body, the changes win.

## Changes from the issue (2026-11-10)

1. The import lives under the segmented primary button in the Notes sidebar (`NotesNewMenu`), the same way Contacts (`ContactsNewMenu`, *Import vCard*) and Calendar (`CalendarNewMenu`, *Import ICS*) do it: an optional `onImport…` callback adds an `Upload` item; a hidden `<input type="file" multiple>` in the workspace opens the picker.
2. Several files at once; each Markdown file becomes its own note (same as the issue).
3. Front matter `title` → note title; fallbacks stay (first-line H1, then file name). Front matter is removed from the body. Tags rule unchanged.
4. **Base64 images are imported.** An inline Markdown image whose source is a `data:image/…;base64,…` URL is decoded and stored as a file in Drive in a hidden attachments folder, and the body refers to it as `drive:fn-…` — the same reference Docs uses. Order per file: create the note, upload its images, then write the body once. Relative-path images stay text and are counted as "images not imported" (as in the issue).

## Goal

A person picks one or more `.md`, `.markdown` or `.txt` files, chooses a notebook (existing writable one, or a new one by name), and gets one note per file with title, tags and body. Embedded base64 images become Drive files that show in the note.

## Non-goals

- Everything listed under Non-goals in #1623 (Keep, zip/folder, ENEX/HTML conversion, drag-and-drop — drag-and-drop may follow as its own PR).
- Images in raw HTML (`<img src="data:…">`) and reference-style images (`![a][ref]`). They stay as text.
- Server-side read inheritance for note images (see plan.md, Open follow-up). Images are stored where the importer — or, for a group notebook, every group member — can read them.
- Cleaning up a note's image folder when the note is deleted.
- Setext headings (`Title\n===`) as a title source; only an ATX `# Title` first line counts.
- A full YAML parser. Only `title` and `tags` are read from front matter.

## Packages

- `packages/apps` only. No API change.

## Behaviour

### Picking files

- Menu item *Import Markdown files* (`Upload` icon) under the Notes new menu. Hidden when the workspace has no import operations (Storybook without mocks, read-only providers).
- While offline the item is disabled with the description "Needs a connection".
- The picker accepts `.md,.markdown,.txt,text/markdown,text/plain`, `multiple`. Files with another extension are skipped with the reason "Not a Markdown or text file".

### Dialog

- Same shape as `calendar-import-dialog.tsx`: title, destination picker, optional "new notebook" name field, Cancel / Import.
- The destination picker is `NotesNotebookSelect` listing writable notebooks (`isViewOnlyNotebook` false), plus *Create notebook*. Picking that switches to create mode and shows a *Notebook name* field (default "Imported notes"). With no writable notebook, create mode is the default.
- Default destination: the notebook of the current sidebar view when it is writable, else the default notebook, else the first writable one.
- While importing: progress line "Importing 3 of 7…" and a progress bar (same CSS as Contacts import).
- After import: when every file was imported with nothing to report, the dialog closes and a toast says "Imported N notes". Otherwise the dialog shows a result view: "Imported N notes", a list of skipped files with their reason, dropped tags, and the number of images not imported, with a *Done* button. Either way the destination notebook is selected.

### Per-file rules (pure parser, `notes-markdown-import.ts`)

1. Read bytes. Over 25 MiB raw → skipped "File is too large". Decode with `TextDecoder("utf-8", { fatal: true })`; failure or a NUL character → skipped "Not a UTF-8 text file". A leading BOM is dropped.
2. Only whitespace → skipped "File is empty".
3. Front matter: the file starts with a `---` line and a later `---` or `...` line closes it. Without a closing line there is no front matter. Read keys:
   - `title`: a scalar, quotes removed.
   - `tags`: inline list `[a, b]`, block list (`- a`), or a scalar with commas. A leading `#` is removed.
4. Title: front matter `title` (trimmed, non-empty) → else the first non-blank body line when it is `# Title` (that line is removed) → else the file name without extension. Cut to 1024 characters.
5. Tags: normalised with `normalizeTag`; valid when `isValidNewTag` (letters a–z and hyphen, same rule as the server `NoteTag::INPUT_PATTERN`). Duplicates are removed. Invalid ones are dropped and listed in the result.
6. Images, outside fenced code blocks only, in inline image syntax (alt text in brackets, then the source and an optional title in parentheses; one level of nested brackets in the alt text):
   - `data:image/<type>;base64,<data>` → extracted for upload; the body keeps a placeholder until the upload is done.
   - Relative path (no URL scheme, not `//…`, not `#…`) → left as is, counted as not imported.
   - `http(s):`, `drive:` and other schemes → left as is, not counted.
7. Body size: the final body (with every data image already replaced by a `drive:fn-<32 hex>` reference of fixed length) must be at most 2 MiB in UTF-8 → else skipped "Note is larger than 2 MB". The check runs before anything is written.

### Writing (orchestrator, `notes-markdown-import-run.ts`)

Per file, in order, one file at a time:

1. `createNote` (direct REST, not the outbox) with `notebookId`, `title`, `categories`, an empty body and a client `uid` (UUID). The uid is kept per `File` object for the dialog's life, so a retry — automatic after a network error, or the person pressing Import again after a failure — returns the same note instead of a new one (server: `NoteRepository::existingCreateForRetry`).
2. Each data image is uploaded with the shared hidden-attachment upload (see below). A failed upload (bad base64, type the browser cannot show, too large, network) replaces the image by its alt text and counts it as not imported; the file still imports.
3. When the final body is not empty: one `PATCH /notes/items/{id}` with `body` and `If-Match` from the create response.
4. The created note is written to the offline cache so the list shows it without a full reload.

A per-file error never stops the batch and never touches existing notes (only the note this file created is written to).

### Image storage (shared with Docs)

`uploadDocAttachmentImage` is split: the folder-independent part (ensure folders, upload blob, create `upload.<ext>`, rename to `<nodeId>.<ext>`) becomes `uploadHiddenAttachmentImage(folderPath, file)`. Docs keeps `uploadDocAttachmentImage` as a wrapper. Notes adds `uploadNoteAttachmentImage(target, noteId, file)`:

- Folder: `/{principal}/.attachments/note-<noteUid>/`, where `{principal}` is `groups/<slug>` for a group notebook and `users/<importer>` otherwise. `.attachments` is browse-hidden and protected from WebDAV writes, like for Docs.
- The body stores an inline image whose source is `drive:fn-…`, made with `toDriveFnSrc`. Notes already renders these: the Notes body is a `DocsCollabEditor` (markdown), whose `DocsImage` node fetches `GET /files/content?id=` with the session.

## Edge cases

- Same file picked twice in one batch → two notes (two `File` objects, two uids).
- New notebook name already in use → the server's notebook create rules apply; on error the dialog shows it and nothing is imported.
- The destination becomes read-only during the batch → each remaining file is skipped with the server's message.
- Session expires mid-batch (401) → the batch stops; the result lists what was imported so far.
