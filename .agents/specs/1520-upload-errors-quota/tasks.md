# Engineering tasks — Drive upload client: space pre-check, error classes, server-full pause, outbox migration

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                         | owner / agent | skill            | key paths                                                                                                                                                                                                                                    | verify command                                                                                                                                                                          |
| -------------------------- | ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunk-a-error-classes`    | builder       | client-transport | `packages/apps/src/lib/offline/drive/upload/drive-upload-failure.ts`, `drive-upload-target-check.ts`, `drive-upload-runner.ts`, `drive-upload-store.ts`, `packages/apps/src/lib/api/wgw/drive-upload-errors.ts`, `sign-in-required-error.ts` | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-failure.test.ts src/lib/offline/drive/upload/drive-upload-runner-errors.test.ts`     |
| `chunk-b-space-pause`      | builder       | testing          | `packages/apps/src/lib/offline/drive/upload/drive-upload-space-check.ts`, `drive-upload-runner.ts`, `drive-upload-subscription.ts`, `drive-upload-operations.ts`, `packages/apps/src/lib/api/wgw/drive-quota-jmap.ts`                        | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-space-check.test.ts src/lib/offline/drive/upload/drive-upload-runner-errors.test.ts` |
| `chunk-c-outbox-migration` | builder       | testing          | `packages/apps/src/lib/offline/drive/upload/drive-upload-outbox-migration.ts`, `packages/apps/src/lib/offline/drive/drive-outbox-flush.ts`, `drive-hybrid-operations.ts`                                                                     | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-outbox-migration.test.ts`                                                            |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update the issue first, then re-sync spec, plan, tasks, and the `Source:` body-hash.
