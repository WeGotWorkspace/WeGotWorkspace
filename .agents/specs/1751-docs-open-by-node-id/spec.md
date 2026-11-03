Source: #1751 (body-hash: 76ebdc8a)

# Open Docs by stable file id instead of path

Technical translation of [#1751](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1751). The issue is the record for acceptance criteria. This spec covers the first slice that ships: **open by id**. The collab room and server-side state slices are planned in [plan.md](./plan.md) and ship as their own pull requests.

## Goal

A Doc URL names the document, not its location. `/docs?id=fn-…` opens the Doc wherever it lives now. An old `/docs?file=<path>` link still opens the Doc and is replaced by its `?id=` form. A rename or move while the Doc is open moves the editor to the new path without a reload, and the URL stays the same.

## Non-goals

- Collab room, Yjs state and comment threads stay keyed by path in this slice. A rename while two people edit still re-joins each editor on the new path (slice 2).
- Guests (public share sessions) stay on `?file=`. They have no node id and no JMAP, and the share session response carries none.
- Notes: unchanged. Notes uses its own route and VJOURNAL UIDs.
- Docs home rows and Drive rows keep handing a path to `onOpenFile`. DocsApp turns the path into an id. No new field on `DriveFile`.

## Affected packages

- packages/api: `GET /api/v1/files/node`, `PUT /api/v1/files/collaboration?node=`, OpenAPI, notification `navigate` link.
- packages/apps: Docs route search, DocsApp document resolution, rename navigation, Docs id ↔ path record, e2e helper.

## Technical constraints

- `GET /api/v1/files/node?id=fn-…` or `?path=/…` returns `{ data: { id, path } }` for a **file** the caller may read. Signed-in users only (`wgw.role:user`), same group as `files/threads`.
  - By id: `DriveService::assertReadableNodeId` (index lookup + `DriveShareAuthorizer::assertMayRead` + file exists). A file the caller may not read answers 404, the same as an unknown one (as `files/content` since #1775); a share-link guest is refused by the role gate (403).
  - By path: `assertReadableFile` on the path, then `FileNodeIndexService::liveByKey`, with `recordCreate` as lazy self-heal for a file that exists but is not indexed yet.
  - A file in product trash (`DriveSharePathScope::isInProductTrash`) is 404 on both forms. Docs must not open a trashed Doc through an id that followed it into trash (review finding 2026-10-06: a path rewrite can carry access into trash).
  - A directory is 404.
- Client resolution is **network first, local cache second**. The server is authoritative online: a cached path→id row can be stale when a new file took the old path. Every server answer is recorded in Docs' own id ↔ path map (offline meta store), because the Drive cache only learns ids from a FileNode crawl. Offline, Docs opens from that map, then the Dexie Drive cache (`drive_entries` indexed by `nodeId`).
- `?file=` waits for its id (one lookup) before the editor opens, then swaps `?id=` into the URL with `replace`. The editor's local copy is keyed by id, so opening on the path first would leave typed text behind after a rename. Without an id (offline and unknown, or the server has no such file) it opens by path.
- Docs saves name the opened file: `PUT /files/collaboration?path=…&node=fn-…`. When that file is no longer at the path, the server answers 404 and writes nothing. Without `node` a save may still create the file.
- `?id=` that the server no longer finds (404 online) falls back to this device's last known path for that id (Docs' id ↔ path record, then the Drive cache):
  - another readable file now holds that path (a same-path replace gives a new id): open that file and replace the URL with its id;
  - otherwise open the last known path, so the editor's "This document is no longer available" / Keep local copy flow runs (revoked share, deleted file).
- Not-found state, not Docs home, only when this device knows no path for the id (online 404, or offline and not cached).
- Known limit: a link to a deleted Doc whose path was later taken by an unrelated file opens that file. Decided 2026-11-04 (overnight, most conservative for user data: local copies stay reachable after a reload, as on main).
- Collab URLs (`buildDocsCollabUrls(filePath)`) and threads keep taking the resolved path.

## Edge cases

- `?id=` and `?file=` both present: `id` wins.
- A malformed `id` (not `fn-` + 32 hex) is dropped by route validation, so the route falls back to `file` or home.
- Rename inside Docs (`DocsWorkspace` rename menu): navigate to the id with `replace` instead of a push of the new path.
- Rename or move elsewhere while open: the editor re-resolves the id on the existing inbound refresh points (open, reconnect) and when the tab becomes visible again. A changed path re-renders the editor on the new path.
- Typing while someone else renames: the next save is refused (404), Docs looks the id up again and the editor moves to the new path with the typed text. The "gone" notice shows only when the id is not found.
- Moved to trash or deleted while open: the re-resolve returns not found and the open editor stays mounted. The current behaviour for a gone document (save 404 → "gone" dialog) stays, also after a reload (last known path).
- Comment notification links (`DocsThreadActivityNotify::navigate`) use `?id=` when the doc is indexed, else `?file=`.
