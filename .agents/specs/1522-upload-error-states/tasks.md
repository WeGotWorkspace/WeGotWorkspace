# Engineering tasks — Drive uploads: pause and error states, warnings

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                 | owner / agent | skill     | key paths                                                                                                                         | verify command                                                                                                      |
| ------------------ | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `chunk-a-states`   | builder       | workspace | `packages/apps/src/drive-core/src/drive-uploads-pane.tsx`, `drive-upload-queue.tsx`, `drive-upload-choose-folder.tsx`             | `pnpm --dir packages/apps exec vitest run src/drive-core`                                                           |
| `chunk-b-warnings` | builder       | workspace | `packages/apps/src/wegotworkspace/src/wegotworkspace-logout.tsx`, `packages/apps/src/drive-core/src/use-drive-upload-recovery.ts` | `pnpm --dir packages/apps exec vitest run src/wegotworkspace src/drive-core/src/use-drive-upload-recovery.test.tsx` |
| `chunk-c-bar`      | builder       | apps-ui   | `packages/apps/src/drive-core/src/drive-main-pane.tsx`, `packages/apps/src/drive-core/src/use-drive-upload-action.tsx`            | `pnpm test:apps-done-gate`                                                                                          |

## Notes

- Chunk `id` values match `plan.md`.
