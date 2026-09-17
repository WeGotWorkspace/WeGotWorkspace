# FileNode node-identity design (JMAP filenode, #439)

> **Issue:** [#439](https://github.com/WeGotWorkspace/wegotworkspace/issues/439) · **Epic:** [#435](https://github.com/WeGotWorkspace/wegotworkspace/issues/435) · **Spec folder:** `.agents/specs/450-jmap-envelope-filenode/`
> **External spec:** draft-ietf-jmap-filenode-14 (pinned) · **Depends on:** real blobs (#438, merged)
>
> Design gate for the files envelope build (chunk F). The build Task derives its acceptance criteria from this document.

## Problem

draft-ietf-jmap-filenode-14 requires **stable node ids** with mutable `name`/`parentId`, and a `FileNode/changes` method. The drive has neither: every surface is **path-addressed** (REST `DriveService` items are `{type, path, name, size, time}`; WebDAV nodes are `FlysystemNode` wrappers around storage keys; the DAV ETag is `sha1(key:mtime:size)` — it changes on rename), and Flysystem has no changelog. The only UUIDs in the drive domain identify **share records** (`drive_shares.id`), not nodes.

Verified starting facts (2026-08-13):

- **REST writes** all funnel through `DriveService` (`createItem`, `handleUpload`, `renameItem`, `deleteItems`); there is no REST copy endpoint.
- **WebDAV writes** happen in `FlysystemNode::setName()` (MOVE), `FlysystemFile::put()/patch()/delete()`, `FlysystemDirectory::createFile()/createDirectory()/delete()/moveInto()`. The node methods have **zero hooks**, but the server registers after-method plugins — `SearchIndexPlugin` (`afterMethod:{PUT,PATCH,MKCOL,DELETE,MOVE,COPY}`) is the precedent to copy.
- **Drift already exists** between the path-keyed stores: REST rename rewrites `drive_shares.path` (`DriveShareService::rewritePathPrefix`) but not stars; WebDAV MOVE updates **only** the search index (shares and stars go stale); deletes clean neither; notes (`WgwStorage::notes()`, same physical root) and collab `.yjs` sidecars write the same tree outside `DriveService`; `FlysystemFile::patch()` bypasses `put()` with a raw `fopen`.
- **Backfill precedent:** `SearchIndexerService::reindexAll()` walks `allDirectories()` + `allFiles()` on `wgw_files`.
- **Rights resolution exists:** `DriveShareAuthorizer::resolvePathContext` (owner/group → full; else deepest member grant; else guest session) → `DriveShareAccess::rightsFor()`.

## Decision 1 — index table, global change sequence, tombstones

New table **`jmap_file_nodes`** (wgw connection), maintained alongside the disk:

| Column | Type | Notes |
|--------|------|-------|
| `id` | PK auto | internal |
| `node_id` | string(64), unique | **stable FileNode id**, `fn-` + UUID, minted once per node, survives rename/move |
| `storage_key` | string(1024), unique among live rows | current path (`users/...` / `groups/...`) |
| `parent_node_id` | string(64) nullable, index | tree link by **id**, not path (rename of an ancestor touches only that ancestor's row) |
| `name` | string(255) | current basename |
| `is_dir` | bool | draft `nodeType` file/directory (no symlinks — decision 6) |
| `size_bytes` | bigint nullable | files only |
| `content_sha256` | char(64) nullable | files only; updated on content writes (bytes are in hand at write time) |
| `created_at` / `modified_at` | timestamps | draft `created` / `modified` |
| `change_seq` | bigint, index | **global monotonic sequence**, bumped on every mutation of the row |
| `deleted_at` | timestamp nullable | **tombstone** — destroyed nodes keep their row (with bumped `change_seq`) so `/changes` can report them |

Sequence source: a single-row counter table (`jmap_file_node_seq`) incremented in the same transaction as the row write — portable across SQLite/MySQL, totally ordered.

**State string** = the counter value at read time (fits `JmapAccountStateCodec` conventions as a single opaque token; no per-collection map needed because the sequence is global). `FileNode/changes(sinceState)` = rows with `change_seq > since`, **filtered to the account's visible set** (decision 5), split into created (`created after since`), updated, destroyed (tombstones). Tombstones are pruned after a retention window (default 30 days); a `sinceState` older than the pruning horizon → `cannotCalculateChanges` (client refetches — same honesty as the other domains).

Ancestor renames do **not** bump descendants (`parent_node_id` links by id), so a folder rename is exactly one `updated` entry — the id-stability test from the spec folder.

## Decision 2 — maintenance hooks: shared service invoked from both write paths

A new **`FileNodeIndexService`** owns all index mutations (`recordCreate`, `recordContentWrite`, `recordMove`, `recordDelete` — each bumping `change_seq`), invoked from:

1. **REST:** `DriveService` mutation methods (`createItem`, `handleUpload`, `renameItem`, `deleteItems`), next to the existing search-sync calls.
2. **WebDAV:** a new **`FileNodeIndexPlugin`** modeled 1:1 on `SearchIndexPlugin` (`afterMethod:{PUT,PATCH,MKCOL,DELETE,MOVE,COPY}`). MOVE knows source + destination paths at the HTTP layer, so the plugin **re-keys the index subtree while keeping every `node_id`** — this is where rename-stability comes from on the DAV path.

Rejected alternative — wrapping the Flysystem adapter: it would catch notes and collab writes we deliberately do **not** index (decision 4), misses `FlysystemFile::patch()` (raw `fopen`, bypasses `put()`), and loses MOVE semantics (adapter sees delete+create on some drivers). The two-call-site approach matches how search indexing already works and reuses its best-effort pattern (`BestEffortSearchIndexSync`): index failures log (`file_node_index_sync_failed`) and never fail the user's write.

## Decision 3 — drift is expected; reconcile, don't pretend

Out-of-band writes (direct disk access, admin operations, the `patch()` fopen path, crashed half-updates) will desynchronize any index. Mitigations, in order:

1. **Lazy self-heal:** `FileNode/get`/`query` listings compare the index against the disk for the directories they touch; missing rows are minted (new ids), stale rows tombstoned — same best-effort posture as search.
2. **Full backfill/reconcile command:** `wgw:jmap:filenodes-reindex` walks the tree (the `reindexAll()` pattern), keyed by `storage_key`: existing keys keep their `node_id`, new keys are minted, vanished keys are tombstoned. Doubles as the initial backfill (hash computation for `content_sha256` happens here; expensive but one-time and resumable — hash lazily on first read if the walk is interrupted).
3. **Documented limitation:** an out-of-band rename is indistinguishable from delete+create → the node id changes. Every remote-FS protocol on top of a plain filesystem shares this; it goes in the deviations section of the envelope docs.

The plugin work also surfaces two **pre-existing** drive bugs this design does not fix but the build should file issues for: WebDAV MOVE leaves `drive_shares.path` and stars stale (REST rename already rewrites shares).

## Decision 4 — surface scope: what is a FileNode

Indexed and exposed: the account's personal tree (`users/{username}/…`) and member group trees (`groups/{slug}/…`), **excluding**:

- collab sidecars (`.{name}.yjs`) and other dot-file internals — Drive browse and FileNode still agree that these are not listing entries.

**Exceptions** (indexed as FileNodes; Drive browse still hides them):

- the product trash directory `.Trash` (and its children). Drive “Move to Trash” is a FileNode create/move into that folder;
- leftover on-disk `.notes` trees (personal and group) and `.archive` **only** when it lives under `.notes` may still be indexed as FileNodes during/after migration. They are **not** the Notes store. Drive children listings still omit `.notes` via `DriveService::isHiddenNotesPath`. Other `.archive` directories stay hidden.
- **Notes left Drive:** FileNode no longer projects a `note` object. Notes are CalDAV VJOURNAL (`REST /notes/*` + vendor `urn:wgw:jmap:notes` on `POST /jmap`). See [notes.md](../../../docs/architecture/notes.md). There is no FileNode query/get/set under `.notes` and no Drive star for notes. `GET /files/shared-with-me?includeNotes=true` is a leftover Drive flag for old path grants, not a Notes client API.

## Decision 5 — rights, visibility, and shared nodes

- **`myRights`** is derived at read time by resolving the node's current path through the existing `DriveShareAuthorizer` / `DriveShareAccess::rightsFor()` and mapping onto the draft's 8-boolean `FilesRights` (`mayRead`, `mayWrite` split per draft-14 into `mayAddChildren`/`mayRename`/`mayDelete`/`mayModifyContent`, `mayShare`, `mayReadItems` analogs). No new rights storage; inheritance is the authorizer's deepest-grant-wins walk, which matches the draft's ancestor-derived model. `mayShare` follows the authorizer (owners can share children; drive roots cannot) so the REST share dialog can show; `shareWith` writes stay off the envelope.
- **Phase-1 visible set = own tree + member group trees.** Shared-with-me subtrees (`drive_shares` grants) are **deferred**: the draft's discoverability rules (a grant appearing = a flood of `created` in `/changes`, derived-rights change propagation) interact with the per-account filtering of a global change sequence, and drive shares today are path-rooted rather than node-rooted. Revisit after the core envelope lands; `shareWith` writes stay out of scope entirely (roadmap non-goal).

## Decision 6 — nodeType, blobs, and content

- **No symlink nodes.** The virtual tree has no symlink concept; `nodeType` is `file`/`directory` only. Creating a `symlink` node → `invalidProperties`.
- **File content blobIds are node-derived, not blob-store copies:** `fnb-{node_id}-{sha256-prefix}` served by the existing `/jmap/download` endpoint via a third resolver that streams from disk through the index. Copying drive content into `jmap_blobs` would double storage for no gain. The blobId value changes when content changes — allowed by draft-14 (blobId is mutable; the server updates `size` with it).
- **`FileNode/set` create/content-update consumes an uploaded `jb-…` blob and copies the bytes into the file on disk** — after the write the node's blobId is the `fnb-…` derived one and the upload can expire naturally. This is the contacts-media pattern (#438) and it means **no `JmapBlobReferenceCheckerInterface` registration is needed for filenode**: the draft's "referenced blobs must not be GC'd" constraint is satisfied by not holding references. The GC seam stays available if a future decision changes this.
- **`webWriteUrlTemplate`: `null`** (clients use `FileNode/set` + upload), per the roadmap non-goal.

## Consequences for the build Task (chunk F acceptance criteria inputs)

1. Migration `jmap_file_nodes` + sequence table; `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` bump.
2. `FileNodeIndexService` + `DriveService` call sites + `FileNodeIndexPlugin` (DAV); best-effort logging.
3. `wgw:jmap:filenodes-reindex` backfill/reconcile command.
4. Envelope methods `FileNode/get|changes|set|copy|query` (+ `queryChanges` → `cannotCalculateChanges`) behind `urn:ietf:params:jmap:filenode` with a `FilesCapabilityProvider` (gate: `files_enabled`); `onExists` (null/`replace`/`rename`/`newest`), `onDestroyRemoveChildren`, `alreadyExists` + `existingId` per draft-14.
5. Download resolver for `fnb-…` ids.
6. Tests: rename/move id-stability (one `updated`, same id); WebDAV-side write visible in `/changes`; tombstone pruning → `cannotCalculateChanges`; `.notes` (and `.archive` under it) indexed while Drive browse still hides `.notes`; sidecar / other-dot exclusion; `onExists` matrix; group-tree visibility; lifecycle contract test per the spec folder.
7. Docs: envelope dispatch rows, deviations (out-of-band rename changes ids; shared-with-me deferred; no symlinks), draft revision pinned.

## Open questions (explicitly deferred, not blockers)

- Shared-with-me exposure (decision 5) — needs node-rooted shares or a share→node join; candidate follow-up epic item.
- WebDAV MOVE share/star drift (pre-existing) — file as separate bugs during the build.
- `caseInsensitiveNames`: the backing filesystems are case-sensitive in production (Linux); advertise `false` and support `compareCaseInsensitively` per-request as draft-14 allows.
