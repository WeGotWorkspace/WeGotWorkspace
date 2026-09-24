# Engineering tasks — Docs threads VJOURNAL

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `api-threads` | builder | api | `packages/api/app/Services/Docs/**`, `packages/api/openapi/**`, `packages/api/routes/api.php`, `packages/api/tests/Feature/Docs/**` | `pnpm test:api-done-gate` | done |
| `client-cutover` | builder | workspace | `packages/apps/src/text-editor-core/docs-collab/**` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab` | done |
| `task2-archive` | builder | workspace | `use-docs-suggestions.ts`, PATCH archive, orphan prune | targeted PHPUnit + Vitest | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and the worktree `docs-threads-vjournal`.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **#749 / #750 first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
