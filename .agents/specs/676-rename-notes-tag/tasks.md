# Engineering tasks — Rename a notes tag across every loaded note

**Not** a copy of the GitHub issue checklist. This file tracks which chunk implements the technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `rename-notes-tag` | builder | workspace, apps-ui, accessibility, storybook, testing | `packages/apps/src/notes-core/src/note-tag-rename.ts`, `packages/apps/src/notes-core/src/use-notes-tag-rename.tsx`, `packages/apps/src/notes-core/src/notes-rename-tag-dialog.tsx`, `packages/apps/src/notes-core/src/notes-workspace.tsx`, `packages/apps/src/notes-core/src/use-notes-controller.tsx`, `packages/api/tests/Feature/Notes/NotesTagDeltaTest.php` | `pnpm --dir packages/apps exec vitest run src/notes-core/src/note-tag-rename.test.ts src/notes-core/src/use-notes-tag-rename.test.tsx src/notes-core/src/notes-rename-tag-dialog.test.tsx src/notes-core/src/use-notes-sidebar-model.test.tsx src/notes-core/src/notes-note-utils.test.ts` |

## Notes

- Chunk `id` matches the worktree chunk `rename-notes-tag`.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
