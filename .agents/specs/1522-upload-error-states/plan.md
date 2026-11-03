# Drive uploads: pause and error states, sign-out and leave warnings

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1522.

## Goal

Show every upload pause and failure with its own way out, warn before sign-out or closing the last uploading tab, and retire the floating progress bar.

## Budget

Epic #1499, third UI slice. Builds on #1501, #1519, #1520, #1521; #1620 builds on it.

## Non-goals

See [spec.md](./spec.md).

## What exists

- The queue reports `paused_server_full` and rows say "Waiting for space on the server". `path: packages/apps/src/drive-core/src/drive-upload-row-state.ts:115`
- `resumeUploadQueue` and `retargetQueuedUpload` exist on the Drive operations. `path: packages/apps/src/drive-core/src/drive-types.ts:216`
- `insecure_context` and `no_local_copy` are not retryable. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-store.ts:245`
- The logout screen asks before wiping unsynced work. `path: packages/apps/src/wegotworkspace/src/wegotworkspace-logout.tsx:60`
- The uploader takes a cross-tab lock per account. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-lock-name.ts:9`

## Considered

Considered: a tab registry over BroadcastChannel for "last tab" — rejected; the uploader lock already lists every tab that would carry on, and `navigator.locks.query()` reads it without new messages. Considered: a separate sign-out dialog before the unsynced one — rejected; two dialogs in a row for one sign-out, so the warnings share one. Considered: always sending _Retry_ on `auth` through `/login` — rejected; with a session in place the login route bounces straight back after a full reload for nothing.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (states) and Chunk B (warnings) are independent.
2. Chunk C (bar removal) is independent.

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- A queued batch without questions still uploads without the floating bar. Proof: `path: packages/apps/src/drive-core/src/use-drive-mutations-upload-queue.test.tsx` assertion `queues the picked files locally and releases the batch instead of uploading directly`.
- Sign-out with nothing waiting does not ask. Proof: `path: packages/apps/src/wegotworkspace/src/wegotworkspace-logout.test.tsx` assertion `signs out immediately when nothing is unsynced`.

## Chunks

### Chunk A: Pause and error states

- **id:** `chunk-a-states`
- **Skill:** workspace
- **Inputs:** row state — `path: packages/apps/src/drive-core/src/drive-upload-row-state.ts:115`
- **Done when:** the Uploads view, the placeholder menu, and the sidebar badge show the server-full pause and the per-reason actions; stories in light and dark pass the a11y gate.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/drive-core`
- **Parallel with:** Chunk B, Chunk C

### Chunk B: Sign-out and leave warnings

- **id:** `chunk-b-warnings`
- **Skill:** workspace
- **Inputs:** logout screen — `path: packages/apps/src/wegotworkspace/src/wegotworkspace-logout.tsx:60`
- **Done when:** `/logout` warns about queued files with _Wait_ and _Sign out anyway_; the last uploading tab gets the leave prompt.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/wegotworkspace src/drive-core/src/use-drive-upload-recovery.test.tsx`
- **Parallel with:** Chunk A, Chunk C

### Chunk C: Retire the floating bar

- **id:** `chunk-c-bar`
- **Skill:** apps-ui
- **Inputs:** main pane — `path: packages/apps/src/drive-core/src/drive-main-pane.tsx:300`
- **Done when:** `upload-progress/` is gone with its styles; direct uploads toast instead.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** Chunk A, Chunk B

## Test plan

- [ ] jsdom tests for the Uploads view states, the sign-in retry, the leave warning, and the sign-out warning
- [ ] Vitest unit for the last-tab check and the queued-upload count
- [ ] Storybook `vitest-ci` stories with the a11y gate, light and dark
- [ ] Browser end to end against the 8 MB host, including the download round trip with sha256

## Doc updates (only if user wants)

- None
