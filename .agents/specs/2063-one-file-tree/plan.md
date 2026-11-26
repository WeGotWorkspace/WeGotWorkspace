# One local file tree for Drive and Docs home

## Goal

Replace the per-view listing code of Drive and Docs home with one local recursive tree (`drive_entries`) that both apps query. Fetch that tree in a few batched JMAP requests, keep it current with `FileNode/changes` only, and make Docs home a configuration of the Drive workspace. Fix the three server gaps the design depends on: query cost, team membership in the change state, and share flags on FileNode.

## Budget

Draws from the Pioneer programme chore #2063 (Docs/Drive family of #1641) and from Epic #2284 (traffic budget): a Drive open stops costing one request per folder. Displaces the per-view cache direction that #2063 described before 2026-11-26, and the `docs_listing_rows` patching rules of `1563-docs-inbound-sync` decision 4 and 10. Does not displace #2338 chunk F (shared body queue).

## Non-goals

- Body or binary download changes beyond #2063's per-row indicator criteria.
- Offline full-text search.
- Moving Drive/Docs inbound onto the #1565 engine.
- Guest sessions.

## What exists

- The device already stores a recursive tree of home plus group roots, written by a BFS crawl, one JMAP listing per folder. `path: packages/apps/src/lib/offline/drive/drive-metadata-sync.ts:101`
- That crawl runs on every Drive bootstrap, every reconnect and every offline-settings change, even with a valid `FileNode/changes` token. `path: packages/apps/src/drive-core/src/use-drive-api.ts:129`, `:143`, `:150`
- Incremental inbound via `FileNode/changes` with one token per account already exists, and falls back to the crawl on `cannotCalculateChanges`. `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:73`, `:182`
- The crawl skips dot-folders, so Trash is not in the tree; share roots are not crawl roots. `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:137`, `path: packages/apps/src/lib/offline/drive/drive-metadata-sync.ts:34`
- `drive_entries` row: `{ id (path), parentPath, type, modifiedAt, data (WgwDriveDirectoryEntry JSON), nodeId?, uploadId? }`, indexes `id, parentPath, type, modifiedAt, nodeId, uploadId`. `path: packages/apps/src/lib/offline/drive/drive-schema.ts:15`, `:83`
- JMAP-built rows carry no share flags. `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:183`
- Docs home lists through `GET /search/results` into its own per-filter cache `docs_listing_rows`. `path: packages/apps/src/docs-core/src/use-docs-home-listing-load.ts:60`, `path: packages/apps/src/lib/offline/docs/docs-listing-cache-key.ts:16`
- `docs_listing_rows` also feeds trash-undo snapshots and offline size/time facts. `path: packages/apps/src/lib/offline/docs/docs-hybrid-operations.ts:168`, `path: packages/apps/src/lib/offline/docs/docs-offline-entries.ts:55`
- Drive's All files waits on the network (`items === null`); Starred and Shared have no offline rows in Drive. `path: packages/apps/src/drive-core/src/use-drive-all-files.ts:194`, `path: packages/apps/src/drive-core/src/drive-visible-items.ts:53`
- Docs home already renders Drive's list and grid views. `path: packages/apps/src/docs-core/src/docs-home-pane.tsx:11`
- Lists are windowed. `path: packages/apps/src/drive-core/src/drive-list-spacer.tsx:8`
- Cache-changed notifications go through a cross-tab topic; there is no Dexie `liveQuery` in app code. `path: packages/apps/src/lib/offline/core/cache-changed-topic.ts:27`
- Stars are a path set in meta key `docs.starredPaths`, shared by both apps; REST `GET /files/starred`. `path: packages/apps/src/lib/offline/docs/docs-stars-store.ts:4`
- Server, unfiltered `FileNode/query`: `reconcileVisibleTree` (BFS, disk listing per folder, capped at 2,000 folders) then `liveVisible` (one SQL query, full models), sort in PHP, `array_slice` paging. `path: packages/api/app/Services/Jmap/Methods/FileNodeQueryMethod.php:159`, `:99`, `path: packages/api/app/Services/Jmap/FileNodes/FileNodeAccountSupport.php:216`
- Measured on main `da19686dc` (throwaway PHPUnit bench, 20,440 nodes in 400 folders): query+get page of 500 = 1.93 s and 916 SQL; with reconcile skipped = 1.67 s and 30 SQL. `cmd: BENCH_DIRS=400 BENCH_FILES=50 php vendor/bin/phpunit --filter ZzTreeBenchTest`
- Unfiltered query roots include home, member groups and share roots; share roots keep the owner's parent id. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeAccountSupport.php:71`, `:164`
- Trash (`.Trash`) is file-indexed, so an unfiltered query returns it. `path: packages/api/app/Storage/StorageKeyClass.php:38`
- `FileNode/changes` state is `<seq>.<grantHash>`; the hash covers member grants only. Team membership changes do not change it. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeSyncState.php:10`, `path: packages/api/app/Services/Jmap/FileNodes/FileNodeAccountSupport.php:98`
- Back-references work; at most 32 calls per request; 500 objects per get. `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:257`, `path: packages/api/app/Services/Jmap/JmapCapabilities.php:77`, `:86`
- Share indicators exist as a batch lookup for REST listings; share writes do not bump the node's change sequence. `path: packages/api/app/Services/Drive/DriveService.php:541`, `path: packages/api/app/Services/Drive/DriveShareService.php:472`

## Considered

- **Per-view caches (the Docs model, the earlier #2063 direction):** rejected. It keeps one copy of the same rows per filter and needs its own refresh per view. One tree makes every view, including never-opened folders, available offline after one sync.
- **A server-side "tree snapshot" endpoint (one JSON of the whole tree) or a Sabre plugin that writes a tree record on every write:** rejected. `jmap_file_nodes` already is that record, kept current by `FileNodeIndexPlugin` and `DriveService`, with `FileNode/changes` for deltas. A second representation would need its own invalidation.
- **The search index as list source:** rejected for lists. It is a full-text index, updated best-effort, and is the reason Docs and Drive diverged. It stays the source for content search.
- **Dexie `liveQuery`:** rejected in favour of the existing `cacheChangedTopic`, which every offline domain already uses and which crosses tabs.
- **Share flags as a separate client cache of the person's shares:** rejected. A FileNode property, filled by the existing batch lookup and propagated by a seq bump, keeps one sync path.
- **Team join/leave as a server-emitted subtree of created/destroyed:** rejected for now. Adding the root set to the state hash reuses the existing `cannotCalculateChanges` → full resync path, which is cheap after chunk S1.

## Affected packages

- packages/api
- packages/apps
- docs (`packages/apps/docs/offline-platform.md`)

## Dependencies

1. S1, S2, S3 (server) are independent of each other and of C1.
2. C1 (tree sync) ships on its own: on a server without S1 it is slower but correct.
3. C2 (shared view hook) needs C1's columns.
4. C3 (Drive binding) needs C2. C4 (Docs binding) needs C2 and C3's workspace config.
5. C5 (indicators, thumbnails, team labels) needs C3.
6. C6 (e2e + docs) runs last, on all of the above.

## Open decisions

None — every choice is made.

## Invariants

- An unfiltered `FileNode/query` page costs a number of SQL queries that does not grow with the number of folders. A wrong change brings back per-folder reconcile on every page. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeTreePagingTest.php` assertion `test_query_page_sql_count_does_not_grow_with_folder_count`.
- Out-of-band disk writes still reach the index. A wrong change drops reconcile altogether. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeTreePagingTest.php` assertion `test_first_page_reconciles_out_of_band_files`.
- Joining or leaving a team invalidates the change state. A wrong change leaves a joined team's files off the device. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeTeamStateTest.php` assertions `test_joining_a_team_changes_the_state`, `test_leaving_a_team_changes_the_state`.
- Existing states without a root hash still decode as `cannotCalculateChanges`, never as an error. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeTeamStateTest.php` assertion `test_old_state_format_is_cannot_calculate_changes`.
- Creating or revoking a share bumps the node so `FileNode/changes` reports it, and `FileNode/get` returns its flags. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeShareFlagsTest.php` assertions `test_share_create_is_reported_by_changes`, `test_get_returns_share_flags_for_the_owner`.
- Opening Drive with a stored token sends no folder listing, only `FileNode/changes`. Proof: `path: packages/apps/src/lib/offline/drive/drive-tree-sync.test.ts` assertion `opens with a token: changes only, no query`.
- The first sync of 20k nodes takes at most 3 listing requests and resumes after an abort without refetching finished pages. Proof: `path: packages/apps/src/lib/offline/drive/drive-tree-sync.test.ts` assertions `first sync batches 16 pages per request`, `resumes from the cursor`.
- A queued outbox write keeps winning over an inbound row for its path. Proof: `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.test.ts` (existing pending-write cases stay green).
- After C1, main still works without C2–C6: existing views keep reading the same `drive_entries` rows. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/drive-core src/docs-core`.
- A view never shows the empty state for a folder that has not synced; it shows "not available offline". Proof: `path: packages/apps/src/lib/files/tree-view/use-file-tree-view.test.tsx` assertion `unsynced folder is not-available, not empty`.
- Docs home rows equal the Drive tree filtered by the Docs entry filter, for every Docs view. Proof: `path: packages/apps/src/docs-core/src/docs-home-binding.test.tsx` assertion `docs views are drive views with the docs filter`.
- Both apps still install as separate PWAs. Proof: `cmd: pnpm --dir packages/apps exec playwright test -c playwright.pwa.config.mjs`.

## Chunks

### Chunk S1: cheap paged tree read
- **Skill:** api
- **Inputs:** reconcile on every unfiltered query — `path: packages/api/app/Services/Jmap/Methods/FileNodeQueryMethod.php:159`; full models loaded — `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:156`.
- **Done when:** an unfiltered query reconciles only when `position` is 0, loads only the columns it sorts and filters on, and pages in SQL where the sort allows it. On the 20,440-node bench a page costs at most 300 ms and a constant number of SQL queries. Feature tests from the Invariants pass. The throwaway bench is not committed.
- **Verify with:** `php scripts/done-gate.php` (or CI shards), the two S1 invariant tests.
- **Parallel with:** S2, S3, C1

### Chunk S2: team membership in the change state
- **Skill:** api, security
- **Inputs:** state hashes grants only — `path: packages/api/app/Services/Jmap/FileNodes/FileNodeAccountSupport.php:98`, `path: packages/api/app/Services/Jmap/FileNodes/FileNodeSyncState.php:10`.
- **Done when:** the state carries a hash over the sorted account root set plus the grant pairs (hash the set whose change must be detected, review-findings 2026-11-04). A join or leave yields `cannotCalculateChanges`. Push state follows the same roots. Old states decode as `cannotCalculateChanges`.
- **Verify with:** S2 invariant tests; existing `TeamHiddenDriveSharesTest` stays green.
- **Parallel with:** S1, S3, C1

### Chunk S3: share flags on FileNode
- **Skill:** api
- **Inputs:** batch share indicators — `path: packages/api/app/Services/Drive/DriveService.php:541`; share writes do not bump — `path: packages/api/app/Services/Drive/DriveShareService.php:472`.
- **Done when:** `FileNode/get` returns `shareFlags { hasShares, hasPublicShare, hasTeamShare }` for nodes the caller owns, using one batch lookup per get call. Every share create, revoke and access change bumps the node's change sequence. Projection omits the lookup when `shareFlags` is not requested.
- **Verify with:** S3 invariant tests; `JmapLeanGetTest` stays green.
- **Parallel with:** S1, S2, C1

### Chunk C1: tree sync replaces the crawl
- **Skill:** workspace, client-transport
- **Inputs:** crawl — `path: packages/apps/src/lib/offline/drive/drive-metadata-sync.ts:101`; callers — `path: packages/apps/src/drive-core/src/use-drive-api.ts:59`; inbound — `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:182`.
- **Done when:**
  - `syncDriveTree` pages `FileNode/query` + `#ids` `FileNode/get` (16 pairs per request), including Trash and share roots, under the Web Lock, with a resumable cursor and a `firstSyncDone` meta flag. It prunes rows the sync did not see only after a complete pass.
  - Rows gain indexed `ext` and `area` (`home | group | share | trash`) in a new Dexie version; existing rows are backfilled from `data`.
  - App open, reconnect and settings change call `FileNode/changes` only. The full sync runs on a missing token or `cannotCalculateChanges`.
  - The BFS crawl is deleted.
