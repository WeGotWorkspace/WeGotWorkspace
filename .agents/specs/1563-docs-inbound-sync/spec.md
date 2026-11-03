Source: #1563 (body-hash: 2d5f7f16)

# Docs inbound reconciliation on the shared inbound engine

Step 1 of #1563: acceptance criterion 2 only ("A Doc deleted, renamed or moved elsewhere disappears from (or moves in) every cached Docs view on the next sync, without a manual reload; a queued local change is not dropped by that sync"). The other gaps of #1563 (name clash on offline create, rename while another tab is offline, offline Starred and Trash, the early "Changes synced" toast, the uncaught "Failed to fetch", the Docs sync matrix) are not part of this step.

## Goal

The Docs home keeps one cached snapshot per browse filter set (`docs_listing_rows`, keyed by `docsListingCacheKey`). Today a snapshot only changes when that exact view is fetched again online, so a Doc deleted, renamed or moved on another device, in another tab or over WebDAV stays in every other cached view, and in the open list, until that view is reloaded online.

After this change, the FileNode changes that Drive already pulls for the Docs home and the Docs editor are applied to every cached Docs view, and every open Docs home tab re-reads its list from the cache. The full live listing of a view keeps rows that a queued local write still owns. Both paths read queued writes through the shared inbound engine (`lib/offline/core/inbound-sync.ts`, #1565).

## Decisions

The owner was not available; each open point is decided here.

1. **Source of changes: the existing Drive FileNode inbound path.** Docs are Drive files. `syncDriveInboundFromFileNodes` already runs on the Docs home and in the Docs editor, holds the one `FileNode/changes` token of the account, and is the only place that knows both the old path (the cached path of the node) and the new path (resolved from `parentId`). Docs adds no second changes call and no second token. Drive reports what it did to each node (moved, upserted in place, dropped) and the Docs binding applies that to the Docs caches. PR #1850 triggers the same path on push, so push and this change compose without new wiring.
2. **Engine pieces, not the per-scope runner.** Like Tasks, Docs uses the engine's pending-write reader (`readPendingWrites`) and scope reconcile (`listRemovedIds`). `runScopedInbound` does not fit: Docs has one account-wide token (Drive's), and its scopes (cached views) overlap, since one Doc is in All and in its drive's view at once.
3. **Engine extension: one queued row can name several items.** A path-keyed rename names two items: the old path (gone, like a delete) and the new path (owned by the queued write). `readPendingWrites` accepts a view that returns a list. Notes and Tasks keep returning one view and do not change.
4. **Which cached views, and the membership rule.**
   - Every `docs_listing_rows` cache key is reconciled: All docs (no prefix), each drive view (`users/<name>`, `groups/<slug>`) and each search view.
   - A path belongs in a browse view when it is a file with a Docs extension (`md`, `markdown`, `txt`), no path segment starts with `.` (this covers `.Trash`, `.notes` and hidden folders, the same rule as the API's `StorageKeyClass::isSearchIndexed`), and it is under the view's `pathPrefix`.
   - A search view cannot evaluate its query offline. Inbound only removes, renames or updates rows a search view already has; it never adds a row to one.
   - A Doc created elsewhere, or moved into a view's drive, is added to the browse views it belongs to. A row added this way has id `0`; the next live listing replaces it by `sourceKey`.
   - Starred: the cached starred paths (`docs.starredPaths`) follow a remote move and drop a remote delete, as the API's `DriveStarService` does on the server.
   - Shared with me and Trash are not cached on the device (in-memory lists, loaded from the server when shown). They are out of scope here; they reload on push through #1850. Offline Starred and Trash are a separate gap of #1563.
5. **Removal versus queued writes.** Pending writes come from the Docs outbox through the engine:
   - `create` owns its path; `rename` owns its target path and marks its source path as deleting; `trash` marks its source path as deleting; `star` owns only the starred field.
   - A remote change to a path a queued write owns is skipped: the row stays as the user left it, also for a remote move away from it (the local name stays until the queued write settles).
   - A path with a queued rename-away or trash is not brought back by a remote upsert or by a full listing.
   - A queued star does not keep a Doc that was deleted elsewhere.
   - Unsaved collab text: Drive already keeps the drive row, the pin and the collab database of a destroyed Doc with a pending server save (`retainOrDropLocalDocument` returns `kept`). Docs removes listing rows only for paths Drive dropped. The full live listing keeps such a row too, so the Doc stays openable.
6. **The full live listing reconciles instead of replacing.** `fetchLiveListing` merges the live rows with the cached rows of the same view: cached rows the server no longer lists are removed (`listRemovedIds`) unless a queued write owns them or they have unsaved collab text; live rows hidden by a queued trash or rename are dropped.
7. **No token hold for Docs.** The engine holds a scope token when a skipped id still has a retryable queued write, so the skipped server change comes back. Here the Drive cache has already applied the node change; a replay would have no Docs path left to act on, and holding the shared Drive token would replay every Drive change on every sync while a Docs write waits. The skipped row is corrected by the next full listing of that view after the queued write settles.
8. **Offline copies of a deleted Doc.** Checked: Drive inbound already removes the Docs pin (`docs_availability`) and the collab database of a destroyed Doc unless it has unsaved text, and a rename moves the pin. It did not remove the Drive availability row (`drive_availability`, written for Docs by Drive content sync) or a Drive content blob of the destroyed node; the tree-crawl prune does remove both. The FileNode inbound now removes both too.
9. **Cross-tab.** All tabs share one IndexedDB and one Drive token, so only the tab that pulls sees the change. After Docs caches change, the tab tells every tab of the browser, itself included (`cacheChangedTopic("docs")` plus local listeners). Each open Docs home re-reads its visible view from the cache. No extra server request.
10. **Drive full resync.** When `FileNode/changes` returns `cannotCalculateChanges`, Drive re-crawls the tree and has no per-node change set. Docs then only notifies the tabs; cached views correct on their next live listing. This is the existing fallback for a device past the tombstone horizon and is accepted as is.

## Non-goals

- The other gaps of #1563 listed above.
- Moving Drive itself onto the engine (step 5 of #1565).
- A Drive or Docs poll. Inbound still runs on app start, after the reconnect flush, and on push once #1850 lands.
- Shares rooted in another user's tree: the Drive cache cannot place them (`resolveNodePath` returns null), so they are corrected by the next live listing only.

## Affected packages

- packages/apps

## Technical constraints

- No new IndexedDB version. Rows of `docs_listing_rows` are patched by id (`<cacheKey>::<sourceKey>`), and the read-modify-write of all views runs in one `rw` transaction, so two tabs that pull at once do not lose each other's patch. `writeDocsListingToCache` replaces a snapshot in one transaction too.
- Pending writes and unsaved-text checks are read before that transaction: the collab check opens another database, which would commit a Dexie transaction early.
- An empty view stays distinguishable from a view that was never cached: `readDocsListingFromCache` returns an empty snapshot when the view has a sync time but no rows, so a re-read after the last Doc of a view is deleted shows an empty list instead of keeping stale rows.
- Engine stays free of Docs types (#1565 constraint).

## Edge cases

- A folder renamed or moved elsewhere: every cached row under the old folder path moves with it (prefix rewrite); a folder deleted elsewhere removes every row under it.
- A Doc moved from My Drive to a group drive: it leaves the My Drive view, stays in All with the new path and location, and is added to the group view if that view is cached.
- A Doc moved to Trash elsewhere (`/users/<name>/.Trash/…`): it leaves every browse view.
- A Doc renamed offline (queued) and renamed elsewhere: the local name stays; the remote move is skipped.
- A Doc renamed to a non-Docs extension elsewhere: it leaves the browse views.
- A Doc created offline (queued create) and missing from the live listing: it stays.
- A Doc with unsaved offline text deleted elsewhere: Drive keeps it and shows its "kept" notice; the row stays in every view.
- Two tabs pull at once: both patch inside a transaction; the second finds the rows already moved and changes nothing.

## Tests

- **Engine (vitest):** `core/inbound-sync.test.ts` gains a case for a queued row that names two items; the existing Notes and Tasks cases stay unchanged.
- **Docs binding (vitest, fake IndexedDB):** `docs/docs-inbound-sync.test.ts` covers delete, rename, move between drives, move to Trash, folder rename and delete, creation elsewhere, search views, queued create / rename / trash / star, unsaved collab text, starred-path migration, the cross-tab notice, and the full-listing merge.
- **Drive inbound (vitest):** `drive/drive-inbound-sync.test.ts` gains cases proving a `FileNode/changes` delete, rename and move reach every cached Docs view, and that a destroyed node's Drive availability row and content blob are removed.
- **Docs home (vitest):** the listing hook re-reads its view from the cache when the Docs caches change, without a reload.
- **Live tier (Playwright):** `e2e/docs-inbound-sync.spec.ts` seeds Docs over WebDAV, caches two Docs home views, deletes, renames and moves Docs over WebDAV while the tab is offline with a queued offline rename, reconnects with the search API blocked, and asserts both views follow without a reload while the queued rename is kept.
