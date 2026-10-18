# Engineering tasks — Detect an external write on a Docs document

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-server` | builder | api | `packages/api/app/Services/Collab/`, `packages/api/app/Dav/Server/WebdavWriteGuardPlugin.php`, `packages/api/app/Http/Controllers/Api/V1/Files/FilesController.php`, `packages/api/database/migrations/wgw/`, `packages/api/openapi/openapi.json` | `pnpm test:api-done-gate` |
| `chunk-b-client` | builder | workspace | `packages/apps/src/text-editor-core/docs-collab/`, `packages/apps/src/docs-core/src/docs-labels.ts` | `pnpm test:apps-done-gate` |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
