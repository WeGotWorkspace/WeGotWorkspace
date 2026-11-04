# Engineering tasks — Drive: upload a folder with its subfolders

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id              | owner / agent | skill     | key paths                                                                                                                                    | verify command                                                          |
| --------------- | ------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `chunk-a-queue` | builder       | workspace | `packages/apps/src/lib/offline/drive/upload/drive-upload-folder-enqueue.ts`, `drive-upload-folder-create.ts`, `drive-upload-folder-store.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/drive/upload` |
| `chunk-b-ui`    | builder       | apps-ui   | `packages/apps/src/drive-core/src/use-drive-upload-action.tsx`, `drive-upload-batch-dialog.tsx`, `drive-upload-folder-row-state.ts`          | `pnpm --dir packages/apps exec vitest run src/drive-core`               |

## Notes

- Chunk `id` values match `plan.md`.
