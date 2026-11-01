# Drive upload client: parts, resume, conflict policy, version check, download tickets

Derived from [spec.md](./spec.md). Sequential chunks, one builder. Source Task #1519.

## Goal

Send large files in checked parts the host accepts, joined by the server and resumable after a reload; apply the batch's conflict answer at upload time with a safe _Replace_; download through tickets.

## Budget

Epic #1499, second client slice. Builds on #1501 (queue) and #1500 (server); #1520 and #1521 build on it.

## Non-goals

See [spec.md](./spec.md).

## What exists

- The uploader sends one whole-file `/jmap/upload` and fails anything over `maxSizeUpload` as `too_large`. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-transfer.ts:56`
- The server checks `Wgw-Part-Length` / `Wgw-Part-Sha256` and answers `part-mismatch`, `limit`, or 507 problems. `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapBlobController.php:43`
- An append over the step budget is the method error `requestTooLarge`; an append may accept only a prefix, or only advance a hash rebuild (`rebuiltOnly`). `path: packages/api/app/Services/Jmap/Assembly/BlobAssemblyService.php:100`
- `Blob/upload` reports missing sources as SetError `blobNotFound` with `notFound`. `path: packages/api/app/Services/Jmap/Blobs/BlobJoinService.php:110`
- `expectedBlobId` is allowed only with the version-check capability in `using`; a mismatch or a hash-pending node is SetError `versionMismatch`. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeVersionCheck.php:93`
- `contentHashPending` is only returned with that capability in `using`. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php:92`
- Download tickets: `POST /jmap/download-tickets/{accountId}` → `201 {url, idleExpires, absoluteExpires}`. `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapDownloadTicketController.php:29`
- The signed-in download builds a `Blob` and clicks an object URL. `path: packages/apps/src/lib/api/wgw/drive.ts:436`
- The placeholder state already reads an optional `phase: "assembling"`. `path: packages/apps/src/drive-core/src/drive-upload-row-state.ts:87`

## Considered

Considered: appending each step right after its parts are uploaded — rejected; uploading every part first gives the item a distinct assembling phase with its own progress, and the server deletes each part as it is appended, so the disk peak stays near 1× either way. Considered: a pre-planned list of part ranges — rejected; the part size can shrink mid-file, so parts are planned one at a time from the end of the last one. Considered: storing the remembered part size and the last known Session in IndexedDB — rejected; both are small per-account hints, `localStorage` is enough, and losing them only costs a refusal or a missing _Replace_ offer. Considered: a new `permanent` error code — rejected for this slice; `upload_failed` already is the permanent class, #1520 owns the error class names. Considered: offering _Replace_ per file in a mixed batch — rejected; the dialog asks one question for all conflicts, so one hash-pending file removes _Replace_ for the batch.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (transport and capabilities) before B and C.
2. Chunk B (chunked engine) before C.
3. Chunk D (downloads) is independent.

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- A file that fits in one part is still one `/jmap/upload` with no JMAP blob calls. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-chunked.test.ts` assertion `sends a file that fits as one upload with its length and sha256 declared`.
- Strictly one upload at a time, one file at a time. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-chunked.test.ts` assertion `sends a large file as parts in order, one at a time, each with length and sha256`.
- _Replace_ never overwrites a changed file and `versionMismatch` never ends as a failure. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-conflict-policy.test.ts` assertion `falls back to keep both with a replace_fell_back notice when the file changed (versionMismatch)`.
- The #1501 queue behaviour (placeholders, hand-off, lock, retries) is intact. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`.
- Guest reads and previews still fetch bytes; only the signed-in download uses a ticket. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project unit src/lib/api/wgw/drive.test.ts`.

## Chunks

### Chunk A: Transport and capabilities

- **id:** `chunk-a-transport`
- **Skill:** client-transport
- **Inputs:** Session capabilities — `path: packages/apps/src/lib/api/wgw/drive-jmap.ts:131`
- **Done when:** the Session exposes blob, assembly, and version-check capabilities (and remembers the version check per account); `/jmap/upload` parts declare length and sha256 and map 413 / `limit` / `part-mismatch` / 507 to typed errors; `Blob/upload` and `BlobAssembly/*` calls with their `using`; FileNode calls list the version check when advertised; listings carry `blobId` and `contentHashPending`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/jmap-client src/lib/offline/drive/upload/drive-upload-conflicts.test.ts`
- **Parallel with:** Chunk D

### Chunk B: Chunked engine

- **id:** `chunk-b-chunked-engine`
- **Skill:** testing
- **Inputs:** Chunk A
- **Done when:** `sendDriveUploadBytes` covers single upload, parts, adaptive part size with floor and memory, assembly steps with smaller steps on `limit`, the plain `Blob/upload` fallback without splitting, accepted and rebuild-only answers, missing parts, resume from stored state, `insecure_context`, 507, and the assembling progress.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload/drive-upload-chunked.test.ts`
- **Parallel with:** Chunk D

### Chunk C: Uploader, conflict policy, version check

- **id:** `chunk-c-conflict-policy`
- **Skill:** testing
- **Inputs:** Chunk B; the runner — `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner.ts:156`
- **Done when:** batches store the conflict answer and items the replace target; the transfer applies the policy at upload time with `expectedBlobId` and the `versionMismatch` fallback; notices are stored with the created node and outlive the item; chunk progress is saved, kept on requeue and _Retry_, dropped on a permanent failure; `server_full` and `insecure_context` are item reasons; `describeUploadConflicts` tells the dialog what it may offer.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`
- **Parallel with:** none

### Chunk D: Downloads

- **id:** `chunk-d-download-ticket`
- **Skill:** client-transport
- **Inputs:** signed-in download — `path: packages/apps/src/lib/api/wgw/drive.ts:436`
- **Done when:** the signed-in download action uses a ticket and a native link; `readFileBlob` refuses above its size limit before fetching.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/api/wgw/drive.test.ts`
- **Parallel with:** Chunk A, Chunk B

## Test plan

- [ ] Vitest unit for the engine, the conflict policy, the uploader with parts, conflicts and capabilities, the download ticket, and `using`
- [ ] Existing upload, hybrid, and drive tests stay green
- [ ] `pnpm test:apps-done-gate`
- [ ] Browser end to end against a local API with an 8 MB `post_max_size`

## Doc updates (only if user wants)

- None
