# Engineering tasks — One local file tree for Drive and Docs home

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `S1` | builder (api) | api | `packages/api/app/Services/Jmap/Methods/FileNodeQueryMethod.php`, `packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php`, `FileNodeAccountSupport.php` | `php vendor/bin/phpunit --filter JmapFileNodeTreePagingTest` |
| `S2` | builder (api) | api, security | `packages/api/app/Services/Jmap/FileNodes/FileNodeSyncState.php`, `FileNodeIndexService.php` (changesSince), `FileNodeAccountSupport.php`, `app/Services/Jmap/Push/JmapPushStateResolver.php` | `php vendor/bin/phpunit --filter JmapFileNodeTeamStateTest` |
| `S3` | builder (api) | api | `packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php`, `app/Services/Drive/DriveShareService.php`, `FileNodeIndexService.php` | `php vendor/bin/phpunit --filter JmapFileNodeShareFlagsTest` |
| `C1` | builder (apps) | workspace, client-transport | `packages/apps/src/lib/offline/drive/drive-tree-sync.ts` (new), `drive-schema.ts`, `drive-inbound-sync.ts`, `drive-fetched-set-prune.ts`, `drive-core/src/use-drive-api.ts`, `lib/api/wgw/drive-jmap.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/drive` |
| `C2` | builder (apps) | workspace | `packages/apps/src/lib/files/tree-view/` (new) | `pnpm --dir packages/apps exec vitest run src/lib/files/tree-view` |
| `C3` | builder (apps) | workspace, apps-ui | `packages/apps/src/drive-core/src/use-drive-shell.tsx`, `drive-main-pane.tsx`, `drive-visible-items.ts`; delete `use-drive-all-files.ts`, `use-drive-folder-listing-sync.ts`, `use-drive-{starred,shared,trash}-list.ts` | `pnpm --dir packages/apps exec vitest run src/drive-core` |
| `C4` | builder (apps) | workspace | `packages/apps/src/docs-core/src/docs-home-*`, `use-docs-home-*`, `lib/offline/docs/docs-listing-*`, `docs-hybrid-operations.ts` (removed), `docs-domain-contract.ts`, `docs-offline-entries.ts`, `docs-body-sync.ts`, `lib/offline/drive/drive-hybrid-operations.ts`, `drive-inbound-sync.ts` | `pnpm --dir packages/apps exec vitest run src/docs-core src/lib/offline/docs` |
| `C5` | builder (apps) | apps-ui | `packages/apps/src/drive-core/src/use-drive-grid-previews.ts`, `drive-offline-pin-cell.tsx`, team label store | `pnpm --dir packages/apps exec vitest run src/drive-core` |
| `C6` | builder (apps) | testing, document | `packages/apps/e2e/`, `packages/apps/docs/offline-platform.md` | `pnpm --dir packages/apps exec playwright test -c playwright.config.mjs` |
| `V` | verifier | — | read-only | verifier verdict |

## Notes

- Chunk ids match `plan.md`.
- S1–S3 and C1 can run in parallel worktrees; C2 → C3 → C4/C5 → C6 run in order.
- On scope change: update #2063 first, then re-sync these files and the `Source:` body-hash.
