# Discussion thread and activity log on a task — plan

Source spec: [spec.md](./spec.md). Shared design: [docs/architecture/threads.md](../../../docs/architecture/threads.md). Lines are pinned to `db6a4f161`.

## Goal

Every task gets a conversation, and later a record of what changed, in one timeline that the list's audience can read. It is built on one thread module that Chat and Docs already need, so this is not a third copy. Everything that is not about tasks (storage, API, access through a subject type, lifecycle, push, notifications, activity, panel and offline) is shared, so comments on notes or on a future app need only a small subject type on each side. The rule "the history belongs to the list" keeps a moved task from carrying its past to a new audience.

## Budget

This draws from the Tasks Pioneer budget (Product#87 is Identified, with no milestone). Chunk A, the shared module, also pays down duplication in Chat and Docs, so it partly draws from Technical debt. It displaces nothing scheduled. It starts after #2172's chunks A and B (audience, change set and observer) have landed.

## Non-goals

See spec.md, Non-goals.

## What exists

- **Docs threads.**
  - One VJOURNAL per message in a hidden per-owner pool, `docs-threads`. `path: packages/api/app/Services/Docs/DocsThreadCollectionUris.php:18`, `path: packages/api/app/Services/Docs/DocsThreadPoolProvisioner.php:47`
  - The converter writes a root, or a reply with `RELATED-TO`, and states that it mirrors Chat. `path: packages/api/app/Services/Docs/Conversion/DocsThreadJournalConverter.php:17`, `path: packages/api/app/Services/Docs/Conversion/DocsThreadJournalConverter.php:65`
  - A side index table. `path: packages/api/database/migrations/wgw/2026_09_12_000390_wgw_create_docs_thread_index.php:16`
  - Access comes from the document's Drive share. `path: packages/api/app/Services/Docs/DocsThreadDocAccess.php:27`
  - The repository: create, and its own reaction toggle. `path: packages/api/app/Services/Docs/DocsThreadRepository.php:65`, `path: packages/api/app/Services/Docs/DocsThreadRepository.php:610`
  - Its own display names and idempotent insert. `path: packages/api/app/Services/Docs/DocsThreadRepository.php:586`, `path: packages/api/app/Services/Docs/DocsThreadRepository.php:644`
- **Chat.**
  - Stored mentions. `path: packages/api/app/Services/Chat/Conversion/ChatMessageJournalConverter.php:75`
  - Edit. `path: packages/api/app/Services/Chat/Conversion/ChatMessageJournalConverter.php:100`
  - Tombstone. `path: packages/api/app/Services/Chat/Conversion/ChatMessageJournalConverter.php:118`
  - The same body limit and author property as Docs. `path: packages/api/app/Services/Chat/Conversion/ChatMessageJournalConverter.php:39`, `path: packages/api/app/Services/Docs/Conversion/DocsThreadJournalConverter.php:32`
  - The repository has its own reaction toggle and display names. `path: packages/api/app/Services/Chat/ChatMessageRepository.php:470`, `path: packages/api/app/Services/Chat/ChatMessageRepository.php:557`
  - The parent check on create. `path: packages/api/app/Services/Chat/ChatMessageRepository.php:175`
  - Mention notifications. `path: packages/api/app/Services/Chat/ChatMessageRepository.php:580`
- **Hidden collection kinds.**
  - `ChatChannel` and `DocsThreadPool` are DAV-hidden. `path: packages/api/app/Services/Calendars/CollectionKind.php:25`
  - They are filtered out of the CalDAV home. `path: packages/api/app/Dav/Server/WgwCalendarBackend.php:321`
  - Tested. `path: packages/api/tests/Feature/Dav/ChatCollectionsDavExposureTest.php:167` (`test_docs_thread_pool_is_dav_invisible_while_notes_stay_dav_visible`)
- **Docs threads follow a document to another owner's pool.** This is the opposite of this Epic's rule for tasks. `path: packages/api/app/Services/Docs/DocsThreadPathSync.php:19`
- **Docs thread notifications** are grouped per thread with a dedupe key, and Docs mention notices wait for stored mentions. `path: packages/api/app/Services/Notify/DocsThreadActivityNotify.php:119`, `path: packages/api/app/Services/Notify/DocsThreadActivityNotify.php:14`
- **The JMAP push types.** `ChatMessage` exists. There is no thread type, and Docs threads poll every 4 s. `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:36`, `path: packages/apps/src/docs-core/src/collab/use-docs-threads-source.ts:16` (this file moved after `db6a4f161`, so this pin is to main at `f54d7aff3`)
- **chat-ui exports** the composer, mention menu, message, list, thread panel and reaction bar. `path: packages/apps/src/chat-ui/src/index.ts:1`
- **There is no activity or history log anywhere.**
  - `calendarchanges` holds only uri, synctoken and operation. `path: packages/api/resources/installer/sql/mysql/calendars.sql:43`
  - The only audit table is MCP-only. `path: packages/api/database/migrations/wgw/2026_09_08_000350_wgw_create_mcp_audit_and_sessions.php:13`
- **From Epic #2172 (planned, not on main yet):** `TaskListAudience`, `TaskChangeSet` and `TaskChangeObserverPlugin`. Spec in [PR #2175](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/2175), `.agents/specs/2172-task-assignees/spec.md` on that branch.
- **Deleting a task list.** A sharee's delete only dismisses their copy. `path: packages/api/app/Services/Tasks/TaskListRepository.php:191`, `path: packages/api/app/Services/Tasks/TaskListRepository.php:198`
- **CalDAV write methods include `MOVE`.** `EventDispatchPlugin` fires after it, with source and destination. `path: packages/api/app/Dav/Server/EventDispatchPlugin.php:29`
- **Only Drive directories implement `IMoveTarget`.** A calendar object `MOVE` is a copy and then a delete inside one request. `path: packages/api/app/Dav/Storage/FlysystemDirectory.php:11`
- **Task import.** `path: packages/api/app/Services/Tasks/TaskImportService.php:29`
- **Moving a task in the web app.** Three paths: the detail view asks for a confirm, the multi-select dialog picks a list, and a drag onto a sidebar list moves at once with an Undo toast. `path: packages/apps/src/tasks-core/src/use-tasks-mutations.tsx:202`, `path: packages/apps/src/tasks-core/src/tasks-labels.ts:370`, `path: packages/apps/src/tasks-core/src/tasks-workspace.tsx:438`, `path: packages/apps/src/tasks-core/src/tasks-workspace.tsx:88`, `path: packages/apps/src/tasks-core/src/tasks-labels.ts:343`
- **Offline sends.** The core outbox queues rows per domain and flushes them in order; queued rows can follow an entity that the server re-keyed. Chat queues sends, edits, deletes and reactions with client ULIDs, and the server's create is idempotent on that ULID. `path: packages/apps/src/lib/offline/core/outbox-store.ts:10`, `path: packages/apps/src/lib/offline/core/outbox-store.ts:151`, `path: packages/apps/src/lib/offline/core/outbox-flush.ts:83`, `path: packages/apps/src/lib/offline/meet-chat/meet-chat-outbox-flush.ts:87`, `path: packages/apps/src/lib/offline/meet-chat/chat-ulid.ts:46`, `path: packages/api/app/Services/Chat/ChatMessageRepository.php:160`
- **Chat drops a queued send whose channel is gone.** Task comments must not copy that: their text is kept. `path: packages/apps/src/lib/offline/meet-chat/meet-chat-outbox-flush.ts:78`

## Considered

- **The existing components.**
  - The Docs pool pattern (a hidden per-owner VJOURNAL pool plus an index) is reused for task threads.
  - Chat's message model (stored mentions, edit, tombstone, reactions) is reused as the entry model.
  - chat-ui is reused for the composer and messages.
  - A third set of converter and repository copies was rejected. Chunk A extracts the shared core first.
- **Building the thread service, panel and offline queue for Tasks only** (the first version of this plan) was rejected by the product owner on 2026-11-16. A later app would have had to copy the repository, routes, lifecycle, push, notifier, panel and outbox. The cost of the shared layer now is a small interface on each side and one test-only subject type; the code size hardly changes.
- **Moving Chat and Docs onto subject types in this Epic** was rejected as scope. Chat's channels are their own collections and Docs threads follow a document between owners, so both need their own decisions. Chunk A gives them the shared converter core; the rest is a follow-up in threads.md.
- **One generic route with the subject in the body** (`POST /threads` with `{subjectType, subjectId}`) was rejected in favour of the subject in the path, so access is resolved before the body is read and 404s look the same for every type.
- **One pool per task list instead of per owner** was rejected. It would double the hidden collections, and sharing a list would need a second share on its pool. The per-owner pool keyed by list and UID gives the same isolation.
- **Carrying the thread along when a task moves within the same owner** (first proposal to the product owner, 2026-11-14) was rejected. A move from a private list to a shared list of the same owner would show private history to the sharees. Keying on the list is the only rule that never shows history to a new audience. Its cost: comments stay behind on any move. The product owner agreed on 2026-11-16, on condition that the web app says so when a task is moved (spec.md, UI, Move confirmation).
- **A per-period or per-join history grant** (new members see only entries after they joined) was rejected. No comparable tool does it, it conflicts with comments being readable, and it needs membership history the server does not keep.
- **Storing the activity log in a SQL table** instead of VJOURNAL entries in the thread was rejected:
  - it is one timeline with one access rule, one push type and one delete path;
  - the entries stay in the same backup and export as the comments;
  - the product owner asked for "vjournal uiteraard".
- **Storing rendered text** ("Anna changed …") was rejected in favour of `{field, from, to}`. Text would be frozen in one language and time zone, and names would go stale.
- **Logging through `EventDispatchPlugin`** was rejected, because it has no before/after content. The activity writer reads #2172's change set.
- **Moving Docs threads onto `thread_index` and push in this Epic** was rejected as scope. Named as a follow-up in threads.md.
- **A read-only offline state** (cached thread, composer disabled) was the first proposal. The product owner chose offline commenting on 2026-11-16. Chat's outbox flush is Meet-specific code, but the core outbox it runs on is shared, so chunk H builds one shared threads flush (`lib/offline/threads/`) on the core outbox and copies Chat's row shapes, not its code.
- **Dropping a queued comment whose task is gone**, as Chat drops a send to a deleted channel, was rejected. A comment is the author's own text; it stays "Not sent" with Copy and Discard.
- **Placing an offline comment at the time it was written** was rejected. Other people would get it in the thread's past, below entries they already read. The server's arrival time is used.
- **Read access is enough to comment** (the Goal's first wording) was rejected by the product owner on 2026-11-17. Commenting, replying and reacting need write access to the list; read-only people read along.
- **A 30-day purge of entries left under an old key** (a `thread_subject` table with a leave time, leave hooks on every delete and move path, and a daily `threads:purge-orphans` job that also stamped keys a hook missed) was the earlier design. The product owner dropped it on 2026-11-17 as moving parts for little gain. Hidden entries now stay until the owner deletes the list. Cost: comments on deleted tasks keep using storage; they are small text entries and stay hidden.
- **Showing activity rows by default** was the first proposal. The product owner chose comments only by default on 2026-11-17; "Show changes" turns the rows on.

## Affected packages

- `packages/api`
- `packages/apps`
- `docs`

## Dependencies

1. #2172 chunks A and B are on main: audience, stable participant ids, change set and observer.
2. Chunk A (shared module, Chat and Docs moved onto it) comes before B.
3. B (pool, API, access, lifecycle) comes next. Then C (push), D (notifications) and E (thread panel UI) run in parallel.
4. F (activity writer) comes after B. G (activity rows UI) comes after E and F. H (offline comments) comes after B and E.
5. V comes last.

## Open decisions

- [x] Thread history is keyed on the list, so any move starts fresh. Product owner, 2026-11-16: agreed, and every move in the web app says what happens to the comments. It affects chunks B and E.
- [x] Commenting, replying and reacting need write access to the list; read access only reads. Product owner, 2026-11-17 (it reverses the Goal's first wording). It affects chunks B, E and H.
- [x] No time-based purge: entries left under an old key stay hidden until the owner deletes the list. Product owner, 2026-11-17. It affects chunk B.
- [x] The thread shows comments only by default; "Show changes" turns activity rows on. Product owner, 2026-11-17. It affects chunk G.
- [x] No moderation and no alarm logging in this Epic; notifications go to assignees, earlier participants and mentioned people only. Product owner, 2026-11-17.
- [x] Mentions and comment notifications are in scope. Product owner, 2026-11-16. It affects chunk D.
- [x] Commenting works offline through a shared threads outbox. Product owner, 2026-11-16. It adds chunk H and the `scopeId` check in chunk B.
- [x] Threads are a shared layer with Tasks as its first subject type, so another app can reuse it. Product owner, 2026-11-16. It shapes chunks B to H.

## Invariants

- **Chat and Docs write the same ICS and return the same API responses after chunk A.** A wrong change would silently change stored messages, or break older clients. Proof:
  - `path: packages/api/tests/Unit/Chat/ChatMessageJournalConverterTest.php`, assertion `test_round_trip_preserves_all_message_fields`;
  - `path: packages/api/tests/Unit/Docs/DocsThreadJournalConverterTest.php`, assertion `test_comment_root_round_trip_preserves_kind_path_and_anchors`;
  - new golden-ICS tests in `path: packages/api/tests/Unit/Threads/ThreadEntryGoldenIcsTest.php`, assertion `test_chat_and_docs_bytes_unchanged` (written before the move, chunk A).
- **Docs comment permissions do not change.** Proof: `path: packages/api/tests/Feature/Docs/DocsThreadsTest.php`, assertion `test_comment_sharee_can_persist_view_only_cannot`.
- **Thread pools never show up over CalDAV.** A wrong change would expose comments to every native client. Proof: `path: packages/api/tests/Feature/Dav/ChatCollectionsDavExposureTest.php`, assertion `test_docs_thread_pool_is_dav_invisible_while_notes_stay_dav_visible`, plus a new `test_thread_pool_is_dav_invisible` in the same file (chunk B).
- **The shared thread layer has no task code.** A wrong change would tie the layer to tasks again, and the next app would copy it. Proof: `path: packages/api/tests/Feature/Threads/ThreadServiceWithFakeSubjectTest.php`, assertion `test_post_list_and_react_work_for_a_non_task_subject` (new, chunk B); `path: packages/apps/src/thread-ui/thread-panel.test.tsx`, assertion `renders and posts for a non-task adapter` (new, chunk E); `cmd: git grep -n -E 'Services\\Tasks|tasks-core|offline/tasks' packages/api/app/Services/Threads packages/apps/src/thread-ui packages/apps/src/lib/offline/threads` returns nothing (no shared file imports task code).
- **A viewer never sees entries written under another list.** A wrong change would leak a private list's history to a Team after a move. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_moved_task_shows_a_fresh_thread_to_the_new_audience` (new, chunk B).
- **Someone who cannot see the task gets 404 on every thread route, including reactions and changes.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_every_thread_route_is_404_without_list_access` (new, chunk B).
- **Nobody can edit, delete or create an activity entry through the API.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_activity_entries_are_read_only` (new, chunk B).
- **A failed or unauthorized CalDAV write logs no activity.** Proof: `path: packages/api/tests/Feature/Tasks/TaskChangeObserverPluginTest.php`, assertion `test_forbidden_caldav_put_on_read_only_list_notifies_nobody` (#2172), extended in chunk F with an activity assertion.
- **A thread hook failure never fails the task write.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertion `test_thread_hook_failure_keeps_the_task_write` (new, chunk B).
- **A native client's move never destroys or leaks a thread.** A CalDAV `MOVE` acts like a REST move. A `DELETE` then `PUT` keeps the source entries under the source key, and shows them to nobody else. A wrong change would delete a thread for good on an Apple or Thunderbird move, or show list A's history in list B. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertions `test_caldav_move_writes_moved_here_and_keeps_source_entries`, `test_delete_then_put_elsewhere_starts_fresh_and_keeps_source_entries`, `test_writing_the_uid_back_shows_the_old_entries_again`, `test_deleted_task_entries_stay_until_the_owner_deletes_the_list` (new, chunk B).
- **Push state never changes for lists the user cannot read.** A wrong change would leak the timing of activity in another person's private list. Proof: `path: packages/api/tests/Feature/Jmap/JmapEventSourceThreadTest.php`, assertion `test_state_ignores_threads_in_unreadable_lists_of_the_same_pool` (new, chunk C).
- **Only the owner deleting a list removes its thread entries.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertion `test_sharee_dismiss_keeps_thread_entries` (new, chunk B).
- **No idle polling is added.** The thread panel polls only while it is open, visible and push is down. Proof: `path: packages/apps/src/thread-ui/use-thread.test.ts`, assertion `does not poll while push is up or the panel is closed` (new, chunk E).
- **A comment written offline is stored once, however often it is sent.** A wrong change would duplicate comments after a flaky reconnect or two tabs flushing. Proof: `path: packages/api/tests/Feature/Threads/ThreadApiTest.php`, assertion `test_post_with_the_same_ulid_twice_stores_one_entry` (new, chunk B); `path: packages/apps/src/lib/offline/threads/threads-outbox-flush.test.ts`, assertion `sends a queued comment once across two flushes` (new, chunk H).
- **A queued comment never lands in another list's thread without its author's say.** A wrong change would show a comment written for one audience to another. Proof: `path: packages/api/tests/Feature/Threads/ThreadApiTest.php`, assertion `test_post_with_a_stale_scope_id_is_409_and_stores_nothing` (new, chunk B); `path: packages/apps/src/lib/offline/threads/threads-outbox-flush.test.ts`, assertion `keeps a comment whose task moved as not sent` (new, chunk H).
- **An entry under another key can never be read or written through the subject's routes.** A wrong change would let someone who can see the task in list B react to, reply to or edit an entry left in list A. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_entry_from_another_list_is_404_and_is_not_written` (new, chunk B).
- **A retry after a move never stores a comment twice.** Proof: `path: packages/api/tests/Feature/Threads/ThreadApiTest.php`, assertion `test_retry_of_a_stored_id_after_a_move_is_already_stored_and_writes_nothing` (new, chunk B): the caller cannot read the old list, and the new list's entry count stays the same; plus `test_a_ulid_taken_by_another_person_gets_a_fresh_id` (new, chunk B).
- **An offline comment never sorts into the thread's past.** Proof: `path: packages/api/tests/Feature/Threads/ThreadApiTest.php`, assertion `test_entries_sort_by_arrival_not_by_ulid_time` (new, chunk B).
- **Someone with read-only access to the list can read the thread but write nothing.** A wrong change would let a passive share comment, react or edit. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertions `test_read_only_sharee_reads_but_every_write_is_403` and `test_read_only_retry_of_the_callers_own_ulid_returns_200_or_already_stored` (new, chunk B); `path: packages/apps/src/thread-ui/thread-panel.test.tsx`, assertion `shows no composer, reply, reaction picker, edit or delete when the adapter cannot post` (new, chunk E).
- **Queued rows behind a comment that is not sent are not lost.** Proof: `path: packages/apps/src/lib/offline/threads/threads-outbox-flush.test.ts`, assertion `holds rows queued behind a comment that stays not sent` (new, chunk H).
- **A queued comment is never dropped silently.** Proof: `path: packages/apps/src/lib/offline/threads/threads-outbox-flush.test.ts`, assertion `keeps the text of a comment whose task is gone` (new, chunk H).
- **After chunk A, main still works with no task-thread code.** Proof: `cmd: pnpm test:api-done-gate`.

## Chunks

### Chunk A: Shared thread module; Chat and Docs moved onto it
- **Skill:** api
- **Inputs:**
  - the Docs converter (`DocsThreadJournalConverter.php:65`) and reactions (`DocsThreadRepository.php:610`);
  - the Chat converter (`ChatMessageJournalConverter.php:75`, `:100`, `:118`) and reactions (`ChatMessageRepository.php:470`);
  - display names (`ChatMessageRepository.php:557`, `DocsThreadRepository.php:586`).
- **Done when:**
  - Golden-ICS tests for Chat and Docs are added first and pass on the old code.
  - `App\Services\Threads\{ThreadEntryJournal, ThreadReactions, ThreadAuthorNames}` exist.
  - Both domain converters and repositories call them, and the duplicated private helpers are gone.
  - Golden, unit and feature tests pass unchanged.
  - `thread_index` migration added (unused by Chat and Docs).
- **Verify with:** `pnpm test:api-done-gate`; `cmd: git grep -n "function toggleReactionSet" packages/api/app` returns nothing.
- **Parallel with:** none

### Chunk B: Shared thread service and the task subject type
- **Skill:** api, security
- **Inputs:**
  - the hidden kinds (`CollectionKind.php:25`) and the pool provisioner pattern (`DocsThreadPoolProvisioner.php:47`);
  - the Docs repository and controller as the shape for the shared repository and routes (`DocsThreadRepository.php:65`);
  - list delete (`TaskListRepository.php:191`, sharee dismiss at `:198`);
  - CalDAV `MOVE` (`EventDispatchPlugin.php:29`, `FlysystemDirectory.php:11`);
  - #2172's audience, change set and observer.
- **Done when:**
  - In `App\Services\Threads`: `ThreadSubjectType`, `ThreadSubjectRegistry`, `CollectionKind::ThreadPool` (DAV-hidden) with a shared provisioner, the shared repository, `ThreadsController` with the routes from spec.md in OpenAPI, and `ThreadLifecycle` with `scopeDeleted()`.
  - In `App\Services\Tasks\Threads`: `TaskThreadSubject`, registered; the owner's list delete calls `ThreadLifecycle::scopeDeleted('task', …)`, and the move paths write "moved here".
  - The shared layer passes its tests with the test-only subject type (the "no task code" invariant).
  - The task access, move, delete, list-delete and limit rules are tested.
  - `POST …/entries` follows the retry order in spec.md: 200 for the caller's own ULID under the current key, 409 `already_stored` for the caller's own ULID under an earlier key, 409 `subject_moved` for a new ULID with a stale `scopeId`; none of them writes. A ULID already stored for this subject by the caller is never replaced with a fresh id, including when the caller cannot read the earlier scope; a fresh id is only for a ULID taken by another subject or another person.
  - Entry routes and `parentId` accept only entries under the subject's current key (404 or 422 otherwise, nothing written).
  - Lists sort and page by `(created_at, uid)`.
  - #2172's observer handles `afterMethod:MOVE` between task lists as a `moved` change set. #2172 leaves `MOVE` out on purpose, so this chunk adds it.
  - There is no purge job. A task delete or move deletes no entries; only the owner's list delete calls `scopeDeleted()`, which deletes only that subject type's entries in that scope (`test_scope_deleted_keeps_other_subject_types_in_the_same_scope` with the test-only subject type).
  - Every write route answers 403 without `canPost`; for tasks that is write access to the list. A retry of the caller's own stored ULID is answered by the post order first (200 or 409 `already_stored`), and a new ULID without `canPost` is 403 even with a stale `scopeId` (`test_read_only_retry_of_the_callers_own_ulid_returns_200_or_already_stored`). `GET …/entries` returns `canPost`.
  - The native-client move cases from spec.md (CalDAV `MOVE`; `DELETE` then `PUT`) are tested.
  - `docs/architecture/tasks.md` gets "Decision 18 — Task threads".
  - The B invariants pass.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none (chunk F also edits the observer, after B)

### Chunk C: `ThreadEntry` push type
- **Skill:** api, client-transport
- **Inputs:** the push types (`JmapPushStateResolver.php:36`).
- **Done when:**
  - `ThreadEntry` state is a hash of `max(thread_index.modseq)` per readable scope, over every registered subject type's `readableScopes`. For tasks it changes on any entry write in a readable list, and never for another list in the same pool that the user cannot read.
  - The client subscribes only while a thread panel is open.
  - Tests cover both.
- **Verify with:** `pnpm test:api-done-gate`, `pnpm test:apps-done-gate`
- **Parallel with:** D, E

### Chunk D: Thread notifications and mentions
- **Skill:** api
- **Inputs:**
  - the Docs grouping (`DocsThreadActivityNotify.php:119`);
  - the Chat mention notices (`ChatMessageRepository.php:580`);
  - the allow-list (`NotifyListener.php:30`).
- **Done when:**
  - The shared `ThreadNotifier` sends each subject type's two actions to the recipients in spec.md, never to the actor or to people outside the audience. It is tested with the test-only subject type too.
  - `tasks.thread_activity` and `tasks.mentioned` are the task actions. One row per person per task, with supersede.
  - The PHP and TypeScript formatters have the copy.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** C, E

### Chunk E: Shared thread panel, mounted in Tasks
- **Skill:** apps-ui, workspace, accessibility
- **Inputs:**
  - the chat-ui exports (`chat-ui/src/index.ts:1`);
  - the Docs threads source as the shape for `useThread` (`packages/apps/src/docs-core/src/collab/use-docs-threads-source.ts:100`, pinned to main at `f54d7aff3`);
  - the detail view fields (`tasks-detail-view.tsx:187`);
  - #2172's audience cache;
  - the product owner's mockup (`mockup-task-detail.webp` in this folder);
  - the three move paths (`use-tasks-mutations.tsx:202`, `tasks-workspace.tsx:438`, `tasks-workspace.tsx:88`).
- **Done when:**
  - `thread-ui/` has `ThreadSubjectAdapter`, `ThreadPanel` and `useThread`, and `lib/api/wgw/threads.ts` is the shared client. None of them imports from `tasks-core`.
  - The panel has comments, replies, reactions, edit and delete of your own messages, and mentions limited to the adapter's people, laid out as in spec.md, UI, Layout.
  - `tasks-core` has the task adapter and mounts the panel in the detail view.
  - A read cache offline in `lib/offline/threads/`, with "Last updated …".
  - The move confirm, the multi-select move dialog and the drag toast say that comments stay in the old list (spec.md, UI, Move confirmation), with Vitest on the label functions.
  - Mock API, Storybook stories for `ThreadPanel` with a stub adapter (empty, busy thread, tombstone, offline, a "Sending…" and a "Not sent" comment) and Vitest, including the polling invariant and a non-task adapter.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** C, D

### Chunk H: Offline comments
- **Skill:** workspace, client-transport
- **Inputs:**
  - the core outbox (`outbox-store.ts:10`, `:151`; `outbox-flush.ts:83`);
  - Chat's row shapes and re-key handling (`meet-chat-outbox-flush.ts:44`, `:87`) and its ULID (`chat-ulid.ts:46`);
  - the Tasks outbox flush as a second example of a domain flush (`tasks-outbox-flush.ts:188`);
  - chunk B's `scopeId` check and chunk E's panel.
- **Done when:**
  - `lib/offline/threads/` is one offline domain for every subject type. Comments, replies, edits, deletes and reactions queue there while offline and flush in order once online, with the composer enabled offline.
  - A queued send shows at once with "Sending…"; edits and reactions queued behind it follow a re-keyed id.
  - 404, 403 and 409 `subject_moved` keep the comment as "Not sent" with Copy and Discard, plus the adapter's "post where it is now" action on `subject_moved` only, which resends the same ULID. 409 `already_stored` shows "Kept in the previous list" with no repost. They show in the failed-outbox notice.
  - Rows queued behind a comment that is not sent stay held; Discard removes them with it, and a repost sends them after it.
  - Vitest for the flush (the H invariants) and for two tabs flushing at once.
  - A live Playwright spec: go offline, comment and reply, reload while offline and see both, go online, and a second user sees each comment once.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** F, G (after B and E)

### Chunk F: Activity writer
- **Skill:** api, security
- **Inputs:**
  - #2172's `TaskChangeSet` and `TaskChangeObserverPlugin`;
  - import (`TaskImportService.php:29`).
- **Done when:**
  - The shared `ThreadActivityWriter` takes `ThreadFieldChange`s for any subject type; `TaskThreadActivity` maps the task change set to them.
  - REST, MCP and CalDAV writes produce the entries in spec.md.
  - Quick edits are merged under a lock on the pool collection row, so two concurrent first writes to an empty thread are serialized too.
  - Imports write one `created` entry each.
  - An empty change set writes nothing.
  - Pruning keeps "created" and "moved here".
  - A CalDAV `MOVE` logs "moved here" in the destination. A `DELETE` then `PUT` logs `created`.
  - Tests for each field, for merging (including two concurrent first writes), for two actors, and for the CalDAV `PUT`, `MOVE` and `DELETE` then `PUT` paths.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none (after B)

### Chunk G: Activity rows
- **Skill:** apps-ui
- **Inputs:** chunk E's panel; the entry format from chunk F.
- **Done when:**
  - `thread-ui/format-thread-activity.ts` is pure and takes field labels from the adapter, with Vitest for every task field, merged entries, a removed person, the locale and time zone, and a stub adapter's own field.
  - `ThreadActivityRow` exists.
  - The "Show changes" toggle is off by default and remembered per user in localStorage, wrapped in try/catch.
  - Stories cover them.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none (after E and F)

### Chunk V: Cross-chunk verify
- **Skill:** testing
- **Done when:**
  - The verifier, prompted from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md), returns `PASS` or `PASS_WITH_NITS`.
  - A two-user browser e2e on a Team list: A comments and mentions B, B gets the notification and replies, and A sees the reply without reloading.
  - A renames the task and sets the priority. B sees only comments, turns on "Show changes", and both rows show in B's language.
  - C, with read-only access to the list, reads the thread and sees no composer.
  - A moves the task to a private list; the confirm says the comments stay behind. B no longer sees the task. A sees a fresh thread with "moved here".
  - B goes offline, comments, goes online, and A sees the comment once.
  - A Chat and Docs comment smoke test still passes.

## Test plan

- [ ] API: golden ICS first (chunk A); then OpenAPI, failing feature tests, the implementation and `composer done-gate` for each API chunk.
- [ ] UI: mock-tier Storybook, Vitest for the formatter, the polling rule, the offline cache, the move copy and the offline outbox flush.
- [ ] Live Playwright for offline comments (chunk H).
- [ ] E2E: two users, one Team list, plus a move to a private list (chunk V).

## Doc updates

- `docs/architecture/threads.md` (this PR).
- `docs/architecture/tasks.md`: Decision 18 and Known limitations (threads are web-only).
- `docs/architecture/notifications.md`: `tasks.thread_activity`, `tasks.mentioned`.
