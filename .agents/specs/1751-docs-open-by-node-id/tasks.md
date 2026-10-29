# Engineering tasks — Open Docs by stable file id instead of path

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `api-file-node-locate` | builder | api | `packages/api/app/Http/Controllers/Api/V1/Files/FileNodeLocateController.php`, `packages/api/app/Services/Drive/DriveFileNodeLocator.php`, `packages/api/routes/api.php`, `packages/api/openapi/openapi.json`, `packages/api/app/Services/Notify/DocsThreadActivityNotify.php` | `pnpm test:api-done-gate` |
| `apps-docs-route-id` | builder | workspace | `packages/apps/src/docs-core/src/docs-route-search.ts`, `packages/apps/src/docs-core/src/use-docs-route-document.ts`, `packages/apps/src/docs-core/src/docs-app.tsx`, `packages/apps/src/lib/api/wgw/drive-node-locate.ts` | `pnpm --dir packages/apps exec vitest run src/docs-core` |
| `apps-docs-follow-rename` | builder | workspace | `packages/apps/src/docs-core/src/use-docs-route-document.ts`, `packages/apps/src/docs-core/src/docs-app.tsx` | `pnpm --dir packages/apps exec vitest run src/docs-core` |
| `docs-save-follows-id` | builder | api, workspace | `packages/api/app/Services/Collab/DocCollabDocumentService.php`, `packages/apps/src/lib/offline/docs/docs-node-paths.ts`, `packages/apps/src/docs-core/src/docs-collab-urls.ts`, `packages/apps/src/text-editor-core/docs-collab/docs-collab-persistence.ts` | `cd packages/api && vendor/bin/phpunit --filter=DocsCollabSaveByNodeIdTest`; `pnpm --dir packages/apps exec vitest run src/docs-core src/lib/offline/docs` |

## Notes

- Chunk `id` values match `plan.md` chunk IDs.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
