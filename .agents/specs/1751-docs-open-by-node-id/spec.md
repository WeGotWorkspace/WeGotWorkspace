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

- packages/api: `GET /api/v1/files/node`, OpenAPI, notification `navigate` link.
- packages/apps: Docs route search, DocsApp document resolution, rename navigation, e2e helper.

## Technical constraints

- `GET /api/v1/files/node?id=fn-…` or `?path=/…` returns `{ data: { id, path } }` for a **file** the caller may read. Signed-in users only (`wgw.role:user`), same group as `files/threads`.
  - By id: `DriveService::assertReadableNodeId` (index lookup + `DriveShareAuthorizer::assertMayRead` + file exists). Same 403/404 split as `files/content?id=`.
  - By path: `assertReadableFile` on the path, then `FileNodeIndexService::liveByKey`, with `recordCreate` as lazy self-heal for a file that exists but is not indexed yet.
  - A file in product trash (`DriveSharePathScope::isInProductTrash`) is 404 on both forms. Docs must not open a trashed Doc through an id that followed it into trash (review finding 2026-10-06: a path rewrite can carry access into trash).
  - A directory is 404.
- Client resolution is **network first, local cache second**. The server is authoritative online: a cached path→id row can be stale when a new file took the old path. Offline, Docs keeps opening from the Dexie Drive cache (`drive_entries` indexed by `nodeId`).
- `?file=` opens immediately by path (no added latency, offline keeps working), and the id is swapped into the URL with `replace` once known.
- `?id=` that cannot be resolved (404/403 online, or unknown offline) shows a not-found state, not Docs home.
- Collab URLs (`buildDocsCollabUrls(filePath)`) and threads keep taking the resolved path.

## Edge cases

- `?id=` and `?file=` both present: `id` wins.
- A malformed `id` (not `fn-` + 32 hex) is dropped by route validation, so the route falls back to `file` or home.
- Rename inside Docs (`DocsWorkspace` rename menu): navigate to the id with `replace` instead of a push of the new path.
- Rename or move elsewhere while open: the editor re-resolves the id on the existing inbound refresh points (open, reconnect) and when the tab becomes visible again. A changed path re-renders the editor on the new path.
- Moved to trash or deleted while open: the re-resolve returns not found. The current behaviour for a gone document (save 404 → "gone" dialog) stays.
- Comment notification links (`DocsThreadActivityNotify::navigate`) use `?id=` when the doc is indexed, else `?file=`.
