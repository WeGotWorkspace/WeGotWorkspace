# Rename a notes tag across every loaded note

Derived from [spec.md](./spec.md). One chunk. Decisions D1–D7 are closed in the implementation-plan comment on #676.

## Goal

Rename a sidebar tag by planning a client-side fan-out, applying an optimistic tag rewrite, and persisting one `{tagsAdd, tagsRemove}` delta per writable note.

## Budget

No separate budget. The work is the single chunk below.

## Non-goals

See [spec.md](./spec.md). No server production changes.

## What exists

- Tag delta apply-before-add is already on the server. `path: packages/api/app/Services/Notes/NoteTag.php:94`
- `assignTagToNotes` is the multi-note tag write to mirror, including `noteAllowsTagAssignment(note, true)`. `path: packages/apps/src/notes-core/src/use-notes-mutations.tsx:474`
- Sidebar tag rows are a chip button with no rename control. `path: packages/apps/src/notes-core/src/notes-workspace.tsx:518`
- Tag view filter is exact `includes`. `path: packages/apps/src/notes-core/src/notes-note-utils.ts:601`
- `use-notes-mutations.tsx` is baselined at 937. `path: tools/file-size-baseline.tsv:18`

## Considered

Considered: a server bulk rename, a full `categories` replace, and `renameCachedNotebook` / bootstrap cache rewrite. Rejected in the issue plan (D1, D6). Considered: blocking a rename onto an existing tag. Rejected (D4): merging is allowed and the dialog warns first.

## Affected packages

- packages/apps
- packages/api tests only

## Dependencies

None. The chunk does not wait on another branch.

## Open decisions

None — every choice for this work is made.

## Invariants

- A single-note tag add or remove still sends only `tagsAdd` or `tagsRemove`. A wrong change would replace the whole category list. Proof: `path: packages/apps/src/notes-core/src/use-notes-controller.test.tsx` assertion `persists tag edits as a delta`.
- `use-notes-mutations.tsx` stays 937 lines. Proof: `cmd: pnpm run check:file-size`.
- Lowercase `categoriesRemove` drops a stored mixed-case tag. Proof: `path: packages/api/tests/Feature/Notes/NotesTagDeltaTest.php` assertion `test_a_lowercase_remove_drops_a_stored_mixed_case_tag`.

## Chunks

### Chunk A: Rename notes tag

- **id:** `rename-notes-tag`
- **Skill:** workspace, apps-ui, accessibility, storybook, testing
- **Inputs:** implementation-plan comment on #676; `path: packages/apps/src/notes-core/src/use-notes-mutations.tsx:474`; `path: packages/apps/src/notes-core/src/notes-note-utils.ts:601`
- **Done when:** the plan's unit, dialog, sidebar, PHPUnit, and Storybook tests pass; manual acceptance is walked; `notes-workspace.tsx` is at or under 800 lines
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/notes-core/src/note-tag-rename.test.ts src/notes-core/src/use-notes-tag-rename.test.tsx src/notes-core/src/notes-rename-tag-dialog.test.tsx src/notes-core/src/use-notes-sidebar-model.test.tsx src/notes-core/src/notes-note-utils.test.ts` and `composer test -- --filter test_a_lowercase_remove_drops_a_stored_mixed_case_tag` in `packages/api`
- **Parallel with:** none

## Test plan

- [ ] Pure plan + tag rewrite unit tests
- [ ] Hook tests for delta, view retarget, toast counts, and undo
- [ ] Dialog tests for seed, charset, merge hint, and cancel
- [ ] Sidebar `onRename` and case-insensitive tag view
- [ ] PHPUnit mixed-case remove
- [ ] Mock-tier Storybook states Default, InvalidName, MergeWarning
