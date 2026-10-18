Source: #1349 (body-hash: 4eaad896)
Goal: #1304

# Detect an external write on a Docs document

Technical translation of Task #1349. The acceptance criteria stay in the issue.

## Goal

A Docs `.md` that has a Yjs sidecar can be written from outside the app again (WebDAV `PUT` / `PATCH`, a Finder mount, the person's own editor). The server records which markdown the current sidecar was written from. On the next `GET /files/collaboration?format=yjs` it sends `X-Wgw-External-Write: 1` when the stored markdown is no longer that text. The Docs client then does what Notes already does since #1314: rebuild quietly when there is no local work, or ask once when there is.

## Non-goals

- Sidecar bytes in the database
- Any other part of #1291: the sidecar stays hidden and unwritable over DAV, and a `MOVE` or `COPY` onto a document that has a sidecar stays refused
- A second header name, or a Notes-only branch in `text-editor-core`
- A database transaction around the two files (N10 withdrawn)
- A migration backfill of rows for existing documents
- Seeding a row before a REST (`writeText`, upload) or JMAP `FileNode/set` write. Those writers were never blocked. Once a row exists, they are detected like any other writer

## Affected packages

- `packages/api` — new `doc_yjs_state` table and model, `DocYjsStateStore`, `DocYjsStateDavPlugin`, `DocCollabDocumentService`, `FileNodeIndexService::recordMoveWithSidecar` / `recordDeleteWithSidecar`, `FilesController::showCollaboration`, `WebdavWriteGuardPlugin` (block removed), OpenAPI
- `packages/apps` — `docs-collab-workspace.tsx` wires `onExternalWrite` through `use-docs-external-write-prompt.ts`, `resolveExternalWrite` in `use-docs-collab.ts`, `DocsConflictDialog` (`keepLocalDisabled`), `docs-labels.ts`, the conformance table

## Technical constraints

- **Row shape:** `storage_key` (document key, 1024), `storage_key_hash` (sha256 of the key, 64, unique), `content_etag` (sha256 of the markdown, 64), `sidecar_etag` (sha1 of the sidecar bytes, 64), timestamps. The unique key is on the hash, because utf8mb4 `varchar(1024)` is over the InnoDB key limit and a prefix unique index would refuse distinct keys that share a prefix.
- **Detection compares disk bytes, not the index.** `FileNodeIndexPlugin` clears `jmap_file_nodes.content_sha256` on a DAV write (`recordContentWrite($key)` with no hash). The read hashes the stored markdown with sha256 and compares it with `content_etag`, but only while the row's `sidecar_etag` is the sha1 of the sidecar on disk. A row for another sidecar (a save between its sidecar write and its row write, or a failed row write) does not flag. The read only loads the markdown when a row matches.
- **Write path:** `DocCollabDocumentService::put()` records the row inside the existing flock, right after the markdown write, only when that save also writes the sidecar. A markdown-only save leaves the row, so the next read flags the new text. A yjs-only save refreshes `sidecar_etag` on an existing row and does not create one. A failed row write logs and does not fail the save; the bytes are already on disk.
- **Header constant:** moves to `App\Services\Collab\CollabExternalWrite::HEADER`, shared by Notes and Docs. Same value, `X-Wgw-External-Write`.
- **Save refusal (product decision 2026-10-18):** inside the flock, after the sidecar precondition, `put()` refuses with 409 `{"error": "external_write"}` while a row trusted for the stored sidecar disagrees with the markdown on disk. The request header `X-Wgw-External-Write` acknowledges it: its value is the entity tag of the text representation the client saw (for Docs the markdown `ETag`, sha1 of the bytes). A tag for an older outside text is refused again. Status, code, and header are app-neutral; Notes adopts them in #1381.
- **304:** the yjs read never answers 304 while the flag is set (same shape and comment as `NotesController::yjsState`).
- **DAV:** `WebdavWriteGuardPlugin` no longer refuses `PUT` / `PATCH` on a document with a sidecar. `DocYjsStateDavPlugin` listens on Sabre `beforeWriteContent` / `beforeCreateFile`, which run after ACL, the `If-Match` / `If-None-Match` preconditions, and lock tokens. When the document has a sidecar and no row yet, it records one from the markdown as it is before the write. Until now the block guaranteed that markdown came from the collab path. A refused write reads nothing and writes no row. A failed row write fails the DAV write, so an undetectable write never lands.
- **Move / delete:** `FileNodeIndexService::recordMoveWithSidecar` / `recordDeleteWithSidecar` call `DocYjsStateStore::moveWithDocument` / `deleteWithDocument` right after `CollabSidecarMover`. They re-key or drop the row, exact key and every key under `key/` (an indexed `LIKE` prefix with `!` as the escape character, then a byte-exact check in PHP). `FileNodeIndexService::recordMove` / `recordDelete` (the reindex path) do not touch it.
- **Client:** no change to the join path. `DocsCollabWorkspace` passes `onExternalWrite` in the urls it gives `useDocsCollab`, and shows the prompt with `DocsConflictDialog` and external-write labels. The dialog gets no `onOpenChange`, so it cannot be dismissed without a choice. `externalWriteHoldRef` already stops saves while it is up. The question is kept with its room and dropped when the workspace switches documents, because the workspace is not remounted per path. `resolveExternalWrite` holds saves again when the answer's save fails, and the prompt stays up. Once the outside text has replaced the local edits, Keep my edits is disabled.
- **Client refusal:** `isExternalWriteRefusal` keeps a 409 `external_write` out of the remerge path. The save hook holds saves, loads the outside text, and raises the same prompt through `askAboutRefusedSave`; the save stays pending with no failure status or backoff. `externalWriteSeenRef` keeps the outside text's entity tag from a refusal or a read-time flag; the next save sends it and a landed save clears it. If nobody can be asked (no prompt wired, or the text does not load), the refusal is an ordinary failed save.

## Edge cases

- No row (a document saved before this change and not written since): normal read, no header.
- An equal hash after a DAV `PUT` of the same bytes, a rename, or a move: no header.
- The markdown file is gone but the sidecar is still there (deleted on disk): the empty text differs from the row, so the header is sent and the client rebuilds from empty text.
- A folder move carries the sidecars inside it as ordinary files. Their rows follow by prefix.
- Two clients both rebuild from the same external text. The same markdown seeds the same items, so they merge (existing #1314 behavior).
- "Keep mine" in the prompt saves the local document with `If-Match` on the unchanged sidecar and the outside text's tag. That save rewrites the row, so the next read has no header.
- An outside edit lands while the document is open: the next autosave is refused, and the prompt appears without a reconnect.
- A second outside edit lands while the prompt is up: the answer's save names the older text and is refused again, so the person is asked about the new text.
- A pending offline save meets the refusal on reconnect: it ends in the prompt and stays pending.
