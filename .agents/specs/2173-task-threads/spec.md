Source: #2173 (body-hash: 9a0aefb3)
Goal: WeGotWorkspace/Product#87

# Discussion thread and activity log on a task

Technical translation of Epic #2173. Written against `origin/main` at `db6a4f161` (2026-11-14); every line reference in plan.md is pinned to that commit. The suite-wide thread model is in [`docs/architecture/threads.md`](../../../docs/architecture/threads.md). This Epic needs the list audience resolver and the task change set from Epic #2172 (spec in `.agents/specs/2172-task-assignees/`, PR #2175).

## Goal

- **One thread model for Chat, Docs and Tasks.** Chat messages and Docs comments are each one VJOURNAL per message in a DAV-hidden collection. Their converters and repositories are near-copies: ULID, body limit, `RELATED-TO`, reactions OR-set, reaction toggle and display names. Chunk A moves those shared parts into one backend module, `App\Services\Threads`. Chat and Docs then call it. Their stored ICS and their API stay **byte-for-byte the same**. Task threads are built on the module from the start.
- **Built for any app, with Tasks as the first user** (product owner, 2026-11-16). Comments on notes, or on something in an app that does not exist yet, must reuse this work instead of copying it. So everything that is not about tasks lives in shared code, on the server and in the web app:
  - **The thread subject.** A *subject* is the thing a thread is about (a task). Its *scope* is the place that sets who can see it (the task's list). Each app registers one small **subject type** that answers the questions only that app can answer: does this subject exist, which scope is it in now, who may read and post, who is in the audience, and who should hear about new comments. The server side is `App\Services\Threads\Subjects\ThreadSubjectType`; the web app side is a `ThreadSubjectAdapter` in `packages/apps/src/thread-ui/`.
  - **Shared on the server** (`App\Services\Threads`): the pool and its provisioner, the entry repository (post, reply, edit, delete, react, list, changes, limits, idempotency), the REST controller and routes, access checks through the subject type, the leave-and-purge lifecycle, the `ThreadEntry` push state, grouped notifications, and the activity writer with its merge rule.
  - **Shared in the web app** (`thread-ui/` and `lib/offline/threads/`): the thread panel with its layout, composer and timeline, the `useThread` hook (fetch, push, polling rule), the API client, the activity row and formatter, the offline read cache and the offline outbox.
  - **Tasks only** (`App\Services\Tasks\Threads\TaskThreadSubject`, `tasks-core`): the task subject type, the calls into the lifecycle from task delete and move paths, the mapping from #2172's task change set to activity entries, the two notification actions and their copy, the field labels for activity rows, the move wording, and the place in the detail view where the panel is mounted.
  - Adding threads to another app is then one subject type on each side, its lifecycle calls, its notification copy and a place to mount the panel. `docs/architecture/threads.md` keeps that checklist.
  - Chat and Docs keep their own repositories and routes in this Epic. Chunk A gives them the shared converter core; moving them onto subject types is a follow-up named in threads.md.
- **Thread storage.** A new collection kind `thread_pool`, shared by every subject type:
  - VJOURNAL only, hidden over DAV;
  - one pool per owner and subject type (a user or a Team), URI `<type>-threads` (`task-threads` for tasks), created on first use, like the Docs pool.

  Each entry is one VJOURNAL. Every entry carries its subject: `X-WGW-SUBJECT-TYPE` (`task`), `X-WGW-SUBJECT-ID` (the task's UID) and `X-WGW-SUBJECT-SCOPE` (the `calendarid` of the list it was written in). A task's thread is every entry in the pool of the current list's owner whose key matches **the task's current list and UID**.
- **Entry kinds:**
  - `comment`, a root;
  - `reply`, with `RELATED-TO` to a root. Replies are flat, one level, enforced by the server;
  - `activity`, written by the server only (chunk F).

  Comments and replies carry stored mentions (`X-WGW-MENTIONS`, as in Chat), reactions (`X-WGW-REACTIONS`), edits (`SEQUENCE`, `LAST-MODIFIED`) and tombstones (`STATUS:CANCELLED`, body cleared), all as Chat does today.
- **Who sees and writes.**
  - Reading and writing both follow the task's current list. Anyone who can see the task can read the thread, comment, reply and react. This follows the Goal, the same rule as "can see the task".
  - Only the author can edit or delete their own comment or reply.
  - Nobody can edit or delete an activity entry.
  - Access is checked on every request against `CalendarCollectionAccess`. Nothing is copied per viewer.
- **History belongs to the list.**
  - A person who joins a Team later sees the whole thread. A person who leaves loses all of it.
  - When a task moves to another list, the key no longer matches the old entries, so the new list's audience never sees them. This holds for any other list, the same owner's included. The new thread starts with one activity entry, "moved here from another list". It never names the old list.
  - Old entries stay under the old key, where nobody sees them. They are deleted with that list, or by the 30-day purge below. If the task moves back within 30 days, they show again to that list's audience, who saw them before.
  - Deleting a task does not delete its thread at once. The entries stay under the list's key, where nobody can see them because there is no task. When the task leaves the list, by a delete or a move, the server records that moment on the key (`subject_left_at`). A daily job purges a key only when that moment is more than 30 days ago **and** no task with that UID is in that list. A task that simply sits unchanged in its list never has a leave time, so its thread is never purged. This makes an undo, or a native client's delete-then-create, safe (see Lifecycle hooks).
  - Native clients move tasks in two ways, and both are covered under Lifecycle hooks:
    - a CalDAV `MOVE` counts as a move;
    - a `DELETE` in one list followed by a `PUT` in another counts as a delete plus a new task.
  - **The web app says so before a move** (product owner, 2026-11-16). Every move the web app makes tells the person, before or as it happens, that the comments and history stay behind in the old list and that people in the new list start with an empty thread (see UI, Move confirmation).
- **Live updates.** A new JMAP push type `ThreadEntry`, with source `threads`. Its state changes only when a thread in a **list the user can read** changes, never for other lists in the same pool.
  - The open thread panel refetches its thread on a state change.
  - The panel polls only while it is open and visible, and only while push is down (15 s). This keeps the idle-polling lesson of #2156.
- **Notifications.**
  - `tasks.thread_activity` on a new comment or reply. It goes to assignees and earlier comment authors in the thread, minus the actor, and only to people in the list audience.
  - `tasks.mentioned` goes to mentioned people in the audience instead of `thread_activity`, as Chat does.
  - Both are grouped per task with `supersede`, as Docs does per thread.
  - Activity entries never notify. #798 and #2172 own the notices for status and assignment.
  - Mentions and both notices are in scope by the product owner's decision of 2026-11-16, although the Goal first listed them as non-goals.
- **Commenting works offline** (product owner, 2026-11-16). Comments, replies, edits and deletes of your own messages, and reactions are queued in the shared threads outbox while offline and sent once the connection is back. The client ULID makes each send idempotent, as in Chat. See UI, Offline.
- **Activity log (chunks F and G).**
  - The server turns #2172's `TaskChangeSet`, computed for REST, MCP and CalDAV writes, into activity entries in the same thread.
  - Each entry stores data, not text: `X-WGW-ACTIVITY` is JSON `{field, from, to}` or `{field, added, removed}`, plus the actor and time.
  - The client renders it in the reader's language and time zone, for example "Anna changed the title to 'Moodboard v2' · 1 Jan, 22:21".
  - Quick edits are merged (see Technical constraints).
- **Thread panel UI.** `ThreadPanel` lives in `thread-ui/` and knows nothing about tasks. Tasks mounts it in the task detail view below the fields, as in the product owner's mockup ([mockup-task-detail.webp](./mockup-task-detail.webp), 2026-11-16).
  - One timeline in time order: comments with their replies, and activity rows.
  - A "Show changes" toggle (default on) hides activity rows.
  - The composer is the chat-ui composer, with mentions limited to the list audience.
  - Messages and reactions use chat-ui and the shared reaction picker.
  - The activity row and its formatter live in `thread-ui/` too. The formatter takes field labels and value renderers from the subject adapter, so another app brings only its own field names.

## Non-goals

- Threads in native apps (Reminders, Thunderbird). The pool is DAV-hidden.
- Comments anchored to a field or to text in the description
- Guest comments
- Mail or push when the app is closed (Product#32)
- MCP tools for task threads. That is a follow-up: the REST service is MCP-ready, with no web-only logic.
- Moving Docs threads onto `ThreadEntry` push, or giving Docs the chat composer. These are follow-ups this design allows. Docs keeps its 4 s polling in this Epic.
- An activity log for Docs or Chat. The entry format allows it later.
- Changing how Docs threads follow a document to another owner (`DocsThreadPathSync`). That is flagged in threads.md as a product question for Docs, not changed here.
- Moderation: owners deleting other people's comments
- Restoring a thread when a task moves to a list with another audience

## Affected packages

- `packages/api`:
  - new `app/Services/Threads/*` (shared converter, reactions, names, index; subject types and their registry; pool, repository, lifecycle and purge, notifier, activity writer);
  - Chat and Docs converters and repositories (delegate to the converter core, no behaviour change);
  - new `app/Services/Tasks/Threads/*` (the task subject type and the change-set mapping only);
  - `CollectionKind` (new case `thread_pool`);
  - migrations (`thread_index`, `thread_subject`);
  - the shared REST controller `ThreadsController` and its routes;
  - OpenAPI;
  - `JmapPushStateResolver` (new type);
  - `NotifyListener`, `NotificationCopyFormatter` (the two task actions; the shared `ThreadNotifier` sends them);
  - `TaskRepository`, `TaskListRepository` (lifecycle hooks);
  - #2172's `TaskChangeObserverPlugin` (`MOVE`, and the activity consumer);
  - PHPUnit.
- `packages/apps`:
  - new `thread-ui/` (`ThreadPanel`, `useThread`, `ThreadSubjectAdapter`, timeline, activity row, formatter);
  - new `lib/api/wgw/threads.ts` (the shared API client);
  - new `lib/offline/threads/` (read cache and outbox for every subject type);
  - `tasks-core` (the task adapter, mounting the panel, the move wording);
  - `lib/jmap-client/push` (new type);
  - `notifications-core/format-notification-copy.ts`;
  - the Tasks move confirmation, move dialog and move toast copy;
  - mock API;
  - Storybook;
  - Vitest.
- `docs`:
  - new `docs/architecture/threads.md` (in this PR);
  - `docs/architecture/tasks.md` (decision, in chunk B);
  - `docs/architecture/notifications.md` (new actions).

## Technical constraints

### Shared thread module (chunk A)

- `ThreadEntryJournal` (converter core):
  - It reads and writes `UID` (ULID, uppercase), `DTSTAMP`/`CREATED`, author (`X-WGW-AUTHOR`, as both domains store it today), `DESCRIPTION` (body, size limit), `RELATED-TO`, `X-WGW-MENTIONS`, `X-WGW-REACTIONS`, `SEQUENCE`/`LAST-MODIFIED` on edit, and `STATUS:CANCELLED` tombstones.
  - Domain extras (Docs anchors, path, change id and resolved state; Chat attachments and link previews) stay in the domain converters, which wrap the core.
- `ThreadReactions::toggle(array $set, string $emoji, string $username): array` replaces the two private `toggleReactionSet` copies.
- `ThreadAuthorNames` replaces the two `displayNames` helpers.
- **Golden tests first.** Before the move, chunk A adds tests that pin the ICS each domain writes today for fixed input: a comment, a reply, an edit, a tombstone, reactions and mentions. After the move the bytes are the same. The existing unit and feature tests stay unchanged.
- `thread_index` (new table) holds `uid`, `pool_calendarid`, `subject_type` (`task`), `subject_key` (scope + subject id), `subject_scope` (the list calendarid for tasks, indexed), `kind`, `parent_uid`, `author`, `created_at`, `modseq` and `activity_field` (nullable). A small `thread_subject` table holds one row per `subject_type` and key, with `subject_left_at` (nullable).
  - No column names a task. Only task threads use the tables in this Epic.
  - `docs_thread_index` stays. Moving Docs onto `thread_index` is a follow-up named in threads.md.

### Thread subjects (chunk B)

- `ThreadSubjectType` is the one interface an app implements on the server:
  - `type(): string`, the short name in routes and in `X-WGW-SUBJECT-TYPE` (`task`);
  - `resolve(string $username, string $subjectId): ?ThreadSubject` returns null when the caller cannot see the subject (the route then answers 404). `ThreadSubject` carries the subject id, the current scope, the pool owner, and `canRead` / `canPost`;
  - `audience(ThreadSubject): list<username>`, for mentions and the notification filter;
  - `followers(ThreadSubject): list<username>`, the people who always hear about new comments (for tasks: the assignees from #2172);
  - `readableScopes(string $username): list<string>`, for the push state;
  - `existsInScope(string $scope, string $subjectId): bool`, for the purge;
  - `notificationActions(): {activity, mentioned}` and `navigate(ThreadSubject)`, so the shared notifier sends the app's own actions and opens the right screen.
- `ThreadSubjectRegistry` maps a type name to its implementation. It is filled in a service provider; an unknown type answers 404.
- `TaskThreadSubject` is the only implementation in this Epic. It resolves a task through the same accessible-list lookup as the task routes, uses the list as scope, `TaskListAudience` (#2172) as audience, and `CalendarCollectionAccess::accessibleInstances` for the readable scopes.
- **A fake subject type in the tests.** The shared layer is tested with a second, test-only subject type that has nothing to do with tasks. If the shared code needs a task, that test cannot be written, so it keeps the layer honest.

### Thread API (chunk B)

- The routes are shared, under `/api/v1/threads/{subjectType}/{subjectId}`. For a task, `subjectType` is `task` and `subjectId` is the task id the task routes use.
- `GET …/entries`:
  - It returns entries in time order, 200 per page, with a cursor.
  - Each entry has `id`, `kind`, `parentId`, `author` (`username`, `displayName`), `body` (null for activity and tombstones), `mentions`, `reactions`, `createdAt`, `editedAt`, `deletedAt` and `activity`.
  - It also returns a thread `state` for `/changes`.
- `POST …/entries` with `{id, body, parentId?, mentions?, scopeId?}`:
  - `id` is a client ULID. Retries with the same id are idempotent, as in Chat.
  - `scopeId` is the scope the writer saw the subject in (for a task, its list). When it is given and the subject is now in another scope, the post fails with 409 `subject_moved` and nothing is stored. The web app always sends it, so a comment queued offline never lands in front of a new audience without its author knowing. Callers that omit it post to the current scope.
  - A `parentId` that is itself a reply is rejected with 422.
  - A mention outside the subject's audience is dropped from the stored mentions, but the text stays.
- `PATCH …/entries/{entryId}` with `{body}` and `DELETE …/entries/{entryId}` (tombstone):
  - author only (403);
  - comment and reply kinds only (409 for activity).
- `POST …/entries/{entryId}/reactions` with `{emoji}` toggles a reaction. The emoji set is the shared one.
- `GET …/changes?since=<state>` returns the changed and removed entry ids.
- **Access:**
  - Every route asks the subject type to resolve the subject. 404 if the caller cannot see it. For tasks, read access to the list is enough to post (`canPost`).
  - A task in a multi-VTODO file is addressed by its UID, as in the task routes.
- **Limits:**
  - a body of at most 65 536 bytes (`MAX_BODY_BYTES`, the same in Chat and Docs);
  - at most 5 000 entries per thread. A post past that gets 409 `thread_full`.
  - Activity entries are pruned oldest first beyond 1 000 per thread, and comments are never pruned. Pruning makes room, so automatic activity never hits the limit.
- **Lifecycle hooks.** The shared `ThreadLifecycle` has three calls, keyed by subject type, scope and subject id: `left()` sets `subject_left_at` (upserting the `thread_subject` row), `returned()` clears it, and `scopeDeleted()` deletes every entry in a scope. The purge and its stamping of missed keys are shared too; they ask the subject type's `existsInScope`. What follows is how Tasks calls them.
  - **Task deleted** (REST, MCP, or the CalDAV observer's "deleted" change set): nothing is deleted at once. The entries stay under the list's key. The delete hook sets `subject_left_at = now` on the key.
  - **Leave time.** `subject_left_at` is set on the **source** key by every hook where the task leaves a list: the task-delete hook (REST, MCP, CalDAV `DELETE`), the REST, MCP or web-app move hook, and the CalDAV `MOVE` hook. Any write that puts that UID in that list again clears it: a create, a `PUT`, or a move back. The hook **upserts** the key's `thread_subject` row, because a task deleted before anyone commented has none.
  - **Purge.** `threads:purge-orphans` (daily, every subject type) deletes the entries of a key only when `subject_left_at` is older than 30 days **and** no calendar object with that UID exists in that list. Comments and task edits do not touch `subject_left_at`, so a thread on a task that nobody edits for months stays. The purge deletes the key's `thread_subject` row together with its entries.
  - **Missed leave hooks.** A leave hook can fail without failing the task write, which would leave a key with entries, no task in the list and a null leave time. On each run the purge first finds such keys **from the entries in `thread_index`**, not from `thread_subject`, and stamps `subject_left_at = now` on them, upserting the `thread_subject` row. A later run then purges them 30 days on.
  - **List deleted:** only when the **owner** deletes it, `scopeDeleted()` deletes every entry whose `X-WGW-SUBJECT-SCOPE` is that list. `TaskListRepository::delete` only dismisses a sharee's copy (`dismissIfSharee`), and that deletes nothing.
  - **Move through REST, MCP or the web app** (`taskListId` in the change set): the "moved here" activity entry is written under the new key, and the old entries stay under the old key until the 30-day purge.
  - **CalDAV `MOVE`** of a task object to another list: Sabre copies and then deletes in one request, because calendars are not `IMoveTarget`. The observer turns `afterMethod:MOVE` (source and destination both in task lists, 2xx) into the same `moved` change set as a REST move. The destination gets "moved here", and the source's entries stay under the source key.
  - **CalDAV `DELETE` in list A, then `PUT` of the same UID in list B** (two requests, as some clients do it): these cannot be told apart from a real delete and a new task. B gets a `created` entry. A's entries stay under A's key, and the 30-day purge removes them unless the task comes back to A.
  - **The same UID `PUT` back into list A within 30 days** (undo, or a move back by a delete-then-create client): A's old entries show again, followed by a `created` entry.
  - These hooks run after the task write has committed. A failure is logged and retried by the next write. It never fails the task write.

### Push and live updates (chunk C)

- `ThreadEntry` is added to `JmapPushStateResolver::TYPES`, with source `threads`.
  - The state is a hash over `max(thread_index.modseq)` per **readable scope**, over every registered subject type's `readableScopes` for the user. For tasks that is every list in `CalendarCollectionAccess::accessibleInstances`. A comment in an owner's private list therefore changes nothing for a sharee of another list in the same pool: no timing leak and no extra refetch.
  - `thread_index.modseq` is bumped on every insert, edit, reaction and tombstone of an entry. A purge needs no state change, because purged entries belong to no visible task.
  - Computing the state is one indexed query over `thread_index` (`subject_type`, `subject_scope`, `modseq`).
  - Nothing is added to the idle request load: the client asks for the type only while a thread panel is open.

### Notifications (chunk D)

- The shared `ThreadNotifier` sends them for every subject type. Tasks brings only its two actions, `tasks.thread_activity` and `tasks.mentioned`, which go in the allow-list, the PHP formatter and the TypeScript formatter.
- Recipients: the subject type's `followers` (for tasks, the `u:` assignees from #2172) ∪ authors of earlier non-deleted comments and replies in the thread ∪ mentioned users. Then the actor is removed, and only people in the subject's `audience` (for tasks, `TaskListAudience`, any access) are kept.
- A mentioned user gets the type's `mentioned` action, and the rest get its `activity` action.
- `dedupe_key` is `<type>.thread:<scope>:<subjectId>` (`task.thread:<listCalendarId>:<taskUid>`) with `supersede`. A busy thread is one row per person, updated in place.

### Activity entries (chunk F)

- The shared `ThreadActivityWriter` takes a subject and a list of `ThreadFieldChange` (`{field, from, to}` or `{field, added, removed}`, plus `created` and `moved`). It owns the merge rule, the 200-character cut and the pruning, for any subject type.
- `TaskThreadActivity` maps #2172's `TaskChangeSet` to field changes and calls the writer from REST, MCP and the CalDAV observer. One write produces one entry per changed field.
- **Fields:**
  - `title`, `workflowStatus`, `priority`, `start`, `due` (with `showWithoutTime`) and `assignees` (added, removed);
  - `categories` (added, removed);
  - `description` (changed, no text);
  - `created`;
  - `moved` (in, no source).
- **Values:** stored raw. Strings are cut to 200 characters. Dates are ISO with their time zone, or floating. Assignees are participant ids, rendered with current names.
- **Merging quick edits.** When the newest entry in the thread is an activity entry by the same actor, for the same field, less than 10 minutes old, the writer updates its `to` (or its sets) instead of adding one. If `from` then equals `to`, the entry is deleted. This runs in one transaction that first locks the **pool collection row** (the pool's `calendars` row, which always exists). Two concurrent first writes to an empty thread are therefore serialized too. On SQLite the `IMMEDIATE` transaction mode already serializes writers.
- **Imports** (`TaskImportService`) log only one `created` entry per task, with `{source: "import"}`, and no per-field entries.
- **Not logged:**
  - `sortOrder`, `sequence`, `updated`, alarms, `icsProps`.
- **CalDAV writes** use the authenticated principal as the actor. The observer only acts after a successful write (#2172 invariant).

### UI (chunks E and G)

- **The client subject adapter.** `ThreadSubjectAdapter` (in `thread-ui/`) is what an app hands the shared panel: the subject type and id, the current scope, whether the user may post, a source of people for mentions (for tasks, #2172's cached list audience), the activity field labels, and the text for a moved subject. The task adapter lives in `tasks-core`.
- **Thread panel** (`thread-ui/thread-panel.tsx`, with `useThread`), mounted below the detail fields in `TasksDetailView`.
  - The newest entries are at the bottom. The composer is at the bottom and sticky inside the panel.
  - "Reply" opens an inline reply list under its root.
  - Edit and delete come from the message menu, for your own messages only.
- **Composer and mentions.**
  - It is `ChatComposer` from chat-ui.
  - The mention source comes from the adapter. For tasks it is the list audience, from #2172 chunk C's audience cache.
- **Activity row** (chunk G) in `thread-ui/thread-activity-row.tsx`, with the formatter in `thread-ui/format-thread-activity.ts`.
  - The formatter is pure. It takes the entry, the people map, the locale, the time zone and the subject adapter's field labels and value renderers. Tasks supplies labels for its fields; the shared part renders `created`, `moved`, sets and dates. It is covered by Vitest for every field, merged entries and the removed-person case.
- **Layout** (from the mockup):
  - The panel starts under a divider below the last field row, headed "Activity". The "Show changes" toggle sits at the right of that heading.
  - Each entry shows the author's avatar, name and relative time ("2h ago", with the full date on hover), then the body.
  - The composer is the last row: the current user's avatar, a one-line input "Write a comment…" that grows as you type, and a "Comment" button with its shortcut (⌘↵ / Ctrl+Enter). Typing `@` opens the mention menu; the placeholder hints at it. The mockup's "M to mention" is read as `@`, because a plain letter cannot open a menu in a text field.
- **Move confirmation.** Every move path in the web app states what happens to the thread:
  - The single-task confirm from the detail view (`requestMoveTask`) keeps its title and adds a second sentence to the description: "Comments and history stay in “{old list}”. People in “{new list}” start with an empty thread."
  - The multi-select "Move to list" dialog shows the same sentence under its description, in the plural.
  - Dragging tasks onto a list in the sidebar has no confirm today. Its "Moved" toast gains the same short line, and its Undo moves the task back, which shows the old thread again (within 30 days, see Lifecycle hooks).
  - The copy is the same whether or not the thread has comments, so the client needs no thread count for it.
- **Offline.**
  - Offline support is shared, in `lib/offline/threads/`, one domain for every subject type, keyed by subject type and id.
  - The last fetched thread per subject is cached there and shown offline with "Last updated …".
  - The composer stays enabled offline. A new comment or reply gets a client ULID, is written to the cached thread at once with a "Sending…" mark, and is queued as a row in the threads outbox. Edits, deletes and reactions on your own queued or sent messages queue the same way, behind the send they depend on.
  - The flush follows Chat's outbox (`meet-chat-outbox-flush.ts`): the send posts the client ULID with the `scopeId` the author saw. If the server answers with another id, the rows queued behind it follow the new id.
  - The entry's `createdAt` is the server's time when the send arrives, so an offline comment appears at the end of the thread for everyone, never in its past.
  - Mentions are picked from the adapter's cached people (for tasks, #2172's cached list audience). The server drops a mention of someone outside the audience at send time, as it does online.
  - A send that cannot land is never dropped silently. On 404 (the subject is gone or access was lost), 403 or 409 `subject_moved`, the comment stays in the panel marked "Not sent", with the reason, "Copy text" and "Discard". On 409 `subject_moved` the panel also offers to post it where the subject is now ("Post in the new list" for tasks) when the author can see it there. These rows show in the existing failed-outbox notice.
  - Comments queue only for subjects whose thread is in the cache. A task whose thread was never opened online shows "Connect to load the conversation", as the assignee picker does.

## Edge cases

- **A task in a list the viewer can only read.** They can read the thread and comment (Goal), but cannot edit the task.
- **Someone who left the Team.** Their comments stay, with their name. Notifications skip them, because they are outside the audience. Mentions of them are not stored.
- **A deleted user.** Their entries show "Former member". The display-name helper already falls back.
- **The same task UID in two lists** (a copy made by a native client). The key includes the list, so the two threads are separate.
- **A task moves A → B → A within 30 days, through the web app, MCP, REST or a CalDAV `MOVE`.** The thread in A shows its old entries again, followed by the "moved here" entry. After 30 days away, A's old entries are gone and A starts fresh. The thread in B stays under B's key and is deleted when B is deleted.
- **The same round trip from a client that deletes and re-creates.** B gets `created`, not "moved here". Back in A within 30 days, A's old entries show again, followed by `created`. After 30 days A's old entries are gone.
- **A multi-VTODO file.** Entries are keyed by the VTODO UID, not the file.
- **A recurring task.** One thread for the series. Changes to one occurrence's override are logged as the master's field with `{occurrence: <recurrenceId>}`.
- **A CalDAV client rewrites the whole VTODO with no real change.** The change set is empty and nothing is logged.
- **Two people edit the same field within 10 minutes.** These are separate entries, because merging only happens for the same actor.
- **A tombstoned root with replies.** The root shows "Comment deleted" and its replies stay.
- **A mention of someone who loses access later.** The stored mention stays and renders as plain text.
- **Pruning activity** never removes the "created" or "moved here" entries.
- **A second app gets threads later** (for example Notes, with a notebook as scope). It adds a subject type on each side, calls `ThreadLifecycle` from its delete and move paths, adds its two notification actions and mounts `ThreadPanel`. No shared table, route, push type or panel changes.
- **A comment written offline, then the same tab goes online twice or two tabs flush at once.** The client ULID makes the second send a no-op, so the comment shows once.
- **Someone moves the task while the author is offline.** The queued comment gets 409 `subject_moved`. It stays "Not sent" in the author's panel, and the author chooses to post it in the new list or discard it.
- **A reply queued offline to a root that was deleted meanwhile.** It is posted; the root shows "Comment deleted" with the reply under it, as online.
