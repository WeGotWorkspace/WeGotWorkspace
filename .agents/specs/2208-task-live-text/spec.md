Source: #2208 (body-hash: c11fd0d4)
Goal: WeGotWorkspace/Product#151

# Live co-editing of a task's title and description

Technical translation of Epic #2208. Written against `origin/main` at `e7b06aec` (2026-11-16); every line reference in [plan.md](./plan.md) is pinned to that commit. It builds on two specs that are still in review: assignees and the task change set (#2172, PR #2175, `.agents/specs/2172-task-assignees/` on branch `docs/2172-task-assignees`) and task threads with the activity log (#2173, PR #2178, `.agents/specs/2173-task-threads/` on branch `docs/2173-task-threads`).

Product decisions:

- 2026-11-16: the description stays **plain text** (no Markdown, no rich-text formatting), and **both** the title and the description are co-edited live with Yjs and remote carets, the way Notes does it.
- 2026-11-17: **reuse, do not rebuild.** Tasks handles outside edits exactly as Docs and Notes do, with their shared code: no unsaved typing means the outside text is taken over quietly; unsaved typing means the person is asked which version to keep. The server rules for live text live in one core that Notes and Tasks share. Earlier drafts of this spec had a task-only "never ask" merge (an outside chain on the server and deterministic diffs on every client); that is dropped.
- 2026-11-17: activity "Anna and Bob edited the notes"; the access-lost message with the rescue view; read-only viewers publish no caret; a field over its limit after a merge holds the save and is never cut. The limits are our own (RFC 5545 sets none): 4 096 characters for the title and 8 192 for the description, as the task API has today.

## Goal

- **One room per task, two plain-text fields.** A task's room holds one Yjs document with two `Y.Text` shared types:
  - `note-title`: the title type Notes already uses (`NOTE_TITLE_YTEXT_KEY`). The key name stays; it is the suite's "title of a collab document" type, not a Notes-only one;
  - `plain-body`: a new type for a plain-text body.

  There is no TipTap editor and no `Y.XmlFragment`. Both fields stay the textareas they are today and bind with the binding and remote-caret overlay the Notes title already has, generalised to take a key.
- **Reuse first.** Everything Docs and Notes already do is reused, not copied: signaling and the RTC mesh, the save loop, IndexedDB and tab sync, the join path with its outside-write decision (`decideExternalWrite`), the reload-and-merge on `409`/`412`/`428`, the outside-write question and its two answers, parked writes and the rescue view. Where shared code assumes TipTap or a note, it is generalised so all apps use the same function. Tasks adds only what is task-specific (Reuse map, below).
- **The VTODO is the document of record.** `SUMMARY` and `DESCRIPTION` are what every client reads. The server also stores the last saved Yjs state of each co-edited task (`task_yjs_state`), the same way Notes stores `note_yjs_state`. That state is never shown; it lets a client that joins later continue the same document.
- **Outside edits as in Docs and Notes.** Native clients (Apple Reminders, Thunderbird, jtx Board, tasks.org through DAVx5), MCP and a plain REST `PATCH` change `SUMMARY` or `DESCRIPTION` without the stored state. The room takes the shared path Notes takes: a save by a peer is adopted (`adopt`); an outside edit is taken over quietly (`rebuild`) when this person has typed nothing unsaved; when they have, they are asked once, "keep mine" or "use the other version" (`prompt`). A quiet takeover is never itself counted as typing, a peer's unsaved typing is not this person's work, and a task that was never co-edited is covered too (Client session, The re-read).
- **Text edits leave the task outbox.** While the live API is on, the detail view never sends `title` or `description` in a task `PATCH` for a task that exists on the server. Offline, the text lives in the room's Yjs document in IndexedDB and saves when the connection is back. Creating a task still sends its first title in the create `POST`.
- **Metadata writes keep working while people type.** A `412` on a status, due, priority, alarm, move or assignee patch whose fields the server did not change since the client's base is retried once with the server's ETag, with no dialog and no error.
- **The activity log does not flood.** For `title` and `description`, #2173's merge becomes cross-actor, so two people typing leave one entry per field. Title and description changes notify nobody, as #2173 decides.
- **Access.** Joining needs read access to the task's list; typing needs write access. A read-only viewer sees the typing and the carets and publishes no caret. Losing access mid-session ends the session and parks unsaved text for the existing Tasks rescue flow.

