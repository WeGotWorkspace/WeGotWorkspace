# Docs and Drive lists: one route, no full text per row

Derived from [spec.md](./spec.md). Chunk layout for implementation after the product lead confirms the decision.

## Goal

One shared first-pass client layer for Docs and Drive lists, a Docs server list that never reads full text per row, and a fixed list cap, proven by a before/after run on 2000 documents.

## Budget

Draws from the traffic budget of Epic #2284 (60 requests per minute per IP). Displaces nothing; it lowers Docs first-download requests and removes the unpaced Docs list pages.

## Non-goals

- Moving Docs to `FileNode/query` in this change (option B below).
- The device policy UI.

## What exists

- Docs lists through `GET /search/results` over `search_documents`; the page is `select d.*`, including `body_text`, ordered by `token_score`, `modified_at_ts`, `id`. `path: packages/api/app/Services/Search/SearchDocumentStore.php:140`
- The snippet is the first 160 characters of the body in browse mode. `path: packages/api/app/Services/Search/UnifiedSearchService.php:368`
- `body_text` is indexed up to 512000 bytes per file. `path: packages/api/app/Services/Search/SearchIndexerService.php:20`
- The server caps a page at 100 and `offset` at 1000; the client page size is 50. `path: packages/api/app/Services/Search/UnifiedSearchService.php:21`, `path: packages/apps/src/lib/files/docs-home-listing.ts:27`
- The Docs list pages are fetched without the pacer; only the body queue uses it. `path: packages/apps/src/lib/offline/docs/docs-body-sync.ts:114`
- Drive lists a folder with `FileNode/query` (parentId) plus `FileNode/get`. `FileNode/query` supports no extension filter and no modified sort, loads every candidate node of the tree it touches and slices the id list afterwards. `path: packages/api/app/Services/Jmap/Methods/FileNodeQueryMethod.php:22`, `:113`, `:128`
- `jmap_file_nodes` has no extension or content mtime column; `modified` is a disk stat per node. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php:66`
- #2381 made `/get` lean per record (FileNode/get skips the type sniff unless asked) and kept `maxObjectsInGet` at 500. `path: packages/api/app/Services/Jmap/JmapCapabilities.php:86`
- A search result already carries the FileNode id (`nodeId`, #1976), the join key for 2338 chunk F. `path: packages/api/app/Services/Search/UnifiedSearchService.php:136`

## Measured today and what each number means

Harness: PHPUnit, in-process HTTP kernel with real routes and auth, sqlite, PHP 8.5.6, `memory_limit=-1`, peak = `memory_get_peak_usage` delta per request. 2000 documents (`.md`) in 20 folders plus 2000 other files in the same tree; the index rows were written with `SearchDocumentStore::upsert`, the files on disk. Same method as the 2359 and spike benches; bench code and raw JSON are in the shared notes folder of the session group (not in the repository). The request floor of this harness is about 170 ms, so only the difference between rows is meaningful. **Measured:** all numbers below. **Not measured (guessed):** MariaDB timings, the real 128 MB limit, real disk, concurrency, a real browser.

Docs list, browse mode, today (`select d.*`):

| case | ms | peak MB | notes |
|---|---|---|---|
| page of 50, mixed bodies (avg ~22 KB) | ~200 | 0.8 | 20 KB response |
| page of 100, mixed bodies | ~210 | 1.7 | 41 KB response |
| page of 100, every body 400 KB (near the 512 KB cap) | 2247 | 39 | response unchanged at 41 KB |
| page of 100 at offset 1000, 400 KB bodies | 7173 | 39 | sort plus offset over the full rows |
| all 2000 at 50 per page | 40 requests | | |
| all 2000 at 100 per page | 20 requests | | |

With the browse select cut to `SUBSTR(body_text, 1, 200)` (experiment, not committed):

| case | ms | peak MB |
|---|---|---|
| page of 100, mixed bodies | ~175 | 0.5 |
| page of 100, 400 KB bodies | 192 | 0.5 |
| page of 100 at offset 1000, 400 KB bodies | 192 | 0.5 |

The saving is memory (39 MB to 0.5 MB on the heavy mix, mixed mix 1.7 to 0.5) and, on the heavy mix, 2247 and 7173 ms to under 200 ms. **sqlite caveat:** MariaDB keeps long text off the row page; whether `SUBSTR` still reads the whole value there is not measured. That is why the stored column is a gated second step (chunk D2).

**Finding: Docs lists at most about 1050 documents.** With 2000 documents, offset 1950 is clamped to 1000 and returns the same rows again, and `hasMore` is false from offset 1000, so the client loop reached 1050 unique documents of 2000 (measured). Documents beyond that never show in Docs home and never enter its offline cache. The keyset cursor (chunk D1) fixes this; it is not a lean-read problem but it blocks the "2000 documents" target.

FileNode route for the same 2000 documents (4000 files in the tree):

| case | ms | peak MB | queries |
|---|---|---|---|
| `FileNode/query` all files | ~390-450 | 8.6 | 69 |
| `FileNode/query` `nameMatch *.md` (a filter after load) | ~315-355 | 8.6 | 69 |
| `FileNode/get` 500 ids, lean properties | ~200-230 | 1.7 | 24 |
| `FileNode/get` 500 ids, full properties | ~380-435 | 10.5 | 24 |
| query plus 4 lean gets (all 2000 documents) | ~1100-1200 | 8.5 | 165 |

The FileNode route is five requests per 2000 documents instead of 20, but each request does more server work, the query cost grows with all files in the tree and not with the documents, and it returns no snippet, no sort by modified time and no sharing flags. **Guessed, not measured:** that a pushed-down extension and mtime query would bring the query close to the search route.

## Options

| | A. Keep the search route, lean (chosen) | B. Docs through `FileNode/query` |
|---|---|---|
| Server change | browse select without full body; keyset cursor; optional stored snippet | extension filter, modified sort, `limit` pushed into SQL, extension and mtime columns on `jmap_file_nodes` plus a backfill by tree reconcile, sharing flags and snippet through another path |
| Size | small to medium, API only plus a small client change | large: a migration, three new query features with tests on MariaDB and sqlite, a new snippet source, and reconciling two permission models (search index ACL against the FileNode path authorizer) |
| Requests per 2000 docs | 20 at 100 per page | about 5 plus the snippet problem |
| Risk | low; query already exists and is tested | the lazy reconcile that `FileNode/query` runs for unfiltered queries is the expensive part of Drive's cold start (4-5 s measured by the spike for 2000 nodes) and would now run for a Docs-only cold start |
| One route | one client layer, two server routes | one server route |

Considered: `FileNode/query` for Docs (rejected for now: no extension filter, no modified sort, no pushdown, no mtime column, no snippet; building them is a feature in itself and the request saving is 15 requests per 2000 documents); a client-side filter over Drive's cached metadata (rejected as the only route: a Docs-only cold start would need Drive's per-folder crawl, which costs one request per folder, more than 20 search pages for a normal tree; kept as an optimisation when Drive metadata is already cached, see chunk C); a separate `snippet` table (rejected: a nullable column is enough). Trigger to revisit option B: Drive gains an indexed flat list (extension or mtime column) for its own reasons, or the product lead requires one server route (question 1).

## Snippet decision

Browse returns the first 160 characters, so the list needs only the start of the body.

1. **Step 1 (chunk D1), no migration:** browse selects an explicit column list and `SUBSTR(body_text, 1, 200)`; the 160-character cut happens as today. Measured above.
2. **Step 2 (chunk D2), only if the MariaDB run shows the blob is still read:** a nullable `snippet` column on `search_documents`, written by `SearchIndexerService` on every index of a file, read by browse. Backfill: none required for correctness, because a null snippet falls back to step 1; the admin reindex job (`reindexAllFromFileNodes`) fills the column in the background. Token search is unchanged.
3. Lazy snippet (fetch on scroll) is rejected: the snippet is what makes the list usable offline, and a per-row request multiplies traffic.

## Offline cache and body queue

- The Docs offline listing store (`docs-listing-offline-store`) keeps its row shape (`WgwUnifiedSearchResult`); the cursor replaces `offset` only inside the fetch loop, so cached rows and the cache key are unchanged. A stored snippet is the 160 characters, as now.
- Docs and Drive each declare their listing to the shared body queue of 2338 chunk F, keyed on the FileNode id. This spec adds one requirement to that chunk: the Docs listing row must carry `nodeId` for every row (server annotates it already; rows the FileNode index does not know yet get none and are keyed by path until the next pass).
- The Docs list first pass and the Drive crawl both run under the cross-tab lock and the browser-wide pacer; list pages take the lean-page priority, bodies sit below.
- No regression rule: a document that is `full` in the offline store is never replaced by the list row; the list only adds rows or updates metadata.

## Invariants

- A list row is a view: no write is built from it. A wrong change lets a document be saved from its 160-character snippet. Proof: `path: packages/apps/src/lib/offline/lean-sync/lean-guard.contract.test.ts` assertion `no write path is built from a lean record`.
- Browse output (title, size, modified time, sharing flags, `nodeId`, 160-character snippet) is identical before and after. A wrong change shows a different snippet in the Docs list. Proof: `path: packages/api/tests/Feature/Search/DocsBrowseLeanTest.php` assertion `snippet equals the first 160 characters of the body`.
- Access rules of `whereReadable` are untouched. A wrong change lists another user's document on a later cursor page. Proof: `path: packages/api/tests/Feature/Search/DocsBrowseLeanTest.php` assertion `no page shows another user's document`.
- Token search keeps matching on `body_text`. A wrong change drops body matches from search. Proof: `cmd: cd packages/api && vendor/bin/phpunit tests/Feature/Search`.
- Every Docs list page is paced. A wrong change sends list pages outside the browser-wide pace and risks the IP ban. Proof: `path: packages/apps/src/lib/files/docs-home-listing.test.ts` assertion `every list page waits for the pacer`.

