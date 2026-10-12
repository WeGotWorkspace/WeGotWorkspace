# Engineering tasks — Docs live sync over HTTP

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `docs-http-fallback` | builder | workspace | `packages/api/app/Services/Collab/CollabYjsMailbox.php`, `packages/apps/src/text-editor-core/docs-collab/docs-collab-http-sync.ts` | `pnpm --filter @wgw/apps exec vitest run src/text-editor-core/docs-collab/docs-collab-http-fuzz.test.ts` |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
