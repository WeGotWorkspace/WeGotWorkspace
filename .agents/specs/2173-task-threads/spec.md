Source: #2173 (body-hash: d7143f5b)
Goal: WeGotWorkspace/Product#87

# Discussion thread and activity log on a task

Technical translation of Epic #2173. Written against `origin/main` at `db6a4f161` (2026-11-14); every line reference in plan.md is pinned to that commit. The suite-wide thread model is in [`docs/architecture/threads.md`](../../../docs/architecture/threads.md). This Epic needs the list audience resolver and the task change set from Epic #2172 (spec in `.agents/specs/2172-task-assignees/`, PR #2175).

## Goal

- **One thread model for Chat, Docs and Tasks.** Chat messages and Docs comments are each one VJOURNAL per message in a DAV-hidden collection. Their converters and repositories are near-copies: ULID, body limit, `RELATED-TO`, reactions OR-set, reaction toggle and display names. Chunk A moves those shared parts into one backend module, `App\Services\Threads`. Chat and Docs then call it. Their stored ICS and their API stay **byte-for-byte the same**. Task threads are built on the module from the start.
- **Task thread storage.** A new collection kind `task_thread_pool`:
  - VJOURNAL only, hidden over DAV;
  - one pool per owner of task lists (a user or a Team), URI `task-threads`, created on first use, like the Docs pool.

  Each entry is one VJOURNAL. Every entry carries the task's UID (`X-WGW-TASK-UID`) and the `calendarid` of the list it was written in (`X-WGW-TASK-LIST`). A task's thread is every entry in the pool of the current list's owner whose key matches **the task's current list and UID**.
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
  - Old entries stay under the old key and are deleted with that list. If the task moves back, they show again to that list's audience, who saw them before.
  - Deleting a task deletes its thread under the current key.
- **Live updates.** A new JMAP push type `ThreadEntry`, with source `threads`. Its state changes when any task thread pool the user can read changes.
  - The open thread panel refetches its thread on a state change.
  - The panel polls only while it is open and visible, and only while push is down (15 s). This keeps the idle-polling lesson of #2156.
- **Notifications.**
  - `tasks.thread_activity` on a new comment or reply. It goes to assignees and earlier comment authors in the thread, minus the actor, and only to people in the list audience.
  - `tasks.mentioned` goes to mentioned people in the audience instead of `thread_activity`, as Chat does.
  - Both are grouped per task with `supersede`, as Docs does per thread.
  - Activity entries never notify. #798 and #2172 own the notices for status and assignment.
- **Activity log (chunks F and G).**
  - The server turns #2172's `TaskChangeSet`, computed for REST, MCP and CalDAV writes, into activity entries in the same thread.
  - Each entry stores data, not text: `X-WGW-ACTIVITY` is JSON `{field, from, to}` or `{field, added, removed}`, plus the actor and time.
  - The client renders it in the reader's language and time zone, for example "Anna changed the title to 'Moodboard v2' · 1 Jan, 22:21".
  - Quick edits are merged (see Technical constraints).
- **Thread panel UI.** It sits in the task detail view below the fields.
  - One timeline in time order: comments with their replies, and activity rows.
  - A "Show changes" toggle (default on) hides activity rows.
  - The composer is the chat-ui composer, with mentions limited to the list audience.
  - Messages and reactions use chat-ui and the shared reaction picker.
  - The activity row and its formatter live in a new shared module, `packages/apps/src/thread-ui/`, so Docs and Chat can use them later.

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
  - new `app/Services/Threads/*` (shared converter, reactions, names, index);
  - Chat and Docs converters and repositories (delegate, no behaviour change);
  - new `app/Services/Tasks/Threads/*` (pool, repository, access, lifecycle, activity writer);
  - `CollectionKind` (new case);
  - migrations (`thread_index`);
  - REST controller and routes;
  - OpenAPI;
  - `JmapPushStateResolver` (new type);
  - `NotifyListener`, `NotificationCopyFormatter`, new `TaskThreadNotify`;
  - `TaskRepository`, `TaskListRepository` (lifecycle hooks);
  - #2172's `TaskChangeObserverPlugin` (activity consumer);
  - PHPUnit.
- `packages/apps`:
  - new `thread-ui/` (timeline, activity row, formatter);
  - `tasks-core` (thread panel in the detail view);
  - `lib/models/tasks-types.ts` (thread operations);
  - `lib/jmap-client/push` (new type);
  - `notifications-core/format-notification-copy.ts`;
  - Tasks Dexie store (read cache);
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
- `thread_index` (new table) holds `uid`, `pool_calendarid`, `subject_type` (`task`), `subject_key` (list calendarid + task UID), `kind`, `parent_uid`, `author`, `created_at` and `activity_field` (nullable).
  - Only task threads use it in this Epic.
  - `docs_thread_index` stays. Moving Docs onto `thread_index` is a follow-up named in threads.md.

### Task thread API (chunk B)

- `GET /api/v1/tasks/items/{taskId}/thread`:
  - It returns entries in time order, 200 per page, with a cursor.
  - Each entry has `id`, `kind`, `parentId`, `author` (`username`, `displayName`), `body` (null for activity and tombstones), `mentions`, `reactions`, `createdAt`, `editedAt`, `deletedAt` and `activity`.
  - It also returns a thread `state` for `/changes`.
- `POST …/thread` with `{id, body, parentId?, mentions?}`:
  - `id` is a client ULID. Retries with the same id are idempotent, as in Chat.
  - A `parentId` that is itself a reply is rejected with 422.
  - A mention outside the list audience is dropped from the stored mentions, but the text stays.