## Open decisions

- Question 1 of spec.md (two server routes behind one client layer, or one server route): the product lead decides; this plan builds option A.
- Chunk D2 (stored snippet column) is decided by the MariaDB measurement in chunk M, not by opinion.

## Chunks

### Chunk D1: Docs browse without full text and without the 1050 cap (server)
- **Skill:** api, security
- **Inputs:** `path: packages/api/app/Services/Search/SearchDocumentStore.php:140`, `path: packages/api/app/Services/Search/UnifiedSearchService.php:21`
- **Done when:** browse (no tokens) selects columns explicitly with a cut `body_text`, orders by `modified_at_ts`, `id` and accepts a keyset cursor (`after`) next to `offset`; the response returns the next cursor; the first 160 characters of the snippet are byte-identical to today for the same row (test); a feature test lists 2000 indexed documents page by page through the cursor and sees every one once; offset paging for token search still passes its existing tests; access rules (`whereReadable`) are unchanged and a test proves another user's documents never appear in any page; OpenAPI updated.
- **Verify with:** `cmd: php scripts/done-gate.php`
- **Parallel with:** C

### Chunk D2: Stored snippet column (gated)
- **Skill:** api
- **Inputs:** `path: packages/api/app/Services/Search/SearchIndexerService.php:92`
- **Done when:** only after the MariaDB measurement of chunk M shows the cut still reads the long text. A nullable column, written on every index of a file, read first by browse with the cut as fallback; migration is idempotent; the admin reindex fills it; a test proves identical output with and without the column set.
- **Verify with:** `cmd: php scripts/done-gate.php`
- **Parallel with:** C

