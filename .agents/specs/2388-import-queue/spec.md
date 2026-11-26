Source: #2388 (body-hash: 9b7cabe3)
Goal: WeGotWorkspace/Product#154

# One resumable import queue for Contacts, Calendar, Tasks and Notes

Technical translation of Epic [#2388](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/2388). Product decisions from the product lead (2026-11-26) are in the Goal and repeated under Decisions below.

## Goal

A file a person imports into Contacts (`.vcf`), Calendar (`.ics`), Tasks (`.ics`) or Notes (`.md`) becomes a job in one per-account import queue in the browser. The queue keeps the file in IndexedDB, survives reloads, closed tabs and going offline, and runs in one tab at a time. For vCard and ICS, the file goes to the server once with Drive's chunked upload, and the server imports it in short steps that each fit the step budget, so no request grows with the file. Notes keeps its browser-side conversion and runs one file per step. Each app shows a temporary `Import` sidebar item with progress and a per-job result: imported, already there, too large, failed.

## Decisions (product lead, 2026-11-26)

1. **Resume on an open tab.** An import continues only while a tab of the app is open; it resumes when one opens again. No server worker or cron.
2. **Sidebar item lifetime.** The `Import` item shows while an import is unfinished, or while its view is open. Finished jobs are cleared when the person leaves the view. Same rule as Drive's `Uploads` item.
3. **Notes on the same queue.** Notes uses the same queue, item and view; its conversion stays in the browser.

## Non-goals

- A server worker, cron, or any import progress without an open tab.
- Showing a job on a device other than the one that started it.
- Direct import from Google or iCloud accounts (WeGotWorkspace/Product#101–#104, #111).
- Removing or changing the REST import endpoints (`POST contacts/cards/import`, `calendars/events/import`, `tasks/items/import`). API clients keep them, with their current limits.
- Word, Pages or OpenDocument import (Docs).
- Moving Notes' Markdown conversion to the server.

## Affected packages

- `packages/api`: import job storage, JMAP vendor capability `urn:wgw:jmap:import` with `Import/set`, `Import/get`, `Import/step`, format adapters, blob reference checker, OpenAPI.
- `packages/apps`: `src/lib/offline/import/` (queue core), shared Import sidebar item and view, Contacts, Calendar, Tasks and Notes wiring.
- `docs`: an architecture page for the import queue once the core lands.

## Technical constraints

- **One upload path.** The source file goes up with `sendDriveUploadBytes` (`packages/apps/src/lib/offline/drive/upload/drive-upload-chunked.ts:87`), which returns a `blobId` and stores resumable part state. No import-specific upload protocol.
- **Bounded steps.** `Import/step` stops when `wgw.jmap.step_max_seconds` (5 s by default, `packages/api/config/wgw.php:36`) is spent. A step reads only the byte ranges of the items it imports. It never loads or parses the whole file. Memory per step must not grow with the file size.
- **Index once.** `Import/set` scans the blob once and stores one row per item: a vCard block, or an ICS UID group (master plus overrides, as `ICalendarUidGroupSplitter` groups them today). ICS needs the whole-file scan because overrides of one UID can be anywhere in the file.
- **Exactly once per item.** An item's write and the job cursor commit in one database transaction. A step that dies is repeated from the cursor. Items written before the crash are not written twice. For card and calendar object writes outside that transaction (search index, mutation events), a repeat must be harmless.
- **Per-item limits stay.** The 512 KiB / 512 property / 64 component caps from #162 apply per item; an over-cap item is counted as too large and its siblings continue. The whole-body cap `VObjectPayloadGuard::MAX_ICS_BYTES` (`packages/api/app/Services/VObject/VObjectPayloadGuard.php:22`) does not apply to this path.
- **Blob lifetime.** Unreferenced blobs expire after `wgw.jmap.blob_ttl_hours` (24 h, `packages/api/config/wgw.php:26`). An open import job keeps its blob through a `JmapBlobReferenceCheckerInterface` implementation (`packages/api/app/Services/Jmap/Blobs/JmapBlobReferenceCheckerInterface.php:16`). A finished or abandoned job releases it. Jobs untouched for the assembly TTL are swept.
- **Authorization.** A job belongs to one principal. `Import/set` checks write access to the target collection, and every `Import/step` checks it again, so a share revoked mid-import stops the job.
- **One importer per account.** Cross-tab exclusion with `withCrossTabLock` (`packages/apps/src/lib/cross-tab/cross-tab-lock.ts:321`) under `wgw-importer:<account>`, separate from `wgw-drive-uploader:<account>` (`packages/apps/src/lib/offline/drive/upload/drive-upload-lock-name.ts:9`), so a long upload does not block an import or the reverse.
- **Traffic.** Steps go through `wgwFetch` and the same request pacing as other background traffic (Epic #2284). Shared hosts ban an IP above about 60 requests per minute, so one importer runs one request at a time and waits between steps when the budget asks for it.
- **Idempotent re-import.** A vCard without `UID` gets one from a hash of the card text with `PRODID` and `REV` left out, so the same contact from a later export keeps its UID. The server keeps the existing card and counts it as already there.
- **Offline.** A job picked while offline is stored as queued; the queue starts it on `online`. No step is sent while `navigator.onLine` is false.

## Edge cases

- Reload during the upload: the upload resumes from the next part (`drive-upload-runner-chunked.test.ts:147` covers this for Drive).
- Reload during the import: the job resumes with the next `Import/step`; the server cursor is the truth.
- Two tabs: only the lock holder sends requests; the other shows the same rows live and takes over when the holder closes.
- The device runs out of room for the file Blob: the job stays in tab memory only and fails with a clear reason after a reload, like Drive's `no_local_copy`.
- The server blob expired before the job finished (device offline for days): the job fails with "upload again"; a retry re-uploads from the local Blob if it is still stored.
- The target collection is deleted or unshared mid-import: the step fails with 403/404; the job stops and names the reason; created items stay.
- A file with zero importable items: `Import/set` answers with an error, and no job is created.
- Cards that are exact duplicates within one file: the second counts as already there.
- A Notes file whose image upload fails: same rule as today (`notes-markdown-import-run.test.ts:124`): skipped with a reason, the batch goes on.
- Log out with an unfinished job: the queue is per account and stays in that account's database; it resumes at the next sign-in.
