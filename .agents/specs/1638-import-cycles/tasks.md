# Tasks — import cycles (#1638)

Derived from [plan.md](./plan.md). One pull request per chunk, stacked.

| Chunk | Task | Key paths | Verify |
|-------|------|-----------|--------|
| `chunk-a-files-model` | `git mv` the Drive model, types and path helpers; rewrite importers | `packages/apps/src/lib/files/` | `pnpm --filter @wgw/apps run lint:boundaries` |
| `chunk-b-file-helpers` | Split pure helpers and their tests out of `drive-file-utils.ts` and `drive-batch-utils.ts`; move `docs-collab-text-files.ts` | `packages/apps/src/lib/files/`, `packages/apps/src/drive-core/src/` | `pnpm --filter @wgw/apps run test:jsdom` |
| `chunk-c-sharing-model` | Move the pure sharing model out of `share-ui` | `packages/apps/src/lib/sharing/`, `packages/apps/src/share-ui/` | `pnpm --filter @wgw/apps run typecheck` |
| `chunk-d-domain-types` | Move the five `*-types.ts` modules | `packages/apps/src/lib/models/` | `pnpm --filter @wgw/apps run lint:boundaries` |
| `chunk-e-meeting-links` | Move `calendar-meet-link.ts` and its Meet helpers | `packages/apps/src/lib/meetings/` | `pnpm --filter @wgw/apps run lint:boundaries` |
