Source: #2284 (body-hash: cdb9979e)
Goal: WeGotWorkspace/Product#153

# Notes lean-first first download

Technical translation of the Notes part of Epic #2284 (traffic budget). Spec only: no product code ships with this folder. It applies the contacts approach (PR #2340: lean pages, then a paced detail pass) to Notes, and refines chunk G of [2338-lean-first-sync](../2338-lean-first-sync/plan.md), which assumed Notes already pages and projects. Calendar follows later in its own spec.

## Goal

A device with no Notes copy reaches "list usable" with a few small requests, then downloads the note bodies in a paced, resumable background pass. A note is **partial** until its body is in the cache. A partial note is never edited or saved from its partial copy.

## Non-goals

- Calendar events (later spec), Tasks, Docs, Drive.
- A device that already holds a complete Notes copy: it keeps refreshing with whole notes, never lean ones.
- Changing how live note bodies sync (the Yjs room stays the owner of the body).
- The per-type `maxObjectsInGet` product choice (2338 chunk S).

## What the code does today

1. **The first download is not JMAP.** `fetchNotesVjournalBootstrap` lists notebooks, then calls the REST `GET /notes/items?notebookId=` once per notebook. Each call returns every note of the notebook, body included, in one unpaged response. `packages/apps/src/lib/api/wgw/notes-vjournal.ts:397`, `:196`.
2. **The server builds that response from all rows at once.** `NoteRepository::list` loads every `VJOURNAL` row of the notebook (ICS blobs included), converts each, and returns the array. `packages/api/app/Services/Notes/NoteRepository.php:47`. A notebook with 2000 notes, 500 of them 20–50 KB, is one response of roughly 10–25 MB of bodies and the same again in PHP memory. Not measured yet: part of the measurement plan.
3. **JMAP is used for live inbound only.** `JmapNotesAdapter` pulls `Note/changes`, fetches changed notes with `Note/get`, and on `cannotCalculateChanges` refetches everything with `getAllNotes` (`Note/query` plus chunked gets). `packages/apps/src/lib/jmap-client/adapter/JmapNotesAdapter.ts:90`, `:145`. REST `syncNotesInboundFromRest` is the reconnect and manual-refresh path. `packages/apps/src/lib/offline/notes/notes-inbound-sync.ts:77`.
4. **`Note/get` supports `properties`.** `NoteGetMethod` ends in `projectProperties` (`array_intersect_key`, `id` always kept). `packages/api/app/Services/Jmap/Methods/NoteGetMethod.php:70`, `Concerns/HandlesGetArguments.php`. `JmapNotesClient.getNotes(accountId, ids, properties)` passes it through. `packages/apps/src/lib/jmap-client/notes/JmapNotesClient.ts:67`. A metadata list already exists: `NOTE_METADATA_PROPERTIES` (every property except `body`), used when a live room holds the body. `JmapNotesAdapter.ts:11`.
5. **The projection saves wire bytes, not server work or memory.** `Note/get` by id calls `NoteRepository::show` per id (note lookup, star lookup, ICS parse in `NoteJournalConverter::fromObject`, a state `remember`, a content etag), collects whole records, and projects at the end. So the body is built and held for every note of the page before it is dropped. `NoteRepository.php:94`, `NoteGetMethod.php:42`.
6. **`Note/query` exists and pages ids.** It rejects `sort`, orders by id, takes `position`/`limit`, optional `filter.inNotebook`. `NoteQueryMethod.php:44`. The client helper `fetchAllByQuery` already accepts `properties` and `maxIdsPerGet` and pages ids in 5000s. `packages/apps/src/lib/jmap-client/core/fetch-all.ts:14`, `:19`.
7. **The offline store.** Dexie `notes_notes` rows hold `data` (the whole `Note` as JSON, body included), `notebookId`, `pendingSync`, `updatedAt`; `notes_notebooks` holds notebooks. Reads and writes go through `notes-offline-store.ts`; ingest of a remote note is `ingestRemoteNote`, which holds back only fields queued in the outbox. `packages/apps/src/lib/offline/notes/notes-schema.ts:13`, `notes-jmap-inbound.ts:28`. Tabs learn of cache changes through `notifyNotesBootstrapUpdated`.
8. **Body ownership.** The body lives in the Docs Yjs collab document keyed by the note UID. The outbox carries metadata only (title, tags, starred, archived, notebook); the body is excluded on purpose. The Dexie body is the list preview and the offline read copy; it also seeds the editor: `NoteCollabSession initialMarkdown={noteBodyToMarkdown(active.body)}`. `notes-offline-store.ts:59`, `packages/apps/src/notes-core/src/notes-workspace.tsx:377`, `use-note-body-collab.ts`. Bodies typed offline sit in a y-indexeddb crash buffer and are uploaded after the outbox flush (`notes-pending-bodies.ts`).

## What the notes list needs

The list row reads: `title`, `notebook`, `tags`, `starred`, `archived` (from `status`), `date` (`contentUpdatedAt` else `updatedAt`), and an `excerpt` of 180 characters of plain text taken **from the body**. The excerpt is also the row title when the note has no `title` (`noteFromVjournal`, `noteHasListableBody`, `computeExcerpt`). `wordCount` is also derived from the body; only note creation reads it outside the model (`use-notes-mutations.tsx:615`), to be re-checked in the build.

So the existing metadata projection is **not enough for a usable list**: notes without a title would show blank rows until their bodies arrive. The lean projection therefore needs a server-computed `preview`.

## Decisions in this spec

