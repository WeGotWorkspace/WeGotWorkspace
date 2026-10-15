# Engineering tasks — Raw Yjs bytes on the data channel

**Not** a copy of the GitHub issue acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `data-channel-raw-bytes` | builder | workspace | `packages/apps/src/lib/rtc/session/data-channel-frames.ts`, `packages/apps/src/text-editor-core/docs-collab/docs-collab-channel.ts` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab/collab-transport-conformance.test.ts` |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
