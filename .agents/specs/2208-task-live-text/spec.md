Source: #2208 (body-hash: 87038c51)
Goal: WeGotWorkspace/Product#151

# Live co-editing of a task's title and description

Technical translation of Epic #2208. Written against `origin/main` at `e7b06aec` (2026-11-16); every line reference in [plan.md](./plan.md) is pinned to that commit. It builds on two specs that are still in review: assignees and the task change set (#2172, PR #2175, `.agents/specs/2172-task-assignees/` on branch `docs/2172-task-assignees`) and task threads with the activity log (#2173, PR #2178, `.agents/specs/2173-task-threads/` on branch `docs/2173-task-threads`).

Product decisions (2026-11-16): the description stays **plain text** (no Markdown, no rich-text formatting), and **both** the title and the description are co-edited live with Yjs and remote carets, the way Notes does it.

## Goal

- **One room per task, two plain-text fields.** A task's room holds one Yjs document with two `Y.Text` shared types:
  - `note-title`: the title type Notes already uses (`NOTE_TITLE_YTEXT_KEY`). The key name stays; it is the suite's "title of a collab document" type, not a Notes-only one;
  - `plain-body`: a new type for a plain-text body.

  There is no TipTap editor and no `Y.XmlFragment`. Both fields stay the textareas they are today. They bind to their `Y.Text` with the binding and the remote-caret overlay the Notes title already has (`useNoteTitleField`, `useNoteTitleCarets`, the textarea mirror geometry), generalised to take a key. The caret geometry already wraps over several lines, because the Notes title is a textarea.
- **The same collab stack as Notes, no second one.** The room is joined through the existing `/rooms` signaling, synced over the RTC mesh between browsers (TURN only when peers cannot connect directly), and saved over REST by the shared save loop (`persistCollabSave`, the same 2 s debounce and 3 s cap). The server runs no Yjs. The shared session gets a third document shape next to Docs (`default` fragment) and Notes (fragment + title): **text fields only**, so it can seed, save and rebuild without mounting TipTap.
- **The VTODO is the document of record.** `SUMMARY` and `DESCRIPTION` are what every client reads, ours included. The server also stores the last saved Yjs state of each co-edited task (`task_yjs_state`), the same way Notes stores `note_yjs_state`. That state is never shown to anyone. It is the merge base that lets live peers, tabs and offline devices agree on one history.
- **An outside edit never prompts.** Native clients (Apple Reminders, Thunderbird, jtx Board, tasks.org through DAVx5), MCP `task_write` and a plain REST `PATCH` change `SUMMARY` or `DESCRIPTION` without touching the stored state. Notes asks the person in that case when they have unsaved work (Decision 6 of `docs/architecture/notes.md`); for tasks that prompt would show all the time. Tasks always merges:
  - Every client turns the outside change into **the same deterministic Yjs update**: the diff from the text the stored state holds to the new text, written in a throwaway document loaded from the stored state, with a client id derived from the state tag and the new text's content tag. Two peers or two tabs that apply it produce byte-identical items, so the second application is a no-op. Typing made after the stored state merges with it by the CRDT.
  - When there is no shared state to diff from (the task was never co-edited, a move dropped the state, or the state was compacted), the first save wins with `If-None-Match: *` and every other client **rebases** onto the winner with a three-way merge of plain text (see Technical constraints, Reconcile). Nobody is asked.
- **Text edits leave the task outbox.** While the live API is on, the detail view never sends `title` or `description` in a task `PATCH` for a task that exists on the server. Offline, the text lives in the room's Yjs document in IndexedDB (the y-indexeddb buffer Notes uses) and saves when the connection is back, merged as above. Creating a task still sends its first title in the create `POST`, and a task whose create is still queued keeps editing through that create (Edge cases).
- **Metadata writes keep working while people type.** A text save changes the object ETag every few seconds. A status, due, priority, alarm, move or assignee write from the autosave or the outbox would then hit `412` and show an error. A `412` on a patch whose fields the server did not change since the client's base is retried once with the server's ETag, with no dialog and no error.
- **The activity log does not flood.** Each person saves at most every ~3 s while typing. Epic #2173 merges quick edits by the **same** actor on the same field within 10 minutes, but only into the newest entry of the thread, so two people typing in turn would still add one entry per save. For `title` and `description` only, this Epic changes the merge into a **cross-actor** merge (Technical constraints, Activity log). Title and description changes notify nobody, as #2173 already decides.
- **Access.** Joining a task room needs read access to the task's list. The peer's right is `write` only with write access to the list; a read-only viewer sees the typing and the carets, cannot type, and publishes no caret. Losing access mid-session ends the session (the signaling re-check that exists today), and unsaved text is parked for the existing Tasks rescue flow instead of being lost.

