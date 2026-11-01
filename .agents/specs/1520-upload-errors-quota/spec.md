Source: #1520 (body-hash: 796ed745)
Goal: WeGotWorkspace/Product#140

# Drive upload client: space pre-check, error classes, server-full pause, outbox migration

Third client slice of Epic #1499, on top of the queue from #1501, the chunked client from #1519, and the server from #1500 (`Quota/get` per writable root, 507, `overQuota`). The issue is the source of truth for every acceptance criterion; this file records how the client meets it and settles what the issue leaves open.

## Goal

When files are added, the client knows whether they fit in the server space of the folder's drive (or that it cannot tell). Every failed file has one clear reason, and only hiccups are retried on their own. A full server pauses the whole queue instead of failing file after file, and the queue goes on by itself once there is room. A file whose folder was renamed still lands in it; a file whose folder is gone waits to be sent somewhere else. Old offline uploads stored as base64 move into the queue, and nothing writes base64 any more.

## Non-goals

- UI for these states: the space step of the batch dialog (#1521), and the paused, target-missing, auth, and forbidden states with their actions (#1522). Only text and state mappings in the existing placeholder and Uploads view change.
- Per-tenant quotas or a soft limit (follow-up idea on #1499).

## Affected packages

- packages/apps

## Decisions

- **Pre-check timing.** `enqueueUploads` stores the batch, runs the pre-check, and stores the result on the batch row (`spaceCheck`) before it returns, so it is in the queue snapshot and the batch dialog (#1521) can read it. A failing check stores `unknown`.
- **Pre-check sum.** `neededBytes` = the batch's sizes + the bytes still to send (`size − bytesDone`) of every other item in the same root that will still upload on its own (not failed, or failed `server_full`). `freeBytes` = `hardLimit − used` of that root's quota. `fits` when `neededBytes ≤ freeBytes`.
- **Picking the quota.** The root is the first two segments of the placeholder's folder path (`users/{name}` or `groups/{slug}`; placeholders follow renames and moves). Its FileNode id comes from the cached row, the remembered root ids, or the server; the quota is `dq-{rootNodeId}`. No root, no id, or no such quota → `unknown`. Foreign drives reached through a share have no quota → `unknown`.
- **Fresh or last known.** Online, `Quota/get` (with `urn:ietf:params:jmap:quota` in `using`, only when the Session advertises it) and the answer is stored in the account's offline `meta` table. Offline, or when the call fails, the stored answer is used with `fresh: false` and its `measuredAt`. Nothing known → `unknown`.
- **Error classes.** `too_large` only from `DriveUploadTooLargeError` (the part floor of #1519; a bare 413 on a JMAP call is `permanent`). `quota` for a device `QuotaExceededError`. `server_full` for 507 and `overQuota`. `auth` for a 401 and for `WgwSignInRequiredError` (no session left; the same message as before, now a class). `forbidden` for a 403, SetError `forbidden`, or a target folder without `mayAddChildren`. `target_missing` for a folder that is gone, in a trash, or a create refused with `invalidProperties` on `parentId`. `no_local_copy` and `insecure_context` as before; the classifier checks `insecure_context` first. `transient` for 408, 429, 5xx, `serverFail`/`serverUnavailable`, and a failed token renewal, retried with backoff; after 5 in a row the item fails with code `transient`. `permanent` for everything else (`upload_failed` is renamed; the branch is unreleased, so no stored rows need mapping).
- **Backoff.** The wait doubles per hiccup in a row: 30 s, 1 min, 2 min, 4 min, then 8 min. A network drop waits 30 s and is not counted.
- **Retry.** Manual _Retry_ is offered for every failed item except `no_local_copy`, `insecure_context`, and `quota` without a local copy. `forbidden` and `target_missing` are never retried on their own; _Retry_ after access or the folder is restored works.
- **Server full.** The item fails as `server_full` with its parts kept (#1519). While any such item exists, the queue is `paused_server_full`: `listStartableDriveUploads` returns nothing, so no other file starts. The item's `retryAt` says when any tab may ask `Quota/get` (60 s after the 507, then every 60 s). When the item's root has `hardLimit − used ≥ size − bytesDone` in a fresh answer, every `server_full` item goes back to the queue. _Retry_ on the item, _Retry all failed_, and the new `resumeUploadQueue` operation lift the pause too.
- **Target folder.** Before any byte is sent, `FileNode/get` on the target folder id: gone or not a directory → `target_missing`; `mayAddChildren: false` → `forbidden`; then a walk up the parents: a `.Trash` (or legacy `Trash`) folder right under a root → `target_missing`. The walk stops at a parent the account cannot see (a shared folder). A folder checked in the last 30 s with the same parent skips the walk.
- **Re-targeting.** `retargetDriveUploadItem` (operation `retargetQueuedUpload(itemId, cwd)`) moves a queued or failed item to another folder: new target id, placeholder moved, back to `queued`, `Blob` and stored parts kept. Refused while uploading or once the server created the node.
- **Outbox migration.** Legacy `op: "upload"` rows are read by `readLegacyDriveOutboxUpload` only. `migrateDriveOutboxUploads` decodes each once and moves the rows of one folder into one released batch (`keepOffline: remove`, no conflict choice, so a collision keeps both with a notice) in one IndexedDB transaction with the row removal. Rows whose folder id is unknown while offline stay in the outbox, keep protecting their path from pruning, and move on a later run. It runs on the first uploader cycle per tab and at the start of every outbox flush; the flush never sends or drops a legacy row.
- **No base64.** The `upload` outbox payload type, `encodeUploadFileForOutbox`, and `base64ToBlob` are gone. An offline `uploadFiles` goes to the upload queue (released at once, no dialog).
- **Text mappings.** New failed reasons in `uploadFailedReason`, and the row state `waitingServerFull` ("Waiting for space on the server") for queued files while the queue is paused on a full server.

## Edge cases

- A server whose `disk_free_space` sees more room than a hosting quota allows can answer 507 while `Quota/get` reports room: the queue then resumes and pauses again at most once a minute.
- Two tabs may both ask `Quota/get` when the check is due; both resuming is harmless.
- A folder trashed within 30 s after a file to it was checked, by trashing one of its ancestors, is not noticed for that file.
- A legacy row larger than the device can store as a `Blob` stays in the outbox (the transaction fails) and is tried again on the next run.
