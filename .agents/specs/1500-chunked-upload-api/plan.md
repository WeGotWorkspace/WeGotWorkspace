# API: chunked uploads, blob assembly, true content hash, Quota, version check

Derived from [spec.md](./spec.md). Chunk layout for #1500.

## Goal

Make every Drive byte path on the API streamed and bounded: parts in, assembly in steps, attach by move, download by stream with `Range` and a ticket, with `content_sha256` always the true sha256, plus JMAP Quota and a per-file version check. The client slices (#1519, #1520) build on these contracts.

## Budget

Draws from Epic #1499's API slice. Displaces nothing else in `packages/api`; the client slices wait for this merge.

## Non-goals

- Everything listed under Non-goals in [spec.md](./spec.md) and #1500
- Client-side adaptive part size, queue, and UI (#1501, #1519, #1520, #1502, #1521, #1522)

## What exists

- `/jmap/upload` reads the whole body into a string and checks it against a fixed config limit. `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapBlobController.php:39`
- The envelope blob store hashes a string and writes it with `put()`. `path: packages/api/app/Services/Jmap/Blobs/JmapBlobService.php:44`
- `maxSizeUpload` is the config value only. `path: packages/api/app/Services/Jmap/JmapCapabilities.php:62`
- The GC has no reference checkers. `path: packages/api/app/Services/Jmap/Blobs/JmapBlobGarbageCollector.php:24`
- DAV PUT records a content write without a hash; COPY goes through `recordCreate()`. `path: packages/api/app/Dav/Server/FileNodeIndexPlugin.php:80`
- `recordContentWrite()` overwrites `content_sha256` with whatever it is given, null included; `recordCreate()` writes null. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:259`
- `ensureContentSha()` hashes the whole file in one request and saves quietly. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeMapper.php:99`
- `FileNode/set` reads the blob into a string and writes it with `put()`; update keys are a constant. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeSetService.php:46`
- `/jmap/download` resolves `fnb-` ids into a string with `$disk->get()`. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeBlobResolver.php:58`
- `GET /files/content` streams without `Content-Length` or `Range`. `path: packages/api/app/Services/Drive/DriveService.php:450`
- `DriveService.php` is baselined at 870 lines. `path: tools/file-size-baseline.tsv:5`
- Methods never see `using`; the dispatcher only checks it. `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:147`
- Access tokens carry `sub`, `role`, `exp`, `uid`; refresh tokens have a `family_id` per sign-in. `path: packages/api/app/Services/Auth/AuthTokenService.php:216`
- Raw `fopen` is forbidden outside a few exempt paths. `path: packages/api/scripts/greenfield-guard.php:33`
- Each new migration bumps the schema version count. `path: packages/api/app/Services/Installer/WgwSchemaMigrator.php:15`

## Considered

Considered: `JmapBlobService` and `JmapBlobGarbageCollector` as they are, `DriveService::streamDownload()` as the streaming pattern, and RFC 9530 `Content-Digest` for part checks. Kept and extended the blob store and GC (new checkers, streamed store); extracted the streaming pattern into `RangeResponder` so all three download routes share it; rejected `Content-Digest` because its structured-field base64 adds parsing for no gain over two plain headers the client already computes. Rejected a stream-wrapper concatenator in favour of `LocalDiskFiles` append, because Flysystem has no append and a wrapper would still need raw I/O underneath.

## Affected packages

- packages/api
- tools (file-size baseline integer for `DriveService.php`)

## Dependencies

1. Chunk `foundation` (schema, config, budget, local-disk primitives, hashing filter, request context, providers) before every other chunk.
2. `upload-parts`, `content-hash`, `downloads`, `quota` can run after `foundation`.
3. `blob-upload` and `assembly` after `upload-parts` (they consume stored parts).
4. `attach-version` after `assembly` and `content-hash`.
5. `cleanup` after `assembly` and `attach-version` (checkers reference both).
6. `docs` last.

## Open decisions

None — every choice is made in [spec.md](./spec.md).

## Invariants

- A whole-file upload without the new headers still returns `201` with a `jb-` id, and `FileNode/set` still accepts it. A wrong change breaks #1501 and today's client. Proof: `path: packages/api/tests/Feature/Jmap/JmapBlobsTest.php` assertion `test_upload_download_round_trip`.
- The front-controller 413 for oversized `Content-Length` stays before Laravel. A wrong change lets PHP's discarded body reach the controller unnoticed. Proof: `path: packages/api/tests/Architecture/WgwOversizedPostFrontControllerTest.php`.
- `FileNode/set` without `expectedBlobId` behaves as before; with it but without the capability it fails with `invalidProperties`. A wrong change turns a guarded replace into a plain overwrite. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeVersionCheckTest.php` assertion `test_expected_blob_id_without_capability_is_invalid_properties_and_file_unchanged`.
- Every FileNode write path leaves the true sha256 in `content_sha256`. A wrong change re-hashes large files inside a request or changes ids on byte-identical rewrites. Proof: `path: packages/api/tests/Feature/Jmap/FileNodeContentHashTest.php`.
- Existing FileNode, Drive, and DAV behaviour stays green after each chunk. A wrong change breaks the shipped Drive. Proof: `cmd: cd packages/api && composer done-gate`.
- `DriveService.php` does not grow, and its baseline integer is lowered when it shrinks. Proof: `cmd: node tools/file-size-ratchet.mjs check packages/api/app`.

## Chunks

### Chunk A: Foundation

- **id:** `foundation`
- **Skill:** api, security
- **Inputs:** migrations pattern and schema count — `path: packages/api/app/Services/Installer/WgwSchemaMigrator.php:15`; provider list — `path: packages/api/app/Services/Jmap/Capabilities/JmapCapabilitySet.php:32`
- **Done when:** migrations for assemblies, claims, tickets, hash jobs, attach staging, and `jmap_file_nodes.hash_pending` exist; `JmapUploadLimits`, `JmapStepBudget`, `HashingStreamFilter`, `HashStateCodec`, `LocalDiskFiles`, `StorageFullException`, `JmapRequestContext`, and the four capability providers exist with unit tests
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Unit/Jmap`
- **Parallel with:** none

### Chunk B: Streamed, checked parts

- **id:** `upload-parts`
- **Skill:** api, security
- **Inputs:** body read as a string — `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapBlobController.php:45`
- **Done when:** #1500 "Upload limit and parts" criteria hold, with feature tests for limit derivation, a streamed part above the peak-memory bound, both oversize shapes, a discarded body, and length/sha256 mismatch
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapUploadPartsTest.php`
- **Parallel with:** `content-hash`, `downloads`, `quota`

### Chunk C: RFC 9404 Blob/upload and Blob/get

- **id:** `blob-upload`
- **Skill:** api
- **Inputs:** stored parts from `upload-parts`
- **Done when:** #1500 "RFC 9404 blob capability" criteria hold, with tests for source forms, order, duplicates, `blobNotFound`, budget refusal, `maxDataSources`, and the true sha256
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapBlobUploadMethodTest.php`
- **Parallel with:** `assembly`

### Chunk D: Blob assembly extension

- **id:** `assembly`
- **Skill:** api
- **Inputs:** `HashStateCodec`, `LocalDiskFiles`, `JmapStepBudget` from `foundation`
- **Done when:** #1500 "Blob assembly extension" criteria hold, with tests for budget, resume, TTL, finish id equal to a one-piece upload, corrupt / foreign / non-`HashContext` state rebuilt in steps, retried finish, rebuild-only append, retried append
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapBlobAssemblyTest.php`
- **Parallel with:** `blob-upload`

### Chunk E: One meaning for content_sha256

- **id:** `content-hash`
- **Skill:** api
- **Inputs:** `recordContentWrite()` nulling — `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:259`
- **Done when:** #1500 "One meaning for content_sha256" criteria hold, including DAV PUT and COPY, discovered files, provisional ids, hash jobs, and the `change_seq` bump
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/FileNodeContentHashTest.php tests/Feature/Dav`
- **Parallel with:** `upload-parts`, `downloads`, `quota`

### Chunk F: Attach and version check

- **id:** `attach-version`
- **Skill:** api
- **Inputs:** string attach — `path: packages/api/app/Services/Jmap/FileNodes/FileNodeSetService.php:281`
- **Done when:** #1500 "Attaching the blob" and "Per-file version check" criteria hold, with tests for move vs copy, duplicate references, staged copy, concurrent attach, `overQuota`, and every version-check case
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapFileNodeAttachTest.php tests/Feature/Jmap/JmapFileNodeVersionCheckTest.php`
- **Parallel with:** none

### Chunk G: Streamed downloads, Range, ticket

- **id:** `downloads`
- **Skill:** api, security
- **Inputs:** string download — `path: packages/api/app/Services/Jmap/FileNodes/FileNodeBlobResolver.php:58`; refresh families — `path: packages/api/app/Services/Auth/RefreshTokenRepository.php:95`
- **Done when:** #1500 "Downloading large files" criteria and its listed feature tests hold
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapDownloadStreamTest.php tests/Feature/Jmap/JmapDownloadTicketTest.php tests/Feature/Drive`
- **Parallel with:** `upload-parts`, `content-hash`, `quota`

### Chunk H: JMAP Quota

- **id:** `quota`
- **Skill:** api
- **Inputs:** visible roots — `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:80`
- **Done when:** #1500 "Quota (RFC 9425)" criteria hold, with tests for the four methods, ids stable across a group rename, tombstones excluded, trash included, unknown free space
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapQuotaTest.php`
- **Parallel with:** `upload-parts`, `content-hash`, `downloads`

### Chunk I: Cleanup and checkers

- **id:** `cleanup`
- **Skill:** api
- **Inputs:** empty `CHECKERS` — `path: packages/api/app/Services/Jmap/Blobs/JmapBlobGarbageCollector.php:24`
- **Done when:** #1500 "Cleanup" criteria hold, with tests for part deletion that respects claims and checkers, and opportunistic cleanup
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Feature/Jmap/JmapBlobCleanupTest.php`
- **Parallel with:** none

### Chunk J: OpenAPI and docs

- **id:** `docs`
- **Skill:** document, api
- **Inputs:** JMAP routes in OpenAPI — `path: packages/api/openapi/openapi.json:1`
- **Done when:** new routes and response shapes are in OpenAPI; `packages/api/docs/files/jmap-blob-assembly.md` documents the extensions, deviations, disk peaks, and PATCH; done gate passes
- **Verify with:** `cd packages/api && composer done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature test → implement → `composer done-gate`
- [ ] Every "Docs and tests" item of #1500 maps to a named test (see [tasks.md](./tasks.md))

## Doc updates (only if user wants)

- `packages/api/docs/files/jmap-blob-assembly.md` (new), `packages/api/docs/files/jmap-filenode-design.md` (decision 6), `packages/api/docs/sql-schema.md`
