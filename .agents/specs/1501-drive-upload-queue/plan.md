# Drive upload queue: local queue, placeholders, single whole-file uploader

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1501.

## Goal

Queue picked files locally as `Blob`s with placeholder rows, upload them one at a time from one tab per account through `wgwFetch`, hand the `Blob` to the offline content store on success, and land the shared cross-tab lock that token refresh also uses.

## Budget

Epic #1499, first client slice. Draws from the Drive offline layer; displaces nothing else. #1502, #1519, #1520, and #1521 build on it.

## Non-goals

See [spec.md](./spec.md).

## What exists

- Signed-in uploads post each whole file to `/jmap/upload` through `wgwFetch` and update an existing node with the same name. `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:376`, `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:577`
- Offline uploads are base64 outbox rows. `path: packages/apps/src/lib/offline/drive/drive-hybrid-operations.ts:275`
- The Drive upload action calls `operations.uploadFiles` and toasts at the end. `path: packages/apps/src/drive-core/src/use-drive-mutations.tsx:264`
- The cross-tab refresh lock has one module-wide name, a 30 s stale timeout without heartbeat, and its fallback returns `false` instead of waiting. `path: packages/apps/src/lib/api/wgw/auth-refresh-lock.ts:3`, `path: packages/apps/src/lib/api/wgw/auth-refresh-lock.ts:4`, `path: packages/apps/src/lib/api/wgw/auth-refresh-lock.ts:152`
- Token refresh enters that lock from `wgwFetch`'s refresh path. `path: packages/apps/src/lib/api/wgw/http.ts:665`
- Prune only protects paths covered by open outbox rows. `path: packages/apps/src/lib/offline/drive/drive-fetched-set-prune.ts:170`
- `cannotCalculateChanges` falls back to `syncDriveMetadataTree`, which prunes through the same snapshot function. `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:114`, `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:163`
- Inbound moves go through `applyDriveSidecarPathMigration` and stop early when blocked. `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:201`, `path: packages/apps/src/lib/offline/drive/drive-inbound-sync.ts:251`
- `migrateDriveEntryPath` rebuilds rows field by field (it would drop a new column). `path: packages/apps/src/lib/offline/drive/drive-directory-offline-store.ts:142`
- `writeDriveContentBlob` writes the blob without a try/catch, then availability in separate writes. `path: packages/apps/src/lib/offline/drive/drive-content-sync.ts:58`
- `needsContentResync` compares the blob's `syncedAt` with the entry's `modifiedAt`. `path: packages/apps/src/lib/offline/drive/drive-content-sync.ts:109`
- Server-side `reconcileDirectory()` only touches server index rows. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:417`
- Sign-out deletes every account database. `path: packages/apps/src/lib/offline/core/offline-wipe.ts:69`
- The drive Dexie block is 30–39; 30–33 are used. `path: packages/apps/src/lib/offline/core/offline-version-allocation.ts:20`

## Considered

Considered: reusing the base64 outbox for uploads — rejected; the Epic forbids base64 and the outbox has no placeholders or progress. Considered: extending `auth-refresh-lock.ts` in place — rejected; the uploader needs a name per caller, a heartbeat, waiting, and a generic result, so the primitive moves to `lib/cross-tab/` and refresh becomes a caller. Considered: placeholder ids at the real file path — rejected; a real file of the same name (or a second queued file) would overwrite the placeholder. Considered: an IndexedDB compare-and-set lock as the fallback — rejected; the issue specifies BroadcastChannel / localStorage with heartbeat.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (lock) before Chunk D (uploader).
2. Chunk B (schema, store, placeholders) before C, D, E.
3. Chunk E (Drive wiring) last.

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- Token refresh still runs under a cross-tab lock and coalesces in one tab. A wrong change lets two tabs refresh at once and rotate each other's refresh cookie away. Proof: `path: packages/apps/src/lib/api/wgw/auth-refresh-lock.test.ts` assertion `runs the refresh task under the Web Locks mutex when the browser provides one`.
- A refresh inside an upload that holds the uploader lock completes. A shared name would deadlock. Proof: `path: packages/apps/src/lib/api/wgw/auth-refresh-lock.test.ts` assertion `lets a token refresh run while the uploader lock is held`.
- Prune still removes rows the server no longer lists and still protects outbox rows. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/drive-fetched-set-prune.test.ts`.
- Folder renames still migrate rows, pins, and blobs. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/drive-inbound-sync.test.ts`.
- Guest and mock Drive uploads still use `operations.uploadFiles`. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project jsdom src/drive-core/src/use-drive-shell.test.tsx`.
- After each chunk, `main` behaviour is intact without the next chunk. Proof: `cmd: pnpm test:apps-done-gate`.

