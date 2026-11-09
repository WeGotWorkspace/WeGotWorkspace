# Engineering tasks — Import Markdown files as notes

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-parser` | builder | testing | `packages/apps/src/notes-core/src/notes-markdown-import.ts`, `notes-markdown-front-matter.ts` | `pnpm --dir packages/apps exec vitest run src/notes-core/src/notes-markdown-import.test.ts` |
| `chunk-shared-upload` | builder | workspace | `packages/apps/src/text-editor-core/docs-collab/docs-image-upload.ts` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab/docs-image-upload.test.ts` |
| `chunk-run` | builder | client-transport | `packages/apps/src/notes-core/src/notes-markdown-import-run.ts`, `packages/apps/src/lib/offline/notes-markdown-import-operations.ts` | `pnpm --dir packages/apps exec vitest run src/notes-core/src/notes-markdown-import-run.test.ts` |
| `chunk-ui` | builder | apps-ui | `notes-import-dialog.tsx`, `use-notes-markdown-import.ts`, `notes-new-menu.tsx`, `notes-workspace.tsx`, stories | `pnpm --dir packages/apps exec vitest run src/notes-core` |

## Notes

- On scope change: update the issue first (or comment the change on it), then re-sync spec/plan/tasks.
