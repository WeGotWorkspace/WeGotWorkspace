# Discussion thread and activity log on a task — plan

Source spec: [spec.md](./spec.md). Shared design: [docs/architecture/threads.md](../../../docs/architecture/threads.md). Lines are pinned to `db6a4f161`.

## Goal

Every task gets a conversation, and later a record of what changed, in one timeline that the list's audience can read. It is built on one thread module that Chat and Docs already need, so this is not a third copy. The rule "the history belongs to the list" keeps a moved task from carrying its past to a new audience.

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
- **The JMAP push types.** `ChatMessage` exists. There is no thread type, and Docs threads poll every 4 s. `path: packages/api/app/Services/Jmap/Push/JmapPushStateResolver.php:36`, `path: packages/apps/src/text-editor-core/docs-collab/use-docs-threads-source.ts:13`
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
- **A read-only offline state** (cached thread, composer disabled) was the first proposal. The product owner chose offline commenting on 2026-11-16. Chat's outbox flush is Meet-specific code, but the core outbox it runs on is shared, so chunk H builds a Tasks thread flush on the core outbox and copies Chat's row shapes, not its code.
- **Dropping a queued comment whose task is gone**, as Chat drops a send to a deleted channel, was rejected. A comment is the author's own text; it stays "Not sent" with Copy and Discard.
- **Placing an offline comment at the time it was written** was rejected. Other people would get it in the thread's past, below entries they already read. The server's arrival time is used.

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
- [x] Read access is enough to comment (Goal wording). It affects chunk B only.
- [x] Mentions and comment notifications are in scope. Product owner, 2026-11-16. It affects chunk D.
- [x] Commenting works offline through the Tasks outbox. Product owner, 2026-11-16. It adds chunk H and the `listId` check in chunk B.

## Invariants

- **Chat and Docs write the same ICS and return the same API responses after chunk A.** A wrong change would silently change stored messages, or break older clients. Proof:
  - `path: packages/api/tests/Unit/Chat/ChatMessageJournalConverterTest.php`, assertion `test_round_trip_preserves_all_message_fields`;
  - `path: packages/api/tests/Unit/Docs/DocsThreadJournalConverterTest.php`, assertion `test_comment_root_round_trip_preserves_kind_path_and_anchors`;
  - new golden-ICS tests in `path: packages/api/tests/Unit/Threads/ThreadEntryGoldenIcsTest.php`, assertion `test_chat_and_docs_bytes_unchanged` (written before the move, chunk A).