1. **Lean projection** = `NOTE_METADATA_PROPERTIES` + new `preview`. The server adds `preview` to `Note` (plain-text, at most 180 characters, same rule the client uses for `excerpt`; the server already has such a rule in `NoteMarkdownCodec::listPreview`). It is additive to the JMAP Note type, so `Note/get` without `properties` also returns it. The client uses `preview` as the partial note's `excerpt`.
2. **The server drops the body per record** while looping over ids in `Note/get`, when `body` is not requested, so a lean page of 500 holds no bodies in PHP memory. That is the change that makes a lean page cheap in memory, not only on the wire.
3. **Lean pass over JMAP**: `Note/query` (ids, one window of up to the 5000-id helper page) then `Note/get` with the lean projection in pages. The REST bootstrap stays as the path for a device that already has a copy and for the mock tier.
4. **Detail pass** = `Note/get` with `properties: ["body"]` for the ids in the partial marker, newest content first, in small byte-bounded pages (starting value 100 ids, set by measurement). Each page is saved with its marker update in one Dexie transaction, then other tabs are told.
5. **Partial marker** = a record in the Dexie `meta` table (same shape as the contacts detail pass: a pass id plus the list of note ids still partial), the single source of truth. A note is partial exactly while its id is listed. A body from any source (open, live sync, refresh, detail pass) removes the id in the same transaction as the row write. A device that never ran lean has no marker and no partial notes.
6. **Pages.** The client keeps 500-id pages (`GENERAL_GET_PAGE_CAP`, PR #2340) for note gets. With bodies dropped per record (decision 2) a lean page may be larger; raising it for the lean pass only is decided by the measurement in chunk N5, not assumed. Detail pages stay small because PHP must still parse each ICS body.
7. **Pacing.** The detail pass takes the shared `backgroundSyncPacer` bulk slot for every page, runs in one tab per browser behind a Web Lock (`wgw.notes.detailPass/<username>`), and resumes from the marker after a reload or a network error. A note the user opens is fetched at once without waiting for a slot (it is a user request, not background work). While Contacts and Notes both run, Contacts pages keep priority in the shared schedule.

## The hard rule

**A note that is not complete is never edited or saved from its partial copy.** In practice:

- **One guard.** A single helper (`requireFullNote`, to be folded into the shared lean-sync helper of 2338 when it lands) throws for a note whose id is in the marker. Every path that edits, saves, exports, copies or re-sends a note body or the whole note calls it. Callers listed in plan chunk N3.
- **Online open.** Selecting a partial note shows a loading state in the detail pane, fetches that one full note at user priority, writes the row and clears the marker id, and only then opens the editor and the collab room. If the fetch fails, the pane shows a read-only "could not load, retry" state; no room opens.
- **Offline.** A partial note opens read-only with its title, tags and preview and a plain "The text of this note is not downloaded yet. It is available when you are online." The editor, the room and `initialMarkdown` are never created for it.
- **Why the editor matters.** The editor seeds its room from the cached body. A partial note has none: an empty seed in an empty room could be saved over the real server body. A partial note therefore never reaches `NoteCollabSession`.
- **Archived and read-only notes** show the stored body today. A partial one shows the same "not downloaded" state, never an empty body.
- **Metadata edits.** Field patches (star, archive, move notebook, tags) send no body and merge field by field, so they cannot overwrite a body. Default in this spec: list-level star, archive, move and tag changes stay allowed on a partial note; opening the editor, renaming the title in the pane, export, duplicate and print are blocked until the note is full. This is open question 1.
- **Live collaboration.** A partial note is never in a room, so nobody can type into a room that started from a partial copy. A colleague editing it live reaches us as a `Note/changes` entry; the changed note is fetched with its body (the adapter's existing `withBody` path), which completes it and clears the marker. A note a live room holds is fetched metadata-only today; an open note is already full, so this case never meets a partial note.
- **The outbox.** A partial note can carry queued metadata fields. The marker keeps listing it until its body arrives; the detail pass then fills only the body and keeps the queued fields. A queued write never contains a body, so flushing it cannot save partial content. Conflict reporting is unchanged.
- **Crash buffers.** `enrichNotesListPreviewsFromCollabOffline` and `uploadPendingNoteBodies` skip ids in the marker (a partial note never had a room; the enrich pass would otherwise open a y-indexeddb for every partial row).

## Edge cases

- Note destroyed on the server between the lean and the detail pass: it comes back in `notFound`; the id leaves the marker and the row is removed unless the outbox owns it (same rule as `ingestRemoteNoteDestroyed`).
- A newer download installs a new pass id: the running pass stops after its current page and the new list takes over (as in contacts).
- Quota full or storage error during the detail pass: the pass stops, the marker stays, notes stay readable as partial; it resumes on the next start.
- Search: list search that reads bodies finds titles, tags and previews only until the detail pass finishes (re-check how search matches; UI list for Wouter in plan.md).
- A tab that hides or closes mid-pass: the lock frees, another tab or the next start resumes.
- Notebooks (a few rows) are not lean-split; they arrive in the first request.

## Technical constraints

- Shared hosting: the firewall counts per IP; the pass uses the browser-wide pacer and adds no poll (`.agents/specs/2284-traffic-budget/spec.md`).
- PHP memory limit 128 MB: a page must stay well below it with 50 KB notes (measured case: 1000 notes of 20 KB ran out of memory).
- The server cap `MAX_OBJECTS_IN_GET` (500 on main; 1000 in PR #2340) is respected by every page.
- App packages do not import each other; shared pieces go under `src/lib`.
- OpenAPI/JMAP contract: `preview` is a new `Note` property; update `packages/api/docs` and the API done gate.
