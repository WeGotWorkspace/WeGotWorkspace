# Drive upload batch dialog: shared step dots, stepper dialog, notices

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1521.

## Goal

Ask the batch's questions (server space, name conflicts, keep offline) in one stepper dialog between storing and releasing a batch, and show the batch notices until the user has seen them.

## Budget

Epic #1499, second UI slice. Builds on #1501, #1519, #1520; #1522 and #1620 build on it.

## Non-goals

See [spec.md](./spec.md).

## What exists

- The installer's step dots are module-private and hardcode English labels. `path: packages/apps/src/installer-core/src/installer-layout.tsx:31`
- A batch is stored as `awaiting_input` and released with the answers. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-store.ts:170`
- The conflict check and its choices exist for the dialog. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-conflicts.ts:64`
- The hand-off rule decides which files become automatic offline copies. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-handoff.ts:39`
- Notices are stored per batch and dismissed with `dismissDriveUploadBatchNotices`. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-store.ts:361`
- Placeholders of an `awaiting_input` batch say "Waiting for your answer". `path: packages/apps/src/drive-core/src/drive-upload-row-state.ts:110`

## Considered

Considered: notices as toasts — rejected; a toast times out or is missed, and the issue wants the notice until the user has seen it. Considered: re-asking a left-over batch from a placeholder menu item — rejected; the user would have to find it, and the batch blocks nothing else, so a dialog on the next load is clearer. Considered: a new BroadcastChannel for "who asks about this batch" — rejected; the upload-memory probe already answers "is this id held by an open tab", so it now covers batch ids too.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (primitives) before Chunk C (dialog).
2. Chunk B (questions) before Chunk C.

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- The installer still shows "Setup progress" with the same dot texts. Proof: `path: packages/apps/src/installer-core/src/installer-account-page.test.tsx` assertion `keeps Database in the progress dots after that step`.
- A batch without questions is released at once with `remove`. Proof: `path: packages/apps/src/drive-core/src/use-drive-mutations-upload-queue.test.tsx` assertion `queues the picked files locally and releases the batch instead of uploading directly`.
- "Uploaded" is only toasted once the files are on the server. Proof: `path: packages/apps/src/drive-core/src/use-drive-mutations-upload-queue.test.tsx` assertion `says the files were added, and says Uploaded only once they are on the server`.

## Chunks

### Chunk A: Shared primitives

- **id:** `chunk-a-primitives`
- **Skill:** apps-ui
- **Inputs:** installer dots — `path: packages/apps/src/installer-core/src/installer-layout.tsx:31`
- **Done when:** `StepDots` and `StepperDialog` exist with stories; the installer uses `StepDots` with its labels in `installerCopy`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project jsdom src/step-dots src/installer-core`
- **Parallel with:** Chunk B

### Chunk B: Batch questions

- **id:** `chunk-b-questions`
- **Skill:** testing
- **Inputs:** hand-off rule — `path: packages/apps/src/lib/offline/drive/upload/drive-upload-handoff.ts:39`
- **Done when:** `enqueueUploads` returns the space, conflict, and keep-offline questions; left-over batches can be claimed; notices can be dismissed.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`
- **Parallel with:** Chunk A

### Chunk C: Drive dialog and notices

- **id:** `chunk-c-drive-dialog`
- **Skill:** workspace
- **Inputs:** Chunks A and B
- **Done when:** the upload action asks before release; Cancel drops the batch; notices show until OK; stories for every step combination and both notices in light and dark pass the a11y gate.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Vitest unit for the keep-offline rule and claiming left-over batches
- [ ] jsdom tests for `StepDots`, the batch dialog (order, Back / Next, focus, Escape, single step), and the upload action flow
- [ ] Storybook `vitest-ci` stories with the a11y gate
- [ ] Browser end to end against the 8 MB host

## Doc updates (only if user wants)

- None
