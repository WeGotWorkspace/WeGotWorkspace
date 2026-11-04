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

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- A folder ticket (`{nodeId}`) still zips one folder as before. A wrong change breaks folder downloads from #1621. Proof: `path: packages/api/tests/Feature/Jmap/JmapFolderDownloadTicketTest.php` assertion `test_the_zip_holds_the_folder_tree_with_empty_folders_and_utf8_names`.
- One selected item still downloads on its own, not as a zip. A wrong change zips a single file. Proof: `path: packages/apps/src/drive-core/src/drive-selection-download.test.tsx` assertion `keeps the one-item Download unchanged`.
- An unreadable, hidden or trashed item refuses the whole ticket. A wrong change leaks an item the user may not read. Proof: `path: packages/api/tests/Feature/Jmap/JmapSelectionDownloadTicketTest.php` assertion `test_hidden_trashed_unknown_and_unreadable_items_refuse_the_whole_ticket`.
- No zip entry leaves the top folder, whatever name is sent. A wrong change writes `../` entries. Proof: `path: packages/api/tests/Feature/Jmap/JmapSelectionDownloadTicketTest.php` assertion `test_colliding_names_are_numbered_and_the_name_is_made_safe`.
- Offline, a selection download shows the connection message and makes no request. Proof: `path: packages/apps/src/lib/offline/docs/docs-hybrid-operations.test.ts` assertion `refuses a selection zip while offline without calling the live method`.

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