- **Verify with:** `drive-tree-sync.test.ts`, existing `drive-inbound-sync` tests.
- **Parallel with:** S1, S2, S3

### Chunk C2: one view hook in lib
- **Skill:** workspace
- **Inputs:** cache-changed topic — `path: packages/apps/src/lib/offline/core/cache-changed-topic.ts:27`; stars store — `path: packages/apps/src/lib/offline/docs/docs-stars-store.ts:4`.
- **Done when:** `lib/files/tree-view/` exports `useFileTreeView(view, entryFilter)` and pure predicates for folder, all, recent, starred, shared, trash and path prefix. It returns `{ rows, status: "first-sync" | "ready" | "not-available" }`, re-queries on the drive cache-changed topic, and filters names locally. Team display labels are cached in meta for offline use.
- **Verify with:** `use-file-tree-view.test.tsx`, predicate unit tests.
- **Parallel with:** none

### Chunk C3: Drive on the tree
- **Skill:** workspace, apps-ui
- **Inputs:** current hooks — `path: packages/apps/src/drive-core/src/use-drive-shell.tsx:329`, `use-drive-all-files.ts`, `use-drive-folder-listing-sync.ts`, `use-drive-{starred,shared,trash}-list.ts`.
- **Done when:** every Drive view reads `useFileTreeView`. The full-pane state shows only for `first-sync` with no rows. Online search keeps its server call; offline name filter runs locally. The replaced hooks are deleted.
- **Verify with:** drive-core vitest; own browser e2e (warm, cold, offline). Visible UI: waits for the product lead's review.
- **Parallel with:** none