## Non-goals

- Markdown or rich text in the description, a toolbar, or formatting shortcuts
- Live co-editing of status, due, priority, alarms, tags, assignees or the list. They keep their autosave and outbox.
- Presence in the task list (who has a task open)
- A server-side Yjs process, a websocket relay or a server-side merge
- Live typing inside native clients. They see the text once it is saved and they sync.
- Co-editing in mock mode and Storybook. Without the live API the detail view keeps the solo autosave it has today.
- Changing how Notes handles outside writes. Notes keeps its prompt (Decision 6).
- Co-editing a task from MCP. MCP writes stay plain REST writes, which the room treats as outside writes.

## Affected packages

- `packages/api`:
  - new migration and model `task_yjs_state`;
  - new `Services/Tasks/TaskTextCollaboration.php` (read, outside-write check, collaborative write) and `Services/Tasks/TaskTextProjection.php` (the content tag, the analogue of `NoteYjsProjection`);
  - `TasksController` (three actions on the new sub-resource) and a new form request `TaskTextPutRequest`;
  - `routes/api.php`;
  - `Services/Collab/CollabJoinAuthorizer.php` (the `task:` room shape);
  - `Services/Tasks/TaskRepository.php` (one text-only write entry point on the shared write path);
  - the shared `ThreadActivityWriter` from #2173 (cross-actor merge for two fields);
  - OpenAPI;
  - PHPUnit.
- `packages/apps`:
  - `text-editor-core/docs-collab` (the text-fields document shape: plain seed, plain save body, deterministic outside-write update, rebase);
  - `note-detail-view` (the title binding and carets generalised to a `Y.Text` key; Notes keeps its behaviour);
  - `tasks-core` (`tasks-detail-view.tsx`, a new `use-task-text-collab.ts`, `use-task-detail-autosave.ts`, `use-task-edit-form.ts`, title projection to the list row);
  - `lib/offline/tasks` (text out of the outbox; disjoint-field `412` retry; parking unsaved text);
  - `lib/api/wgw` (task text client);
  - Vitest, Storybook (read-only caret story) and one Playwright spec with two browser contexts.