### Chunk C: Shared client first pass for Docs and Drive lists
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/lib/files/docs-home-listing.ts:27`, `path: packages/apps/src/lib/offline/core/background-sync-pacer.ts`, the lean-sync helper of 2338 chunk A
- **Done when:** the Docs list pass uses the cursor and the server-returned `limit`; `DOCS_HOME_PAGE_SIZE` is gone and Drive reads the same page-size helper; every list page of both apps calls the pacer before the request (a test with a fake pacer asserts zero unpaced list requests in Docs); a resumed pass continues from its stored cursor; the offline listing store keeps its row shape; a second tab runs no duplicate pass.
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/docs-core src/lib/files src/lib/offline/docs src/lib/offline/drive src/lib/offline/core`
- **Parallel with:** D1 (needs its cursor contract; the contract is in this spec)

### Chunk F: Joint body queue (already planned)
- **Done when:** as 2338 chunk F, plus the `nodeId` requirement above. This spec does not duplicate it.
- **Parallel with:** after C

### Chunk M: Measurement
- **Skill:** testing, document
- **Done when:** the before/after table below is filled with measured numbers on the same 2000-document data set: once on sqlite (as above) and once on MariaDB (the stack used for the team simulation), both with the mixed and the heavy body mix; the browser request count comes from the traffic harness of #2292 (`playwright.traffic.config.mjs`); `docs/realtime-capacity.md` records the results.
- **Verify with:** `cmd: WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs`
- **Parallel with:** after D1 and C

## Before/after plan on 2000 documents

Same data as the measured table: 2000 `.md` files, 2000 other files, mixed bodies and a heavy mix (every body 400 KB). Measure per request (ms above the floor, peak MB, response size, query count) and per cold start (requests in minute 1, documents listed, bytes).

| metric | before (measured) | target after D1 and C |
|---|---|---|
| documents reachable in the Docs list | 1050 of 2000 | 2000 |
| list requests for 2000 documents | 40 (and capped) | 20 |
| peak MB, page of 100, heavy mix | 39 | under 1 |
| ms, page of 100 at depth 1000, heavy mix | 7173 | under 250 on sqlite (above-floor share to be re-measured on MariaDB) |
| unpaced Docs list requests | all | none |
| Docs-only cold start, requests in minute 1 | 92 (2338 baseline, 40 documents) | under 60 (2338 target) |

The after column is a target until the chunks are built; MariaDB and the browser run are the part that is **not measured yet**.

## Affected packages

- packages/api, packages/apps, docs (see spec.md).
