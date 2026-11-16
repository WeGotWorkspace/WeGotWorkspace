# Live co-editing of a task's title and description

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `e7b06aec` (2026-11-16), the same commit as spec.md. In What exists and Inputs, API paths are relative to `packages/api/`, app paths to `packages/apps/src/`, and `docs/` paths to the repository root. Invariant proofs use repository-root paths.

## Goal

People who open the same task type in its title and notes together, with remote carets, on the Notes collab stack. The VTODO stays the document of record; the server keeps the last saved Yjs state only as a merge base. Edits from native clients, MCP and plain REST merge into an open room without a prompt, offline edits merge on reconnect, metadata writes keep landing while people type, and the activity log keeps one entry per field per editing session.

## Budget

- **Draws from:** the Tasks slice of the Pioneer programme, next to #2172 (assignees) and #2173 (threads), which this Epic extends.
- **Displaces:** Decision 15 "Tier 2 (optional)" of `docs/architecture/tasks.md` becomes a decided feature. No other planned Tasks work moves; chunk E is a small rule change inside #2173's activity writer rather than new work there.

## Non-goals

See spec.md, Non-goals.

## What exists

**Notes collab, reused as the model**

- The title of a collab document is a `Y.Text` under the key `note-title`; reading does not create it, and a write diffs by common prefix and suffix. `path: text-editor-core/docs-collab/docs-collab-document-title.ts:10`, `path: text-editor-core/docs-collab/docs-collab-document-title.ts:69`
- Seeding is deterministic: a throwaway document whose client id is a hash of format and content, so two clients seeding the same text merge as a no-op. The seed mounts a TipTap `Editor`. `path: text-editor-core/docs-collab/docs-collab-seed.ts:19`, `path: text-editor-core/docs-collab/docs-collab-editor-surface.tsx:32`, `path: text-editor-core/docs-collab/docs-collab-editor-surface.tsx:41`
- The content formats are `html`, `markdown` and `text`, all of them TipTap content in an `XmlFragment`; there is no plain `Y.Text` body shape. `path: text-editor-core/src/text-editor-content.ts:7`, `path: text-editor-core/docs-collab/docs-collab-types.ts:75`
- Outside writes: `decideExternalWrite` returns `adopt`, `rebuild` or `prompt`; the join path prompts when local work is pending. The rebuild is deterministic over the server state vector. `path: text-editor-core/docs-collab/docs-collab-external-write.ts:37`, `path: text-editor-core/docs-collab/docs-collab-external-write.ts:59`, `path: text-editor-core/docs-collab/use-docs-collab-join.ts:238`
- The shared save sends a framed body (document, Yjs, optional title) with a state precondition and the outside-write header; on `409`/`412`/`428` it reloads, merges and saves once more. `path: text-editor-core/docs-collab/docs-collab-server-io.ts:134`, `path: text-editor-core/docs-collab/docs-collab-server-io.ts:145`, `path: text-editor-core/docs-collab/docs-collab-save-attempt.ts:41`
- Save cadence: 2 s after the last edit, at most 3 s after the first; only a client with its own unsaved edit saves. `path: text-editor-core/docs-collab/docs-collab-save-queue.ts:1`, `path: text-editor-core/docs-collab/docs-collab-save-queue.ts:7`, `path: text-editor-core/docs-collab/use-docs-collab-save.ts:256`
- A reader's remote update is dropped before it touches the document. `path: text-editor-core/docs-collab/docs-collab-update-guard.ts:1`
- "Empty" is decided by `isYDocEmpty`, which reads (and so creates) the `default` fragment; a document with only `Y.Text` roots always looks empty to it. `path: text-editor-core/docs-collab/docs-collab-utils.ts:156`
- The Notes title binds a textarea to the `Y.Text` through `NoteCollabYDocProvider` and `useNoteTitleField`, with remote carets from awareness (`noteTitleSelection`) drawn by a textarea mirror that wraps over lines. `path: note-detail-view/src/use-note-title-field.tsx:26`, `path: note-detail-view/src/use-note-title-field.tsx:83`, `path: text-editor-core/docs-collab/docs-collab-title-selection.ts:9`, `path: note-detail-view/src/note-title-caret-geometry.ts:48`, `path: note-detail-view/src/use-note-title-carets.ts:24`
- `useNoteBodyCollab` builds the room URLs per note (live API only), marks the room as held for push, and turns a persist `403` into `accessLost`. `path: notes-core/src/use-note-body-collab.ts:52`, `path: notes-core/src/note-collab-path.ts:15`, `path: notes-core/src/note-collab-path.ts:38`, `path: notes-core/src/note-body-rooms.ts:9`
- Push: "Collab rooms lead" keeps a tab with an open room from refetching that item's body; Tasks syncs on `Task` and `TaskList` state. `path: docs/architecture/jmap-push.md:203`, `path: docs/architecture/jmap-push.md:213`

