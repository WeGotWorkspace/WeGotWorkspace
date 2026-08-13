# Tasks — JMAP blobs (draft)

Engineering split per [plan.md](./plan.md). Delivery issue: #438.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-b-blobs | builder | api | `app/Http/Controllers/Api/V1/Jmap/JmapBlobController.php`, `app/Services/Jmap/Blobs/*`, `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapBlobsTest.php` | upload/download round-trip; reference-protected GC; honest `maxSizeUpload`; done gate | done — `feat/jmap-blobs` branch (`cursor/jmap-blobs-1305`) |
