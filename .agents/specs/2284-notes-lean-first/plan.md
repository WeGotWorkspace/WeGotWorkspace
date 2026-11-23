# Notes lean-first first download

## Goal

A new device lists its notes after a few small requests (title, notebook, tags, dates, a server-made preview), then downloads the bodies as paced background work. A note without its body is read-only and is never edited or saved from its partial copy. Same approach as Contacts (PR #2340), written from the Notes code. See [spec.md](./spec.md).

## Budget

Draws from the per-IP request allowance (60/min on the reference shared host) and from PHP memory (128 MB). Displaces: the one-request-per-notebook full download, whose biggest response is every body of a notebook at once. The number of requests for the same data rises a little (a lean page plus detail pages) but each is small and paced.

## Non-goals

- Calendar events (follow-up spec after this one is measured), Tasks, Docs.
- A device with a complete copy (it keeps whole-note refreshes).
- Moving the body out of the Yjs document.

## What exists

- First download is REST, one unpaged call per notebook with bodies. `path: packages/apps/src/lib/api/wgw/notes-vjournal.ts:397`
- `Note/get` supports `properties`, but projects after building and holding whole records. `path: packages/api/app/Services/Jmap/Methods/NoteGetMethod.php:42`
- A body-less property list exists. `path: packages/apps/src/lib/jmap-client/adapter/JmapNotesAdapter.ts:11`
- `fetchAllByQuery` takes `properties` and `maxIdsPerGet`. `path: packages/apps/src/lib/jmap-client/core/fetch-all.ts:19`
- The list excerpt and untitled-row title come from the body. `path: packages/apps/src/lib/api/wgw/notes-vjournal.ts:355`
- The editor seeds its Yjs room from the cached body. `path: packages/apps/src/notes-core/src/notes-workspace.tsx:377`
- The outbox never carries the body. `path: packages/apps/src/lib/offline/notes/notes-offline-store.ts:59`
- The paged `maxObjectsInGet` helper that PR #2340 extends with `GENERAL_GET_PAGE_CAP`. `path: packages/apps/src/lib/jmap-client/core/get-chunks.ts:1`

## Considered

The contacts version this copies is open PR #2340 (`contacts-detail-pass.ts`, the partial marker in `contacts-offline-store.ts`). Considered: row-level `bodyPending` flag on the Dexie row — the flag is atomic with the row write, but a resumable ordered list needs a scan; chosen the contacts-style marker in `meta` for one pattern across apps, written in the same transaction as the row. Considered: skip the body in Dexie and let the room supply it — rejected: offline read and the list preview would depend on a room that does not exist offline. Considered: client-computed preview from a partial body — rejected: there is no body in the lean pass. Considered: lean pass over the REST list with a `lean=1` flag — rejected: REST has no paging; JMAP query + get already pages.

## Affected packages

- packages/api — `NoteGetMethod`, `NoteRepository`, `NoteJournalConverter`, JMAP docs.
- packages/apps — `jmap-client/notes`, `lib/offline/notes`, `lib/api/wgw/notes*`, `notes-core`.
- docs — measurement results.

## Dependencies

1. N1 (server: `preview`, per-record projection) first.
2. N2 (client lean pass, marker) after N1.
3. N3 (partial-note rule, UI states) after N2; must land with N2 in one release (see Invariants).
4. N4 (detail pass) after N2 and N3.
5. N5 (measurement) last. N2–N4 may ship behind a device default of "lean off" until N3 is in.

PR #2340 (contacts) should merge first so N2 and N4 reuse its marker, pass and page-cap code instead of copying it.

## Open decisions

- [ ] N3: which metadata actions stay allowed on a partial note (spec default: star, archive, move, tags allowed; editor, title, export, duplicate, print blocked). Wouter decides.
- [ ] N2: page size for the lean pass (500 or the server cap). Set by the N5 measurement.
- [ ] N4: detail page size (starting at 100 ids). Set by the N5 measurement.
- [ ] Lean pass on first sign-in always, or only above a size (for example more than 200 notes)? Default: always; small accounts finish in one extra request.

## Invariants

- A partial note never opens an editor, a collab room or `initialMarkdown`. A wrong change can save an empty body over a real one. Proof: `path: packages/apps/src/notes-core/src/use-notes-controller-partial.test.tsx` assertion "never opens a room for a partial note".
- A device with a complete copy never receives or stores lean notes. A wrong change turns a complete cache partial. Proof: `path: packages/apps/src/lib/offline/notes/notes-lean-first.test.ts` assertion "a complete copy refreshes with whole notes".
- The marker lists a note exactly while its body is missing. A wrong change leaves a note read-only forever or editable too early. Proof: `path: packages/apps/src/lib/offline/notes/notes-lean-first.test.ts` assertion "a body from any source clears the marker id in the same write".
- N2 without N3 must not reach users: a lean pass before the rule exists lets the editor open an empty note. Proof: lean pass is off unless N3's guard is present (`cmd: pnpm --dir packages/apps exec vitest run src/notes-core src/lib/offline/notes`).
- After each chunk main still works without the next one. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/jmap-client src/lib/offline/notes src/notes-core`.

## Chunks

### Chunk N1: notes-lean-server
- **Skill:** api, security
- **Inputs:** `NoteGetMethod.php:42` (collects whole records, projects at the end); `NoteJournalConverter.php:211` (`fromIcs`, body and `updatedAt`); `NoteMarkdownCodec.php:100` (`listPreview`); `HandlesGetArguments.php` (`projectProperties`).
- **Done when:**
  - `Note` has a `preview` property (plain text, at most 180 characters, same rule as the client excerpt, empty when the note has neither text nor title).
  - `Note/get` projects each record as it is built and drops `body` at once when `body` is not requested, so a page of lean notes holds no bodies.
  - `Note/get` with `properties: ["body"]` returns `id` and `body` only.
  - The JMAP documentation and OpenAPI/contract text list `preview`.
  - A test with notes of 20–50 KB shows PHP peak memory for a lean page of 500 stays well under the body page (numbers in the PR).
  - The per-id queries are counted: if `show()` costs more than a few queries per id, a batched read for the page is added (one query for the ids, one for stars) or filed as a follow-up with the numbers.
- **Verify with:** `php scripts/done-gate.php`; `vendor/bin/phpunit` for the Note get and projection tests (new `NoteProjectedGetTest.php`, shaped like `ContactCardProjectedGetTest.php` of PR #2340)
- **Parallel with:** none

### Chunk N2: notes-lean-pass
- **Skill:** workspace, testing
- **Inputs:** `JmapNotesClient.ts:67`; `fetch-all.ts:19`; `notes-vjournal.ts:397`; `notes-offline-store.ts`; `notes-jmap-inbound.ts:28`; the contacts marker in `contacts-offline-store.ts` (PR #2340).
- **Done when:**
  - A device with no Notes copy loads notebooks, then `Note/query` (ids) and `Note/get` with `NOTE_METADATA_PROPERTIES` plus `preview`, in pages. `preview` becomes the note's `excerpt`; `body` is empty; the note id goes in the partial marker (new `meta` key, pass id plus ids, saved in the same transaction as the rows).
  - Sync state is recorded from the lean gets so the first `Note/changes` works from the lean download.
  - A device with a complete copy still refreshes whole; the marker is never written for it.
  - The list renders from the lean rows; selecting the Notes app on a cold device shows the list after the lean pass.
  - Requests: one `Note/query` per 5000 ids plus `ceil(notes / lean page)` gets for the whole account, independent of notebook count.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/jmap-client src/lib/offline/notes` (new `notes-lean-first.test.ts`, shaped like `contacts-lean-first.test.ts`)
- **Parallel with:** N1 (client against a mock server) but merges after it

### Chunk N3: notes-partial-rule
- **Skill:** workspace, apps-ui, testing
- **Inputs:** `notes-workspace.tsx:377` (`initialMarkdown`); `use-note-body-collab.ts` (room); `notes-pending-bodies.ts`; `notes-list-preview-enrich.ts`; `use-notes-batch-actions.tsx`, `use-notes-mutations.tsx`, `notes-markdown-import*` and export paths; `use-notes-controller.tsx` (edit rights).
- **Done when:**
  - `requireFullNote` throws for a partial note and is called by every path that edits, saves, exports, duplicates, prints or re-sends a note or its body (list found by searching for readers of `note.body` and the room hooks; each has a test).
  - Selecting a partial note online fetches that one note full at user priority (no pace slot), writes it and clears its marker id, then opens the editor. A failed fetch shows a read-only error with retry.
  - Offline, a partial note shows a read-only state with title, tags, preview and the "not downloaded yet" line; no room, no editor, no `initialMarkdown`. The same state replaces the empty body for archived and read-only notes.
  - `enrichNotesListPreviewsFromCollabOffline` and `uploadPendingNoteBodies` skip marker ids.
  - Metadata patches follow open decision 1.
  - Two tabs: a body written in tab A clears the partial state in tab B through the cache-changed message.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/notes-core src/lib/offline/notes` (new `use-notes-controller-partial.test.tsx`); live spec `notes-offline-read-only.spec.ts`
- **Parallel with:** none (after N2; ships with it)

### Chunk N4: notes-detail-pass
- **Skill:** workspace, testing
- **Inputs:** the contacts detail pass (PR #2340: `contacts-detail-pass.ts`); `background-sync-pacer.ts:140`; the Web Lock helper used there.
- **Done when:**
  - A second pass (`bulk` priority) fetches `body` for the marker ids, newest content first, in detail pages, saving each page with its marker update in one transaction and notifying other tabs; it recomputes `excerpt` and `wordCount` from the body.
  - One tab per browser runs it (Web Lock `wgw.notes.detailPass/<username>`); it stops cleanly on reload or network loss and resumes from the marker; a newer download supersedes it.
  - A note opened or changed live meanwhile leaves the marker without a second fetch.
  - Notes missing on the server (`notFound`) leave the marker and the cache unless the outbox owns them.
  - While the pass runs the browser stays inside the per-minute budget with Contacts and Notes passes both active (harness).
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline/notes src/lib/offline/core`; live specs `notes-first-download.spec.ts`, `notes-detail-pass.spec.ts` (new, shaped like the contacts ones)
- **Parallel with:** none (after N3)

### Chunk N5: notes-measure
- **Skill:** testing, document
- **Inputs:** the traffic harness (`packages/apps/e2e/traffic-budget.spec.ts`, `helpers/traffic-meter.ts`).
- **Done when:** results are written to `docs/realtime-capacity.md` or a note next to this spec, one run per case, before (today's REST bootstrap) and after:
  - Dataset: about 2000 notes including about 500 of 20–50 KB; cold browser, no cache, nothing else open.
  - Per run: time until the list is usable; time until every body is offline; requests per minute for minutes 1, 2 and 3; peak requests in any 10 s; PHP peak memory and server time per request (lean page, detail page, query).
  - Variants: lean page 500 versus the server cap; detail page 50, 100, 200; with Contacts' passes running at the same time.
  - The two open page-size decisions are closed with the numbers.
- **Verify with:** `WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs`; PHP peak from the API test or a server log line
- **Parallel with:** none (last)

## Visible UI changes (for Wouter to review, not decided here)

1. A partial note's detail pane: loading state (online), read-only "not downloaded yet" state (offline), error with retry.
2. List rows of partial notes show the server preview; no word count until the body is in.
3. List search finds titles, tags and previews only until the detail pass is done (to confirm in the build).
4. Whether a small, calm "Downloading your notes" indicator is shown at all (default: none).
5. Which actions stay allowed on a partial note (open decision 1).
