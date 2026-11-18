# Live co-editing of a task's title and description

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `e7b06aec` (2026-11-16), the same commit as spec.md. In What exists and Inputs, API paths are relative to `packages/api/`, app paths to `packages/apps/src/`, and `docs/` paths to the repository root. Invariant proofs use repository-root paths.

## Goal

People who open the same task type in its title and notes together, with remote carets, on the collab stack Docs and Notes share, reused rather than rebuilt. The VTODO stays the document of record; the server keeps the last saved Yjs state beside it, through one live-text core that Notes and Tasks share. Edits from native clients, MCP and plain REST are handled exactly as in Docs and Notes (quiet rebuild, or one question when someone has unsaved typing), metadata writes keep landing while people type, and the activity log keeps one entry per field per editing session.

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
- The outside-write question is shared by Docs and Notes: `useDocsExternalWriteRequest` catches the join path's `prompt`, `useDocsExternalWritePrompt` holds saves and offers "keep mine" and "use the other version" through `resolveExternalWrite`. Notes renders it with `NoteExternalWriteDialog`. `path: text-editor-core/docs-collab/use-docs-external-write-prompt.ts:26`, `path: text-editor-core/docs-collab/use-docs-external-write-prompt.ts:64`, `path: text-editor-core/docs-collab/use-docs-collab.ts:114`, `path: note-detail-view/src/note-external-write-dialog.tsx:28`, `path: note-detail-view/src/note-text-editor-body.tsx:150`
- The session re-reads the server (`mergeServerState`) on join, on reconnect and after a refused save; there is no push-driven re-read yet. With no stored state (`204`) it returns before `decideExternalWrite`, and a quiet rebuild marks the document dirty, so a second outside edit before that save asks. `replaceDocumentWithExternalText` deletes only items up to the stored state's vector. `NoteCollaborativeWrite::assertNoUnseenExternalWrite` returns at once with no state row. `path: text-editor-core/docs-collab/use-docs-collab-join.ts:228`, `path: text-editor-core/docs-collab/use-docs-collab-join.ts:234`, `path: text-editor-core/docs-collab/use-docs-collab-join.ts:262`, `path: text-editor-core/docs-collab/use-docs-collab-reconnect.ts:148`, `path: text-editor-core/docs-collab/docs-collab-external-write.ts:59`, `path: app/Services/Notes/NoteCollaborativeWrite.php:131`
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

- `notes.md` Decision 7 "Title UX" said the title is saved by REST `PATCH` without a room. The code co-edits it in the room and the collab `PUT` writes `SUMMARY` (`docs-collab-server-io.ts:145`, `NoteCollaborativeWrite.php:82`). Its decision sentence said "Persist = `PATCH`" and "No server Yjs sidecar", while the collab save is `PUT` and stores `note_yjs_state`. Both corrected in this PR. `path: docs/architecture/notes.md:109`, `path: docs/architecture/notes.md:115`

## Considered

Considered: the collab stack Docs and Notes share (`useDocsCollab`, the join path with `decideExternalWrite`, the question hooks, the title binding and carets) — **chosen**, reused as is where it fits and generalised where it assumes TipTap or a note; a second, task-only Yjs stack was rejected because the Epic forbids it and it would duplicate signaling, save and tab sync.

