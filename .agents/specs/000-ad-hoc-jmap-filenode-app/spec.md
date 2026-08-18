Source: ad-hoc

# Drive FileNode client (signed-in tree I/O)

Technical translation of Chunk D from the JMAP REST sunset plan. No GitHub Task yet.

## Goal

Signed-in Drive operations talk JMAP FileNode for tree I/O (list, mkdir, create file, rename, move, delete, upload, download). Guest share bootstrap, stars, shares, collaboration, and `/files/context` stay on REST.

## Non-goals

- Deleting dual-protocol `/files/*` routes (Chunk E)
- `FileNode/copy` (single account)
- Shared-with-me FileNode visibility
- Contacts / calendar work
- Filing GitHub issues

## Affected packages

- packages/apps only

## Technical constraints

- Match `JmapFileNodesClientContractTest` methodCalls (`FileNode/get`, `FileNode/query` + `#ids` ResultReference, `FileNode/set` create/destroy, `FileNode/changes`). Path cache uses `FileNode/query` filters `parentId` / `name` / `isTopLevel` then `FileNode/get`.
- Honor advertised `maxSizeUpload` (25 MB). Fail clearly above the limit. No chunked `POST /files/content` fallback.
- Guest `fetchGuestDriveState` keeps `GET /files/children` + `GET`/`HEAD /files/content`.

## Edge cases

- FileNode visible set excludes shared-with-me and hidden (dot-prefixed) segments such as `.Trash`.
- Username colliding with a group slug: home is `/users/{username}`; other top-level nodes map to `/groups/{name}`.
