# Engineering tasks — Drive upload queue

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                       | owner / agent | skill     | key paths                                                                                                                                                                                                                                                                               | verify command                                                                                                        |
| ------------------------ | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `chunk-a-cross-tab-lock` | builder       | testing   | `packages/apps/src/lib/cross-tab/cross-tab-lock.ts`, `packages/apps/src/lib/api/wgw/auth-refresh-lock.ts`                                                                                                                                                                               | `pnpm --dir packages/apps exec vitest run --project unit src/lib/cross-tab src/lib/api/wgw/auth-refresh-lock.test.ts` |
| `chunk-b-upload-store`   | builder       | testing   | `packages/apps/src/lib/offline/drive/upload/drive-upload-schema.ts`, `drive-upload-store.ts`, `drive-upload-placeholders.ts`, `drive-upload-device-storage.ts`, `packages/apps/src/lib/offline/drive/drive-fetched-set-prune.ts`, `drive-directory-offline-store.ts`, `drive-schema.ts` | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive`                                       |
| `chunk-c-subscription`   | builder       | testing   | `packages/apps/src/lib/offline/drive/upload/drive-upload-subscription.ts`                                                                                                                                                                                                               | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`                                |
| `chunk-d-uploader`       | builder       | testing   | `packages/apps/src/lib/offline/drive/upload/drive-upload-runner.ts`, `drive-upload-transfer.ts`, `drive-upload-handoff.ts`, `drive-upload-memory.ts`                                                                                                                                    | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`                                |
| `chunk-e-drive-wiring`   | builder       | workspace | `packages/apps/src/lib/offline/drive/drive-hybrid-operations.ts`, `packages/apps/src/drive-core/src/use-drive-mutations.tsx`, `use-drive-api.ts`, `drive-types.ts`, `drive-file-utils.ts`                                                                                               | `pnpm test:apps-done-gate`                                                                                            |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update #1501 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
