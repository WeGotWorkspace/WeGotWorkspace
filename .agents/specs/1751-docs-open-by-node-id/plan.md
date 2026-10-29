# Open Docs by stable file id instead of path

Derived from [spec.md](./spec.md). Delivery issue [#1751](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1751) (Chore).

## Goal

Docs opens a document by its FileNode id. Slice 1 (this pull request) changes the URL and the resolution step. Slices 2 and 3 move the collab room and server-side state onto the id in later pull requests.

## Budget

Draws from Docs/Drive hardening. Displaces nothing on the Pioneer milestone; no UI is added beyond a not-found state.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- Stable FileNode ids survive rename and move. `path: packages/api/database/migrations/wgw/2026_08_13_000220_wgw_create_jmap_file_nodes.php:17`
- id → readable virtual path with ACL: `DriveService::assertReadableNodeId`. `path: packages/api/app/Services/Drive/DriveService.php:407`
- path → node: `FileNodeIndexService::liveByKey`. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:139`
- No REST endpoint returns the path for an id; JMAP `FileNode/get` returns only `id`, `parentId`, `name`. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php:48`
- Product trash test: `DriveSharePathScope::isInProductTrash`. `path: packages/api/app/Services/Drive/DriveSharePathScope.php:35`
- Docs route is `{ file?: string }`. `path: packages/apps/src/docs-core/src/docs-route-search.ts:1`
- DocsApp derives `filePath` from `file` and passes it to collab URLs, rights and threads. `path: packages/apps/src/docs-core/src/docs-app.tsx:57`
- Rename inside Docs pushes `?file=<newPath>`. `path: packages/apps/src/docs-core/src/docs-app.tsx:83`
- Offline Drive cache maps path → nodeId (`readCachedDriveNodeId`) and indexes `nodeId`. `path: packages/apps/src/lib/offline/drive/drive-directory-offline-store.ts:65`
- Comment notifications link to `/docs?file=`. `path: packages/api/app/Services/Notify/DocsThreadActivityNotify.php:104`
- Guests open shares through `shareDestinationRoute` with `{ file }` and have no node id. `path: packages/apps/src/share-ui/share-destination.ts:64`

## Considered

Considered: JMAP `FileNode/get` with `fetchParents` to rebuild the path on the client (the private `resolveNodePath` in `drive-inbound-sync.ts`), versus a small REST resolve endpoint. Rejected the JMAP walk: it needs one round trip per ancestor level for shared subtrees, returns `null` for a share rooted in someone else's tree, and checks root visibility instead of `DriveShareAuthorizer`. The endpoint reuses the same check as `files/content?id=`.

Considered: putting `nodeId` on `DriveFile` and changing every `onOpenFile(apiPath)` caller. Rejected for slice 1: DocsApp canonicalizes `?file=` to `?id=` in one place, so Drive, Docs home, share links and notifications keep working unchanged.

## Affected packages

- packages/api | packages/apps

## Dependencies

1. Chunk A (API + OpenAPI + typegen) before chunk B uses the generated type.
2. Chunk C after chunk B.
3. Slice 2 and slice 3 after this pull request merges.

## Open decisions

- [ ] Slice 3 (server state by id): threads still move between owner pools on a cross-principal move, and a same-path replace keeps Yjs state on purpose although the node id changes. Re-keying on `node_id` does not remove the move code as the issue says. Decide before slice 3 starts; the issue is updated first.

## Invariants

- An old `/docs?file=<path>` link still opens the Doc. A wrong change sends old bookmarks and notification links to Docs home. Proof: `path: packages/apps/src/docs-core/src/use-docs-route-document.test.tsx` assertion `opens a file link by path at once and swaps in the id`.
- Offline, a `?file=` link opens without any network call succeeding, and an `?id=` link opens from the Drive cache. A wrong change shows not found on a train. Proof: `path: packages/apps/src/docs-core/src/use-docs-route-document.test.tsx` assertions `falls back to the cached path when the network fails` and `keeps the file link when offline and the id is unknown`.
- Guests keep `?file=` and never call the user-only endpoint. A wrong change turns every guest share link into an error. Proof: `path: packages/apps/src/docs-core/src/use-docs-route-document.test.tsx` assertion `does not resolve for guests`; `path: packages/apps/src/share-ui/share-destination.test.ts` (unchanged).
- The endpoint never resolves an id the caller cannot read, and never resolves into product trash. A wrong change leaks a path or reopens a trashed Doc. Proof: `path: packages/api/tests/Feature/Docs/DocsFileNodeLocateTest.php` assertions `test_stranger_cannot_resolve`, `test_trashed_doc_is_not_found`.
- Notes collab is untouched. Proof: `path: packages/apps/src/notes-core/src/note-collab-path.test.ts` (unchanged, green).

## Chunks

### Chunk A: API locate endpoint

- **id:** `api-file-node-locate`
- **Skill:** api, security
- **Inputs:** `DriveService::assertReadableNodeId` `path: packages/api/app/Services/Drive/DriveService.php:407`; `FileNodeIndexService::liveByKey` / `recordCreate` `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:139`; user route group `path: packages/api/routes/api.php:146`
- **Done when:** `GET /api/v1/files/node` by `id` and by `path` returns `{id, path}` for a readable file; 400 without either; 404 for unknown id, directory, trash; 403 for a file the caller cannot read; guest bearer is refused by the role gate; OpenAPI entry with `x-wgw-access: user`; generated types updated; comment notifications link by id.
- **Verify with:** `cd packages/api && php artisan test --filter=DocsFileNodeLocateTest`; `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: Docs route by id

- **id:** `apps-docs-route-id`
- **Skill:** workspace, client-transport
- **Inputs:** route search `path: packages/apps/src/docs-core/src/docs-route-search.ts:1`; DocsApp `path: packages/apps/src/docs-core/src/docs-app.tsx:57`; Dexie cache `path: packages/apps/src/lib/offline/drive/drive-directory-offline-store.ts:65`
- **Done when:** route accepts `id`; `useDocsRouteDocument` resolves id → path (network, then cache) and path → id (network, then cache) and replaces `?file=` with `?id=`; not-found state for an unresolvable id; rename inside Docs navigates by id with `replace`; guests and mock mode skip resolution.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/docs-core`; apps done gate
- **Parallel with:** none

### Chunk C: Follow a rename while open

- **id:** `apps-docs-follow-rename`
- **Skill:** workspace
- **Inputs:** inbound refresh key and reconnect hook `path: packages/apps/src/docs-core/src/docs-app.tsx:62`
- **Done when:** with `?id=` open, a server-side rename or move is picked up on reconnect, inbound refresh, and tab visibility; the editor re-renders on the new path; the URL does not change.
- **Verify with:** vitest for the hook; browser e2e: open by id, rename in Drive in a second tab, return to the Docs tab.
- **Parallel with:** none

## Test plan

- [ ] API: failing feature test first, then the endpoint, then `pnpm test:api-done-gate`.
- [ ] UI: Vitest for route search and `useDocsRouteDocument`; apps done gate.
- [ ] Browser (dev server against a local API): open from Drive, old `?file=` link, bookmark after rename, rename in a second tab, offline reopen on the production preview, guest share link.

## Doc updates (only if user wants)

- None.
