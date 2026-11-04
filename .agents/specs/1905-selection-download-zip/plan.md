# Download several selected Drive and Docs items as one zip

Derived from [spec.md](./spec.md). Two chunks, built in sequence by one agent in one PR. The client depends on the API shape.

## Goal

See [spec.md](./spec.md#goal).

## Budget

This is a small extension of #1621. It adds no new dependency and no new table. It adds one column and one branch in the ticket route.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The folder ticket route, its service and its table. `path: packages/api/app/Services/Drive/FolderZip/FolderDownloadTicketService.php:44`
- A walker that yields a folder's entries under one top folder. `path: packages/api/app/Services/Drive/FolderZip/FolderZipWalker.php:39`
- One selection bar hook, shared by Drive and Docs home. `path: packages/apps/src/drive-core/src/use-drive-selection-bar.tsx:26`, `path: packages/apps/src/docs-core/src/docs-home-pane.tsx:226`

## Chunks

1. **api-selection-ticket**:
   - Migration for `node_ids`, with the schema version bumped.
   - `issueSelection` and redeem in the service.
   - `selectionEntries` in the walker and `streamSelection` in the streamer.
   - The controller branch.
   - OpenAPI and the generated types.
   - Feature tests.

   Done when the feature tests pass and `pnpm check:api-types` is clean.
2. **apps-selection-download**:
   - The ticket client.
   - `downloadSelection` on the live and hybrid operations.
   - `zipName` in the selection bar hook, passed from Drive and Docs.
   - Vitest.
   - The live e2e spec and its `live-tier.mjs` line.

   Done when Vitest and the live spec pass.