- **A task-only "never ask" merge** (the earlier drafts: an outside chain on the server, every client replaying it as deterministic diffs, a three-way rebase, a deterministic blank-title restore) — rejected by the product owner on 2026-11-17. It took nine review rounds to close its races, it was code only Tasks would have, and Docs and Notes already answer the same question with shared code. The cost of the chosen way is one question in the rare case that someone has unsaved typing when an outside edit lands. (Before that, a first draft without a server-kept chain was rejected in review because two native writes before a save doubled or lost text.)
- **Task copies of `NoteCollaborativeWrite` and `NoteYjsProjection`** — rejected by the product owner (2026-11-17): the precondition, the outside-write guard, the content tag and the locked write are the same rules with other field names. One core in `Services/Collab` serves both apps; each app only says which fields an object holds. Notes moves onto it first, with no change in behaviour.
- **One state table for Notes and Tasks** — rejected: it needs a data migration of every stored Notes state and changes nothing anyone sees. The code is shared; the tables stay apart.
- **Moving Docs (`DocYjsStateStore`) and Docs' conflict dialog onto the same core and dialog now** — deferred: Docs keys a Drive path, not a CalDAV row, and has its own replace flow. A follow-up once two apps use the core.
- **A rebuild that counts as local work and must be saved** (Notes' rebuild, as is) — rejected in review (2026-11-17): a second outside edit before that save would ask a person who typed nothing. The text-fields replacement uses an origin that is not local work and sends no `PUT`; the VTODO already holds the text.
- **"The document differs from its server base" as the local-work test, with "everything the document held" as the delete limit** (the round-10 fix) — rejected in review: a peer's unsaved typing counted as this person's work, and a peer's save was re-seeded beside its own items. The shared own-edits flag stays the input, a stored state without the flag is adopted, and the delete limit is the stored state's vector plus `base.vector`, which covers only content the server wrote or a replacement seeded.
- **`base.vector` as the live document's vector** (the round-11 fix) — rejected in review: it covered a peer's unsaved typing that had already arrived, so the next replacement deleted it. It is now built from the applied snapshot, the applied delete limit and the new seed only.
- **The seed id inside `base`** (the round-12 fix) — rejected in review: an adopt or a landed save rewrote `base` from older server bytes and pointed the cleanup at a dead seed, emptying the fields. The seed id now has its own key that only seeds write.
- **Trusting one `base` value to remove the previous seed** — rejected in review: two rooms replacing at the same moment leave two seeds, and only one is named. Replacement seed ids are kept in `text-fields-seeds`, and every replica deletes the ones `base` does not name.
- **A seed id from the text alone for replacements** — rejected in review: text that returns to an earlier value would reuse items Yjs keeps deleted, and the field would stay blank. Replacements are salted with the object ETag.
- **Leaving no-state tasks as Notes does (a first save that is not checked)** — rejected in review: every task starts without a state row, so an idle room would never show a native edit and the first keystroke, minutes later, would overwrite it. The core's first-save check and the `204` branch of the re-read close that for tasks.
- **TipTap with a plain-text schema for the description** — rejected. It brings an `XmlFragment` that must be converted to and from plain text on every save, and TipTap's paste and keyboard handling would invite formatting the product decided against. A `Y.Text` bound to a textarea is the exact shape of the data, and the Notes title already proves the binding and the multi-line carets.
- **No stored Yjs state; seed every room from the ICS** — rejected: a later joiner could not continue the same document, and two seeds of different texts would double the text. Notes stores one per note for the same reason.
- **Locking only the text `PUT`** — rejected in review. A `PATCH` that passed `If-Match` on its unlocked read would wait out the text `PUT`'s lock and then write its stale ICS, reverting the saved text with no `412`. Every task object write takes the same row lock and checks `If-Match` on the locked row, as `NoteRepository::patch` does for notes.
- **A server-side "metadata ETag" for status and other field patches** — rejected. It adds a second ETag to the task contract and every client. A client-side retry when the patched fields did not change on the server needs no API change and also removes today's needless conflicts between people editing different fields.
- **The task id (object URI) as room key** — rejected: URIs are chosen by clients and not unique across lists, so a former viewer could join a room by recreating the URI in their own list. `calendarid` + UID, issued by the server, is unique and the same for every sharee.
- **Keeping title and description in the task outbox next to the room** — rejected: two write paths for one field would race, and the outbox's whole-field `412` would undo the merge.
- **#2173's same-actor merge unchanged** — rejected: with two people typing in turn every save would start a new entry.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

1. Chunks A0, B and D can start at once. Chunk A needs A0.
2. Chunk C needs A (the endpoints and room authorization) and B (the session shape and the field binding).
3. Chunk E needs #2173's chunk F (the activity writer) on main. Until then, E is a change to #2173's spec and lands with that chunk instead.
4. Chunk F (architecture docs) goes with C.
5. Chunk V runs after A0–D (and E when it is in).

## Open decisions

None — every choice for this work is made. Product questions raised during review are listed in the PR, not here.

## Invariants

- `decideExternalWrite` stays one function for every app: unsaved local work over an outside write is always a question, never a silent overwrite. Proof: `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-external-write.test.ts` assertion `asks the person when local work would otherwise be overwritten`.
- Moving the question dialog out of `note-detail-view` does not change what Notes shows. Proof: `path: packages/apps/src/note-detail-view/src/note-collab-prompts.test.tsx`.
- A Notes collab save still refuses an unseen outside write. Moving Notes onto the shared core must not loosen it. Proof: `path: packages/api/tests/Feature/Notes/NotesCollabExternalWriteTest.php`.
- Note rooms and Drive rooms authorize as before after the `task:` shape is added. A wrong prefix order would send a note or Drive path to the task branch, or a task UID with a slash to the Drive branch. Proof: `path: packages/api/tests/Feature/Collab/CollabJoinAuthorizationTest.php` assertions `test_join_denied_for_other_users_note_room_without_notebook_share` and `test_join_denied_for_room_matching_neither_known_form`.
- A task `PATCH` with `title` or `description` from REST, MCP or a native client keeps working and keeps its ETag precondition. Proof: `path: packages/api/tests/Feature/Tasks/TaskInPlaceUpdateTest.php`, `path: packages/api/tests/Feature/Mcp/McpTasksToolsTest.php`.
- Without the live API (mock, Storybook) the detail view saves title and description through the 600 ms autosave as today. Proof: `path: packages/apps/src/tasks-core/src/tasks-detail-view.test.tsx`.
- A real conflict still reaches the conflict dialog: a `412` where the server changed a patched field is not retried. Proof: `path: packages/apps/src/lib/offline/tasks/tasks-outbox-flush.test.ts` assertion on `etagMismatches` equal to `[task.id]`.
- After chunk A0 alone, Notes behaves exactly as before. Proof: `cmd: cd packages/api && composer done-gate`.
- After chunk A alone, main works: the endpoints exist and nothing calls them. Proof: `cmd: cd packages/api && composer done-gate`.
- After chunk B alone, Notes and Docs behave as before, because the new shape is opt-in. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab src/note-detail-view`.
- After chunk D alone, the outbox and autosave only retry more often; nothing else changes. Proof: `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/tasks src/tasks-core`.

## Chunks

### Chunk A0: Shared live-text core, Notes moved onto it

- **id:** `chunk-a0-collab-text-core`
- **Skill:** api
- **Inputs:** the Notes rules to move — `path: app/Services/Notes/NoteCollaborativeWrite.php:37`, `path: app/Services/Notes/NoteCollaborativeWrite.php:126`, `path: app/Services/Notes/NoteCollaborativeWrite.php:142`, `path: app/Services/Notes/NoteYjsProjection.php:23`, `path: app/Services/Notes/NoteYjsProjection.php:47`, `path: app/Services/Notes/NoteYjsProjection.php:79`; the shared collab helpers already there — `path: app/Services/Collab/CollabExternalWrite.php:11`, `path: app/Services/Collab/YjsBytes.php:16`, `path: app/Services/Collab/DocCollabDocumentService.php:100`
- **Done when:**
  - `Services/Collab/CollabTextState.php` and the `CollabTextFields` interface exist as in spec.md (Shared server core).
  - `NoteCollaborativeWrite` and `NoteYjsProjection` call the core and keep no copy of its rules; `NoteTextFields` supplies body and title.
  - Unit tests for the core: content tag order, precondition codes, the header never matching `*`, metadata-only writes not counting as outside writes, the locked transaction re-reading both rows, the 256 KiB cap.
  - Every existing Notes collab test passes unedited; a stored Notes content tag from before the change still matches.
  - No duplicate block between `Services/Notes` and `Services/Collab` (the copy-paste ratchet stays green).
- **Verify with:** `cd packages/api && composer done-gate` (or `php scripts/done-gate.php` when the local run hits the 900 s limit)
- **Parallel with:** `chunk-b-collab-text-fields`, `chunk-d-disjoint-retry`

### Chunk A: Task text resource, stored state and room authorization

- **id:** `chunk-a-api-task-text`
- **Skill:** api, security
- **Inputs:** the shared core from chunk A0 (`Services/Collab/CollabTextState.php`), with `NoteCollaborativeWrite` as the example caller — `path: app/Services/Notes/NoteCollaborativeWrite.php:37`; the Notes metadata `PATCH` lock to mirror — `path: app/Services/Notes/NoteRepository.php:203`; the shared task write path — `path: app/Services/Tasks/TaskRepository.php:249`; the join authorizer — `path: app/Services/Collab/CollabJoinAuthorizer.php:38`; the routes — `path: routes/api.php:287`
- **Done when:**
  - Migration and model `task_yjs_state` as in spec.md (Stored state), FK cascade, unique `(calendar_object_id, vtodo_uid)`, `MEDIUMBLOB` on MySQL; `vtodo_uid` is the component's real UID also for single-VTODO files (test: a native client adds a second VTODO to the file and the first task's state row is still found).
  - `TaskTextCollaboration` and `TaskTextFields` use the chunk A0 core for the precondition, the outside-write guard, the content tag, the locked write and the state row; they hold no copy of those rules.
  - First-save check: a CalDAV `PUT` after `GET …/text` and before an `If-None-Match: *` text `PUT` that names the `GET …/text` tag makes that `PUT` answer `409 external_write`, and the native text stays; a no-state `PUT` without `X-Wgw-External-Write` gets `428`; the Notes first save (no header) still lands.
  - `GET …/text`, `GET …/text?format=yjs` and `PUT …/text` behave as in spec.md (API): `GET …/text` carries `objectEtag`, which changes on a write that restores an earlier text; `204` with no state, `X-Wgw-External-Write: 1` after a native, MCP or REST text write and not after a metadata write, `428`, `412`, `409 external_write`, `413 state_too_large`, `422` over the field limits and on a blank title, `403` on a read-only list, `404` for a task the caller cannot see.
  - Every task object write (`rewriteOwnedTask` for `PATCH`, `PUT`, MCP and move; the text `PUT`) runs in the core's locked transaction and checks `If-Match` on the locked row. Test, with a hook between the unlocked lookup and the write: a status `PATCH` whose read happens before a text `PUT` and whose write runs after it gets `412`, the saved text is still there, and a follow-up `PATCH` with the new ETag stores the status beside it.
  - A text `PUT` is a normal task write: a `TaskStatusChangedNotifyTest`-style test and, once #2172 is in, a change-set test see it.
  - `CollabJoinAuthorizer` resolves `task:<calendarid>:<uid>` before the slash test, parsing a decimal `calendarid` and the whole remainder as the UID (test with a `urn:uuid:` UID and a UID with a slash); access `write` / `read` from the instance; `403` for an unknown object, a hidden or dismissed share, a malformed key, or a URI-collision attempt (a task with the same URI in the attacker's own list).
  - OpenAPI updated; `TasksAccessControlTest` gains the three routes.
- **Verify with:** `cd packages/api && composer done-gate` (or `php scripts/done-gate.php` when the local run hits the 900 s limit)
- **Parallel with:** `chunk-b-collab-text-fields`, `chunk-d-disjoint-retry`

### Chunk B: Text-fields shape, shared rebuild, binding and question dialog

- **id:** `chunk-b-collab-text-fields`
- **Skill:** workspace, apps-ui
- **Inputs:** seed — `path: text-editor-core/docs-collab/docs-collab-editor-surface.tsx:32`; rebuild — `path: text-editor-core/docs-collab/docs-collab-external-write.ts:59`; join merge — `path: text-editor-core/docs-collab/use-docs-collab-join.ts:228`; emptiness — `path: text-editor-core/docs-collab/docs-collab-utils.ts:156`; save body — `path: text-editor-core/docs-collab/docs-collab-server-io.ts:134`; title binding and carets — `path: note-detail-view/src/use-note-title-field.tsx:83`, `path: note-detail-view/src/use-note-title-carets.ts:24`; the dialog to move — `path: note-detail-view/src/note-external-write-dialog.tsx:28`; collab hook split rules — [workspace/collab-hooks.md](../../skills/workspace/collab-hooks.md)
- **Done when:**
  - `DocsCollabUrls.documentShape: "text-fields"`: the session asks the shape for seed, emptiness and save body; the Docs and Notes shapes keep their code. Vitest: two plain seeds of the same text are byte-identical; a document restored from IndexedDB that already holds `note-title` and `plain-body` is not seeded again (offline reopen and join), and no `default` fragment appears in `doc.share`.
  - `replaceDocumentWithExternalText` seeds through the shape, accepts an empty server state and takes the delete limit as a parameter; Docs and Notes tests stay green unchanged. `\r\n` outside text is seeded as `\n`.
  - Text-fields re-read (spec.md, The re-read), Vitest:
    - adopt: a document on S1 (`Buy milk`) with no edit re-reads S2, a peer's save of `Buy oat milk` with no flag: the result is `Buy oat milk` once, applied with `SERVER_ORIGIN`, nothing seeded or published, no `PUT`; the same with a document that has no `base` yet;
    - outside write with a state: the same document with the flag set and outside text `Buy soy milk` ends on `Buy soy milk` once; a local document `Buy milk`, stored state `Buy oat milk`, server text `Buy soy milk`, no local edit, ends on `Buy soy milk` once;
    - no state: a document seeded with `Buy milk`, no local edit, `204` and server text `Buy oat milk` becomes `Buy oat milk` once and sends no `PUT`; a second document still on the old seed, receiving that over the mesh or re-reading itself, becomes `Buy oat milk` once; IndexedDB holding the `Buy milk` seed, `204` and server text `Buy oat milk` opens as `Buy oat milk` with no `PUT`;
    - own local work: the outside re-read with an unsaved `!` typed here raises the question and sends no `PUT` before the answer; "use the other version" gives the outside text; "keep mine" sends `If-None-Match: *` (no state) or `If-Match` (state) naming the outside text's tag;
    - a peer's typing: a document that received a peer's unsaved `!` over the mesh, then re-reads an outside write, is not asked, and the `!` survives its quiet replacement; "use the other version" on the typist's side removes only the typist's own items;
    - two outside edits: replacing o1 then o2 gives o2 once with no question; a document that received o1's replacement over the mesh and then replaces to o2 gives o2 once; typing here after o1's replacement, then o2, raises the question;
    - back to an earlier text: `Buy milk` → `Buy oat milk` → `Buy milk` ends on `Buy milk` once, not blank, and a second document applying the same replacements ends on it once;
    - after a quiet replacement to `Buy oat milk`, a second re-read of that same text writes nothing, leaves `seed` on that replacement and publishes no delete of it; adopting a snapshot that already contains that `base` writes `base` zero times; the four re-read cases are exclusive (a case-1 adopt does not also run case 2); a pushed text equal to the document triggers no re-read; a quiet replacement leaves `localDirtySinceLastSave` unset and a reconnect afterwards sends no `PUT`;
    - a character typed after `base` was set survives a quiet replacement;
    - a peer's typing across passes: a document receives a peer's unsaved `!`, replaces to o1, then replaces to o2: the `!` survives both, once, and the peer is not asked; a document receives a peer's unsaved `!`, adopts a peer's save that lacks it, then quiet-replaces an outside write: the `!` survives, once;
    - `base.vector` after an adopt equals the snapshot's vector and after a replacement equals the delete limit plus the seed, on two peers with different live documents;
    - overlapping replacements: two documents on the same base, one replaces to `Buy oat milk` and the other to `Buy soy milk` before either applies the other's update; after sync the text is one of the two, once, on both; a following re-read whose server text is `Buy soy milk` leaves `Buy soy milk` once;
    - writing `base` after a landed save does not set `localDirtySinceLastSave`;
    - stale writers: a document on s1 has a save in flight, receives a peer's replacement to o2 over the mesh, then gets the save's `200`: the save writes no `base`, `seed` stays o2's, and the text is o2 once, not empty; a re-read whose snapshot names s1 is applied after a peer's o2 replacement arrived: the text is o2 once; the same two cases with the writes concurrent, on two documents, after sync, end on one text, never empty;
    - adopt after a missed replacement: a document on o1 reconnects to a stored state that a peer saved after replacing to o2; it adopts o2's text once and the cleanup does not delete o2's seed.
  - The session exposes its re-read (`mergeServerState`) so an app can trigger it; with a text-fields room and no unsaved work it rebuilds, with unsaved work it raises the shared question (`prompt`). `decideExternalWrite` is unchanged.
  - `NoteExternalWriteDialog` moves to `text-editor-core/docs-collab/collab-external-write-dialog.tsx` as `CollabExternalWriteDialog` with a labels prop; Notes passes its current labels and its prompt tests stay green unchanged.
  - The title field hook and carets take a `Y.Text` key and an awareness field; Notes passes `note-title` and `noteTitleSelection` and its tests stay green unchanged.
  - The update guard admits writes to `note-title` and `plain-body` from a writer and drops them from a reader.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab src/note-detail-view`
- **Parallel with:** `chunk-a0-collab-text-core`, `chunk-a-api-task-text`, `chunk-d-disjoint-retry`

### Chunk C: Tasks detail view in the room

- **id:** `chunk-c-tasks-room`
- **Skill:** workspace, apps-ui
- **Inputs:** the detail view — `path: tasks-core/src/tasks-detail-view.tsx:141`; the autosave — `path: tasks-core/src/use-task-detail-autosave.ts:212`; the form rebase — `path: tasks-core/src/use-task-edit-form.ts:29`; the Notes room hook to mirror — `path: notes-core/src/use-note-body-collab.ts:52`; parking — `path: lib/offline/tasks/tasks-parked-writes.ts:16`
- **Done when:**
  - `useTaskTextCollab` opens one room per open task with a server id (live API only), using the room key from `GET …/text`; `holdTaskTextRoom` marks it for push.
  - Title and description bind to `note-title` and `plain-body` with carets; `maxLength` 4 096 / 8 192; the over-limit hint holds the save.
  - Title and description leave `taskEditPatch` and the form's field groups while a room is open; the other fields keep the 600 ms autosave.
  - A task push whose `title` or `description` differs from the text the document holds now triggers the shared re-read; the list row shows the projected title.
  - The question uses `useDocsExternalWriteRequest`, `useDocsExternalWritePrompt` and `CollabExternalWriteDialog` with task labels, wired as `note-text-editor-body.tsx` does; no task-specific merge code.
  - Blank title: the save is held with "A task needs a title"; leaving with a blank title writes the `base` title back with `writeNoteTitle` and sends nothing when the document then equals `base`; with a held description it saves through the guarded save, and a refusal parks the text. Only when no other writer is in the room.
  - Read-only: fields read-only, carets shown, none published. Access lost (`403`, `404`, or signaling `403`) with unsaved text: leave the room, show the message from spec.md, park the task.
  - A task whose create is still queued opens without a room.
  - Storybook: a mock-tier story with two simulated peers' carets on the description, a read-only story, and the question dialog with task labels.
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
- **Done when:** `tasks.md` gets "Decision 17 — Live title and description" (the design as decided, linking this spec folder; it says that outside edits follow the Docs and Notes question flow, and in one line that, unlike Notes, the fields are read-only while the room loads instead of saving a title edit by `PATCH`), Decision 15 and the Tier 2 table point to it, the property-mapping `DESCRIPTION` note says "plain text, co-edited live"; `jmap-push.md` "Collab rooms lead" names Tasks.
- **Verify with:** `pnpm run check:agent-docs`
- **Parallel with:** `chunk-c-tasks-room`

### Chunk V: Cross-chunk verify and two-browser e2e

- **id:** `chunk-v-verify`
- **Skill:** testing
- **Inputs:** every chunk above; [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md)
- **Done when:**
  - A Playwright spec with two browser contexts (two users on a shared list) covers: typing in both fields shows on the other side with carets; concurrent typing in one sentence keeps both; an outside `PUT` over CalDAV (the Reminders fixture from `tests/fixtures/Interop/RealClients/`) while nobody types shows the new text in both contexts with no dialog, run on a task that has no `task_yjs_state` row with both contexts already open, and again on a task that has one; the same `PUT` while one context has unsaved typing asks that context once, and both answers leave both contexts on the same text; two quick outside `PUT`s (title, then notes, within 2 s) leave no doubled text and show no dialog in either context; blanking the title, waiting past the save debounce and typing a new title saves exactly the new title as `SUMMARY`; leaving a task with a blank title shows the stored title again; a status change during typing saves; one context offline edits the notes and reconnects (and, with the text changed elsewhere meanwhile, gets the question), also on a task nobody had typed in before; a read-only third user sees typing and cannot type; revoking the share mid-session shows the access message.
  - A second tab of the same user converges with the first.
  - Verifier `PASS` or `PASS_WITH_NITS` and the parent ran the [done-checklist](../../skills/developer/done-checklist.md).
- **Verify with:** the Playwright spec above, `pnpm test:apps-done-gate`, `composer done-gate`
- **Parallel with:** none

## Test plan

- [ ] Shared core: unit tests for `CollabTextState`; the Notes collab tests pass unedited after Notes moves onto it
- [ ] API: OpenAPI → failing feature tests for `/text` (preconditions, outside write, limits, access, URI collision) → implement → `composer done-gate`
- [ ] Collab lib: Vitest on the plain seed, the text-fields emptiness test, the shape-aware rebuild and the text-fields re-read (no state, two outside edits, the server base), line ends, and the moved dialog
- [ ] UI: mock-tier Storybook for carets, read-only and the task question dialog; Vitest for `useTaskTextCollab` contracts (RTL), the form without title and description, and the disjoint-field retry
- [ ] Activity: PHPUnit for the cross-actor merge; Vitest for the formatter
- [ ] e2e: two browser contexts as in chunk V, plus a cold browser first visit (a fresh context with an empty IndexedDB)

## Doc updates (only if user wants)

- Chunk F covers the architecture docs. The `notes.md` Decision 7 correction is in this PR.
