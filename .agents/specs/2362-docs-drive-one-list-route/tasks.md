# Engineering tasks — Docs and Drive lists: one route, no full text per row

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `docs-browse-lean` (D1) | builder | api, security | `packages/api/app/Services/Search/SearchDocumentStore.php`, `UnifiedSearchService.php`, `packages/api/openapi/openapi.json`, `tests/Feature/Search/` | `php scripts/done-gate.php` |
| `docs-snippet-column` (D2, gated by M on MariaDB) | builder | api | `packages/api/app/Services/Search/SearchIndexerService.php`, `packages/api/database/migrations/wgw/` | `php scripts/done-gate.php` |
| `list-first-pass-shared` (C) | builder | workspace, testing | `packages/apps/src/lib/files/docs-home-listing.ts`, `src/lib/api/wgw/search.ts`, `src/lib/offline/docs/`, `src/lib/offline/drive/`, `src/lib/offline/core/background-sync-pacer.ts` | `pnpm --dir packages/apps exec vitest run src/docs-core src/lib/files src/lib/offline` |
| `body-queue-joint` (F) | builder | workspace | see 2338 chunk F | see 2338 |
| `docs-list-measure` (M) | builder | testing, document | `packages/apps/e2e/traffic-budget.spec.ts`, `docs/realtime-capacity.md`, a PHPUnit bench kept out of the repository | `WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs` |

## Notes

- D1 and C can run in parallel once the cursor contract in spec.md is agreed; F after C; D2 only if M shows it is needed.
- Nothing here starts before the product lead answers question 1 of spec.md.
- On scope change: update #2362 first, then re-sync these files and the body-hash in `spec.md`.