## Chunks

### Chunk A: Cross-tab lock primitive

- **id:** `chunk-a-cross-tab-lock`
- **Skill:** testing
- **Inputs:** current refresh lock — `path: packages/apps/src/lib/api/wgw/auth-refresh-lock.ts:140`
- **Done when:** `withCrossTabLock<T>(name, task, options)` exists with Web Locks and the localStorage/BroadcastChannel fallback (heartbeat, wait-and-retake, stale takeover, loss signal, `pagehide` release); `withAuthRefreshLock` is a caller with its own name; tests cover both paths, separate names, and refresh-during-upload.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/cross-tab src/lib/api/wgw/auth-refresh-lock.test.ts`
- **Parallel with:** none

### Chunk B: Upload store and placeholders

- **id:** `chunk-b-upload-store`
- **Skill:** testing
- **Inputs:** drive schema registration — `path: packages/apps/src/lib/offline/drive/drive-schema.ts:1`; prune protection — `path: packages/apps/src/lib/offline/drive/drive-fetched-set-prune.ts:170`
- **Done when:** version 34 tables; enqueue (batch `awaiting_input`, items with size and folder id, `Blob`s, placeholders) before any dialog; release, cancel, remove; placeholders protected from prune and kept through refresh and full resync; `migrateDriveEntryPath` keeps `uploadId`; placeholders excluded from content sync and search; `navigator.storage` checks with fallbacks and `persist()`; quota-safe `Blob` writes.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive`
- **Parallel with:** none

### Chunk C: Subscription

- **id:** `chunk-c-subscription`
- **Skill:** testing
- **Inputs:** Chunk B store
- **Done when:** `subscribeDriveUploadQueue` delivers items (status, bytes done/total, error), queue state, batch status, and notices in every tab (BroadcastChannel, localStorage ping fallback); `hasPendingDriveUploads` exists.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`
- **Parallel with:** none

### Chunk D: Uploader and hand-off

- **id:** `chunk-d-uploader`
- **Skill:** testing
- **Inputs:** `uploadJmapBlob` through `wgwFetch` — `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:369`; content store — `path: packages/apps/src/lib/offline/drive/drive-content-sync.ts:51`
- **Done when:** one runner per account and tab under `wgw-drive-uploader:<account>`; strictly one file at a time; `too_large` above `maxSizeUpload`; keep-both naming; placeholder replaced by the real row; hand-off in one transaction with the server's `modified` and the final `source` (auto, manual, or dropped) with settings read at finish; direct uploads from memory and `no_local_copy`; stale `uploading` items resumed; resume on app start.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`
- **Parallel with:** none

### Chunk E: Drive wiring

- **id:** `chunk-e-drive-wiring`
- **Skill:** workspace
- **Inputs:** upload action — `path: packages/apps/src/drive-core/src/use-drive-mutations.tsx:264`
- **Done when:** signed-in hybrid operations expose `enqueueUploads`, `releaseUploadBatch`, `cancelUploadBatch`, `subscribeUploadQueue`; online and offline listings include placeholders; the upload action queues, releases, and never toasts "Uploaded" before the server has the file; the listing refreshes from the cache when the queue changes; the Drive app starts the uploader on load.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Vitest unit for the lock, store, placeholders, subscription, uploader, hand-off, storage checks (one file per module under `lib/cross-tab/` and `lib/offline/drive/upload/`)
- [ ] Existing prune, inbound, and hybrid tests extended for placeholders
- [ ] jsdom test for the upload action using the queue when `enqueueUploads` exists
- [ ] `pnpm test:apps-done-gate`

## Doc updates (only if user wants)

- None