**Notes collab on the server**

- `PUT /notes/items/{uid}` is the collaborative save. `path: routes/api.php:311`
- `NoteCollaborativeWrite::put` checks the state precondition, refuses an unseen outside write with `409 external_write`, merges `body` and `title` into the ICS, and stores the state in the same transaction. `path: app/Services/Notes/NoteCollaborativeWrite.php:37`, `path: app/Services/Notes/NoteCollaborativeWrite.php:106`, `path: app/Services/Notes/NoteCollaborativeWrite.php:126`, `path: app/Services/Notes/NoteCollaborativeWrite.php:142`
- `NoteYjsProjection` keeps the object ETag and a content hash next to the state; an outside write is "ETag moved and content hash differs". `path: app/Services/Notes/NoteYjsProjection.php:23`, `path: app/Services/Notes/NoteYjsProjection.php:47`, `path: app/Services/Notes/NoteYjsProjection.php:79`
- `note_yjs_state` is unique per `calendar_object_id` with a cascading FK, and its `state` column is widened to `MEDIUMBLOB` on MySQL. `path: database/migrations/wgw/2026_10_15_000620_wgw_create_note_yjs_state.php:34`, `path: database/migrations/wgw/2026_10_15_000620_wgw_create_note_yjs_state.php:36`, `path: database/migrations/wgw/2026_10_15_000620_wgw_create_note_yjs_state.php:67`
- The Notes write locks the object row (`lockForUpdate`) inside one `wgw` transaction before it reads the ICS, and writes the object and the state row in that transaction. `path: app/Services/Notes/NoteCollaborativeWrite.php:53`
- The Notes metadata `PATCH` also locks the object row and checks `If-Match` on the locked row. `path: app/Services/Notes/NoteRepository.php:203`
- `rewriteOwnedTask` checks the task `If-Match` on its unlocked read. `path: app/Services/Tasks/TaskRepository.php:293`
- The header name is shared. `path: app/Services/Collab/CollabExternalWrite.php:13`

**Room join**

- `CollabJoinAuthorizer` knows two room shapes: a slash means a Drive path, anything else a note UID; access is `write` unless the notebook instance is read-only. `path: app/Services/Collab/CollabJoinAuthorizer.php:38`, `path: app/Services/Collab/CollabJoinAuthorizer.php:55`
- Signaling re-checks access on every poll and narrows the ticket on a downgrade; a room holds at most 20 peers. `path: app/Services/Collab/DocCollabSignalingService.php:263`, `path: app/Services/Collab/DocCollabSignalingService.php:280`, `path: app/Services/Collab/DocCollabSignalingService.php:27`

**Tasks today**

