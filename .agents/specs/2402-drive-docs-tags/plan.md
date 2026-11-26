# Tags on Drive files and Docs

## Goal
Add Notes-style tags to the shared file tree so Drive and Docs show and filter the same tags, with Team/personal scope following the node.

## Budget
Draws from the Pioneer programme budget for the Drive/Docs family; displaces nothing planned. Slice A is small server work; most effort is UI in C to E.

## Non-goals
- Tasks tags, cross-app tags, colours, nested tags, WebDAV exposure.

## What exists
- Notes tags are VJOURNAL categories with an add/remove delta wire shape. `path: packages/apps/src/lib/api/wgw/notes.ts:289`
- Tag rules (a-z and hyphen, 255) and toggle helpers. `path: packages/apps/src/lib/models/note-tag.ts:1`
- The add/remove delta merge used offline. `path: packages/apps/src/lib/offline/notes/notes-tag-delta.ts:28`
- Notes tag rename by per-note delta fan-out. `path: .agents/specs/676-rename-notes-tag/spec.md:1`
- File nodes are rows in `jmap_file_nodes` keyed by node id; a move updates the row. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:484`
- FileNode set properties are whitelisted; `note` is the one extension patch today. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeSetService.php:47`
- Path-keyed extras (stars, shares, threads) are rewritten on move. `path: packages/api/app/Services/Drive/DrivePathBookkeeping.php:44`
- Visible roots for a principal (personal and Team roots). `path: packages/api/app/Services/Jmap/FileNodes/FileNodeVisibility.php:25`
- The shared chip component. `path: packages/apps/src/tag/src/tag.tsx:1`
- Docs home already imports rows, selection and share code from drive-core; #2063 merges the data layers. `path: packages/apps/src/drive-core/src/drive-visible-items.test.ts:1`
- Offline Drive stores nodes in Dexie and flushes an outbox. `path: packages/apps/src/lib/offline/drive/drive-outbox-flush.ts:1`

## Considered
Considered: WebDAV/dead properties (path-keyed property store; files have none; moves must rewrite it) — rejected. Tags inside file content or a sidecar file (binary files, Yjs content, external writers) — rejected. A tag entity table with ids and per-Team ownership (only needed for colours or tag-level access, both non-goals; makes rename atomic but adds a second thing to keep in sync) — rejected for now; string-per-node equals Notes, so people learn it once. Path-keyed rows like stars — rejected: every move needs a rewrite and cross-space moves get ambiguous. A tag-list endpoint versus computing from loaded nodes — both: the endpoint feeds first load and online suggestions, cached rows keep it working offline.

## Affected packages
- packages/api, packages/apps, docs

## Dependencies
A before C. B before C, D and E (B can land first, no visible change). D and E after C. F after D and after the Notes rename behaviour is confirmed. UI chunks build on the shared file workspace of #2063 where it has landed; if not, they bind to both apps' current code and #2063 moves the binding.

## Open decisions
- [ ] (chunk C) Tags follow the item when it moves between personal and Team space. Recommended yes; product lead to confirm.
- [ ] (chunk C) A person a file is shared with (personal sharing only) sees, and with write rights edits, the owner's tags. Recommended yes; product lead to confirm.

## Invariants
- Notes tags behave as before after B. A wrong move of the model breaks note tag toggles. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/models/note-tag.test.ts src/notes-core`
- A person never sees a tag of a node they cannot see. Proof: `cmd: php artisan test --filter=FileNodeTagsVisibilityTest` (test added in A).
- A move or rename keeps tags. Proof: `cmd: php artisan test --filter=FileNodeTagsMoveTest` (test added in A).
- After chunk A, main still works without the next chunk: no client sends `tags` yet and the projection field is additive. Proof: `cmd: php scripts/done-gate.php`

## Chunks

### Chunk A: Server
- **Skill:** api, security
- **Inputs:** table and projection claims above
- **Done when:** migration and model; `tags` on get; `tagsAdd`/`tagsRemove` on set with validation and rights; `hasTag` on query; tag list method; copy copies rows; trash hides; purge and delete drop rows; change_seq bump; OpenAPI/capability note; feature tests for visibility, move, delete, copy, rights, Team versus personal.
- **Verify with:** `php scripts/done-gate.php` (or the CI shards)
- **Parallel with:** B

### Chunk B: Shared tag model and editor
- **Skill:** apps-ui, workspace
- **Inputs:** `note-tag.ts`, `notes-tag-delta.ts`, `tag.tsx`
- **Done when:** `lib/tags/` holds the model, the delta merge and a `TagEditor` (input with suggestions, chips) with stories; Notes imports from it; no visible Notes change.
- **Verify with:** apps done gate; Notes tests green
- **Parallel with:** A

### Chunk C: Tag a file or Doc (visible UI; waits for the product lead)
- **Skill:** apps-ui, workspace
- **Done when:** editor in the file detail panel in Drive and Docs; chips in rows; offline outbox delta; undo; works for Team and personal files; screenshots in the PR.
- **Verify with:** apps done gate and own browser e2e (online, offline, second tab)
- **Parallel with:** none

### Chunk D: Filter by tag (visible UI)
- **Skill:** apps-ui
- **Done when:** sidebar Tags section in both apps; `tag:<name>` view across all folders; empty and offline states.
- **Verify with:** apps done gate and browser e2e

### Chunk E: Bulk tagging (visible UI)
- **Skill:** apps-ui
- **Done when:** the selection bar Tag action applies a delta to all writable selected nodes in one request; skipped read-only nodes counted in the toast; one undo.

### Chunk F: Rename a tag everywhere
- **Skill:** apps-ui, api
- **Done when:** behaviour matches Notes (merge dialog, skipped read-only counted); client fan-out versus server op decided at that time.

- **Chunk V: Cross-chunk verify** — read-only verifier per `developer/multitask-verifier.md`; `done-when`: `PASS` or `PASS_WITH_NITS` and the done checklist run.
