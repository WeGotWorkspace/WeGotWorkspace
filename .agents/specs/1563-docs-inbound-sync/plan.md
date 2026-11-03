# Docs inbound reconciliation on the shared inbound engine

Derived from [spec.md](./spec.md). One pull request, `Part of #1563`.

## Goal

Apply the FileNode changes Drive already pulls to every cached Docs view, keep rows a queued local write owns, clean up the offline copies of a Doc deleted elsewhere, and repaint every open Docs home from the cache. Built on the engine's pending-write reader and scope reconcile from #1565.

## Budget

Draws from the Pioneer programme's offline sync work (#1563 is step 4 of the order in #1565). Displaces a Docs-only inbound copy: Docs gets no changes call or token of its own.

## Non-goals

- The other #1563 gaps and the Docs sync matrix
- Moving Drive onto the engine
- A poll; Shared with me and Trash lists (not cached on the device)

## What exists

- Docs keeps one snapshot per filter view, replaced whole on each write. `path: packages/apps/src/lib/offline/docs-listing-offline-store.ts:66`
- The live listing of the visible view replaces its snapshot; nothing else refreshes other views. `path: packages/apps/src/docs-core/src/use-docs-home-listing-load.ts:136`
- The Docs home and the Docs editor run the Drive FileNode inbound. `path: packages/apps/src/docs-core/src/docs-home-workspace.tsx:251` `path: packages/apps/src/docs-core/src/docs-app.tsx:63`
- Drive inbound knows the old path of a moved node and drops or keeps a destroyed one. `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:200` `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:220`
- A destroyed Doc loses its pin and collab database unless it has unsaved text. `path: packages/apps/src/lib/offline/drive/drive-local-document.ts:20`
- The tree-crawl prune removes the Drive content blob and availability row; the FileNode path does not. `path: packages/apps/src/lib/offline/drive/drive-fetched-set-prune.ts:233`
- The engine reads one item per outbox row. `path: packages/apps/src/lib/offline/core/inbound-sync.ts:31`
- Docs outbox rows: rename, trash, create, star. `path: packages/apps/src/lib/offline/docs/docs-outbox-flush.ts:18`
- Search indexes no path with a dot segment. `path: packages/api/app/Storage/StorageKeyClass.php:55`
- The server moves and deletes stars with the file. `path: packages/api/app/Services/Drive/DriveStarService.php:97`
- Cross-tab cache notices exist per domain. `path: packages/apps/src/lib/offline/core/cache-changed-topic.ts:18`
- PR [#1850](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1850) (open) runs the same Drive inbound on push and reloads the Docs home lists afterwards.

## Considered

Considered:

- **A Docs `FileNode/changes` pass with its own token.** Rejected: a second call per sync, and a second token that can drift from Drive's; Drive already resolves old and new paths.
- **`runScopedInbound` with one scope per cached view.** Rejected: there is no per-view token, and overlapping views break the engine's once-per-id upsert.
- **Re-listing every cached view live on each sync.** Rejected: one search request per view per sync (search views included), and it does nothing offline.
- **Holding the Drive token while a Docs write is queued.** Rejected: replays every Drive change on every sync, and the replay has no path to act on.
- **Chosen:** Drive reports per-node outcomes; a Docs binding applies them to all cached views with the engine's pending-write reader, and the live listing merges through the engine's scope reconcile.

## Affected packages

- packages/apps

## Dependencies

1. Engine extension before the Docs binding (same pull request).
2. Independent of #1850; both touch `docs-home-workspace.tsx`, `use-docs-home-listing-load.ts` and `drive-inbound-sync.ts` in different places.

## Open decisions

None. Every point is decided in spec.md under Decisions.

## Invariants

- A queued Notes or Tasks write still reads the same through the engine. A wrong change breaks their inbound. Proof: `path: packages/apps/src/lib/offline/core/inbound-sync.test.ts` assertion `collects bases in order, fields, deletes and the token hold per item`.
- A Doc deleted, renamed or moved elsewhere leaves or moves in every cached view. A wrong change leaves stale rows. Proof: `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.test.ts` assertion `applies a FileNode delete, rename and move to every cached Docs view`.
- A queued create or rename target is not removed or moved by inbound or by a full listing, and a queued trash is not brought back. A wrong change drops queued work. Proof: `path: packages/apps/src/lib/offline/docs/docs-inbound-sync.test.ts` assertion `keeps a row a queued write owns` and `keeps queued rows the live listing lacks and drops rows a queued trash hides`.
- A destroyed node leaves no Drive availability row or content blob behind. Proof: `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.test.ts` assertion `removes the Drive availability row and content blob of a destroyed node`.
- The Drive inbound keeps its own behaviour (token, kept documents, moves). Proof: `cmd: pnpm --filter @wgw/apps exec vitest run src/lib/offline/drive`.
- An open Docs home follows without a reload, in two views. Proof: `cmd: pnpm --dir packages/apps exec playwright test -c playwright.live.config.mjs docs-inbound-sync`.

## Chunks

### Chunk A: Docs inbound reconciliation

- **id:** `docs-inbound`
- **Skill:** workspace
- **Inputs:** the What exists rows above — `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:200` `path: packages/apps/src/lib/offline/core/inbound-sync.ts:31`
- **Done when:** the engine reads a multi-item row; `lib/offline/docs/docs-inbound-sync.ts` applies Drive's per-node outcomes to every cached view and the starred paths, notifies every tab, and merges the live listing with pending writes; Drive inbound reports its outcomes and removes the Drive availability row and content blob of a dropped node; the Docs home re-reads its view on the notice; the live spec passes.
- **Verify with:** `pnpm --filter @wgw/apps exec vitest run src/lib/offline src/docs-core` and the live `docs-inbound-sync` spec
- **Parallel with:** none

## Test plan

- [ ] Engine: multi-item row case; existing Notes and Tasks engine cases unchanged
- [ ] Docs binding: every edge case in spec.md
- [ ] Drive inbound: delete / rename / move reach every cached view; offline copies removed
- [ ] Docs home hook: re-read on the notice
- [ ] Live: `docs-inbound-sync.spec.ts` on a local install
