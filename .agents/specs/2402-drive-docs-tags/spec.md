Source: #2402 (body-hash: 3c78af58)
Goal: WeGotWorkspace/Product#158

# Tags on Drive files and Docs

Technical translation of #2402. Tasks (Product#58) is a sibling Goal and not built here, but the model and editor are designed as shared code for it.

## Goal

A tag is a lowercase label on a file node, exactly like a Notes tag: letters a-z and hyphen, at most 255 characters, no stored entity, no colour, no nesting. Drive and Docs show one file tree (#2063), so a tag set in either app is the same data in both. A tag on a Team file belongs to that Team's item and every Team member who can see the node sees it; a tag on a personal file is visible to its owner. People add and remove tags per file or for a selection, get suggestions from tags already in use, and open a tag to see every tagged file across all folders.

## Non-goals

- Tags on tasks (Product#58); cross-app tags; tag colours; nested tags.
- A tag admin screen, or creating a tag nobody uses.
- Tags in WebDAV clients, or on guest/public share links.
- Changing the Notes tag storage (VJOURNAL CATEGORIES stays).

## Affected packages

- packages/api (JMAP FileNode: table, projection, set, query, tag list)
- packages/apps (shared tag model and editor in `lib`, drive-core, docs-core, offline Drive/Docs)
- docs (OpenAPI / JMAP capability note)

## Technical constraints

- **Storage: table `jmap_file_node_tags`** on the wgw connection, one row per (node_id, tag), unique pair, index on tag and node_id. Not a DAV property (files are Flysystem objects with no property store; a propstore is path-keyed and would need rewriting on move) and not file content (binary files; Docs content is Yjs).
- **Why node id, not path:** a move keeps the node row and node id (`FileNodeIndexService::recordMove`), so tags survive rename and move without bookkeeping. Stars, shares and threads are path-keyed and need `DrivePathBookkeeping` rewrites; tags do not. Delete and purge must drop the rows (hook in `DrivePathBookkeeping::afterDelete` and the trash purge).
- **Visibility follows the node:** the projection and the tag list only return tags of nodes the principal can see (`FileNodeVisibility`). There are no tag ACLs. This is how "Team files show the Team's tags" holds with no extra rule, and it matches Product#155 (access through the Team only).
- **Wire (WGW extension, like `note`):** `tags: string[]` on FileNode get for files and folders; `tagsAdd`/`tagsRemove` on FileNode/set update (same delta shape as Notes, never a full replace); a `hasTag` filter (normalised, case-insensitive) on FileNode/query; a read-only list of tags in use with counts for the caller. A tag edit bumps the node `change_seq` so the existing inbound sync and live updates deliver it, in both apps.
- **Validation:** one rule shared with Notes (a-z and hyphen, max 255). PHP validates the same pattern server-side; an invalid add returns `invalidProperties`. Removal matches case-insensitively, like Notes.
- **Write rights:** a tag write needs the same right as renaming that node (`myRights`). Read-only nodes show tags but cannot change them.
- **Shared code:** move `lib/models/note-tag.ts` and `lib/offline/notes/notes-tag-delta.ts` to a generic `lib/tags/`; Notes re-exports so nothing visible changes. The chip (`tag`), an editor (input with suggestions, chips) and a selection-tag action are shared components; apps only declare labels and the source of suggestions. Tasks reuses them later.
- **Offline:** the Dexie node row gains `tags`; tag edits queue in the Drive outbox as a delta merged per node with the shared delta merge; the same row feeds Docs (one workspace). The tag list for suggestions and the sidebar is computed from cached rows plus the last server list. A tag view offline shows cached nodes only and says so for folders not cached, matching the #2063 "not available offline" rule.
- **Files stay small:** the tag editor and sidebar are new files; `use-*` hooks respect the hook-size check; no baselined file grows.

## Edge cases

- **Move between personal and Team space:** the node id is kept, so tags move with the item. A personal file moved into a Team shows its tags to every member; a Team file moved out shows them only to the new owner. The move dialog already warns about access changes (Product#155); it should also say tags go along. Open question for the product lead.
- **Copy:** the copy gets the same tags (new node id, rows copied). Copy into another space follows the same rule as move.
- **Trash and restore:** rows stay while the node is in trash; trashed nodes are left out of tag views and counts; purge deletes the rows.
- **File shared to one person (personal sharing only):** the grantee sees the owner's tags, and can edit them if they can rename. There is no separate set per person. Open question for the product lead.
- **Same name in personal and in a Team:** one entry in the list; the filter matches both (Notes behaves the same).
- **Folders:** folders can carry tags like files; a tag view lists both.
- **Hidden trees:** `.notes`, `.Trash` and other hidden paths never appear in tag views; Notes tags stay in Notes.
- **Offline add then remove of the same tag:** the merge ends removed; two devices adding different tags both land (delta, not replace).
- **Rename a tag everywhere:** client fan-out over loaded writable nodes first, like #676; a server bulk op only if the loaded set proves too small (slice F).