- **Docs comment permissions do not change.** Proof: `path: packages/api/tests/Feature/Docs/DocsThreadsTest.php`, assertion `test_comment_sharee_can_persist_view_only_cannot`.
- **Thread pools never show up over CalDAV.** A wrong change would expose comments to every native client. Proof: `path: packages/api/tests/Feature/Dav/ChatCollectionsDavExposureTest.php`, assertion `test_docs_thread_pool_is_dav_invisible_while_notes_stay_dav_visible`, plus a new `test_task_thread_pool_is_dav_invisible` in the same file (chunk B).
- **A viewer never sees entries written under another list.** A wrong change would leak a private list's history to a Team after a move. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_moved_task_shows_a_fresh_thread_to_the_new_audience` (new, chunk B).
- **Someone who cannot see the task gets 404 on every thread route, including reactions and changes.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_every_thread_route_is_404_without_list_access` (new, chunk B).
- **Nobody can edit, delete or create an activity entry through the API.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadAccessTest.php`, assertion `test_activity_entries_are_read_only` (new, chunk B).
- **A failed or unauthorized CalDAV write logs no activity.** Proof: `path: packages/api/tests/Feature/Tasks/TaskChangeObserverPluginTest.php`, assertion `test_forbidden_caldav_put_on_read_only_list_notifies_nobody` (#2172), extended in chunk F with an activity assertion.
- **A thread hook failure never fails the task write.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertion `test_thread_hook_failure_keeps_the_task_write` (new, chunk B).
- **A native client's move never destroys or leaks a thread.** A CalDAV `MOVE` acts like a REST move. A `DELETE` then `PUT` keeps the source entries under the source key until the 30-day purge, and shows them to nobody else. A wrong change would delete a thread for good on an Apple or Thunderbird move, or show list A's history in list B. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertions `test_caldav_move_writes_moved_here_and_keeps_source_entries`, `test_delete_then_put_elsewhere_starts_fresh_and_keeps_source_entries`, `test_purge_removes_orphan_entries_after_30_days_only`, `test_thread_of_task_untouched_for_40_days_survives_purge`, `test_task_untouched_for_40_days_then_deleted_or_moved_keeps_source_entries_30_more_days`, `test_writing_the_uid_back_clears_the_leave_time`, `test_purge_stamps_keys_with_entries_but_no_leave_time_and_purges_them_30_days_later` (new, chunk B).
- **Push state never changes for lists the user cannot read.** A wrong change would leak the timing of activity in another person's private list. Proof: `path: packages/api/tests/Feature/Jmap/JmapEventSourceThreadTest.php`, assertion `test_state_ignores_threads_in_unreadable_lists_of_the_same_pool` (new, chunk C).
- **Only the owner deleting a list removes its thread entries.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertion `test_sharee_dismiss_keeps_thread_entries` (new, chunk B).
- **No idle polling is added.** The thread panel polls only while it is open, visible and push is down. Proof: `path: packages/apps/src/tasks-core/src/use-task-thread.test.ts`, assertion `does not poll while push is up or the panel is closed` (new, chunk E).
- **A comment written offline is stored once, however often it is sent.** A wrong change would duplicate comments after a flaky reconnect or two tabs flushing. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadApiTest.php`, assertion `test_post_with_the_same_ulid_twice_stores_one_entry` (new, chunk B); `path: packages/apps/src/lib/offline/tasks/tasks-thread-outbox-flush.test.ts`, assertion `sends a queued comment once across two flushes` (new, chunk H).
- **A queued comment never lands in another list's thread without its author's say.** A wrong change would show a comment written for one audience to another. Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadApiTest.php`, assertion `test_post_with_a_stale_list_id_is_409_and_stores_nothing` (new, chunk B); `path: packages/apps/src/lib/offline/tasks/tasks-thread-outbox-flush.test.ts`, assertion `keeps a comment whose task moved as not sent` (new, chunk H).
- **A queued comment is never dropped silently.** Proof: `path: packages/apps/src/lib/offline/tasks/tasks-thread-outbox-flush.test.ts`, assertion `keeps the text of a comment whose task is gone` (new, chunk H).
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

### Chunk B: Task thread pool, API, access and lifecycle
- **Skill:** api, security
- **Inputs:**
  - the hidden kinds (`CollectionKind.php:25`) and the pool provisioner pattern (`DocsThreadPoolProvisioner.php:47`);
  - list delete (`TaskListRepository.php:191`, sharee dismiss at `:198`);
  - CalDAV `MOVE` (`EventDispatchPlugin.php:29`, `FlysystemDirectory.php:11`);
  - #2172's audience, change set and observer.
- **Done when:**
  - `CollectionKind::TaskThreadPool` (DAV-hidden) exists, with a provisioner.
  - The REST routes from spec.md are in OpenAPI.
  - The access, move, delete, list-delete and limit rules are tested.
  - `POST …/thread` is idempotent on the client ULID and answers 409 `task_moved` when a given `listId` is not the task's current list.
  - #2172's observer handles `afterMethod:MOVE` between task lists as a `moved` change set. #2172 leaves `MOVE` out on purpose, so this chunk adds it.
  - The 30-day orphan purge command is scheduled daily. It purges only keys whose `subject_left_at` is older than 30 days and whose UID is not in the list. Every leave hook (delete, REST move, CalDAV `DELETE`, CalDAV `MOVE`) upserts the key's row and sets that timestamp, and any write of the UID into the list clears it. Keys a hook missed are found from the entries, stamped on one run, and purged 30 days later.
  - The native-client move cases from spec.md (CalDAV `MOVE`; `DELETE` then `PUT`) are tested.
  - `docs/architecture/tasks.md` gets "Decision 18 — Task threads".
  - The B invariants pass.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none (chunk F also edits the observer, after B)

### Chunk C: `ThreadEntry` push type
- **Skill:** api, client-transport
- **Inputs:** the push types (`JmapPushStateResolver.php:36`).
- **Done when:**
  - `ThreadEntry` state is a hash of `max(thread_index.modseq)` per list the user can read. It changes on any entry write in a readable list, and never for another list in the same pool that the user cannot read.
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
  - `tasks.thread_activity` and `tasks.mentioned` are delivered to the recipients in spec.md, never to the actor or to people outside the audience.
  - One row per person per task, with supersede.
  - The PHP and TypeScript formatters have the copy.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** C, E

### Chunk E: Thread panel
- **Skill:** apps-ui, workspace, accessibility
- **Inputs:**
  - the chat-ui exports (`chat-ui/src/index.ts:1`);
  - the detail view fields (`tasks-detail-view.tsx:187`);
  - #2172's audience cache;
  - the product owner's mockup (`mockup-task-detail.webp` in this folder);
  - the three move paths (`use-tasks-mutations.tsx:202`, `tasks-workspace.tsx:438`, `tasks-workspace.tsx:88`).
- **Done when:**
  - A thread panel with comments, replies, reactions, edit and delete of your own messages, and mentions limited to the audience, laid out as in spec.md, UI, Layout.
  - A read cache offline, with "Last updated …".
  - The move confirm, the multi-select move dialog and the drag toast say that comments stay in the old list (spec.md, UI, Move confirmation), with Vitest on the label functions.
  - Mock API, Storybook stories (empty, busy thread, tombstone, offline, a "Sending…" and a "Not sent" comment) and Vitest, including the polling invariant.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** C, D

### Chunk H: Offline comments
- **Skill:** workspace, client-transport
- **Inputs:**
  - the core outbox (`outbox-store.ts:10`, `:151`; `outbox-flush.ts:83`);
  - Chat's row shapes and re-key handling (`meet-chat-outbox-flush.ts:44`, `:87`) and its ULID (`chat-ulid.ts:46`);
  - the Tasks outbox flush (`tasks-outbox-flush.ts:188`);
  - chunk B's `listId` check and chunk E's panel.
- **Done when:**
  - Comments, replies, edits, deletes and reactions queue offline in the Tasks outbox and flush in order once online, with the composer enabled offline.
  - A queued send shows at once with "Sending…"; edits and reactions queued behind it follow a re-keyed id.
  - 404, 403 and 409 `task_moved` keep the comment as "Not sent" with Copy and Discard, plus "Post in the new list" on 409 when allowed. They show in the failed-outbox notice.
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
  - `thread-ui/format-thread-activity.ts` is pure, with Vitest for every field, merged entries, a removed person, and the locale and time zone.
  - `ThreadActivityRow` exists.
  - The "Show changes" toggle is remembered per user in localStorage, wrapped in try/catch.
  - Stories cover them.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none (after E and F)

### Chunk V: Cross-chunk verify
- **Skill:** testing
- **Done when:**
  - The verifier, prompted from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md), returns `PASS` or `PASS_WITH_NITS`.
  - A two-user browser e2e on a Team list: A comments and mentions B, B gets the notification and replies, and A sees the reply without reloading.
  - A renames the task and sets the priority, and both rows show in B's language.
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
