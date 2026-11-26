# One resumable import queue for Contacts, Calendar, Tasks and Notes

## Goal

Every import in Contacts, Calendar, Tasks and Notes runs as a job in one per-account browser queue. The queue survives reloads, closed tabs and going offline. vCard and ICS files go to the server once with Drive's chunked upload. The server imports them in budgeted steps through a new JMAP vendor capability. Notes runs its existing browser conversion one file per step on the same queue. Each app shows a temporary `Import` sidebar item and view. Details and decisions: [spec.md](./spec.md).

## Budget

Not scheduled yet: the Goal (WeGotWorkspace/Product#154) is Identified. Once adopted, it draws from the import and data-portability work and displaces nothing already Adopted. #2387 covers the urgent data loss in the meantime.

## Non-goals

- Server-side progress without an open tab (decision 1 in spec.md).
- Cross-device job visibility.
- Changing or removing the REST import endpoints.
- Server-side Markdown conversion.
- Generalising Drive's upload queue into a shared transfer framework. This plan reuses Drive's building blocks, not its queue code (see Considered).

## What exists

- Drive's chunked upload sends a `Blob` in parts and returns the `blobId` of the whole file, storing part state after every part and step, so a later call resumes. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-chunked.ts:87`
- Drive keeps queue rows and file Blobs in the per-account Dexie database (`drive_upload_batches`, `drive_upload_items`, `drive_upload_blobs`). `path: packages/apps/src/lib/offline/drive/upload/drive-upload-schema.ts:11`
- The per-account Dexie database is opened by account key. `path: packages/apps/src/lib/offline/core/offline-db.ts:110`
- Cross-tab exclusion uses `withCrossTabLock` (Web Locks, with a localStorage fallback for http installs). `path: packages/apps/src/lib/cross-tab/cross-tab-lock.ts:321`
- Drive's uploader lock is per account: `wgw-drive-uploader:<account>`. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-lock-name.ts:9`
- Drive's retry backoff starts at 30 s and doubles to 8 min. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner.ts:47`
- Drive's runner wakes on `online` and `pageshow`. `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner.ts:107`
- Drive shows `Uploads` in the sidebar only while the queue has files or the view is open, with `DriveUploadsBadge`. `path: packages/apps/src/drive-core/src/use-drive-sidebar-model.tsx:92`
- The server's step budget is `wgw.jmap.step_max_seconds` (5 s). `path: packages/api/config/wgw.php:36`
- Unreferenced JMAP blobs expire after 24 h. `path: packages/api/config/wgw.php:26`
- Domains keep blobs alive through `JmapBlobReferenceCheckerInterface::isReferenced`. `path: packages/api/app/Services/Jmap/Blobs/JmapBlobReferenceCheckerInterface.php:18`
- Vendor JMAP capabilities use `urn:wgw:jmap:*` constants (notes, chat, availability, mail). `path: packages/api/app/Services/Jmap/JmapCapabilities.php:45`
- JMAP methods are registered in the dispatcher, for example `BlobAssemblySetMethod`. `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:109`
- The vCard importer parses and creates a whole request in one PHP request and builds every created card for the answer. `path: packages/api/app/Services/Contacts/ContactCardRepository.php:143`
- Calendar and Tasks import the whole `.ics` in one request, capped at 512 KiB for the whole body. `path: packages/api/app/Services/VObject/VObjectPayloadGuard.php:22`, `path: packages/api/app/Services/Calendars/CalendarEventRepository.php:246`, `path: packages/api/app/Services/Tasks/TaskImportService.php:52`
- ICS files are split into UID groups (master plus overrides) by `ICalendarUidGroupSplitter`. `path: packages/api/app/Services/VObject/ICalendarUidGroupSplitter.php:22`
- The Calendar client posts the whole file text in one call. `path: packages/apps/src/lib/api/wgw/calendar.ts:279`
- The Contacts client refuses to import offline. `path: packages/apps/src/lib/offline/contacts/contacts-hybrid-operations.ts:350`
- Notes import converts in the browser, creates each note with a client `uid`, and treats a 409 for that uid as already created. `path: packages/apps/src/notes-core/src/notes-markdown-import-wgw.ts:44`
- [#2387](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2387) (open, draft) sends vCard imports in adaptive batches of at most 500 cards and reports already-there and too-large cards separately. It stays the fallback until chunk D replaces the Contacts call site.
  > Send at most 500 cards and 1 MiB per POST (`VCARD_IMPORT_BATCH_MAX_CARDS`, `VCARD_IMPORT_BATCH_MAX_BYTES`).

## Considered

Considered: Drive's upload queue (`lib/offline/drive/upload/*`) as the import queue — rejected because its rows, placeholders, conflict handling and FileNode handoff are Drive-specific; the import queue reuses its building blocks (`sendDriveUploadBytes`, `withCrossTabLock`, backoff and wake pattern, sidebar rule) instead.
Considered: the generic offline outbox (`runOutboxFlush`) — rejected because rows hold small JSON payloads, flush has no progress or resume within a row, and failures show only as a count.
Considered: client-side splitting into many small REST batches (what #2387 does) as the end state — rejected because it cannot survive a reload, and ICS needs whole-file UID grouping that the browser would have to duplicate from the server.
Considered: a server worker or cron that runs jobs alone — rejected by the product lead (decision 1): many installs have no background jobs.
Considered: moving Markdown conversion to the server — rejected by the product lead (decision 3): images already go to Drive from the browser.
Chosen: upload once with the existing chunked upload, then client-driven budgeted server steps (`Import/step`), the same pattern as Blob assembly steps.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

1. Chunk A (server job + vCard) and chunk C (client queue core) can start together.
2. Chunk B (ICS adapters) needs chunk A's job store and methods.
3. Chunk D (Import UI + Contacts) needs A and C.
4. Chunk E (Calendar + Tasks) needs B and D.
5. Chunk F (Notes) needs C and D.
6. Chunk G (vCard UID seed) has no dependency; it must land before or with D so re-imports through the queue match.

## Open decisions

None — every choice is made. The product decisions are in spec.md (Decisions, 2026-11-26).

## Invariants

- The REST import endpoints keep their behavior and limits for API clients, including the 512 KiB whole-body ICS cap. A wrong change lets an API client post an unbounded `.ics` in one request. Proof: `path: packages/api/tests/Feature/Calendars/CalendarsEventImportTest.php` assertion `test_import_body_over_max_ics_bytes_returns_payload_too_large`.
- The vCard REST importer still creates all cards of a multi-card body. A wrong change breaks third-party clients and #2387's fallback path. Proof: `path: packages/api/tests/Feature/Contacts/ContactsCardImportTest.php` assertion `test_import_multi_vcard_file_creates_all_contacts`.
- Tasks import still imports every UID group of a VTODO file. A wrong change silently drops recurring task overrides. Proof: `path: packages/api/tests/Feature/Tasks/TasksImportTest.php` assertion `test_vtodo_only_file_imports_every_uid_group`.
- Drive uploads still resume from the next part after a reload. Sharing `sendDriveUploadBytes` with the import queue must not change its state shape. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner-chunked.test.ts` assertion `resumes an unfinished upload from the next part after a reload`.
- Drive uploads still run one file at a time under the account's uploader lock. A wrong change lets the importer and the uploader share a lock and block each other. Proof: `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner.test.ts` assertion `uploads one file at a time through wgwFetch under the account's uploader lock`.
- Drive's `Uploads` sidebar item rule is unchanged when the shared Import item lands. Proof: `path: packages/apps/src/drive-core/src/use-drive-sidebar-model.test.tsx` assertion `shows Uploads next to Starred and Trash while the queue has files or the view is open`.
- Notes import does not create a second note for the same file. Proof: `path: packages/apps/src/notes-core/src/notes-markdown-import-run.test.ts` assertion `does not create a second note when the same file is imported again`.
- After chunk A, main still works without chunk C: the capability is advertised but no client uses it, and the REST importers are untouched. Proof: `cmd: pnpm test:api-done-gate`.
- After chunk C, main still works without chunk D: the queue core ships with no caller, and the apps done gate passes. Proof: `cmd: pnpm test:apps-done-gate`.

## Chunks

### Chunk A: server-import-job-vcard
- **Skill:** api, security
- **Inputs:** vCard importer per request — `path: packages/api/app/Services/Contacts/ContactCardRepository.php:143`; blob reference interface — `path: packages/api/app/Services/Jmap/Blobs/JmapBlobReferenceCheckerInterface.php:18`; step budget — `path: packages/api/config/wgw.php:36`; method registration — `path: packages/api/app/Services/Jmap/JmapMethodDispatcher.php:109`; vendor capability constants — `path: packages/api/app/Services/Jmap/JmapCapabilities.php:45`
- **Done when:** `urn:wgw:jmap:import` is advertised; `Import/set` creates a job from a `blobId`, kind `vcard` and a writable address book, indexes item ranges once, and keeps the blob referenced; `Import/step` imports items within the step budget, commits each item with the cursor, and returns progress counts and first errors; `Import/get` returns job state; a job is owned by one principal and every step re-checks write access; OpenAPI documents the methods; the security skill checklist passes for the blob parser (caller-supplied input).
- **Verify with:** feature tests: a 20,000-card fixture imports completely across steps with `memory_limit=128M`; a step killed mid-way and repeated creates no duplicates; a revoked share stops the job; another principal cannot read or step the job; `pnpm test:api-done-gate`.
- **Parallel with:** C, G

### Chunk B: server-ics-adapters
- **Skill:** api
- **Inputs:** UID group splitting — `path: packages/api/app/Services/VObject/ICalendarUidGroupSplitter.php:22`; current importers — `path: packages/api/app/Services/Calendars/CalendarEventRepository.php:246`, `path: packages/api/app/Services/Tasks/TaskImportService.php:52`
- **Done when:** kinds `ics-events` and `ics-tasks` index UID groups once and import one group per item with the existing per-object caps; files over 512 KiB import through this path; skipped components (events in a task list, tasks in a calendar) are counted like today.
- **Verify with:** feature tests for a multi-year calendar fixture (several MB) and a recurring series with overrides spread through the file; `pnpm test:api-done-gate`.
- **Parallel with:** none (after A)

### Chunk C: client-import-queue-core
- **Skill:** workspace, testing
- **Inputs:** chunked upload — `path: packages/apps/src/lib/offline/drive/upload/drive-upload-chunked.ts:87`; Dexie account database — `path: packages/apps/src/lib/offline/core/offline-db.ts:110`; cross-tab lock — `path: packages/apps/src/lib/cross-tab/cross-tab-lock.ts:321`; backoff and wake — `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner.ts:47`, `path: packages/apps/src/lib/offline/drive/upload/drive-upload-runner.ts:107`
- **Done when:** `src/lib/offline/import/` holds job and Blob tables in the account database, one importer per account under `wgw-importer:<account>`, wake on `online`/`pageshow`/queue change, Drive's backoff, a live snapshot subscription for UI, and a kind registry with two step shapes: server-step (upload with `sendDriveUploadBytes`, `Import/set`, then `Import/step` until done) and client-step (one browser step per item). Nothing calls it yet.
- **Verify with:** Vitest with a fake server: reload mid-upload resumes from the next part; reload mid-import resumes with the next step; offline holds the job queued; a second tab waits for the lock and takes over; `pnpm test:apps-done-gate`.
- **Parallel with:** A, G

### Chunk D: import-ui-contacts
- **Skill:** apps-ui, workspace, accessibility
- **Inputs:** Drive's sidebar rule and badge — `path: packages/apps/src/drive-core/src/use-drive-sidebar-model.tsx:92`; Contacts offline refusal to replace — `path: packages/apps/src/lib/offline/contacts/contacts-hybrid-operations.ts:350`
- **Done when:** a shared Import sidebar item and Import view (shared by all apps, declared per app) follow decision 2; the view lists jobs with progress and a result per job (imported, already there, too large, failed with reasons); progress is announced to screen readers in steps like Drive; Contacts' import dialog enqueues a job (also offline) instead of posting batches; #2387's batching stays only for API clients outside the app.
- **Verify with:** RTL tests for the sidebar rule and the result view; browser e2e with the 18,875-card fixture class: reload mid-import and close/reopen the tab, then the book holds every importable card; screenshots for the product lead (UI waits for review).
- **Parallel with:** none (after A and C)

### Chunk E: calendar-tasks-client
- **Skill:** workspace
- **Inputs:** Calendar whole-file call — `path: packages/apps/src/lib/api/wgw/calendar.ts:279`; Tasks import operation — `path: packages/apps/src/lib/models/tasks-types.ts:80`
- **Done when:** Calendar and Tasks import dialogs enqueue `ics-events` and `ics-tasks` jobs and show them in their Import item and view.
- **Verify with:** browser e2e importing a calendar file over 512 KiB and a task file through the queue, with a reload mid-import; `pnpm test:apps-done-gate`.
- **Parallel with:** F (after B and D)

### Chunk F: notes-on-queue
- **Skill:** workspace
- **Inputs:** Notes uid idempotency — `path: packages/apps/src/notes-core/src/notes-markdown-import-wgw.ts:44`
- **Done when:** the Notes import enqueues one job with one client-step item per file; each step runs today's per-file import (create with uid, upload images, write body); the job's result keeps today's skip reasons, dropped tags and images-not-imported counts.
- **Verify with:** Vitest: reload mid-job resumes at the next file without a duplicate note; browser e2e with a multi-file import and a reload.
- **Parallel with:** E (after C and D)

### Chunk G: vcard-uid-seed
- **Skill:** api
- **Inputs:** vCard importer — `path: packages/api/app/Services/Contacts/ContactCardRepository.php:143`
- **Done when:** a vCard without `UID` gets a UID from a hash of its text with `PRODID` and `REV` lines removed and line endings normalised; the same card from two exports with different `PRODID` maps to the same UID; cards imported before this change keep their stored UID.
- **Verify with:** unit test with two exports differing only in `PRODID`/`REV`; `ContactsCardImportTest` stays green.
- **Parallel with:** A, C

## Test plan

- [ ] API: OpenAPI for `Import/set`, `Import/get`, `Import/step` → failing feature tests (completeness across steps, crash-and-repeat, revoked access, foreign principal, blob reference) → implement → `pnpm test:api-done-gate`.
- [ ] Memory: a feature test that imports a 20,000-card file with the step budget and asserts peak memory per step stays flat as the file grows.
- [ ] UI: mock-tier Storybook stories for the Import item and view (running, paused offline, finished with mixed results), Vitest for the queue core, RTL for the sidebar rule.
- [ ] Browser e2e per app on a host with `memory_limit=128M` and `max_execution_time=30`: full import, reload mid-import, close and reopen the tab, second tab takes over, re-import adds nothing.

## Doc updates (only if user wants)

- `docs/architecture/import-queue.md` once chunk C lands, linking this spec folder.
