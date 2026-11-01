# Engineering tasks — Chunked upload API (#1500)

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `foundation` | builder | api, security | `database/migrations/wgw/2026_10_22_*`, `app/Services/Jmap/Blobs/{JmapUploadLimits,JmapStepBudget,HashStateCodec}.php`, `app/Storage/Local/LocalDiskFiles.php`, `app/Storage/Streams/HashingStreamFilter.php`, `app/Services/Jmap/JmapRequestContext.php`, `app/Services/Jmap/Capabilities/*` | `php vendor/bin/phpunit tests/Unit/Jmap` |
| `upload-parts` | builder | api, security | `JmapBlobController.php`, `JmapBlobService.php` | `php vendor/bin/phpunit tests/Feature/Jmap/JmapUploadPartsTest.php` |
| `blob-upload` | builder | api | `app/Services/Jmap/Methods/Blob{Upload,Get}Method.php`, `app/Services/Jmap/Blobs/BlobJoinService.php` | `php vendor/bin/phpunit tests/Feature/Jmap/JmapBlobUploadMethodTest.php` |
| `assembly` | builder | api | `app/Services/Jmap/Assembly/*`, `app/Services/Jmap/Methods/BlobAssembly*Method.php`, `app/Models/JmapBlobAssembly.php` | `php vendor/bin/phpunit tests/Feature/Jmap/JmapBlobAssemblyTest.php` |
| `content-hash` | builder | api | `FileNodeIndexService.php`, `FileNodeContentHasher.php`, `FileNodeIndexPlugin.php`, `FileNodeMapper.php`, `FileNodeBlobResolver.php` | `php vendor/bin/phpunit tests/Feature/Jmap/FileNodeContentHashTest.php` |
| `attach-version` | builder | api | `FileNodeSetService.php`, `FileNodeBlobAttacher.php`, `FileNodeVersionCheck.php` | `php vendor/bin/phpunit tests/Feature/Jmap/JmapFileNodeAttachTest.php tests/Feature/Jmap/JmapFileNodeVersionCheckTest.php` |
| `downloads` | fork agent (worktree) | api, security | `JmapBlobController.php`, `app/Http/Support/RangeResponder.php`, `app/Services/Jmap/Download/*`, `DriveService.php`, auth `sid` claim | `php vendor/bin/phpunit tests/Feature/Jmap/JmapDownloadStreamTest.php tests/Feature/Jmap/JmapDownloadTicketTest.php` |
| `quota` | fork agent (worktree) | api | `app/Services/Jmap/Quota/*`, `app/Services/Jmap/Methods/Quota*Method.php` | `php vendor/bin/phpunit tests/Feature/Jmap/JmapQuotaTest.php` |
| `cleanup` | builder | api | `JmapBlobGarbageCollector.php`, `app/Services/Jmap/Blobs/JmapBlobMaintenance.php`, checkers | `php vendor/bin/phpunit tests/Feature/Jmap/JmapBlobCleanupTest.php` |
| `docs` | builder | document | `openapi/openapi.json`, `docs/files/jmap-blob-assembly.md`, `docs/sql-schema.md` | `composer done-gate` |

## Notes

- Chunk `id` values must match `plan.md`.
- On scope change: update Task #1500 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
