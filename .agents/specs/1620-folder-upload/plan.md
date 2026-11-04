# Drive: upload a folder with its subfolders

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1620.

## Goal

Queue a picked or dropped folder tree as one batch, create its folders parent-first on the server, then upload the files into them.

## Budget

Epic #1499 follow-up; WeGotWorkspace/Product#129. Builds on #1501, #1521, #1522.

## Non-goals

See [spec.md](./spec.md).

## What exists

- The queue reserves temporary targets and the uploader skips them. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-schema.ts:17`
- Name conflict answers and keep-both naming for files. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-transfer.ts`
- The batch stepper dialog. `path: packages/apps/src/drive-core/src/drive-upload-batch-dialog.tsx`

## Considered

Considered: waiting for #1515 to create a tree in one call — rejected for now; one call per folder with a recorded create is safe across reloads and needs no server change. Considered: a separate table for folders — rejected; a `kind` field on the item keeps one queue, one uploader and no schema version. Considered: always asking on a top-level clash — rejected; when _Merge_ is impossible the only answer is keep both, so the step would ask nothing.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (queue) before Chunk B (UI).

## Open decisions

None — every choice is made in [spec.md](./spec.md). The conflict decision waits for the product lead's look on the PR.

## Invariants

- A file never starts while its folder is not on the server. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-folder-runner.test.ts`
- A reload between folder create and resolve does not create the folder twice. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-folder-runner.test.ts`

## Chunks

### Chunk A: Queue a folder tree

- **id:** `chunk-a-queue`
- **Skill:** workspace
- **Inputs:** queue store — `path: packages/apps/src/lib/offline/drive/upload/drive-upload-store.ts`
- **Done when:** a tree enqueues with temporary targets, folders are created parent-first and survive reloads, failures cascade, the snapshot lists folders.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline/drive/upload`

### Chunk B: Pick, drop, dialog step, folder rows

- **id:** `chunk-b-ui`
- **Skill:** apps-ui
- **Inputs:** upload action — `path: packages/apps/src/drive-core/src/use-drive-upload-action.tsx`
- **Done when:** _Upload folder_ and folder drop queue a tree, the dialog asks Keep both / Merge, folder rows and grid folder tiles show progress and failed counts, and a folder placeholder's menu opens the folder (no _Download_); stories in light and dark pass the a11y gate.
- **Note:** the grid folder tile moves out of `drive-browser.tsx` (`drive-folder-tile.tsx`, `drive-browser-item-parts.tsx`), so that file drops under the 800-line limit instead of growing.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/drive-core`
