# Engineering tasks — Drive upload batch dialog

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                     | owner / agent | skill     | key paths                                                                                                                         | verify command                                                                              |
| ---------------------- | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `chunk-a-primitives`   | builder       | apps-ui   | `packages/apps/src/step-dots/`, `packages/apps/src/stepper-dialog/`, `packages/apps/src/installer-core/src/installer-layout.tsx`  | `pnpm --dir packages/apps exec vitest run --project jsdom src/step-dots src/installer-core` |
| `chunk-b-questions`    | builder       | testing   | `packages/apps/src/lib/offline/drive/upload/drive-upload-operations.ts`, `drive-upload-keep-offline.ts`, `drive-upload-memory.ts` | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`      |
| `chunk-c-drive-dialog` | builder       | workspace | `packages/apps/src/drive-core/src/drive-upload-batch-dialog.tsx`, `use-drive-upload-batch-dialog.ts`, `drive-upload-notices.tsx`  | `pnpm test:apps-done-gate`                                                                  |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update #1521 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