### Chunk C4: Docs home as a Drive configuration
- **Skill:** workspace
- **Inputs:** Docs listing layer — `path: packages/apps/src/docs-core/src/use-docs-home-listing-load.ts:60`; other readers of `docs_listing_rows` — `path: packages/apps/src/lib/offline/docs/docs-hybrid-operations.ts:168`, `path: packages/apps/src/lib/offline/docs/docs-offline-entries.ts:55`.
- **Done when:** Docs home is a workspace config (entry filter, views, labels, create actions, open-file) on the Drive workspace. `use-docs-home-list`, `use-docs-home-listing-load`, the Docs starred/shared/trash list hooks and `docs_listing_rows` are removed; trash-undo and offline facts read `drive_entries`. Content search stays a server call. Body sync reads the tree instead of re-running the browse search.
- **Verify with:** `docs-home-binding.test.tsx`; existing Docs offline e2e specs.
- **Parallel with:** C5

### Chunk C5: indicators, thumbnails, team names
- **Skill:** apps-ui
- **Inputs:** #2063 measurements 2, 5, 6.
- **Done when:** the #2063 criteria for the per-row indicator, stored thumbnails and offline team names are met in both apps.
- **Verify with:** grid-previews and indicator tests; browser check.
- **Parallel with:** C4

### Chunk C6: e2e, docs, line counts
- **Skill:** testing, document
- **Done when:** a Drive offline e2e on the production build covers warm online open without a spinner, cold offline open, Starred, Shared, and a never-synced folder; Docs offline e2e specs stay green; `offline-platform.md` describes the tree; the PR states data-layer line counts before (Docs home 3,876; Drive data hooks 1,318; `lib/offline/docs` 2,615; `lib/offline/drive` without upload 2,814) and after.
- **Verify with:** `pnpm --dir packages/apps exec playwright test -c playwright.config.mjs` (offline project), PWA config.
- **Parallel with:** none

### Chunk V: cross-chunk verify
- Read-only verifier per [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md); done when `PASS` or `PASS_WITH_NITS` and the parent ran the done-checklist.

## Test plan

- [ ] API: failing feature tests first (S1–S3), then implement, then done gate.
- [ ] UI: Vitest for tree sync, predicates and the view hook; RTL for the Docs binding.
- [ ] Browser e2e on this Mac against the production build: cold browser, warm, offline, second tab, refresh mid first sync.
