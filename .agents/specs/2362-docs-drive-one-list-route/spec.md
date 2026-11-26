Source: #2362 (body-hash: a823699b)
Goal: WeGotWorkspace/Product#153

# Docs and Drive lists: one route, no full text per row

Technical translation of #2362, a child of Epic #2284 (traffic budget). Design only: no product code ships with this folder. Builds on [2338-lean-first-sync](../2338-lean-first-sync/spec.md) (chunk F, one body queue) and the merged server lean reads (#2381).

## Decision (needs the product lead's confirmation)

**Docs keeps `GET /search/results` as its server list route, with a lean projection and a fixed paging cap. It does not move to `FileNode/query` now.** The "one route" of the issue is delivered where it costs requests: one shared client first-pass runner, one browser-wide pace, one page-size rule and one body queue for Docs and Drive, joined on the FileNode id (`nodeId`). Reasons and numbers are in [plan.md](./plan.md). A server-side move to FileNode stays possible later; plan.md lists the trigger and what it needs.

This differs from the stated view that "Docs is a filter on Drive". Nothing in the user-visible product changes either way, but it is the product lead's call to accept two server list routes behind one client layer, so it is listed as question 1.

## Open product questions

1. Accept two server list routes (search index for Docs, FileNode index for Drive) behind one shared client layer, or require one server route (the larger FileNode build in plan.md, option B)? Default built in here: the shared client layer.
2. Documents beyond the first ~1050 are not listed in Docs today (measured, see plan.md). Fixing it is in scope; no product choice needed, but say if a visible "showing the newest N" cap is wanted instead.

## Goal

Docs lists every document the person can open, newest first, without the server reading each document's full indexed text for a 160-character snippet, and without a second set of limit, pace and queue rules next to Drive.

## Non-goals

- The Yjs sidecar, collaboration, the Docs editor.
- Per-device offline choice (later; the device policy of 2338 chunk D).
- Replacing the token search of Docs and Drive (`q` set): it still matches on `body_text`.
- Changing what Drive lists, or Drive's per-folder crawl.
- Mail, Notes, Contacts.

## Affected packages

- packages/api — `app/Services/Search/SearchDocumentStore.php`, `UnifiedSearchService.php`, `SearchIndexerService.php`, a migration, `openapi/openapi.json`.
- packages/apps — `src/lib/api/wgw/search.ts`, `src/lib/files/docs-home-listing.ts`, `src/lib/offline/docs/*`, `src/lib/offline/lean-sync/*` (shared helper from 2338).
- docs — `docs/realtime-capacity.md` (final numbers).

## Technical constraints

- **Browse stays a flat, SQL-pushed query.** Docs needs a cross-tree list (My Drive plus team drives), sorted newest first, filtered by extension, with sharing flags and the FileNode id. `search_documents` has these columns (`extension`, `modified_at_ts`, `size`, `source_key`) and the page is one indexed query. `FileNode/query` has none of them (plan.md).
- **Snippet.** Browse returns the first 160 characters of the trimmed body (`UnifiedSearchService::snippetForTokens` with no tokens). The new browse path must return the same text. A token search keeps its match-centred snippet and still reads `body_text`.
- **Paging.** Browse uses a keyset cursor (`modified_at_ts`, `id`) instead of `offset`; the `offset` parameter stays for token search, where the cap of 1000 (`UnifiedSearchService::MAX_OFFSET`) remains.
- **One limit rule.** Page size comes from the server response (`limit` is already echoed), capped by one shared client helper; no app keeps its own constant (`DOCS_HOME_PAGE_SIZE` goes away).
- **One pace.** Every list page, Docs or Drive, draws from `backgroundSyncPacer` (`src/lib/offline/core/background-sync-pacer.ts`) at the lean-page priority of 2338. Today the Docs list pages bypass it.
- **Hard rule of 2338 applies.** A Docs row from the lean list is a view. Opening a document in the editor or saving needs the body (`requireFullRecord`); the listing row never feeds a write.
- **OpenAPI contract.** The cursor parameter and the response field are added to `packages/api/openapi/openapi.json` in the same change; the API done gate applies.

## Edge cases

- Row indexed before the snippet column exists: the query falls back to a cut of `body_text`; output is identical, only cost differs until the reindex.
- Document with empty body: `snippet` is null, as today.
- A file deleted between two pages: the keyset cursor skips it; no duplicate or gap (offset paging could shift rows).
- Two tabs: one tab runs the first pass under the cross-tab lock; the other reads the shared IndexedDB.
- Server answers 429 or 503 mid-pass: the shared pacer backs off for the whole browser; the pass resumes from its cursor.
- Document beyond 1050 in an old client: an old client keeps working (offset path unchanged); it just stays capped until updated.
