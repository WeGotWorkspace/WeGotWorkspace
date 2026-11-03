# Engineering tasks — Docs inbound reconciliation

**Not** a copy of the GitHub issue checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `docs-inbound` | builder | workspace | `packages/apps/src/lib/offline/core/inbound-sync.ts`, `packages/apps/src/lib/offline/docs/docs-inbound-sync.ts`, `packages/apps/src/lib/offline/docs-listing-offline-store.ts`, `packages/apps/src/lib/offline/drive/drive-inbound-sync.ts`, `packages/apps/src/lib/offline/drive/drive-local-document.ts`, `packages/apps/src/docs-core/src/use-docs-home-listing-load.ts`, `packages/apps/e2e/docs-inbound-sync.spec.ts` | `pnpm --filter @wgw/apps exec vitest run src/lib/offline src/docs-core` + `pnpm --dir packages/apps exec playwright test -c playwright.live.config.mjs docs-inbound-sync` |

## Notes

- Chunk ids match `plan.md`.
- On scope change: update issue #1563 first, then re-sync these files and the `Source:` body-hash.
