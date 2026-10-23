Source: #1501 (body-hash: 91b20c0b)
Goal: #1498

# Drive upload queue: local queue, placeholders, single whole-file uploader

First client slice of Epic #1499. Merges standalone against today's server: one `/jmap/upload` request per file, no parts, no conflict choices, no version check.

## Goal

Signed-in Drive uploads stop going straight to the server. Picking or dropping files stores each file as a `Blob` in a dedicated IndexedDB upload store, shows a placeholder row in the folder at once, and a single background uploader per account drains the queue one file at a time, in whichever tab holds a cross-tab lock. On success the placeholder becomes the real FileNode row and the stored `Blob` becomes the offline copy when the device rule (or the batch's keep-offline answer) says so, without a second download. The cross-tab lock is a new shared primitive that the token refresh also moves onto.

## Non-goals

- Parts, resume within a file, conflict choices, version check (#1519)
- Space pre-check against the server, error classes beyond `too_large`, `quota`, `no_local_copy`, `upload_failed`; `server_full` pause; outbox migration; `target_missing` and re-targeting (#1520)
- Progress ring, Uploads view, disabling actions on placeholders, upload copy beyond the minimum (#1502)
- The batch stepper dialog (#1521); this slice releases each batch right after queueing because no step applies yet
- Sign-out and leave warnings themselves (#1522); this slice only exposes `hasItems`
- Guest uploads, Docs uploads, and the outbox upload path (unchanged)

## Affected packages

- packages/apps

## Decisions

- **Cache vs queue keys.** `drive_entries` stays keyed by path. The queue is keyed by target folder FileNode id. A placeholder row lives under the folder's current cache path, so every existing path migration (online rename, offline rename, inbound `moveCachedNodeToPath`) moves it with its folder. The uploader finds a placeholder by its `uploadId` index, never by a computed path.
- **Placeholder ids never collide with real names.** A placeholder row id is `<folder>/\u0000upload:<itemId>`. A NUL byte cannot appear in a server file name, so a real file of the same name (or two queued files with one name) never overwrites a placeholder. The row's `name` is the picked file name; the row carries `uploadId` and `upload: { id, batchId, status }` in its listing payload.
- **Target folder reference.** `targetFolder: { kind: "server" | "temporary"; id }`. This Epic only writes `server`. The uploader skips `temporary` targets (folder upload #1040 resolves them). The id comes from the cached row's `nodeId`, then a remembered root id (home and group roots, written by the metadata crawl), then live resolution when online.
- **Server-side cleanup cannot touch placeholders.** `FileNodeIndexService::reconcileDirectory()` deletes index rows whose files are gone on the server. Placeholders exist only in the client's `drive_entries` cache, so it never sees them. Only the client prune can drop them, and it now protects them.
- **Batch release in this slice.** The upload action queues the batch as `awaiting_input` (placeholders visible, uploader skips it) and releases it immediately with `keepOffline: "remove"`, because no dialog step exists yet. #1521 inserts the dialog between queue and release.
- **Keep both.** A name collision at upload time picks the next free `name (n).ext` (client side, from the folder's children) and creates a new node. `alreadyExists` on create picks the next name. The upload never updates an existing node.
- **Hand-off.** After the create, the client reads the new node with `FileNode/get` and writes the real row, the content blob, and the availability row in one Dexie transaction, with `entryModifiedAt` = the node's `modified` (seconds) and `syncedAt` no earlier than that instant, so `needsContentResync` stays false. Device settings are read at that moment. Docs-editable files (`.md`, `.txt`) keep their existing Docs offline path: their `Blob` is not handed off, because Docs keeps offline text in the collab database, not in `drive_content_blobs`.
- **Error codes in this slice.** `too_large` (over `maxSizeUpload`, or HTTP 413), `quota` (IndexedDB quota error while storing the `Blob`), `no_local_copy` (a direct upload whose bytes are gone), `upload_failed` (any other permanent failure, or five transient failures in a row). Network errors and session renewal errors put the item back to `queued` and the uploader waits for a reconnect or retries after a backoff.
- **Direct uploads.** When `estimate()` says the file does not fit, the item is stored without a `Blob`, marked `localCopy: false`, and its `File` stays in the memory of the tab that queued it. Only that tab can upload it; another tab holding the lock asks it over a BroadcastChannel and skips the item while that tab answers. When nobody answers (the tab was closed or reloaded), the item fails as `no_local_copy`.
- **Queue state** is derived per tab: `paused_offline` when items wait and the browser is offline, `running` when items wait and it is online, `idle` otherwise. `paused_server_full` exists in the type for #1520.

## Cross-tab lock primitive

`withCrossTabLock<T>(name, task, options): Promise<T>` in `lib/cross-tab/cross-tab-lock.ts`.

- Web Locks when `navigator.locks` exists (secure contexts). Waiting is native; a closed tab releases on its own.
- Otherwise a localStorage record `{ owner, heartbeatAt }` per name with a heartbeat while the task runs, a BroadcastChannel `released` notice plus polling for waiters, wait-and-retake when the record is gone or stale, and release on `pagehide`. On `http://` installs this is the normal path in every tab.
- Same-tab callers of one name queue in memory first, so they never poll each other.
- The task receives a `signal` that aborts when the fallback lock is lost (another tab took over a stale record).
- Without localStorage, only the in-tab queue applies; the task still never runs outside a lock.
- Names: token refresh uses `wgw-auth-refresh`; the uploader uses `wgw-drive-uploader:<account>`. They must differ: the uploader calls `wgwFetch` while holding its lock, and `wgwFetch` may take the refresh lock.

## Technical constraints

- Uploads go through `wgwFetch` (`uploadJmapBlob`), never `XMLHttpRequest`. Progress is per file.
- No base64 for queued files; `Blob`s are stored as-is.
- `navigator.storage`, `estimate()`, and `persist()` are each optional. Missing `estimate()` means "enough room". `persist()` is called once per tab, the first time a file is queued, and only when it is a function.
- New Dexie version 34 inside the drive block (30–39): `drive_entries` gains an `uploadId` index; new tables `drive_upload_batches`, `drive_upload_items`, `drive_upload_blobs`. Sign-out already deletes the whole account database, so it wipes the queue.

## Edge cases

- A folder refresh or a full resync that does not list a placeholder keeps it while its queue item exists; an orphan placeholder (no item) is pruned like any missing row.
- A blocked `moveCachedNodeToPath` (unsaved document at the target) leaves the folder row and its placeholders together at the old path; the uploader still finds the placeholder by id and the next sync moves both.
- An upload that finished while its placeholder was gone (for example the folder was trashed locally) writes no row and no offline copy; the next listing shows the file.
- A quota error during hand-off still completes the upload; the batch gets an `offline_copy_failed` notice and the `Blob` is dropped.
- A stale `uploading` item (its tab closed mid-upload) is picked up again by the next lock holder.
