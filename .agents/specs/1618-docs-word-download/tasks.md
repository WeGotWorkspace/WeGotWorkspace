# Engineering tasks — Download a Doc as a Word file

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-walker` | builder | workspace | `packages/apps/src/text-editor-core/src/export/text-editor-export-blocks.ts` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/src/export` |
| `chunk-b-docx-writer` | builder | workspace | `packages/apps/src/text-editor-core/src/export/docs-docx-writer.ts`, `text-editor-export-images.ts`, `packages/apps/package.json` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/src/export` |
| `chunk-c-download-menu` | builder | apps-ui, workspace | `packages/apps/src/docs-core/src/docs-header-actions.tsx`, `docs-download-menu.tsx`, `docs-labels.ts`, `text-editor-core/docs-collab/docs-collab-header-actions.tsx`, `docs-core/src/docs-workspace.tsx` | `pnpm --dir packages/apps exec vitest run src/docs-core src/text-editor-core` |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update #1618 first, then re-sync spec/plan/tasks and the body-hash.
