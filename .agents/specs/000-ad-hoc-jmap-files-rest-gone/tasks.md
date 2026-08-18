# Engineering tasks — files dual-REST deletion

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `jmap-files-rest-gone` | builder | api | `packages/api/routes/api.php`, `packages/api/openapi/openapi.json`, `packages/api/app/Http/Controllers/Api/V1/Files/FilesController.php`, `packages/api/tests/Feature/Jmap/*`, `packages/api/tests/Feature/Drive/*` | `pnpm test:api-done-gate` | done |

## Notes

- Chunk `id` matches worktree / branch slug `jmap-files-rest-gone`.
- Source: ad-hoc — no GitHub Task yet.