- `docs`:
  - `docs/architecture/tasks.md` (a new decision that replaces Decision 15's "Tier 2 (optional)", and the property-mapping note on `DESCRIPTION`);
  - `docs/architecture/notes.md` (Decision 7 "Title UX" corrected in this PR);
  - `docs/architecture/jmap-push.md` ("Collab rooms lead" gains Tasks).

## Technical constraints

### Room key and join

- The REST task id is the object URI, or `{objectUri}#{vtodoUid}` for a VTODO inside a multi-VTODO file (Decision 9 of `docs/architecture/tasks.md`). `findOwnedTask` resolves it by URI across every list the caller can reach. A URI is chosen by whichever client created the object, so two unrelated lists can hold the same URI. The task id is therefore **not** a safe room key: someone could create a task with the URI of a task they can no longer see, join that room, and receive its live text.
- The room key is `task:<calendarid>:<vtodo-uid>`, built by the server. `calendarid` is the shared calendar row, the same for the owner and every sharee; the UID names the component. The client gets it from `GET /tasks/items/{taskId}/text` and never builds it.
- `CollabJoinAuthorizer::assertMayJoin` and `accessFor` check the `task:` prefix **before** the "a slash means a Drive path" test, because a VTODO UID written by a native client may contain a slash. A task room resolves to the VTODO with that UID in that calendar, then to the caller's accessible instance on that calendar (`CalendarCollectionAccess`, the same lookup the task routes use, dismissed and hidden shares excluded). No such object, or no instance: `403`. Access is `write` when the instance is writable, `read` otherwise.
- A note whose UID starts with `task:` can no longer open a room. Notes created by the app have UUIDs; a foreign journal with that UID is not a supported case (Decision 17 of `notes.md`).
- The rest of the join is unchanged: the per-poll re-check (`assertStillMayJoin`) ends the session when read access goes away, `refreshAccess` narrows the ticket when write access goes, `MAX_PEERS_PER_ROOM` stays 20, and peers drop updates from a peer whose ticket says `read`.

### Stored state

- `task_yjs_state`: `id`, `calendar_object_id` (FK to `calendarobjects.id`, `ON DELETE CASCADE`), `vtodo_uid` (the component, `''` for a single-VTODO object), `state` (binary), `object_etag`, `content_etag`, timestamps. Unique `(calendar_object_id, vtodo_uid)`. Same shape and rules as `note_yjs_state`.
- `content_etag` is `sha1(description . "\0" . title)` of the VTODO **after** the write, computed from the stored ICS by the mapper, not from the request. A metadata write (status, due, assignee, alarm) changes `object_etag` and leaves `content_etag` alone, so it is not an outside write.
- A move through REST creates the object in the target calendar and deletes it from the source (`TaskRepository.php:321`), and a CalDAV `MOVE` does the same. The new object has a new `calendarobjects.id`, so the state row is gone with the old one. The room key changes too (new `calendarid`). This is intended: the next join seeds from the text, and any client with unsaved text rebases.
- Size: the stored state is capped at 256 KiB (`413 state_too_large`). Title and description stay capped at 4 096 and 8 192 characters, as in `TaskPatchRequest`. A plain-text Yjs state at those sizes stays far below the cap unless a long history of deletions accumulates; then a client that is alone in the room compacts: it seeds a new document from the current text and saves it with `If-Match` on the old tag.

### API

New sub-resource under the existing `wgw.tasks` middleware group. `{taskId}` is the REST task id.

- `GET /api/v1/tasks/items/{taskId}/text` returns `{ title, description, room }` with `ETag` set to the **content tag** (quoted `content_etag` of the current object). Read access to the list.
- `GET /api/v1/tasks/items/{taskId}/text?format=yjs` returns the stored state bytes with `ETag` set to the state tag (`DocCollabDocumentService::sidecarEtag`). It sets `X-Wgw-External-Write: 1` when the object's content tag differs from the row's `content_etag`. No row: `204` (the client seeds from the text). Read access.
- `PUT /api/v1/tasks/items/{taskId}/text`: the framed payload Notes uses (`FramedPayload`: `documentLen`, `yjsLen`, optional `title`), where the document part is the description. Write access to the list.
  - `If-Match` on the state tag, or `If-None-Match: *` when the client saw no state. No precondition while a state exists: `428`. A mismatch: `412`.
  - While the object's content tag differs from the row's `content_etag`, the save must name the content tag it merged in `X-Wgw-External-Write`, or it gets `409 external_write`. This is the guard `NoteCollaborativeWrite::assertNoUnseenExternalWrite` already has; it proves the client merged the outside text before writing over it.
  - The text is written through **`TaskRepository`'s shared write path** (`rewriteOwnedTask`), as a patch of `title` (only when present and not blank) and `description` (`""` removes `DESCRIPTION`). So the write lock, list write check, multi-VTODO component handling, search index, #2172's task change set, #798's status notification logic and #2173's activity writer all run, exactly as for a REST `PATCH`. The object `If-Match` precondition of that path is skipped for this call; the state tag is the precondition.
  - The state row is written in the same transaction as the object, with the new `object_etag` and `content_etag`.
  - The response is `200 {ok: true}` with `ETag` set to the new state tag. Errors use the shared envelope (`error`, `code`); clients classify on status and code only.
- OpenAPI describes the three operations, the framed body, and the `X-Wgw-External-Write` header on both sides.
- `PATCH /tasks/items/{taskId}` and `PUT /tasks/items/{taskId}` are unchanged. API callers that set `title` or `description` there keep working; the room sees their change as an outside write.

### Client session (text-fields shape)

- `DocsCollabUrls` gains `documentShape: "text-fields"`. With it:
  - **Seed** writes `note-title` and `plain-body` from the text into a throwaway document whose client id is `seedClientId("text-fields", title + "\0" + description)`, plus `task-text-meta.root` set to that id. No TipTap editor is created. Two clients seeding the same text produce byte-identical updates.
  - **Save** sends `plain-body` as the document part and `note-title` as `title` (`noteTitleForSave` already does the title). Text is sent as typed: no trim. A blank or whitespace-only title is not sent, so `SUMMARY` keeps its value (today's rule, `use-task-detail-autosave.ts:212`, and `TaskPatchRequest` requires `min:1`).
  - **Line ends:** outside text is normalised to `\n` before it is seeded or diffed, because a textarea reports `\n` only. A `DESCRIPTION` with `\r\n` from a native client is saved back with `\n`.
- **Outside write while a room is open.** `decideExternalWrite` returns `"prompt"` for Notes when local work is pending (`use-docs-collab-join.ts:238`). The text-fields shape never prompts: it calls `mergeOutsideText(ydoc, storedState, stateTag, outside)`, which
  1. loads the stored state into a throwaway document and gives it the client id `hash32("outside\0" + stateTag + "\0" + contentTag)`;
  2. applies `plainTextOps(base, outside)` to each field whose outside text differs, where `base` is that field's text in the stored state;
  3. encodes only the new items (`encodeStateAsUpdate(temp, stateVectorOfStoredState)`) and applies the stored state, then that update, to the live document with the publishable `EXTERNAL_REBUILD_ORIGIN`.

  It then saves with `X-Wgw-External-Write` set to the content tag it merged.
- **How an open room learns about it.** The open task's `Task` push (or `/changes` poll) brings a new `title` or `description`. When that text is not the text the room last saved or loaded, the room re-reads `?format=yjs` (`mergeServerState`), which carries the outside-write flag. A save that races it gets `409 external_write` and does the same. Both paths end in `mergeOutsideText`, so whichever comes first wins and the other is a no-op.
- **`plainTextOps(base, next)`** is a pure function in `text-editor-core/docs-collab`: a line-level diff (Myers) of the two texts, then a common prefix and suffix inside each changed hunk (the method `replaceNoteTitle` uses for one line), returning `insert` / `delete` operations at character offsets of `base`. No new dependency.
- **Reconcile** (join, reconnect, a `412` on save). Inputs: the local document (y-indexeddb), its root, the text it last saved or loaded (`lastSyncedText`, kept next to the document in IndexedDB), and the server's `?format=yjs` answer plus `GET …/text`.
  - Server state with the **same root**: apply it (the CRDT merges); if flagged as outside write, `mergeOutsideText`; save.
  - Server state with **another root**, or **no state**: rebase. `merged` is a CRDT three-way merge: seed `lastSyncedText` deterministically, apply `plainTextOps(lastSyncedText, serverText)` with one client id and `plainTextOps(lastSyncedText, localText)` with another, merge both. Then load the server state (or seed the server text when there is none), apply `plainTextOps(serverText, merged)` with this client's id, make that the local document, and save with `If-Match` on the server's tag (or `If-None-Match: *`). The stored state's root always wins, so clients converge on one lineage.
- **Two tabs** of one browser share the y-indexeddb document and the cross-tab channel the shared session already has; they behave as two peers.

### Detail view and form

- `TasksDetailView` mounts the room through a new `useTaskTextCollab({ task, readOnly, username, displayName })`, modelled on `useNoteBodyCollab`: live API only, one room per open task, `holdTaskTextRoom(taskId)` while it is open so push sync knows the room leads.
- It wraps the view in the existing `NoteCollabYDocProvider`, so the title (already rendered by `NoteDetailView`) binds to `note-title` with no Tasks code. The description `TextareaAutosize` binds through the generalised field hook with key `plain-body` and its own awareness field for carets (`noteTitleSelection` stays the title's field).
- `title` and `description` leave `TASK_DETAIL_SAVE_DEBOUNCE_MS` and `taskEditPatch` while a room is open. The other fields keep the 600 ms autosave. Without a room (mock, Storybook, the room still loading) the detail view behaves as today.
- While the room is loading, the fields show the stored text read-only, so nothing typed lands outside the document (as Notes does).
- The list row shows the live title: the room projects `note-title` onto the in-memory task (`projectTaskTitle`, like `projectNoteTitle`) without a write or an outbox row.
- `rebaseTaskForm` (#1858) keeps working for the other fields. `title` and `description` drop out of its field groups while a room is open, because the document owns them.
- `maxLength` is 4 096 on the title and 8 192 on the description. A merge can still push a field over its limit (two people add at once). The field then shows its "too long" hint, the save is held, and the text is not cut; the next edit that brings it back under the limit saves.

### Outbox and autosave (disjoint-field retry)

- Online autosave (`use-task-detail-autosave.ts:244`) and the outbox flush (`tasks-outbox-flush.ts:126`) both send `If-Match`. On a `412`, the client fetches the task once and compares, **for each field in the patch**, the server value with the value the patch was based on.
  - None changed on the server: send the same patch again with the server's ETag. No dialog, no error.
  - One did: today's behaviour (the conflict dialog from the outbox, the error and revert from the autosave).
- The base values are recorded when the patch is made: the autosave has the task it diffed against; an outbox row gets a `base` map of the patched fields' previous values, kept through `coalesceTaskPatches` (the first base of a field wins). Rows queued before this change have no `base` and keep today's behaviour.
- `title` and `description` leave `TaskConflictFieldKey`'s rows for tasks with a stored state, because the document merges them. Old outbox rows that carry them still flush as they do today.

### Access loss and read-only

- A read-only peer binds both fields read-only, receives updates and carets, and publishes no caret.
- `onPersistForbidden` (a `403` on save) or a `404` (the task was deleted, or moved out of every list the person can see) while the room holds unsaved text: the client leaves the room, shows the fields read-only with the message "You no longer have access to this task. Your last changes were not saved here.", and parks the task with the document's text through `parkTask`, so the existing rescue view can create it in another list. The poll-side `403` from signaling does the same.
- A peer that loses access keeps its local copy of what it already received. That is the same gap Notes and Docs accept (Decision 8 of `notes.md`); nothing new is exposed, because the peer could read it a moment earlier.

### Activity log (needs #2173)

- #2173's `ThreadActivityWriter` merges an entry into the thread's **newest** entry when it is an activity entry by the same actor, for the same field, younger than 10 minutes.
- For `title` and `description` only, this Epic changes the rule to: merge into the **newest activity entry for the same field** when it is younger than 10 minutes and no comment or reply was posted after it, **whatever its actor**. The actor is added to a new `actors` list on the entry (the entry's author stays the first actor). `to` is updated for `title`; `description` stays a changed flag.
- If `from` then equals `to` and only one actor is listed, the entry is deleted, as #2173 already does.
- The client formatter renders "Anna and Bob edited the notes" and "Anna and Bob changed the title to 'Moodboard v2'"; three or more actors read "Anna and 2 others".
- Every other field keeps #2173's same-actor rule.
- If this Epic is built before #2173 lands, chunk E is a change to #2173's spec instead, and the rule goes in with #2173's chunk F.

## Edge cases

- **Two people type in the same sentence.** The CRDT keeps both. Each person's save carries everything merged so far; the second save of the same text changes nothing in the VTODO.
- **Someone edits the title in Reminders while two people type in the notes.** Both browsers see the new title within one push (or one save round trip). Both apply the same deterministic update; their notes typing is untouched. The next save stores the merged text with `X-Wgw-External-Write`.
- **Reminders changes the notes in the same place someone is typing.** The outside diff and the typing merge by the CRDT: both texts stay, interleaved at the character level where they touch. Nobody is asked. This is the accepted cost of never prompting.
- **An offline edit, while the text also changed elsewhere.** On reconnect the room reconciles: same root, it merges by the CRDT and applies the outside diff; other root or no state, it rebases with the three-way merge. Either way no prompt, and the save goes out.
- **Two tabs, one offline.** The offline tab's edits live in the shared y-indexeddb document and reach the other tab through it; the online tab saves them.
- **A status change while someone types.** The status patch gets `412` because a text save changed the ETag. Its field (`workflowStatus`) did not change on the server, so it is retried with the new ETag and lands.
- **A task moved to another list while a room is open.** The room key changes and the old state row is gone. The open detail view closes the old room and joins the new one, if the person can see the new list; a peer that cannot is told it no longer has access, and its unsaved text is parked.
- **A task in a multi-VTODO file.** The room and the state row are per component (`vtodo_uid`); a save rewrites only that component.
- **A recurring task.** Title and description live on the master, as for a REST `PATCH`. An override with its own `SUMMARY` from another client is left as it is.
- **A task created offline.** Until its create lands it has only a temporary id (`tempTaskId` in the outbox row), which the server replaces. Such a task opens **without a room**: its title and description edits go into the queued create through the existing outbox, as today. The room opens once the task has its server id. Unlike Notes, where the app picks the final UID up front, this keeps the temporary-id remap out of the collab layer.
- **The title is blanked.** The document shows an empty title; the save leaves `SUMMARY` as it was. A later fresh seed shows the stored title again.
- **A completed or cancelled task** stays editable, as today. Tasks have no archive.
- **Search** indexes each save, as it does for a `PATCH`; while someone types that is one re-index per ~3 s per typist.
- **Push load.** Each save is a task write, so every client of that list gets a `Task` state change and fetches one task; a thread panel that is open refetches its thread. This is the same per-save cost Notes has, and the "Collab rooms lead" rule keeps the typing tab from refetching its own text.
