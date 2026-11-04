# Engineering tasks — Download several selected items as one zip

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `api-selection-ticket` | builder | api | `packages/api/app/Services/Drive/FolderZip/`, `packages/api/app/Http/Controllers/Api/V1/Jmap/JmapFolderDownloadTicketController.php`, `packages/api/database/migrations/wgw/`, `packages/api/openapi/openapi.json` | `php artisan test --filter='SelectionDownloadTicket\|FolderDownloadTicket'` |
| `apps-selection-download` | builder | apps-ui | `packages/apps/src/lib/api/wgw/drive-download-ticket.ts`, `packages/apps/src/drive-core/src/use-drive-selection-bar.tsx`, `packages/apps/src/lib/offline/drive/drive-hybrid-operations.ts`, `packages/apps/e2e/drive-selection-download.spec.ts` | `pnpm --dir packages/apps exec vitest run src/drive-core/src` |
