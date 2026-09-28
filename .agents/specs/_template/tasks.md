# Engineering tasks — [Feature title]

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-slug` | builder | api | `packages/api/...` | `pnpm test:api-done-gate` |
| `chunk-b-slug` | builder | apps-ui | `packages/apps/src/...` | `pnpm --dir packages/apps exec vitest run …` |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
