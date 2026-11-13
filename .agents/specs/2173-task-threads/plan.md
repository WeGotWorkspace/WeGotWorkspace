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
- **Deleting a task list.** `path: packages/api/app/Services/Tasks/TaskListRepository.php:191`
- **Task import.** `path: packages/api/app/Services/Tasks/TaskImportService.php:29`

## Considered

- **The existing components.**
  - The Docs pool pattern (a hidden per-owner VJOURNAL pool plus an index) is reused for task threads.
  - Chat's message model (stored mentions, edit, tombstone, reactions) is reused as the entry model.
  - chat-ui is reused for the composer and messages.
  - A third set of converter and repository copies was rejected. Chunk A extracts the shared core first.
- **One pool per task list instead of per owner** was rejected. It would double the hidden collections, and sharing a list would need a second share on its pool. The per-owner pool keyed by list and UID gives the same isolation.
- **Carrying the thread along when a task moves within the same owner** (first proposal to the product owner, 2026-11-14) was rejected. A move from a private list to a shared list of the same owner would show private history to the sharees. Keying on the list is the only rule that never shows history to a new audience. Its cost: comments stay behind on any move. Listed under "Decisions to review".
- **A per-period or per-join history grant** (new members see only entries after they joined) was rejected. No comparable tool does it, it conflicts with comments being readable, and it needs membership history the server does not keep.
- **Storing the activity log in a SQL table** instead of VJOURNAL entries in the thread was rejected:
  - it is one timeline with one access rule, one push type and one delete path;
  - the entries stay in the same backup and export as the comments;
  - the product owner asked for "vjournal uiteraard".
- **Storing rendered text** ("Anna changed …") was rejected in favour of `{field, from, to}`. Text would be frozen in one language and time zone, and names would go stale.
- **Logging through `EventDispatchPlugin`** was rejected, because it has no before/after content. The activity writer reads #2172's change set.
- **Moving Docs threads onto `thread_index` and push in this Epic** was rejected as scope. Named as a follow-up in threads.md.
- **An outbox for offline comments** was rejected for now. Chat's outbox is Meet-specific, and a read cache plus a disabled composer is the smallest honest offline state.

## Affected packages

- `packages/api`
- `packages/apps`
- `docs`

## Dependencies

1. #2172 chunks A and B are on main: audience, stable participant ids, change set and observer.
2. Chunk A (shared module, Chat and Docs moved onto it) comes before B.
3. B (pool, API, access, lifecycle) comes next. Then C (push), D (notifications) and E (thread panel UI) run in parallel.
4. F (activity writer) comes after B. G (activity rows UI) comes after E and F.
5. V comes last.

## Open decisions

- [x] Thread history is keyed on the list, so any move starts fresh. Taken overnight; listed under "Decisions to review" in the PR. It affects chunk B only.
- [x] Read access is enough to comment (Goal wording). It affects chunk B only.
- [x] There is no offline comment outbox. It affects chunk E only.

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
- **A thread hook failure never fails the task write.** Proof: `path: packages/api/tests/Feature/Tasks/TaskThreadLifecycleTest.php`, assertion `test_thread_cleanup_failure_keeps_the_task_delete` (new, chunk B).
- **No idle polling is added.** The thread panel polls only while it is open, visible and push is down. Proof: `path: packages/apps/src/tasks-core/src/use-task-thread.test.ts`, assertion `does not poll while push is up or the panel is closed` (new, chunk E).
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
  - list delete (`TaskListRepository.php:191`);
  - #2172's audience and change set.
- **Done when:**
  - `CollectionKind::TaskThreadPool` (DAV-hidden) exists, with a provisioner.
  - The REST routes from spec.md are in OpenAPI.
  - The access, move, delete, list-delete and limit rules are tested.
  - `docs/architecture/tasks.md` gets "Decision 18 — Task threads".
  - The B invariants pass.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk C: `ThreadEntry` push type
- **Skill:** api, client-transport
- **Inputs:** the push types (`JmapPushStateResolver.php:36`).
- **Done when:**
  - `ThreadEntry` state changes on any write to a pool the user can read, and does not change for pools they cannot read.
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
  - #2172's audience cache.
- **Done when:**
  - A thread panel with comments, replies, reactions, edit and delete of your own messages, and mentions limited to the audience.
  - A read cache offline, with the composer disabled offline.
  - Mock API, Storybook stories (empty, busy thread, tombstone, offline) and Vitest, including the polling invariant.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** C, D

### Chunk F: Activity writer
- **Skill:** api, security
- **Inputs:**
  - #2172's `TaskChangeSet` and `TaskChangeObserverPlugin`;
  - import (`TaskImportService.php:29`).
- **Done when:**
  - REST, MCP and CalDAV writes produce the entries in spec.md.
  - Quick edits are merged under a lock.
  - Imports write one `created` entry each.
  - An empty change set writes nothing.
  - Pruning keeps "created" and "moved here".
  - Tests for each field, for merging, for two actors, and for the CalDAV path.
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
  - A moves the task to a private list, and B no longer sees the task. A sees a fresh thread with "moved here".
  - A Chat and Docs comment smoke test still passes.

## Test plan

- [ ] API: golden ICS first (chunk A); then OpenAPI, failing feature tests, the implementation and `composer done-gate` for each API chunk.
- [ ] UI: mock-tier Storybook, Vitest for the formatter, the polling rule and the offline cache.
- [ ] E2E: two users, one Team list, plus a move to a private list (chunk V).

## Doc updates

- `docs/architecture/threads.md` (this PR).
- `docs/architecture/tasks.md`: Decision 18 and Known limitations (threads are web-only).
- `docs/architecture/notifications.md`: `tasks.thread_activity`, `tasks.mentioned`.
