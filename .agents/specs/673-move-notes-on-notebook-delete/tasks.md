# Engineering tasks — Move notes when deleting a notebook

**Not** a copy of the GitHub issue acceptance checklist. This file tracks which chunk implements the technical work.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `notebook-delete-move` | builder | api, apps-ui, workspace, storybook, testing | `packages/api/openapi/openapi.json`, `packages/api/app/Services/Notes/NotebookNotesMover.php`, `packages/api/app/Services/Notes/NotebookRepository.php`, `packages/apps/src/notes-core/src/use-notes-notebook-delete.tsx`, `packages/apps/src/notes-core/src/notes-change-notebook-dialog.tsx`, `packages/apps/src/lib/offline/notes-offline-store.ts` | `composer test -- --filter NotebookDeleteWithMoveTest` in `packages/api`; `pnpm exec vitest run src/notes-core/src/use-notes-notebook-delete.test.tsx src/notes-core/src/notes-change-notebook-dialog.test.tsx src/notes-core/src/use-notes-notebook-mutations.test.tsx src/lib/offline/notes-offline-store.test.ts src/lib/offline/notes-hybrid-operations.test.ts src/lib/api/wgw/notes-archive.test.ts` in `packages/apps` |

## Notes

- Chunk `id` matches the worktree chunk `notebook-delete-move`.
- On scope change: update the issue first, then re-sync spec, plan, tasks, and the `Source:` body-hash.
