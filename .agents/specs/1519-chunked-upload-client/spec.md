Source: #1519 (body-hash: 20518c1f)
Goal: #1498

# Drive upload client: parts, resume, conflict policy, version check, download tickets

Second client slice of Epic #1499, on top of the queue from #1501 and the server from #1500. The issue is the source of truth for every acceptance criterion; this file records how the client meets it and settles what the issue leaves open.

## Goal

A signed-in Drive upload of any size works on a small host: the file goes to `/jmap/upload` in parts the host accepts, one after another, each with its length and sha256 declared; the server joins them (blob assembly extension in budgeted steps, or one plain `Blob/upload`); a reload resumes from the next part or step. A name conflict is resolved at upload time by the batch's stored choice, and _Replace_ never overwrites a file that changed since the user chose. Downloads stream to disk through a ticket.

## Non-goals

- The batch stepper dialog that asks the conflict question (#1521). This slice stores and applies the answer and exposes what the dialog may offer.
- The space pre-check and the queue-wide `server_full` pause (#1520). Until then a 507 stops only the item.
- New visible UI. Notices, the `insecure_context` reason, and the assembling progress are in the queue model; only text and percent hook-ups in the existing placeholder state from #1502 change.

## Affected packages

- packages/apps

## Decisions

- **One path for every file.** A file that fits in the working part size is one `/jmap/upload`; otherwise it goes in parts. The whole-file `maxSizeUpload` check of #1501 is gone: a file above it is split when the Session can join parts, and fails as `too_large` only when it cannot (no `urn:ietf:params:jmap:blob` and no assembly extension).
- **Declared part checks.** Every upload sends `Wgw-Part-Length`; it sends `Wgw-Part-Sha256` whenever Web Crypto is there (always for parts). Parts of an assembly also send `Wgw-Assembly-Id`, so cleanup leaves them alone until they are appended.
- **Part size.** Starts at `min(maxSizeUpload, stepBudgetBytes, remembered)`; `stepBudgetBytes` only with the assembly extension. On `/jmap/upload`, a 413, a `limit` problem, or a `part-mismatch` problem halves the size of the refused part (not below 256 KiB) and sends it again; a refused part already at the floor fails the file as `too_large`. The smaller size is remembered per account in `localStorage` (`wgw-drive-part-size:<account>`).
- **Join.** With the assembly extension: create the assembly before the first part, upload every part, then append in steps (parts until the step budget, capped by `stepParts`), then finish (repeated while a hash rebuild is pending). A `requestTooLarge` or `limit` on an append halves `stepParts`, down to one part per call, then the file fails as permanent. Without it: one `Blob/upload` with every part; more parts than `maxDataSources` fails before any part is sent, and a `requestTooLarge` or `limit` on the call fails the file. It is never split.
- **Accepted parts.** After each append, the accepted count is the larger of the stored count and the server's `nextIndex`, extended over the contiguous indexes it lists in `accepted`. A `rebuiltOnly` answer accepts nothing new, so the same remaining parts go again.
- **Resume.** The item stores `chunk` (`partSize`, parts with offset, length, and `blobId`, `join`, `assemblyId`, `appendedParts`, `stepParts`, final `blobId`) after every part and step. Requeue and _Retry_ keep it; a permanent failure drops it. Entering the assembly phase always asks `BlobAssembly/get`: a finished assembly gives its blob, an open one gives `nextIndex`, a missing one (expired) is created again and filled from index 0. An `invalidArguments` on an append asks the server once before it counts as a failure.
- **Missing parts.** `blobNotFound` (`notFound` on `Blob/upload`, the method error on an append) re-sends only those parts, from their stored ranges, at most three rounds.
- **Full server.** A 507 (part or request), `overQuota` (Blob/upload, assembly create, FileNode/set) fails the item as `server_full` with its chunk progress kept; no backoff. _Retry_ resumes from the stored parts.
- **Secure context.** Without `crypto.subtle`, a file above `maxSizeUpload` fails as `insecure_context` before any request; _Retry_ is not offered for it. Smaller files upload without the sha256 header.
- **Assembling phase.** While the server joins, the item has `phase: "assembling"` with `assembledBytes`; the placeholder state shows "Finishing on the server · N%".
- **Error codes.** `upload_failed` stays the permanent class (#1520 may rename it to `permanent`). New: `server_full`, `insecure_context`.
- **Conflict answers.** `releaseDriveUploadBatch(…, { keepOffline, conflict?, replaceTargets? })`. The batch stores `conflict`; each _Replace_ item stores `replaceTarget { nodeId, blobId }`, taken from the cached listing the question was based on. Listings now carry `blobId` and `contentHashPending` per file, and FileNode calls list the version-check capability in `using` whenever the Session advertises it (that is what makes the server return `contentHashPending`).
- **What the dialog may offer.** `describeUploadConflicts(batchId)` returns the batch's conflicts against the cached listing and the choices: `replace` only when the Session (live, else the last known one, stored per account in `localStorage`) advertises the version check, and every colliding file has a `blobId` and is not hash-pending. With no known Session, no `replace`.
- **At upload time.** A `skip` whose name is taken sends no bytes. After the bytes: a free name is a plain create under the own name, whatever the choice; a taken name follows the choice. `keep_both` and "no stored choice" create under the next free `name (n).ext` (next one again on `alreadyExists`); the latter stores a `kept_both` notice. `replace` checks the capability (gone → permanent), then that the name still belongs to the stored node (another node → keep both with `replace_fell_back`), then updates `blobId` with `expectedBlobId`; `versionMismatch` → keep both with `replace_fell_back`. Any other SetError is classified as usual. A `replace` item without a stored target (it had no conflict when the user chose) keeps both with `kept_both`.
- **attachInProgress.** A create or update answered with `attachInProgress` is sent again unchanged until it succeeds.
- **Notices.** Stored on the batch together with `createdNodeId` in one transaction, so a retry after the read-back neither loses nor repeats them. A finished batch with notices stays until `dismissDriveUploadBatchNotices`.
- **Downloads.** The signed-in `downloadFile` asks `POST /jmap/download-tickets/{accountId}` and clicks a hidden link to the ticket URL; the bytes never enter a `Blob`. `readFileBlob` refuses files above 100 MiB (`DriveFileTooLargeToOpenError`) before fetching. Guest reads, offline content sync, and grid previews are unchanged.

## Edge cases

- A file of 0 bytes is one upload with `Wgw-Part-Length: 0`.
- A part the server lost that can no longer be sent at its stored length (the host refuses it now) fails the file as permanent instead of re-planning the parts.
- Two identical parts share one `blobId`; the server keeps the part until the last index of the call.
- The live Session is cached per page, so a capability the server drops while the page is open is noticed after the next reload; the server refuses `expectedBlobId` without the capability either way (`invalidProperties`), so nothing is overwritten.
