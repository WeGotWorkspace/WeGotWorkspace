Source: #1349 (body-hash: 06ddee69)
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

- `packages/api` — new `doc_yjs_state` table and model, a small store service, `DocCollabDocumentService`, `CollabSidecarMover`, `FilesController::showCollaboration`, `WebdavWriteGuardPlugin`, OpenAPI
- `packages/apps` — `docs-collab-workspace.tsx` wires `onExternalWrite` through a new hook, `docs-labels.ts`, the conformance table

## Technical constraints

- **Row shape:** `storage_key` (document key, 1024), `storage_key_hash` (sha256 of the key, 64, unique), `content_etag` (sha256 of the markdown, 64), `sidecar_etag` (sha1 of the sidecar bytes, 64), timestamps. The unique key is on the hash, because utf8mb4 `varchar(1024)` is over the InnoDB key limit and a prefix unique index would refuse distinct keys that share a prefix.
- **Detection compares disk bytes, not the index.** `FileNodeIndexPlugin` clears `jmap_file_nodes.content_sha256` on a DAV write (`recordContentWrite($key)` with no hash). The read hashes the stored markdown with sha256 and compares it with `content_etag`. The read only loads the markdown when a row exists.
- **Write path:** `DocCollabDocumentService::put()` records the row inside the existing flock, right after the markdown write, when a sidecar exists after the write. A yjs-only save refreshes `sidecar_etag` on an existing row and does not create one. A failed row write logs and does not fail the save; the bytes are already on disk.
- **Header constant:** moves to `App\Services\Collab\CollabExternalWrite::HEADER`, shared by Notes and Docs. Same value, `X-Wgw-External-Write`.
- **304:** the yjs read never answers 304 while the flag is set (same shape and comment as `NotesController::yjsState`).
- **DAV:** `WebdavWriteGuardPlugin` no longer refuses `PUT` / `PATCH` on a document with a sidecar. Before such a write, when there is no row yet, it records one from the markdown as it is before the write. Until now the block guaranteed that markdown came from the collab path.
- **Move / delete:** `CollabSidecarMover::moveWithDocument` / `deleteWithDocument` also re-key or drop the row, exact key and every key under `key/`. `FileNodeIndexService::recordMove` / `recordDelete` (the reindex path) do not touch it.
- **Client:** no change to the join path. `DocsCollabWorkspace` passes `onExternalWrite` in the urls it gives `useDocsCollab`, and shows the prompt with `DocsConflictDialog` and external-write labels. The dialog gets no `onOpenChange`, so it cannot be dismissed without a choice. `externalWriteHoldRef` already stops saves while it is up.

## Edge cases

- No row (a document saved before this change and not written since): normal read, no header.
- An equal hash after a DAV `PUT` of the same bytes, a rename, or a move: no header.
- The markdown file is gone but the sidecar is still there (deleted on disk): the empty text differs from the row, so the header is sent and the client rebuilds from empty text.
- A folder move carries the sidecars inside it as ordinary files. Their rows follow by prefix.
- Two clients both rebuild from the same external text. The same markdown seeds the same items, so they merge (existing #1314 behavior).
- "Keep mine" in the prompt saves the local document with `If-Match` on the unchanged sidecar. That save rewrites the row, so the next read has no header.
