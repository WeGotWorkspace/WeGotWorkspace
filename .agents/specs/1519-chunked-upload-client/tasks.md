# Engineering tasks — Drive upload client: parts, resume, conflict policy, version check

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                        | owner / agent | skill            | key paths                                                                                                                                                                                                  | verify command                                                                                                                            |
| ------------------------- | ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `chunk-a-transport`       | builder       | client-transport | `packages/apps/src/lib/api/wgw/drive-blob-jmap.ts`, `drive-upload-capabilities.ts`, `drive-upload-errors.ts`, `drive-jmap.ts`, `packages/apps/src/lib/jmap-client/filenodes/JmapFileNodesClient.ts`        | `pnpm --dir packages/apps exec vitest run --project unit src/lib/jmap-client src/lib/offline/drive/upload/drive-upload-conflicts.test.ts` |
| `chunk-b-chunked-engine`  | builder       | testing          | `packages/apps/src/lib/offline/drive/upload/drive-upload-chunked.ts`, `drive-upload-part-size.ts`                                                                                                          | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-chunked.test.ts`                       |
| `chunk-c-conflict-policy` | builder       | testing          | `packages/apps/src/lib/offline/drive/upload/drive-upload-transfer.ts`, `drive-upload-runner.ts`, `drive-upload-store.ts`, `drive-upload-failure.ts`, `drive-upload-conflicts.ts`, `drive-upload-schema.ts` | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`                                                    |
| `chunk-d-download-ticket` | builder       | client-transport | `packages/apps/src/lib/api/wgw/drive-download-ticket.ts`, `drive.ts`, `drive-jmap.ts`                                                                                                                      | `pnpm --dir packages/apps exec vitest run --project unit src/lib/api/wgw/drive.test.ts`                                                   |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update the issue first, then re-sync spec, plan, tasks, and the `Source:` body-hash.