- `PATCH …/thread/{entryId}` with `{body}` and `DELETE …/thread/{entryId}` (tombstone):
  - author only (403);
  - comment and reply kinds only (409 for activity).
- `POST …/thread/{entryId}/reactions` with `{emoji}` toggles a reaction. The emoji set is the shared one.
- `GET …/thread/changes?since=<state>` returns the changed and removed entry ids.
- **Access:**
  - Every route resolves the task through the same accessible-list lookup as the task routes. 404 if the caller cannot see the task. Read access is enough to post.
  - A task in a multi-VTODO file is addressed by its UID, as in the task routes.
- **Limits:**
  - a body of at most 65 536 bytes (`MAX_BODY_BYTES`, the same in Chat and Docs);
  - at most 5 000 entries per thread. A post past that gets 409 `thread_full`.
  - Activity entries are pruned oldest first beyond 1 000 per thread, and comments are never pruned. Pruning makes room, so automatic activity never hits the limit.
- **Lifecycle hooks:**
  - `TaskRepository::delete` and the CalDAV observer's "deleted" change set delete the thread under the current key.
  - `TaskListRepository::delete` deletes every entry whose `X-WGW-TASK-LIST` is that list.
  - A move (`taskListId` in the change set) writes the "moved here" activity entry under the new key.
  - These hooks run after the task write has committed. A failure is logged and retried by the next write. It never fails the task write.

### Push and live updates (chunk C)

- `ThreadEntry` is added to `JmapPushStateResolver::TYPES`, with source `threads`.
  - The state is a hash over the `synctoken`s of the task thread pools whose owners have a list the user can see. Those are the user's own pool, their Teams' pools and the pools of owners who share a list with them.
  - Computing the state is one query, which the plan names.
  - Nothing is added to the idle request load: the client asks for the type only while a thread panel is open.

### Notifications (chunk D)

- New actions `tasks.thread_activity` and `tasks.mentioned` go in the allow-list, the PHP formatter and the TypeScript formatter.
- Recipients: assignees (`u:` participants from #2172) ∪ authors of earlier non-deleted comments and replies in the thread ∪ mentioned users. Then the actor is removed, and only people in `TaskListAudience` (any access) are kept.
- A mentioned user gets `tasks.mentioned`, and the rest get `tasks.thread_activity`.
- `dedupe_key` is `tasks.thread:<listCalendarId>:<taskUid>` with `supersede`. A busy thread is one row per person, updated in place.

### Activity entries (chunk F)

- The writer is called with #2172's `TaskChangeSet` from REST, MCP and the CalDAV observer. One write produces one entry per changed field.
- **Fields:**
  - `title`, `workflowStatus`, `priority`, `start`, `due` (with `showWithoutTime`) and `assignees` (added, removed);
  - `categories` (added, removed);
  - `description` (changed, no text);
  - `created`;
  - `moved` (in, no source).
- **Values:** stored raw. Strings are cut to 200 characters. Dates are ISO with their time zone, or floating. Assignees are participant ids, rendered with current names.
- **Merging quick edits.** When the newest entry in the thread is an activity entry by the same actor, for the same field, less than 10 minutes old, the writer updates its `to` (or its sets) instead of adding one. If `from` then equals `to`, the entry is deleted. This runs in one transaction with a lock on the thread's newest index row.
- **Not logged:**
  - imports (`TaskImportService`), which write one `created` entry per imported task with `{source: "import"}`;
  - `sortOrder`, `sequence`, `updated`, alarms, `icsProps`.
- **CalDAV writes** use the authenticated principal as the actor. The observer only acts after a successful write (#2172 invariant).

### UI (chunks E and G)

- **Thread panel** below the detail fields in `TasksDetailView`.
  - The newest entries are at the bottom. The composer is at the bottom and sticky inside the panel.
  - "Reply" opens an inline reply list under its root.
  - Edit and delete come from the message menu, for your own messages only.
- **Composer and mentions.**
  - It is `ChatComposer` from chat-ui.
  - The mention source is the list audience. The audience cache from #2172 chunk C is reused.
- **Activity row** (chunk G) in `thread-ui/thread-activity-row.tsx`, with the formatter in `thread-ui/format-thread-activity.ts`.
  - The formatter is pure. It takes the entry, the people map, the locale and the time zone. It is covered by Vitest for every field, merged entries and the removed-person case.
- **Offline.**
  - The last fetched thread per task is cached in the Tasks Dexie store and shown offline with "Last updated …".
  - Offline, the composer is disabled and says "Comments need a connection". There is no outbox for comments in this Epic.

## Edge cases

- **A task in a list the viewer can only read.** They can read the thread and comment (Goal), but cannot edit the task.
- **Someone who left the Team.** Their comments stay, with their name. Notifications skip them, because they are outside the audience. Mentions of them are not stored.
- **A deleted user.** Their entries show "Former member". The display-name helper already falls back.
- **The same task UID in two lists** (a copy made by a native client). The key includes the list, so the two threads are separate.
- **A task moves A → B → A.** The thread in A shows its old entries again, followed by the "moved here" entry. The thread in B stays under B's key and is deleted when B is deleted.
- **A multi-VTODO file.** Entries are keyed by the VTODO UID, not the file.
- **A recurring task.** One thread for the series. Changes to one occurrence's override are logged as the master's field with `{occurrence: <recurrenceId>}`.
- **A CalDAV client rewrites the whole VTODO with no real change.** The change set is empty and nothing is logged.
- **Two people edit the same field within 10 minutes.** These are separate entries, because merging only happens for the same actor.
- **A tombstoned root with replies.** The root shows "Comment deleted" and its replies stay.
- **A mention of someone who loses access later.** The stored mention stays and renders as plain text.
- **Pruning activity** never removes the "created" or "moved here" entries.
