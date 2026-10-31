# Drive upload progress: ring in the pin slot, placeholder states, Uploads view

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1502.

## Goal

Show each queued file's state in the folder and in an Uploads view, in every tab, with _Retry_ / _Remove_, and stop saying "Uploaded" before the server has the file.

## Budget

Epic #1499, first UI slice. Builds on #1501. Leaves the batch stepper to #1521 and error/pause states to #1522.

## Non-goals

See [spec.md](./spec.md).

## What exists

- Placeholder rows and their marker `{ id, status, reason }`. `path: packages/apps/src/drive-core/src/drive-models.ts:28`
- The queue snapshot and subscription. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-subscription.ts:61`
- The offline pin slot in list and grid. `path: packages/apps/src/drive-core/src/drive-browser.tsx:30`
- The shared sidebar order. `path: packages/apps/src/drive-core/src/files-browser-sidebar.ts:1`
- The upload action and its toasts. `path: packages/apps/src/drive-core/src/use-drive-mutations.tsx:1`

## Considered

Considered: extending `UploadProgress` (the floating bar) for rows — rejected; it has no progress role and the issue asks for the Radix primitive. Considered: one `subscribeDriveUploadQueue` per consumer — rejected; three readers per tab would triple IndexedDB reads and flicker when the operations object is recreated. Considered: hiding server-only actions on placeholders — rejected; the issue asks for them disabled with an explanation. Considered: a percentage from the whole-file upload — rejected; it would jump from 0 to 100%.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (store and watch) before Chunk B (row state and ring).
2. Chunk B before Chunk C (sidebar and Uploads view) and Chunk D (toasts and stories).

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- The mock and guest Drive keep the direct upload path and the floating bar. Proof: `path: packages/apps/src/drive-core/src/use-drive-mutations-upload-queue.test.tsx` assertion `keeps the direct upload path when the operations have no queue (mock)`.
- Docs shows no Uploads entry. Proof: `path: packages/apps/src/docs-core/src/use-docs-home-sidebar-model.test.tsx`.
- Retry never revives a file whose bytes are gone. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-retry.test.ts` assertion `refuses files whose bytes are gone, and files that did not fail`.

## Chunks

### Chunk A: Retry and shared watch

- **id:** `chunk-a-store`
- **Skill:** testing
- **Done when:** `retryDriveUploadItem`, `retryAllFailedDriveUploads`, `canRetry`, `folderPath`, and `sharedDriveUploadQueueWatch` exist with tests; hybrid operations expose them.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`

### Chunk B: Row state and ring

- **id:** `chunk-b-ring`
- **Skill:** workspace
- **Done when:** `ProgressRing`, `driveUploadRowState`, `DriveUploadRing` in the pin slot of list and grid, placeholder menu with disabled server actions, status line from labels.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project jsdom src/drive-core/src/drive-browser.test.tsx`

### Chunk C: Sidebar and Uploads view

- **id:** `chunk-c-uploads-view`
- **Skill:** workspace
- **Done when:** sidebar entry with badge; `view=uploads` route, icon, breadcrumb; `DriveUploadsPane` with rows, _Retry all failed_, and the all-done state.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project jsdom src/drive-core/src/drive-uploads-pane.test.tsx`

### Chunk D: Toasts, announcements, stories

- **id:** `chunk-d-copy-stories`
- **Skill:** workspace
- **Done when:** "Added N files to uploads" and completion toasts; live region; stories for every state in list, grid, the pin slot, and the Uploads view, light and dark, tagged `vitest-ci`.
- **Verify with:** `pnpm --dir packages/apps test:storybook:ci`

## Test plan

- [ ] Vitest unit for retry, the shared watch, row state, upload files, batch toasts, announcements, the placeholder menu
- [ ] jsdom for the browser placeholders, the Uploads view, the upload action toasts, and both sidebars
- [ ] Storybook `vitest-ci` stories with the axe gate
- [ ] `pnpm test:apps-done-gate`

## Doc updates (only if user wants)

- None