## Non-goals

- Markdown or rich text in the description, a toolbar, or formatting shortcuts
- Live co-editing of status, due, priority, alarms, tags, assignees or the list
- Presence in the task list (who has a task open)
- A server-side Yjs process, a websocket relay or a server-side merge
- A merge of outside edits that never asks (the earlier drafts' outside chain). Tasks asks exactly when Notes and Docs ask.
- Live typing inside native clients. They see the text once it is saved and they sync.
- Co-editing in mock mode and Storybook. Without the live API the detail view keeps the solo autosave it has today.
- Moving Docs (`DocYjsStateStore`) onto the shared server core, or Docs' conflict dialog onto the shared question dialog. Possible follow-ups.
- Co-editing a task from MCP. MCP writes stay plain REST writes, which the room treats as outside writes.

## Reuse map

| Piece | Today | In this Epic |
|---|---|---|
| Signaling, RTC mesh, `MAX_PEERS_PER_ROOM`, per-poll access re-check | shared by Docs and Notes | reused as is; `CollabJoinAuthorizer` gains the `task:` room shape |
| Save loop (`persistCollabSave`, 2 s debounce, 3 s cap), reload-and-merge on `409`/`412`/`428` | shared | reused as is |
| IndexedDB buffer, cross-tab channel, reconnect | shared | reused as is |
| Outside-write decision (`decideExternalWrite`: `adopt`, `rebuild`, `prompt`), its pending-work input, and `resolveExternalWrite` | shared | reused as is. The text-fields replacement uses a published origin that the update listener does not count as local work, so only this client's own typing makes the question appear |
| Rebuild from outside text (`replaceDocumentWithExternalText`) | shared, TipTap seed only, needs a stored state | generalised: it seeds through the document shape with a seed salt, accepts an empty server state (no state row), and takes the delete limit as a parameter. Docs and Notes pass what they pass today |
| Seed, "empty" check, save body | shared, TipTap shapes only | generalised with a third shape, `text-fields`; Docs and Notes unchanged |
| Question state (`useDocsExternalWriteRequest`, `useDocsExternalWritePrompt`) | shared by Docs and Notes | reused as is |
| Question dialog (`NoteExternalWriteDialog`) | Notes only | moved to `text-editor-core/docs-collab` as `CollabExternalWriteDialog` with labels; Notes and Tasks use it |
| Title binding and remote carets (`useNoteTitleField`, `useNoteTitleCarets`, caret geometry) | Notes only | generalised to a `Y.Text` key and an awareness field; Notes and Tasks use it |
| Server rules: state precondition, unseen-outside-write guard, content tag, locked write, state row | Notes only (`NoteCollaborativeWrite`, `NoteYjsProjection`) | moved into one core, `Services/Collab/CollabTextState`; Notes and Tasks call it |
| `X-Wgw-External-Write`, `FramedPayload`, `sidecarEtag`, `YjsBytes` | shared | reused as is |
| Parked writes and the rescue view | shared core, per-app adapters | reused; Tasks' adapter `parkTask` already exists |
| Room hook (`useNoteBodyCollab`) | Notes | Tasks gets its own small hook with the same shape (`useTaskTextCollab`), because URLs, room key and form wiring are task-specific |

Task-only code is limited to: the `task:` room key, `TaskTextFields` (which text a VTODO component holds), the `/text` routes, `task_yjs_state`, the room hook and the detail view wiring, the disjoint-field `412` retry in the task outbox, and the activity merge rule.

## Affected packages

- `packages/api`:
  - `Services/Collab/CollabTextState.php` and the `CollabTextFields` interface (the shared core); `NoteCollaborativeWrite` and `NoteYjsProjection` move onto it, and `NoteTextFields` supplies the note's fields;
  - migration and model `task_yjs_state`;
  - `Services/Tasks/TaskTextCollaboration.php` (the task routes on the core) and `Services/Tasks/TaskTextFields.php`;
  - `TasksController` (three actions on the new sub-resource), form request `TaskTextPutRequest`, `routes/api.php`;
  - `Services/Collab/CollabJoinAuthorizer.php` (the `task:` room shape);
  - `Services/Tasks/TaskRepository.php` (locked writes; one text write entry point on the shared write path);
  - the shared `ThreadActivityWriter` from #2173 (cross-actor merge for two fields);
  - OpenAPI, PHPUnit.
- `packages/apps`:
  - `text-editor-core/docs-collab`: the `text-fields` shape (seed, emptiness, save body), the shape-aware rebuild, `CollabExternalWriteDialog`;
  - `note-detail-view`: title binding and carets generalised to a key; Notes uses the moved dialog;
  - `tasks-core` (`tasks-detail-view.tsx`, new `use-task-text-collab.ts`, `use-task-detail-autosave.ts`, `use-task-edit-form.ts`, title projection to the list row);
  - `lib/offline/tasks` (text out of the outbox; disjoint-field `412` retry);
  - `lib/api/wgw` (task text client);
  - Vitest, Storybook, one Playwright spec with two browser contexts.
- `docs`: `docs/architecture/tasks.md` (a decision replacing Decision 15's "Tier 2 (optional)"), `docs/architecture/notes.md` (Decision 7 "Title UX" corrected in this PR), `docs/architecture/jmap-push.md` ("Collab rooms lead" gains Tasks).

## Technical constraints

### Room key and join

- The REST task id is the object URI, or `{objectUri}#{vtodoUid}` for a VTODO inside a multi-VTODO file (Decision 9 of `docs/architecture/tasks.md`). A URI is chosen by whichever client created the object, so two unrelated lists can hold the same URI. The task id is therefore **not** a safe room key: someone could create a task with the URI of a task they can no longer see, join that room, and receive its live text.
- The room key is `task:<calendarid>:<vtodo-uid>`, built by the server. `calendarid` is the shared calendar row, the same for the owner and every sharee. The client gets it from `GET /tasks/items/{taskId}/text` and never builds it.
- **Parsing the key:** the literal prefix `task:`, a decimal `calendarid`, one `:`, then **the whole remainder** as the UID (server UIDs are `urn:uuid:…`; native UIDs may hold colons or slashes). No digits or an empty UID: `403`.
- `CollabJoinAuthorizer::assertMayJoin` and `accessFor` check the `task:` prefix **before** the "a slash means a Drive path" test. A task room resolves to the VTODO with that UID in that calendar, then to the caller's accessible instance on it (`CalendarCollectionAccess`, dismissed and hidden shares excluded). No object or no instance: `403`. Access is `write` when the instance is writable, `read` otherwise.
- A note whose UID starts with `task:` can no longer open a room. App notes have UUIDs; a foreign journal with that UID is not a supported case (Decision 17 of `notes.md`).
- The rest of the join is unchanged: the per-poll re-check ends the session when read access goes, `refreshAccess` narrows the ticket when write access goes, and peers drop updates from a `read` peer.

### Shared server core

Notes and Tasks use one server core for live text. Today the rules live in `NoteCollaborativeWrite` and `NoteYjsProjection`; a Tasks copy would be the same code with other field names.

- **`App\Services\Collab\CollabTextState`** holds every rule that does not depend on the app:
  - the content tag: `sha1` of the fields joined with `"\0"`, in the order the app gives. Notes passes `[body, title ?? '']`, which is today's `hashContent`, so stored Notes tags stay valid;
  - the state precondition (`428` without one while a state exists, `412` on a mismatch or on `If-None-Match: *` over an existing state);
  - "is this an outside write" (object ETag moved and content tag differs) and "does `X-Wgw-External-Write` name the current text" (never `*`);
  - the unseen-outside-write guard: a save over an outside write that does not name its text gets `409 external_write`;
  - the **first-save check**: a save with no state row that names a content tag in `X-Wgw-External-Write` gets `409 external_write` when, under the lock, the object's content tag differs from it. The text the client seeded from is then no longer the server's, and the client must see the new text first. Tasks always sends it on a no-state save (API); Notes sends no header on a first save today and is unaffected;
  - the locked transaction: `lockForUpdate()` on the object row, then the state row, and a re-read of both;
  - storing the state row (state bytes, object ETag, content tag) and the 256 KiB cap (`413 state_too_large`).
- **`CollabTextFields`** is what each app supplies: the state model and row for an object, and the ordered text fields it holds. Notes reads the first VJOURNAL `DESCRIPTION` and `SUMMARY` through `NoteIcsConverter`. Tasks reads the VTODO component with the row's `vtodo_uid`.
- **`NoteCollaborativeWrite` and `NoteYjsProjection` become thin callers** in the first chunk, before any Tasks code. Nothing a Notes client sees changes; the existing Notes collab tests are the proof and are not edited.
- **The tables stay separate** (`note_yjs_state`, `task_yjs_state`). One table would need a data migration of every stored Notes state for no change anyone sees.

### Stored state

- `task_yjs_state`: `id`, `calendar_object_id` (FK to `calendarobjects.id`, `ON DELETE CASCADE`), `vtodo_uid` (the component's real `UID`, also for a single-VTODO object, so the row still matches after a native client adds a second VTODO), `state` (`MEDIUMBLOB` on MySQL, as the `note_yjs_state` migration does), `object_etag`, `content_etag`, timestamps. Unique `(calendar_object_id, vtodo_uid)`.
- `content_etag` is the core's content tag of `[description, title]` as the stored state holds them. A metadata write (status, due, assignee, alarm) changes `object_etag` and leaves the text alone, so it is not an outside write.
- A move (REST or CalDAV `MOVE`) creates a new object, so the state row goes with the old one and the room key changes. The next join seeds from the text.
  - **The state never moves with the task** (decided by the product owner, 2026-11-18). A Yjs state holds edit history: depending on garbage collection, text deleted in the old list and traces of who typed it. Carrying it over would let the new list's audience recover text meant only for the old list, a leak across the ACL boundary. The title and notes move as plain VTODO text; the old state row and room are dropped, and the target list seeds afresh from the current text. Clients still in the old room follow the edge case "A task moved to another list while a room is open" below: they close the old room and join the new one if they can read the target list, otherwise the access-lost path runs. A move never reuses the old document: the client does not adopt, rebuild from or save the old Yjs state on the moved task; the new room seeds only from the current title and notes. This follows the same rule as threads (#2231): what belongs to a list does not move silently with it.
- Title and description stay capped at 4 096 and 8 192 characters, as in `TaskPatchRequest`.

### Every task write takes the lock

A text save changes the object every few seconds, so a status `PATCH` that read the object before a text save must not write its stale ICS after it.

- Every `rewriteOwnedTask` write (REST `PATCH` and `PUT`, MCP, move) and the text `PUT` run in one `wgw` transaction through the core's locked transaction, check `If-Match` on the **locked** row (not on the unlocked read it does today, `TaskRepository.php:293`), and build the ICS from the locked read. This is what `NoteRepository::patch` already does for notes.
- A `PATCH` that read the object before a text `PUT` and reaches its write after it therefore gets `412` and writes nothing; the client's disjoint-field retry (below) lands it with the new ETag.

### API

New sub-resource under the existing `wgw.tasks` middleware group; `{taskId}` is the REST task id. It mirrors the Notes collab routes.

- `GET /api/v1/tasks/items/{taskId}/text` returns `{ title, description, room, objectEtag }` with `ETag` set to the content tag of the current object. `objectEtag` is the calendar object's ETag; every write changes it, also one that puts back an earlier text. Read access.
- `GET /api/v1/tasks/items/{taskId}/text?format=yjs` returns the stored state with `ETag` set to the state tag and `X-Wgw-External-Write: 1` when the core says the object holds an outside write, exactly as Notes does. No row: `204`. Read access.
- `PUT /api/v1/tasks/items/{taskId}/text`: the framed payload Notes uses (`FramedPayload`), where the document part is the description and `title` is the title. Write access.
  - The core's state precondition (`If-Match` on the state tag, or `If-None-Match: *` with no state) and its unseen-outside-write guard (`409 external_write` unless `X-Wgw-External-Write` names the current text).
  - **With no state row**, the save must name the content tag of its server base in `X-Wgw-External-Write` (`428` without it). The core's first-save check answers `409 external_write` when the object's text moved on since, and writes nothing. So a native edit that landed after the room seeded, whether seconds or days ago, is never overwritten unseen.
  - The text is applied as a patch of `title` and `description` (`""` removes `DESCRIPTION`) through the shared task write path, so the list write check, multi-VTODO handling, search index, #2172's change set, #798's status notification logic and #2173's activity writer all run as for a REST `PATCH`. The object and the state row are written in one transaction.
  - A blank or whitespace-only `title` gets `422 title_required`.
  - `200 {ok: true}` with `ETag` set to the new state tag. Errors use the shared envelope.
- `PATCH` and `PUT /tasks/items/{taskId}` are unchanged. API callers that set `title` or `description` there keep working; the room sees their change as an outside write.

### Client session (text-fields shape)

- `DocsCollabUrls` gains `documentShape: "text-fields"`. The shared session asks the shape for three things, and the existing shapes keep their current code:
  - **Seed:** write `note-title` and `plain-body` from the text into a throwaway document with `seedClientId("text-fields", title + "\0" + description)`, with no TipTap editor. Two clients seeding the same text produce byte-identical updates.
  - **Empty:** neither `note-title` nor `plain-body` is in `doc.share`. Today "empty" is `isYDocEmpty`, which reads (and so creates) the `default` fragment; every place that calls it (`shouldApplyImmediateSeed`, `shouldSeedOffline`, `markSeedDoneAfterSnapshot`, `isMeshDocumentHydrated`) asks the shape instead, so a restored offline task is not seeded twice and no fragment appears.
  - **Save body:** `plain-body` as the document part, `note-title` as `title`. Text is sent as typed: no trim.
- **Server base.** The document records in a `Y.Map` `text-fields-meta`, key `base`, what it last took from the server: `{contentTag, title, description, vector}`, the text normalised to `\n`. `vector` covers **only content the server wrote or a seed wrote**, never the live document, so it is the same on every peer and never covers a peer's unsaved typing. Writers, and only these:
  - the first seed writes `base` **inside its throwaway seed document**, so two peers seeding the same text are byte-identical; the document is empty, so nothing is overwritten. `vector` is the seed's own vector;
  - a replacement (steps 3 and 4) writes `base` **on the live document**, in the same transaction as `adoptServerSnapshot`, right after it, with `EXTERNAL_REPLACE_ORIGIN`. A write in a fresh throwaway would not be causally after the value it replaces, and Yjs could keep the old value by client id; a write on the live document takes the current item as its origin and always wins. `vector` is the applied delete limit joined with the seed's client and clock. Two peers making the same replacement write the same value, so either item is correct;
  - a save that lands writes `base` (`vector` = the state vector of the stored update) **only if** `text-fields-meta` is unchanged since that save was encoded, a compare-and-set on the local document. A replacement or a peer's newer `base` that arrived meanwhile wins, and the save writes nothing;
  - an adopt (step 1) writes `base` only when the applied snapshot carries none, with `vector` from the snapshot bytes. A snapshot written by this code always carries one, so in practice an adopt writes nothing and takes the snapshot's `base` as Yjs merges it;
  - step 2 writes nothing when `base.contentTag` already equals the server's; otherwise it updates `contentTag`, `title` and `description` and copies `vector` from the current `base`, with the same compare-and-set.

  Every `text-fields-meta` write uses `EXTERNAL_REPLACE_ORIGIN`, which is published and is not local work, so writing it never starts a save. It travels over the mesh, across tabs and in IndexedDB. Besides the delete limit, `base` gives the content tag a no-state save names and the title the leave-restore puts back.
- **Seed and replacement seeds.** `text-fields-meta`, key `seed`, names the client id of the live seed. Only a seed writes it. The first seed writes it inside its throwaway (the document is empty). A replacement writes it **on the live document** in the same transaction and with the same origin as its `base` write, after `adoptServerSnapshot`, so the new value is causally after the old one and always wins; the replacement's text, and its entry in a `Y.Map` `text-fields-seeds` (client id → `true`, one key per seed), stay in the throwaway so two peers' seed bytes are identical. An adopt, a landed save or step 2 never touch `seed`; a stale snapshot's older value is causally before the live write and merges as a no-op. Two rooms can replace at the same moment from different reads (two quick native writes, or a status `PATCH` that moved `objectEtag` between two peers' reads); after sync both seeds are present, both `seed` writes are concurrent, and Yjs picks the same one on every peer; both candidates are live seeds. **Cleanup:** whenever `seed` or `text-fields-seeds` changes, by a local or a remote update, each replica deletes the items of every client in `text-fields-seeds` other than the one `seed` names now, with `EXTERNAL_REPLACE_ORIGIN`. A replacement runs it only after its own `seed` write, so it never deletes the seed it just applied. Neither concurrent replacement deleted the other's seed, so the survivor is always live; deletes are idempotent, so every peer ends on one text, once, and a later re-read cannot bring the loser back. Older seeds were already deleted by the replacement that followed them.
- **Pending local work** is the shared input as Docs and Notes have it: this client's own edits since its last landed save (`localDirtySinceLastSave`, `pendingServerSave` in IndexedDB). Remote, tab and server origins never set it, and neither does the text-fields replacement origin (`EXTERNAL_REPLACE_ORIGIN`, published like `EXTERNAL_REBUILD_ORIGIN` but not local work). So a peer's unsaved typing that arrived over the mesh does not make this client's person the one who is asked, and a quiet replacement never asks or saves. The text-fields save gate follows it: a document with no own edit since `base` sends no `PUT`, also on reconnect.
- **Line ends:** outside text is normalised to `\n` when it is seeded, compared or replaced, because a textarea reports `\n` only. A `DESCRIPTION` with `\r\n` from a native client is saved back with `\n`.
- **The re-read.** The shared session re-reads (`mergeServerState`) on join, on reconnect and after a refused save. For tasks it is also called when the open task's `Task` push (or `/changes` poll) brings a `title` or `description` that differs from the text the document **holds now**; a peer's save that the mesh already delivered triggers nothing. The session exposes that call for any app. For the text-fields shape the re-read reads `?format=yjs` and then `GET …/text`, also when the first answers `204`, and runs the **first** of these cases that matches; the others do not run:
  1. **A stored state without the outside-write flag** (a peer's save, a reconnect after a peer saved, a fresh join): `adopt`. Apply the snapshot with `SERVER_ORIGIN`; publish nothing, send nothing. `base` and `seed` come with the snapshot (Server base). The one condition (security review, #2227): when the yjs read's `X-Wgw-Content-Tag` equals the content tag of the text read, so both are one save, the state is adopted only when its `note-title` and `plain-body` equal the served title and description. A state that holds another text, or cannot be read, goes to step 3 or 4. Tags that differ (a save landed between the two reads) adopt.
  2. **The server text equals the document** (normalised): the Server base rule for step 2, which usually writes nothing. Nothing else.
  3. **An outside write (`204`, or the flag set), no pending local work:** replace quietly. Apply the stored state (none on `204`); seed the server text with the text-fields seed salted with `objectEtag`; apply it with `adoptServerSnapshot`, deleting items up to the **delete limit**: per client the larger clock of the stored state's vector and `base.vector`, plus every client in `text-fields-seeds`. Everything the server or an earlier replacement wrote is in that limit and goes; a peer's unsaved typing written after `base` is outside it and stays, as in Notes. Set `base`; publish with `EXTERNAL_REPLACE_ORIGIN`; send no `PUT`.
  4. **An outside write with pending local work:** raise the shared question and hold every save, including the leave-restore below, until the person answers. "Use the other version" is step 3 with this client's own items added to the delete limit, so it removes this person's typing and never a peer's. "Keep mine" saves the document as it is, naming the new server text's content tag in `X-Wgw-External-Write` (with a state: `If-Match` on the state tag; without: `If-None-Match: *`).

  A save refused with `409 external_write` runs the same re-read; it reaches step 4 only when this person typed.
- **Seed salts.** The first seed of a document uses `seedClientId("text-fields", title + "\0" + description)`, so two clients that seed the same text are byte-identical. Every replacement salts the seed with `objectEtag`, which every peer reads from the same response and which changes on every write. Text that returns to an earlier value (`Buy milk` → `Buy oat milk` → `Buy milk`) therefore gets new items instead of reusing the deleted ones of the first seed, which Yjs would keep deleted.
- **The question.** Tasks wires `useDocsExternalWriteRequest` and `useDocsExternalWritePrompt` as Notes does, and shows `CollabExternalWriteDialog` with task labels: "This task was changed elsewhere", "Keep mine", "Use the other version".
- **Blank title.** While `note-title` is blank or whitespace-only, the save is held (title and description: one `PUT` carries both) and the field shows "A task needs a title", like the over-limit hold. When the person leaves the task with a blank title, the client writes the title from `base` back into `note-title` as a normal local edit (`writeNoteTitle`). If the document then equals `base`, nothing is sent. Otherwise (a held description) it saves through the normal guarded save; a `409` or another refusal after the person has left parks the unsaved text for the rescue view (`parkTask`) instead of writing over the other version. Only the last writer to leave the room does this; a peer still in the room keeps typing and receives the title over the mesh.
- **Two tabs** of one browser share the IndexedDB document and the cross-tab channel, as in Notes.

### Detail view and form

- `TasksDetailView` mounts the room through `useTaskTextCollab({ task, readOnly, username, displayName })`, modelled on `useNoteBodyCollab`: live API only, one room per open task, `holdTaskTextRoom(taskId)` while it is open so push sync knows the room leads.
- Unlike a note room, a held task room does not drop `title` or `description` from the inbound task: they are the signal for the re-read above. They are kept in the cache but never written into the bound fields.
- It wraps the view in the existing `NoteCollabYDocProvider`, so the title (rendered by `NoteDetailView`) binds to `note-title` with no Tasks code. The description `TextareaAutosize` binds through the generalised field hook with key `plain-body` and its own awareness field for carets.
- `title` and `description` leave `TASK_DETAIL_SAVE_DEBOUNCE_MS` and `taskEditPatch` while a room is open or loading. The other fields keep the 600 ms autosave. Without the live API the detail view behaves as today.
- While the room is loading, the fields show the stored text read-only, so nothing typed lands outside the document. Notes saves a title edit by `PATCH` in that window; for tasks that `PATCH` would come back as an outside write and raise the question.
- The list row shows the live title: the room projects `note-title` onto the in-memory task (`projectTaskTitle`, like `projectNoteTitle`) without a write.
- `rebaseTaskForm` (#1858) keeps working for the other fields; `title` and `description` drop out of its field groups while a room is open.
- `maxLength` is 4 096 on the title and 8 192 on the description. A merge of two people's typing can still push a field over its limit; the field then shows its "too long" hint and the save is held, and the text is not cut.

### Outbox and autosave (disjoint-field retry)

- Online autosave (`use-task-detail-autosave.ts:244`) and the outbox flush (`tasks-outbox-flush.ts:126`) both send `If-Match`. On a `412`, the client fetches the task once and compares, **for each field in the patch**, the server value with the value the patch was based on.
  - None changed on the server: send the same patch again with the server's ETag. No dialog, no error.
  - One did: today's behaviour (the conflict dialog from the outbox, the error and revert from the autosave).
- The base values are recorded when the patch is made: the autosave has the task it diffed against; an outbox row gets a `base` map of the patched fields' previous values, kept through `coalesceTaskPatches` (the first base of a field wins). Rows queued before this change have no `base` and keep today's behaviour.
- `title` and `description` leave `TaskConflictFieldKey`'s rows for tasks with a stored state; the room and its question handle them. Old outbox rows that carry them still flush as today.

### Access loss and read-only

- A read-only peer binds both fields read-only, receives updates and carets, and publishes no caret.
- A `403` on save, a `404` (the task was deleted or moved out of reach) or the signaling `403` while the room holds unsaved text: the client leaves the room, shows the fields read-only with "You no longer have access to this task. Your last changes were not saved here.", and parks the task with the document's text through `parkTask`, so the existing rescue view can create it in another list.
- A peer that loses access keeps its local copy of what it already received, the same gap Notes and Docs accept (Decision 8 of `notes.md`).

### Activity log (needs #2173)

- #2173's `ThreadActivityWriter` merges an entry into the thread's **newest** entry when it is by the same actor, for the same field, younger than 10 minutes.
- For `title` and `description` only, this Epic changes the rule to: merge into the **newest activity entry for the same field** when it is younger than 10 minutes and no comment or reply was posted after it, **whatever its actor**. The actor is added to a new `actors` list (the entry's author stays the first actor). `to` is updated for `title`; `description` stays a changed flag.
- If `from` then equals `to` and only one actor is listed, the entry is deleted, as #2173 already does.
- The formatter renders "Anna and Bob edited the notes", "Anna and Bob changed the title to 'Moodboard v2'", and "Anna and 2 others" for three or more.
- Every other field keeps #2173's same-actor rule. If this Epic is built before #2173 lands, chunk E is a change to #2173's spec instead.

## Edge cases

- **Two people type in the same sentence.** The CRDT keeps both. Each save carries everything merged so far.
- **Someone edits the task in Reminders while nobody in the room is typing.** The push triggers the re-read; every open room replaces its text quietly (step 3), with no question and no `PUT`. This holds on a task that was never co-edited (`204`) as well, and when the task is opened later from IndexedDB.
- **Someone edits the task in Reminders while a person in the room has unsaved typing.** That person gets the question: keep theirs or use the other version. Peers who typed nothing replace quietly and keep the typist's unsaved characters; once the person answers, everyone follows over the mesh. This is the Notes and Docs behaviour.
- **A peer saves while this browser has the task open.** The push and the mesh both bring it. If the mesh was first, nothing happens; otherwise the re-read adopts the stored state (step 1). Nothing is seeded, published or saved.
- **Two quick outside edits** (title, then notes, within seconds). Each re-read replaces the previous replacement; nobody who did not type is asked. When two rooms replace at the same moment from different reads, both seeds meet and the losing one is deleted (Replacement seeds), so the text is shown once.
- **Someone types while outside edits arrive.** A peer's unsaved characters are never in `base.vector`, so a quiet replacement, an adopt and a second replacement all keep them; only the typist's own "use the other version" removes them.
- **An offline edit, while the text also changed elsewhere.** On reconnect the re-read finds an outside write and this client's own pending edit: the question appears, as in Notes. On a task that was never co-edited the same holds (`204`), and its save would otherwise be refused by the first-save check.
- **First save of a task that was never co-edited.** No state row: the save sends `If-None-Match: *` and names its `base` tag. A native edit that landed after the seed makes it `409`, and the re-read shows the native text (quietly, or with the question if the person typed). A second client that also seeded gets `412` and takes the shared reload-and-merge path.
- **Two tabs, one offline.** Shared IndexedDB document and tab channel; the online tab saves.
- **A status change while someone types.** The status patch gets `412` (also when it read the object before a text save: the locked `If-Match` refuses it). Its field did not change on the server, so it is retried once with the new ETag. If another text save lands in between, the retry also gets `412` and today's error path runs.
- **A task moved to another list while a room is open.** The room key changes and the old state row is gone. The detail view closes the old room and joins the new one if the person can see the new list; otherwise the access-lost path runs.
- **A task in a multi-VTODO file.** The room and the state row are per component (`vtodo_uid`); a save rewrites only that component.
- **A recurring task.** Title and description live on the master, as for a REST `PATCH`.
- **A task created offline.** Until its create lands it has only a temporary id; it opens **without a room** and edits go into the queued create, as today. The room opens once the task has its server id.
- **The title is blanked.** The save is held and the field says why. Typing a new title releases the save. Leaving with a blank title puts the stored title back (Blank title, above). Two writers leaving at the same instant could both put it back; the title would then show twice until someone fixes it. That is rare and visible, and accepted.
- **Over the limit after a merge.** The save is held with the "too long" hint; nothing is cut.
- **A completed or cancelled task** stays editable, as today.
- **Search** re-indexes each save, as for a `PATCH`: one re-index per ~3 s per typist.
- **Push load.** Each save is a task write, so every client of that list gets a `Task` state change and fetches one task, the same per-save cost Notes has.
