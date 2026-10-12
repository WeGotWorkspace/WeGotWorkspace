# Engineering tasks — Collab ticket on the reuse envelope

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `collab-ticket-envelope` | builder | workspace | `packages/apps/src/lib/rtc/session/collab-reuse-envelope.ts`, `packages/apps/src/text-editor-core/docs-collab/docs-collab-principal-reuse.ts`, `packages/api/openapi/schemas/rtc/rtc-signaling.json`, `packages/apps/src/lib/rtc/types.ts` | `pnpm --filter @wgw/apps typecheck` |

## Notes

- Chunk `id` matches the worktree `feat/collab-ticket-envelope`.
- On scope change: update issue #1112 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
