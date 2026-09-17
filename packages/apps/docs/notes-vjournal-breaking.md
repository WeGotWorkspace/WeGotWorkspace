# BREAKING: Notes leave Drive

Notes are CalDAV **VJOURNAL** objects in VJOURNAL-only notebooks. They are no longer Drive markdown files.

## What changed

- Per-note Drive grants on `…/.notes/{notebook}/{id}.md` are **not** migrated and are **not** recreated. After cutover a note is visible only via notebook ACL or group membership.
- `GET /files/shared-with-me?includeNotes=true` no longer returns notes. There is no per-note Shared-with-me inbox.
- FileNode `note` projection and `FileNode/set` `note` patches are removed.
- `PUT /files/collaboration` is unchanged for Drive docs. Notes persist with `PATCH /notes/items/{uid}` + `If-Match`. Collab room key is the VJOURNAL `UID`.
- Group `.notes/` directories are no longer provisioned as a product path. Group notebooks are CalDAV collections (`notes-{slug}` / `group-{slug}`).

## What to do

Share the **notebook** (same collection share UI as Calendar and Tasks). Re-star notes if a Drive star path was not in the migration map. Drain any FileNode Dexie notes outbox before running `wgw:notes:migrate-files`.
