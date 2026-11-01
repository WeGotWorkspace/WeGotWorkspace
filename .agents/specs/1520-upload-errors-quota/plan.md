# Drive upload client: space pre-check, error classes, server-full pause, outbox migration

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1520.

## Goal

Pre-check server space per target root when files are added, classify every failure into one of the issue's classes, pause the whole queue on a full server until _Retry_ or room, keep a renamed target and handle a missing one, and move old base64 outbox uploads into the queue.

## Budget

Epic #1499, third client slice. Builds on #1501, #1519, and #1500; #1521 and #1522 build on it.

## Non-goals

See [spec.md](./spec.md).

## What exists

- Old offline uploads are base64 in the Drive outbox. `path: packages/apps/src/lib/offline/drive/drive-outbox-flush.ts:22`
- The hybrid `uploadFiles` writes those rows while offline. `path: packages/apps/src/lib/offline/drive/drive-hybrid-operations.ts:293`
- The classifier knows `too_large`, `server_full` (with parts kept), `insecure_context`, and `upload_failed`. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-failure.ts:63`
- The server returns one quota per writable root, id `dq-{rootNodeId}`. `path: packages/api/app/Services/Jmap/Quota/DriveQuotaService.php:43`
- A create into a missing folder is `invalidProperties` on `parentId`; into a folder without rights it is `forbidden`. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeSetService.php:256`
- Placeholders of queued items are already protected from pruning. `path: packages/apps/src/lib/offline/drive/drive-fetched-set-prune.ts:375`
- Trash is a `.Trash` folder under the drive root. `path: packages/apps/src/drive-core/src/drive-path-utils.ts:34`
- A 401 after a failed refresh reaches the caller as a 401 response, not a sign-out. `path: packages/apps/src/lib/api/wgw/http.ts:762`

## Considered

Considered: a separate pause record (meta row) for `paused_server_full` — rejected; deriving the pause from a failed `server_full` item needs no extra state, survives a reload, works in every tab through the existing queue events, and _Retry_ or _Remove_ on that item lifts it without a second write. Considered: putting the 507 item back to `queued` while paused — rejected; keeping it `failed` reuses the existing _Retry_ and _Retry all failed_ actions as the resume path. Considered: detecting a trashed folder only from the create's answer — rejected; the server creates into a trashed folder (trash is a move), and a large file would be sent first. Considered: running the outbox migration in a Dexie `upgrade()` — rejected; resolving a folder id may need the server, which an upgrade transaction cannot wait for. Considered: dropping legacy rows that cannot move yet — rejected; nothing is dropped automatically. Considered: comparing root ids instead of root paths for "same root" — rejected; paths are known offline for every placeholder, ids are not.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (error classes and target check) before B.
2. Chunk B (pause and space) uses the classes of A.
3. Chunk C (outbox migration) is independent of B.

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- No upload path base64-encodes file bytes. Proof: `cmd: grep -rn "btoa\|encodeUploadFileForOutbox" packages/apps/src/lib/offline/drive` returns nothing.
- A full server never triggers backoff and no other file starts while paused. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner-errors.test.ts` assertion `pauses the whole queue without backoff: no other file starts`.
- Prune protection survives the outbox migration. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-outbox-migration.test.ts` assertion `keeps the prune protection: the queue's placeholders survive a refresh of the folder`.
- The #1501 and #1519 queue behaviour is intact. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`.

## Chunks

### Chunk A: Error classes and target check

- **id:** `chunk-a-error-classes`
- **Skill:** client-transport
- **Inputs:** the classifier — `path: packages/apps/src/lib/offline/drive/upload/drive-upload-failure.ts:63`
- **Done when:** every class of the issue is produced by the classifier; the target folder is checked by id before bytes are sent; transient retries back off; re-targeting moves an item with its `Blob`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-failure.test.ts src/lib/offline/drive/upload/drive-upload-runner-errors.test.ts`
- **Parallel with:** Chunk C

### Chunk B: Space pre-check and server-full pause

- **id:** `chunk-b-space-pause`
- **Skill:** testing
- **Inputs:** Chunk A; `Quota/get` — `path: packages/api/app/Services/Jmap/Quota/DriveQuotaService.php:43`
- **Done when:** a batch stores its pre-check; the queue snapshot reports `paused_server_full` and the batch's `spaceCheck`; the uploader resumes on _Retry_ or on room from `Quota/get`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-space-check.test.ts src/lib/offline/drive/upload/drive-upload-runner-errors.test.ts`
- **Parallel with:** none

### Chunk C: Outbox migration

- **id:** `chunk-c-outbox-migration`
- **Skill:** testing
- **Inputs:** the outbox flush — `path: packages/apps/src/lib/offline/drive/drive-outbox-flush.ts:22`
- **Done when:** legacy rows move into the queue with prune protection intact; the `upload` payload type and every base64 encoder are gone; offline `uploadFiles` queues `Blob`s.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-outbox-migration.test.ts`
- **Parallel with:** Chunk A

## Test plan

- [ ] Vitest unit for the pre-check, each error class, the pause and both resumes, forbidden without sign-in, target_missing with re-targeting, failed items persisting, and the outbox migration
- [ ] Existing upload, hybrid, and drive tests stay green
- [ ] `pnpm test:apps-done-gate`
- [ ] Browser end to end against a local API, including a profile with old outbox upload rows

## Doc updates (only if user wants)

- None
