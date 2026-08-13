# Tasks — JMAP blobs (draft)

Engineering split per [plan.md](./plan.md). Delivery issue: #438.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-b-blobs | builder | api | `app/Http/Controllers/Api/V1/Jmap/JmapStubController.php` (superseded), `app/Services/Jmap/Blobs/*`, `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapBlobsTest.php` | upload/download round-trip; reference-protected GC; honest `maxSizeUpload`; done gate | pending — after umbrella chunk P |