- A task id is the object URI (or `uri#uid` for multi-VTODO files), resolved by URI across every reachable principal, so the URI alone is not unique across lists. `path: app/Services/Tasks/TaskRepository.php:626`, `path: app/Services/Tasks/TaskRepository.php:636`, `path: docs/architecture/tasks.md:133`
- All REST task writes share `rewriteOwnedTask`: list write check, object precondition, ICS rewrite, re-index. It takes **no** lock and opens no transaction for an in-place update: it reads the ICS through `findOwnedTask`, builds the new ICS from that read and writes it. A move creates the object in the target calendar and deletes the source, so the row id changes. `path: app/Services/Tasks/TaskRepository.php:277`, `path: app/Services/Tasks/TaskRepository.php:292`, `path: app/Services/Tasks/TaskRepository.php:318`, `path: app/Services/Tasks/TaskRepository.php:321`
- UIDs the server mints for tasks are `urn:uuid:…`, so a UID holds colons. `path: app/Services/Tasks/TaskRepository.php:507`
- `title` is 1 to 4 096 characters, `description` up to 8 192. `path: app/Http/Requests/Api/V1/TaskPatchRequest.php:42`, `path: app/Http/Requests/Api/V1/TaskPatchRequest.php:43`
- `PUT /tasks/items/{taskId}` is already the full-task update, so the collab save needs its own path. `path: routes/api.php:285`, `path: routes/api.php:287`
- The detail view reuses `NoteDetailView`; the title goes through `onTitleChange` and the description is a plain `TextareaAutosize`, both saved after a 600 ms pause. `path: tasks-core/src/tasks-detail-view.tsx:21`, `path: tasks-core/src/tasks-detail-view.tsx:141`, `path: tasks-core/src/tasks-detail-view.tsx:147`, `path: tasks-core/src/tasks-detail-view.tsx:175`
- The autosave trims title and description, keeps the stored title when the field is blank, and sends `If-Match`; any failure reverts and shows an error. `path: tasks-core/src/use-task-detail-autosave.ts:13`, `path: tasks-core/src/use-task-detail-autosave.ts:212`, `path: tasks-core/src/use-task-detail-autosave.ts:244`, `path: tasks-core/src/use-task-detail-autosave.ts:249`
- A newer copy of the open task is folded into the form per field group (#1858). `path: tasks-core/src/use-task-edit-form.ts:10`, `path: tasks-core/src/use-task-edit-form.ts:29`
- The outbox flush sends `If-Match` and turns every `412` into a conflict for the dialog, whose rows include title and description. `path: lib/offline/tasks/tasks-outbox-flush.ts:53`, `path: lib/offline/tasks/tasks-outbox-flush.ts:126`, `path: lib/offline/tasks/tasks-outbox-flush.ts:220`, `path: lib/offline/tasks/tasks-conflict-merge.ts:22`, `path: lib/offline/tasks/tasks-patch-merge.ts:32`
- Refused writes are parked for the rescue view with `parkTask`. `path: lib/offline/tasks/tasks-parked-writes.ts:16`, `path: lib/offline/tasks/tasks-refused-write.ts:111`
- Architecture today: Decision 15 keeps Yjs for tasks as "optional", Decision 2 makes Reminders a supported client, Decision 14 is the Contacts-style outbox. `path: docs/architecture/tasks.md:197`, `path: docs/architecture/tasks.md:42`, `path: docs/architecture/tasks.md:178`

**Pending specs this builds on** (not on main)

- #2172 adds `TaskChangeSet`, computed in `TaskRepository` for every REST and MCP write and by a CalDAV observer. A write through `rewriteOwnedTask` therefore produces a change set with no extra code. See [PR #2175](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2175), `.agents/specs/2172-task-assignees/spec.md` ("Change set").
- #2173 turns the change set into activity entries and merges quick edits only into the newest entry, by the same actor, same field, under 10 minutes. See [PR #2178](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2178), `.agents/specs/2173-task-threads/spec.md` ("Activity entries (chunk F)").

**A doc that says otherwise**

- `notes.md` Decision 7 "Title UX" said the title is saved by REST `PATCH` without a room. The code co-edits it in the room and the collab `PUT` writes `SUMMARY` (`docs-collab-server-io.ts:145`, `NoteCollaborativeWrite.php:82`). Corrected in this PR. `path: docs/architecture/notes.md:115`

## Considered

Considered: the Notes collab stack (`useDocsCollab`, `NoteYjsProjection`, the title binding and carets) — **chosen** and extended with a text-fields document shape; a second, task-only Yjs stack was rejected because the Epic forbids it and it would duplicate signaling, save and tab sync.

- **TipTap with a plain-text schema for the description** — rejected. It brings an `XmlFragment` that must be converted to and from plain text on every save and diff, and TipTap's paste and keyboard handling would invite formatting the product decided against. A `Y.Text` bound to a textarea is the exact shape of the data, and the Notes title already proves the binding and the multi-line carets.
- **No stored Yjs state; seed every room from the ICS** (the starting proposal) — rejected after reading the merge path. Without a state that every client shares, two clients cannot produce the same Yjs update for one outside change: their documents carry different item ids. Then either one client must be elected to apply it (a race when it leaves) or every client applies it and the text doubles. The stored state is the common base that makes the outside diff deterministic, and Notes already stores one per note for the same reason.
- **Locking only the text `PUT`** (the second draft) — rejected in review. A `PATCH` that passed `If-Match` on its unlocked read would wait out the text `PUT`'s lock and then write its stale ICS, reverting the saved text with no `412`. Every task object write takes the same row lock and checks `If-Match` on the locked row, as `NoteRepository::patch` does for notes.
- **Restoring a blanked title through the chain at the next save** (the second draft) — rejected in review: someone who clears the title, pauses, and types a new one would get the old title interleaved with the new. The save is held while the title is blank instead.
- **One outside diff from the stored state per outside write** (the first draft of this spec) — rejected in review. Two native writes before the next save would each diff from the stored text with their own client id: a peer that applied both inserts the first change twice, and a peer that missed the first is left with a different text. The server-kept **outside chain** lets every client replay all outside texts in order on the same base, so the updates stay deterministic.
- **A leader peer that alone applies outside writes** — rejected: when it leaves or goes offline mid-merge the others have no safe way to know whether it applied the change, and a tab with no peers still needs to merge.
- **Notes' outside-write prompt** (`decideExternalWrite` → `prompt`) — rejected for Tasks. Native VTODO clients write `SUMMARY` and `DESCRIPTION` all the time, so the prompt would appear in normal use. The deterministic diff merges instead; the rare cost is interleaved text when two writers change the same characters.
- **A server-side "metadata ETag" for status and other field patches** — rejected. It adds a second ETag to the task contract and every client. A client-side retry when the patched fields did not change on the server needs no API change and also removes today's needless conflicts between people editing different fields.
- **The task id (object URI) as room key** — rejected: URIs are chosen by clients and not unique across lists, so a former viewer could join a room by recreating the URI in their own list. `calendarid` + UID, issued by the server, is unique and the same for every sharee.
- **Keeping title and description in the task outbox next to the room** — rejected: two write paths for one field would race, and the outbox's whole-field `412` would undo the merge.
- **#2173's same-actor merge unchanged** — rejected: with two people typing in turn every save would start a new entry.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

1. Chunks A, B and D can start at once.
2. Chunk C needs A (the endpoints and room authorization) and B (the session shape and the field binding).
3. Chunk E needs #2173's chunk F (the activity writer) on main. Until then, E is a change to #2173's spec and lands with that chunk instead.
4. Chunk F (architecture docs) goes with C.
5. Chunk V runs after A–D (and E when it is in).

## Open decisions

None — every choice for this work is made. Product questions raised during review are listed in the PR, not here.

## Invariants

- Notes keeps its outside-write prompt; only the text-fields shape never prompts. A wrong change to `decideExternalWrite` would silently overwrite a Notes user's unsaved text. Proof: `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-external-write.test.ts` assertion `asks the person when local work would otherwise be overwritten`.
- A Notes collab save still refuses an unseen outside write. Sharing the projection with tasks must not loosen it. Proof: `path: packages/api/tests/Feature/Notes/NotesCollabExternalWriteTest.php`.
- Note rooms and Drive rooms authorize as before after the `task:` shape is added. A wrong prefix order would send a note or Drive path to the task branch, or a task UID with a slash to the Drive branch. Proof: `path: packages/api/tests/Feature/Collab/CollabJoinAuthorizationTest.php` assertions `test_join_denied_for_other_users_note_room_without_notebook_share` and `test_join_denied_for_room_matching_neither_known_form`.
- A task `PATCH` with `title` or `description` from REST, MCP or a native client keeps working and keeps its ETag precondition. Proof: `path: packages/api/tests/Feature/Tasks/TaskInPlaceUpdateTest.php`, `path: packages/api/tests/Feature/Mcp/McpTasksToolsTest.php`.
- Without the live API (mock, Storybook) the detail view saves title and description through the 600 ms autosave as today. Proof: `path: packages/apps/src/tasks-core/src/tasks-detail-view.test.tsx`.
- A real conflict still reaches the conflict dialog: a `412` where the server changed a patched field is not retried. Proof: `path: packages/apps/src/lib/offline/tasks/tasks-outbox-flush.test.ts` assertion on `etagMismatches` equal to `[task.id]`.
- After chunk A alone, main works: the endpoints exist and nothing calls them. Proof: `cmd: cd packages/api && composer done-gate`.
- After chunk B alone, Notes and Docs behave as before, because the new shape is opt-in. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab src/note-detail-view`.
- After chunk D alone, the outbox and autosave only retry more often; nothing else changes. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/tasks src/tasks-core`.

## Chunks

### Chunk A: Task text resource, stored state and room authorization

- **id:** `chunk-a-api-task-text`
- **Skill:** api, security
- **Inputs:** the Notes write and projection to mirror — `path: app/Services/Notes/NoteCollaborativeWrite.php:37`, `path: app/Services/Notes/NoteYjsProjection.php:47`; the shared task write path — `path: app/Services/Tasks/TaskRepository.php:249`; the join authorizer — `path: app/Services/Collab/CollabJoinAuthorizer.php:38`; the routes — `path: routes/api.php:287`
- **Done when:**
  - Migration and model `task_yjs_state` as in spec.md (Stored state), FK cascade, unique `(calendar_object_id, vtodo_uid)`.
  - `GET …/text`, `GET …/text?format=yjs` and `PUT …/text` behave as in spec.md (API), including `204` with no state, `428`, `412`, `409 external_write`, `413 state_too_large`, `422` over the field limits, `403` on a read-only list, `404` for a task the caller cannot see.
  - Every task object write (`rewriteOwnedTask` for `PATCH`, `PUT`, MCP and move; the text `PUT`; chain appends from the CalDAV hook and the `?format=yjs` repair) runs in one `wgw` transaction with `lockForUpdate()` on the object row and then the state row, re-reads both, and checks `If-Match` on the locked row. Tests (drive each race with a test hook between the unlocked lookup and the write):
    - a status `PATCH` whose read happens before a text `PUT` takes the lock and whose write runs after the `PUT` commits gets `412`, the saved text is still there, and a follow-up `PATCH` with the new ETag stores the status beside it;
    - a status `PATCH` that commits before the text `PUT` takes the lock survives the text `PUT`;
    - a CalDAV `PUT` that committed before a text `PUT`, with its hook not yet run, makes the text `PUT` append that text and answer `409`; the hook then appends nothing;
    - a `?format=yjs` read that started before a text `PUT` commits leaves no pre-`PUT` link afterwards;
    - two CalDAV `PUT`s whose hooks run in order leave both links in order, each hook appending the text of its own request body; when the hooks run only after both commits, nothing is doubled and the next locked `?format=yjs` read leaves the chain ending on the object's text;
    - a CalDAV `PUT` that commits after `GET …/text` and before an `If-None-Match: *` text `PUT` makes that `PUT` answer `409`, and the native text stays;
    - a text `PUT` leaves an empty chain (its own write adds no link);
    - a `TaskStatusChangedNotifyTest`-style test and, once #2172 is in, a change-set test see the text `PUT` as a normal write.
  - `task_yjs_state.state` is `MEDIUMBLOB` on MySQL; `vtodo_uid` is the component's real UID also for single-VTODO files (test: a native client adds a second VTODO to the file and the first task's state row is still found).
  - The outside chain: REST, MCP and CalDAV text writes append a link while a state row exists; a text `PUT` clears it and must name the last link (`409` otherwise); the chain is capped at 20 links (the row is dropped beyond that); a blank title in the `PUT` gets `422 title_required`.
  - `CollabJoinAuthorizer` resolves `task:<calendarid>:<uid>` before the slash test, parsing a decimal `calendarid` and the whole remainder as the UID (test with a `urn:uuid:` UID and a UID with a slash); access `write` / `read` from the instance; `403` for an unknown object, a hidden or dismissed share, a malformed key, or a URI-collision attempt (a task with the same URI in the attacker's own list).
  - OpenAPI updated; `TasksAccessControlTest` gains the three routes.
- **Verify with:** `cd packages/api && composer done-gate` (or `php scripts/done-gate.php` when the local run hits the 900 s limit)
- **Parallel with:** `chunk-b-collab-text-fields`, `chunk-d-disjoint-retry`

### Chunk B: Text-fields session shape and the generic text binding

- **id:** `chunk-b-collab-text-fields`
- **Skill:** workspace, apps-ui
- **Inputs:** seed — `path: text-editor-core/docs-collab/docs-collab-editor-surface.tsx:32`; outside write — `path: text-editor-core/docs-collab/docs-collab-external-write.ts:59`; join merge — `path: text-editor-core/docs-collab/use-docs-collab-join.ts:238`; save body — `path: text-editor-core/docs-collab/docs-collab-server-io.ts:134`; title binding and carets — `path: note-detail-view/src/use-note-title-field.tsx:83`, `path: note-detail-view/src/use-note-title-carets.ts:24`; collab hook split rules — [workspace/collab-hooks.md](../../skills/workspace/collab-hooks.md)
- **Done when:**
  - Pure lib, Vitest on exports: `plainTextOps`, the plain seed (byte-identical for equal text), `mergeOutsideChain` (two documents applying it converge and hold the outside text once; local typing after the base survives), the rebase (same root, other root, no state), and line-end normalisation.
  - `mergeOutsideChain` with two links, in both orders of arrival (a peer that saw link 1 before link 2 arrived, and a peer that only ever saw the chain of two), for an insert ("Buy milk" → "Buy oat milk", then a notes-only change) and a delete that is undone ("Buy milk" → "Buy" → "Buy milk"): every peer ends on exactly the last link's text plus its typing.
  - Blank title: the save is held while `note-title` is blank. `restoreBlankTitle` starts from a document whose title was deleted after the stored state: after one apply the title is exactly `SUMMARY`; applying the same bytes from a second document leaves it once; the save after the restore carries the held description; a second restore with the same ids falls back to the deterministic `"\0again"` update, and two documents that both reach it leave the title once. The same three checks start from a seeded document with **no stored state** whose title was deleted: the title becomes the loaded `SUMMARY`, a second document's identical bytes leave it once, and the first save (`If-None-Match: *`, the `GET …/text` ETag in `X-Wgw-External-Write`) carries the description typed while the title was blank.
  - Rebase after an applied link: a document that applied one link (`a` → `ab`), then typed (`ab!`), and is rebased because the server has no state, ends on `ab!`; the link's text appears once.
  - An open room that is told of an outside write reads `GET …/text` and `?format=yjs` together and replays `outsideChain`; a peer that already applied link 1 of a two-link chain does not insert it again.
  - The text-fields emptiness test: a document restored from IndexedDB that already holds `note-title` and `plain-body` is not seeded again, on reopen offline and on join, and no `default` fragment appears in `doc.share`.
  - `DocsCollabUrls.documentShape: "text-fields"` routes seed, save and outside writes to that lib and never prompts; without it nothing changes for Docs or Notes.
  - The title field hook and carets take a `Y.Text` key and an awareness field; Notes passes `note-title` and `noteTitleSelection` and its tests stay green unchanged.
  - The update guard admits writes to `note-title` and `plain-body` from a writer and drops them from a reader.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab src/note-detail-view`
- **Parallel with:** `chunk-a-api-task-text`, `chunk-d-disjoint-retry`

### Chunk C: Tasks detail view in the room

- **id:** `chunk-c-tasks-room`
- **Skill:** workspace, apps-ui
- **Inputs:** the detail view — `path: tasks-core/src/tasks-detail-view.tsx:141`; the autosave — `path: tasks-core/src/use-task-detail-autosave.ts:212`; the form rebase — `path: tasks-core/src/use-task-edit-form.ts:29`; the Notes room hook to mirror — `path: notes-core/src/use-note-body-collab.ts:52`; parking — `path: lib/offline/tasks/tasks-parked-writes.ts:16`
- **Done when:**
  - `useTaskTextCollab` opens one room per open task with a server id (live API only), using the room key from `GET …/text`; `holdTaskTextRoom` marks it for push.
  - Title and description bind to `note-title` and `plain-body` with carets; `maxLength` 4 096 / 8 192; the over-limit hint holds the save.
  - Title and description leave `taskEditPatch` and the form's field groups while a room is open; the other fields keep the 600 ms autosave.
  - A task push with a changed text triggers `mergeServerState`; the list row shows the projected title.
  - Read-only: fields read-only, carets shown, none published. Access lost (`403`, `404`, or signaling `403`) with unsaved text: leave the room, show the message from spec.md, park the task.
  - A task whose create is still queued opens without a room.
  - Storybook: a mock-tier story with two simulated peers' carets on the description, and a read-only story.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/tasks-core src/lib/offline/tasks`, then the apps done gate
- **Parallel with:** `chunk-d-disjoint-retry` (after A and B are merged)

### Chunk D: Retry a `412` on fields the server did not change

- **id:** `chunk-d-disjoint-retry`
- **Skill:** workspace
- **Inputs:** autosave `If-Match` and error path — `path: tasks-core/src/use-task-detail-autosave.ts:244`; outbox flush — `path: lib/offline/tasks/tasks-outbox-flush.ts:126`, `path: lib/offline/tasks/tasks-outbox-flush.ts:220`; coalescing — `path: lib/offline/tasks/tasks-patch-merge.ts:32`
- **Done when:**
  - Outbox rows carry a `base` map of the patched fields' previous values; `coalesceTaskPatches` keeps the first base per field.
  - On `412`, the autosave and the flush fetch the task once; when no patched field differs from its base on the server, the same patch is sent again with the server's ETag; otherwise today's conflict or error path runs.
  - Rows without `base` behave as today.
  - Vitest: a status patch after a text-only server change lands; a status patch after a server status change still reports the conflict; when the single retry also gets `412`, today's error path runs (no second retry).
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/offline/tasks src/tasks-core`
- **Parallel with:** `chunk-a-api-task-text`, `chunk-b-collab-text-fields`

### Chunk E: Cross-actor merge for title and description activity

- **id:** `chunk-e-activity-merge`
- **Skill:** api, workspace
- **Inputs:** #2173's activity writer and merge rule — [PR #2178](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2178), `.agents/specs/2173-task-threads/spec.md` ("Merging quick edits")
- **Done when:**
  - For `title` and `description`, the writer merges into the newest same-field activity entry younger than 10 minutes with no comment or reply after it, adding the actor to `actors`; other fields keep the same-actor rule.
  - The thread-ui formatter renders one, two and three-or-more actors.
  - PHPUnit: two actors saving alternately for 10 minutes leave one entry per field; a comment in between starts a new entry; a status change by either actor is its own entry. Vitest on the formatter.
- **Verify with:** `cd packages/api && composer done-gate`; `pnpm --dir packages/apps exec vitest run src/thread-ui`
- **Parallel with:** `chunk-c-tasks-room`

### Chunk F: Architecture docs

- **id:** `chunk-f-docs`
- **Skill:** document
- **Inputs:** `path: docs/architecture/tasks.md:197`, `path: docs/architecture/tasks.md:341`, `path: docs/architecture/jmap-push.md:203`
- **Done when:** `tasks.md` gets "Decision 17 — Live title and description" (the design as decided, linking this spec folder; it says in one line that, unlike Notes, the fields are read-only while the room loads instead of saving a title edit by `PATCH`), Decision 15 and the Tier 2 table point to it, the property-mapping `DESCRIPTION` note says "plain text, co-edited live"; `jmap-push.md` "Collab rooms lead" names Tasks.
- **Verify with:** `pnpm run check:agent-docs`
- **Parallel with:** `chunk-c-tasks-room`

### Chunk V: Cross-chunk verify and two-browser e2e

- **id:** `chunk-v-verify`
- **Skill:** testing
- **Inputs:** every chunk above; [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md)
- **Done when:**
  - A Playwright spec with two browser contexts (two users on a shared list) covers: typing in both fields shows on the other side with carets; concurrent typing in one sentence keeps both; an outside `PUT` over CalDAV (the Reminders fixture from `tests/fixtures/Interop/RealClients/`) while both type merges without a dialog; two quick outside `PUT`s (title, then notes, within 2 s) leave no doubled or lost text; blanking the title, waiting past the save debounce and typing a new title saves exactly the new title as `SUMMARY`; leaving a task with a blank title shows the stored title again in the other context; a status change during typing saves; one context offline edits the notes and reconnects; a read-only third user sees typing and cannot type; revoking the share mid-session shows the access message.
  - A second tab of the same user converges with the first.
  - Verifier `PASS` or `PASS_WITH_NITS` and the parent ran the [done-checklist](../../skills/developer/done-checklist.md).
- **Verify with:** the Playwright spec above, `pnpm test:apps-done-gate`, `composer done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature tests for `/text` (preconditions, outside write, limits, access, URI collision) → implement → `composer done-gate`
- [ ] Collab lib: Vitest on `plainTextOps`, plain seed, `mergeOutsideChain` convergence and idempotence (two links, both arrival orders), the text-fields emptiness test, rebase, line ends
- [ ] UI: mock-tier Storybook for carets and read-only; Vitest for `useTaskTextCollab` contracts (RTL), the form without title and description, and the disjoint-field retry
- [ ] Activity: PHPUnit for the cross-actor merge; Vitest for the formatter
- [ ] e2e: two browser contexts as in chunk V, plus a cold browser first visit (a fresh context with an empty IndexedDB)

## Doc updates (only if user wants)

- Chunk F covers the architecture docs. The `notes.md` Decision 7 correction is in this PR.
