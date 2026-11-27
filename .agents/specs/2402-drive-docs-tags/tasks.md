# Engineering tasks — Tags on Drive files and Docs

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `tags-a-server` | builder | api | `packages/api/database/migrations/wgw/`, `packages/api/app/Services/Jmap/FileNodes/`, `packages/api/app/Services/Drive/DrivePathBookkeeping.php` | `php scripts/done-gate.php` |
| `tags-b-shared-lib` | builder | apps-ui | `packages/apps/src/lib/tags/`, `packages/apps/src/lib/models/note-tag.ts`, `packages/apps/src/tag/` | `pnpm --dir packages/apps exec vitest run src/notes-core src/lib/tags` |
| `tags-c-tag-a-file` | builder | apps-ui | `packages/apps/src/drive-core/`, `packages/apps/src/docs-core/`, `packages/apps/src/lib/offline/drive/` | apps done gate + browser e2e |
| `tags-d-filter` | builder | apps-ui | `packages/apps/src/drive-core/`, `packages/apps/src/docs-core/` | apps done gate + browser e2e |
| `tags-e-bulk` | builder | apps-ui | `packages/apps/src/drive-core/use-drive-batch-actions.tsx` | apps done gate + browser e2e |
| `tags-f-rename` | builder | apps-ui, api | after D | per the design chosen then |

## Notes

- Chunk ids match `plan.md`. C to E are visible UI and wait for the product lead; A and B are non-UI.
