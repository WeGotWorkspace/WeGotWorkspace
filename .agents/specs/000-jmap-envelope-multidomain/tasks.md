# Tasks — JMAP envelope multi-domain expansion (draft)

Engineering split per [plan.md](./plan.md). **Draft, planning-only** — rows become actionable when their issues are filed ([issue-drafts.md](./issue-drafts.md)). Design-only rows (F0, M0) deliver documents, not code.

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-p-envelope-decouple | builder | api | `routes/api.php`, `app/Services/Jmap/JmapCapabilities.php`, `app/Http/Controllers/Api/V1/Jmap/*`, `tests/Feature/Jmap/JmapDispatcherTest.php` | existing Jmap suites green unchanged; gated-capability test; `composer done-gate` | pending |
| chunk-c-contacts-envelope | builder | api | `app/Services/Jmap/Methods/AddressBook*`, `app/Services/Jmap/Methods/ContactCard*`, `app/Services/Contacts/*`, `tests/Feature/Jmap/JmapContactsMethodsTest.php` | lifecycle contract test; mixed-domain batch test; done gate | pending — after chunk-p |
| chunk-b-blobs | builder | api | `app/Http/Controllers/Api/V1/Jmap/JmapStubController.php` (superseded), `app/Services/Jmap/Blobs/*`, `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapBlobsTest.php` | upload/download round-trip; reference-protected GC; honest `maxSizeUpload`; done gate | pending — after chunk-p |
| chunk-t-rest-task-sync | builder | api | `app/Services/Tasks/*`, `routes/api.php`, `tests/Feature/Tasks/*` | parity with calendar event sync tests; done gate | pending |
| chunk-t-envelope-tasks | builder | api | `app/Services/Jmap/Methods/Task*`, `app/Services/Jmap/Methods/TaskList*`, `tests/Feature/Jmap/JmapTasksMethodsTest.php` | lifecycle contract test; draft-06 pinned in docs/tests; done gate | pending — after chunk-p + chunk-t-rest |
| chunk-f0-filenode-design | planner | plan-feature, api | design doc (this folder or `packages/api/docs/files/`) | maintainer review of node-id index design | pending |
| chunk-f-filenode-envelope | builder | api | `app/Services/Jmap/Methods/FileNode*`, `app/Dav/Storage/*` (index maintenance), `database/migrations/wgw/*`, `tests/Feature/Jmap/JmapFileNodeMethodsTest.php` | lifecycle contract test; rename/move id stability; WebDAV write visible in `/changes`; done gate | pending — after chunk-f0 + chunk-b |
| chunk-m0-mail-design | planner | plan-feature, api | decision doc (`docs/product/` or epic body) | maintainer review of build/defer/reject + phase-1 scope | pending |
| chunk-m1-mail-read | builder | api | `app/Services/Jmap/Methods/Mailbox*`, `Email*`, `Thread*`, `app/Services/Mail/*` (read adapters), `tests/Feature/Jmap/JmapMailMethodsTest.php` | lifecycle contract test vs IMAP fixture; done gate | pending — after chunk-m0 ("build") + chunk-b |
| chunk-m2-mail-write | builder | api | `app/Services/Jmap/Methods/EmailSet*`, `Identity*`, `EmailSubmission*`, `app/Services/Mail/*` | write-then-sync incremental path; submission test; done gate | pending — after chunk-m1 |
