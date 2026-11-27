Source: #2063 (body-hash: 5eae6e09)

# One local file tree for Drive and Docs home

Technical translation of #2063 as redirected on 2026-11-26: the device keeps one recursive file tree, and every Drive and Docs home list is a local query on it.

## Goal

The device holds the whole file and folder tree the person can see (home, every team drive, Trash, and the roots shared with them) in one Dexie table, `drive_entries`. The tree is fetched once in a few batched JMAP requests, and after that is kept current with `FileNode/changes` only. Every list in Drive and in Docs home is a query on that table, served by one shared hook in `packages/apps/src/lib`. Docs home is a configuration of the Drive workspace (entry filter, views, labels, create actions, open-file behaviour) with no data layer of its own. A full-pane loading state shows only while the first sync on this device has not finished and the view has no rows.

## Non-goals

- Downloading file bodies or binaries. Content sync stays as it is, apart from the per-row indicator fixes in #2063. The shared body queue is #2338 chunk F.
- Full-text search offline. Content search stays a server call (`GET /search/results`), online only. Filtering by name runs on the local tree.
- Moving Drive or Docs inbound onto the shared sync engine of #1565. The tree sync keeps its own path-keyed binding and uses the #1565 domain contract (`drive-domain-contract.ts`) where it exists.
- Any change to the PWA identity of either app (manifest, route, icons, push scope).
- Guest (share-link) sessions. They keep their live listing.

## Affected packages

- packages/api: `FileNodeQueryMethod`, `FileNodeAccountSupport`, `FileNodeIndexService`, `FileNodeSyncState`, `FileNodeMapper`, OpenAPI/JMAP contract notes.
- packages/apps: `lib/offline/drive/*` (tree sync, store), a new `lib/files/tree-view/` (shared view hook and view predicates), `drive-core` and `docs-core` bindings; Dexie schema version bump; removal of the Docs listing cache.
- docs: `packages/apps/docs/offline-platform.md` (Drive and Docs rows).

## Technical constraints

- **Request budget.** A shared host bans an IP above 60 requests per minute (Epic #2284). The first sync of a 20k-node tree must take at most 3 listing requests. The first request is the state get plus 15 query+get pairs, and each later request is 16 pairs of 500 (`maxCallsInRequest` 32, `maxObjectsInGet` 500).
- **Query cost.** One unfiltered `FileNode/query` page must not reconcile the whole tree against disk, and must not hydrate every node as an Eloquent model. Measured on main `da19686dc` with 20,440 nodes:
  - with reconcile: 1.93 s and 916 SQL queries per page;
  - without reconcile: 1.67 s and 30 SQL queries.
- **Change state.** The `FileNode/changes` state must change when the set of roots changes (team join or leave), not only when member grants change. Otherwise a joined team's existing files are never sent and a left team's files stay on the device.
- **Share roots.** A node shared with the person keeps its owner's `parentId`, which the person cannot see (`FileNodeAccountSupport.php:164-168`). Every row's path is the virtual path that `FileNode/get` returns, so two share roots with the same name stay distinct. After a complete pass, the client treats a node whose parent is not in the tree, and that is not an account root, as a share root. Pages arrive in `node_id` order and ids are random, so a parent can come after its child; the class is never decided per page.
- **Paged walk is not a snapshot.** Position paging on the name sort shifts when a node before the cursor is deleted or renamed, so the walk pages by a `node_id` keyset instead, limited to nodes that existed at the state from before page 1. Walked pages go to a persisted staging set, so a resume keeps them. After the last page the client catches up with `FileNode/changes` from that state. The walk ends only on a successful short page. A page is kept only when it and every page before it in the request succeeded, so a retry starts at the first failed page; any such error leaves the tree and the token as they were. Final paths are resolved after the catch-up from each node's parent and name, so a folder renamed during the walk, also inside another renamed folder, takes its already-fetched children with it. It prunes only when the catch-up succeeds, keeping the paths of the walked nodes after the catch-up and the dot-path filter, plus the protected rows of `prunerProtectedPaths` (outbox paths, upload placeholders, pending server saves, their ancestors). On `cannotCalculateChanges` it does not prune and starts a new pass.
- **Dot paths.** `.Trash` is part of the tree. A node with any other path segment that starts with `.` (`.notes`, `.attachments`, and everything inside them) is file-indexed on the server but is not stored as a list row, neither by the walk nor by the change applier, and never appears in a view.
- **One operations layer.** Docs writes go through Drive's hybrid operations; Docs-only side effects live in the Docs binding.
- **Row shape.** `drive_entries.data` stays the `WgwDriveDirectoryEntry` JSON. New indexed columns (`ext`, `area`) avoid parsing 20k JSON blobs for a Docs or Trash query.
- **Lean records (#2338).** Tree rows are list records. No whole-object write may be built from one; writes keep going through the existing operations.
- **One tab syncs.** The first sync and full resync run under the existing Web Lock (`withCrossTabLock`), resume from a cursor in the meta store, and never restart a finished page.
- **Language.** All code comments, labels, specs and issue text are in English.

## Edge cases

- Offline before the first sync has finished: the list shows the rows that already arrived. When there are none, it says the files are not available offline yet. It never says the folder is empty.
- A folder that synced with zero entries is known-empty and shows the empty state without a spinner.
- The person joins a team: the state no longer matches, `FileNode/changes` returns `cannotCalculateChanges`, and the client runs a paged full resync. The team's files appear.
- The person leaves a team: same path; the full resync prunes the team's rows.
- Someone drags a folder from their home into a team drive, or restores a team folder from Trash: `FileNode/changes` reports the folder and every descendant to the other members, so the folder does not show as empty.
- A share is revoked: the grant hash changes (existing behaviour) and the full resync prunes the share root.
- A file is renamed by another client: `FileNode/changes` reports an update. The row moves to its new path and every view re-queries.
- A folder and a folder inside it are both renamed, or a share root is renamed, between two opens: one `FileNode/changes` batch places every cached descendant under the new paths.
- A file or folder is deleted, renamed, or created while the first sync is between two pages: the keyset does not shift, the catch-up from the pre-page-1 state applies the change, and no unchanged file is pruned. A file created and deleted during the walk is never stored.
- The first sync is interrupted (refresh, tab closed): the next run resumes from the stored cursor with the same pre-page-1 state and keeps the pages fetched before the abort. If the catch-up then answers `cannotCalculateChanges`, the rows stay, nothing is pruned, and a new pass starts.
- A shared file has its sharing changed by its owner: the node's change sequence is bumped, `FileNode/changes` reports it, and the badge updates.
- A tab sits on a page while another tab finishes the first sync: the cache-changed topic makes the first tab re-query.
- A write is queued in the outbox for a path: the queued state wins over an inbound row for that path (decision 5 of `1563-docs-inbound-sync`).
- 20k rows in one Docs view: the list is already windowed (`drive-list-spacer.tsx`). The query uses indexed columns, not a JSON scan.
