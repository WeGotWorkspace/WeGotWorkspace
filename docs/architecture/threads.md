# Threads

Conversations attached to something: a chat channel, a document, a task. Every thread in the suite stores messages the same way and follows the same rules for who reads it. Epic: #2173 (Goal WeGotWorkspace/Product#87), which adds task threads and the activity log and moves Chat and Docs onto one shared module. Spec, plan and chunks: [.agents/specs/2173-task-threads/](../../.agents/specs/2173-task-threads/). Status: **design**; nothing below is built yet except the parts marked "today".

---

## Rules

1. **One message is one VJOURNAL.** Every message, reply and activity entry is its own VJOURNAL in a DAV-hidden collection.
   - It carries a client ULID as `UID`, the author as `X-WGW-AUTHOR` and the body as `DESCRIPTION`.
   - It can carry stored mentions (`X-WGW-MENTIONS`) and reactions (`X-WGW-REACTIONS`, an OR-set).
   - An edit bumps `SEQUENCE`. A delete leaves a tombstone (`STATUS:CANCELLED`, body cleared).
   - Today Chat and Docs each have their own copy of this. #2173 chunk A moves the shared part into `App\Services\Threads`.
2. **Replies are one level deep.** A reply's `RELATED-TO` points at a root. A reply to a reply is rejected by the server. Docs and Chat keep replies flat today, but Chat checks it only in the client (`chat-thread-actions.ts`). #2173 puts the check in the shared server module.
3. **A thread belongs to its subject, and access follows the subject.**
   - Nothing is copied per reader. Each request checks whether the reader can see the subject now:
     - a chat channel's membership;
     - a document's Drive share;
     - a task's current list.
   - Someone who gains access sees the whole thread, and someone who loses access sees none of it.
   - There is no per-period access: a new Team member reads the history like everyone else.
4. **History stays with its audience.** A thread is keyed on the subject *and* the place that sets its audience.
   - For a task that place is the list. Moving a task to another list starts a fresh thread, and the old entries are never shown to the new list's audience.
   - Every read and write goes through the subject's **current** key. An entry id or a reply parent from an old key answers 404 or 422, so an old scope's entries cannot be read or changed from the new one.
   - Entries whose task has left that list, by a delete or a move, stay hidden under the old key. They are purged 30 days after the task left, unless it comes back. The shared purge asks the subject type whether the subject still exists in that scope, so a live thread of any app is never purged. A task that just sits in its list is never purged. A CalDAV `MOVE` counts as a move. A native client's delete-then-create counts as a delete plus a new task.
   - Docs differs today: a document's threads follow it into another owner's pool (`DocsThreadPathSync`). Whether Docs should follow rule 4 is an open product question. #2173 does not change Docs.
5. **Pools are per owner.** A domain keeps one hidden pool per owner (a user or a Team). Docs uses `docs-threads`, and tasks use `task-threads`. Chat is the exception: each channel or DM is its own collection, because the channel is the subject. An index table makes listing a thread one query.
6. **Activity entries are data, written by the server.**
   - An activity entry is a thread entry of kind `activity` with `X-WGW-ACTIVITY` = `{field, from, to}` or `{field, added, removed}`.
   - The client renders it in the reader's language and time zone, with current names.
   - Nobody can edit or delete it.
   - Quick edits by one person to one field within 10 minutes are merged into one entry.
   - Tasks are the first domain to write them (#2173). The same format can later record Docs actions (resolve, rename) or Chat channel events.
7. **Live updates come from push, not polling.**
   - Chat has the `ChatMessage` push type today.
   - Task threads get `ThreadEntry` (#2173 chunk C), which a client asks for only while a thread is open.
   - Docs threads still poll every 4 s today. Moving them onto `ThreadEntry` is a follow-up.
8. **Notifications are grouped per thread.** One inbox row per person per thread is updated in place (`supersede`). A mentioned person gets the domain's "mentioned" action instead of the general one. The actor never gets a notice, and nobody outside the subject's audience gets one.

## Where each domain stands

| | Chat | Docs | Tasks (#2173) |
|---|---|---|---|
| Collection | one per channel or DM (`chat-…`, `dm-…`) | `docs-threads` pool per owner | `task-threads` pool per owner (kind `thread_pool`) |
| Built on | own repository and routes | own repository and routes | the shared thread service, through the `task` subject type |
| Subject key | the channel | the document path, which moves with the doc | list `calendarid` + task UID |
| Access | channel membership | Drive share (`mayView` / `mayComment`) | the task's current list (read access can comment) |
| Edit / delete | the author / tombstone | none | the author / tombstone |
| Mentions stored | yes | no (regex for subscribing only) | yes |
| Activity entries | no | no | yes (server-written) |
| Live updates | `ChatMessage` push | 4 s polling | `ThreadEntry` push |
| Index | read-time | `docs_thread_index` | `thread_index` |

## Shared code

Threads are a shared layer. An app plugs in a **subject type**: the thing a thread is about (a task) and its **scope**, the place that sets who can see it (the task's list). Tasks is the first subject type (#2173).

- **Backend:** `App\Services\Threads`.
  - Converter core (#2173 chunk A): `ThreadEntryJournal` for the properties in rule 1, `ThreadReactions` to toggle a reaction, `ThreadAuthorNames` for display names. Domain converters wrap the core with their own properties: Docs anchors, path and resolved state; Chat attachments.
  - Subjects: `ThreadSubjectType`, the interface an app implements (resolve and access, scope, audience, followers, readable scopes, existence for the purge, notification actions), and `ThreadSubjectRegistry`.
  - Service: the `thread_pool` collection kind and provisioner, the entry repository, `ThreadsController` under `/api/v1/threads/{subjectType}/{subjectId}`, `ThreadLifecycle` with the daily `threads:purge-orphans`, the `ThreadEntry` push state, `ThreadNotifier` and `ThreadActivityWriter`.
  - `thread_index` and `thread_subject` are generic (`subject_type`, `subject_key`, `subject_scope`).
- **Frontend:**
  - `thread-ui`: `ThreadSubjectAdapter` (what an app hands the panel), `ThreadPanel`, `useThread`, the activity row and its formatter;
  - `lib/api/wgw/threads.ts`, the shared API client;
  - `lib/offline/threads/`, one offline domain for the read cache and the outbox of every subject type;
  - the chat-ui composer, mention menu, message and reaction bar, and the shared `reaction-picker` and `user-avatar`.

  Docs cards still have their own reply input. Moving them onto the chat composer is a follow-up.

## Adding threads to another app

For example comments on notes, with the notebook as scope. Nothing shared changes; the app adds:

1. A server subject type: how to find the subject and check access, its scope, its audience, who follows it, the scopes a user can read, and whether a subject still exists in a scope. Register it.
2. Calls to `ThreadLifecycle` from the app's delete and move paths (`left`, `returned`, `scopeDeleted`), and a decision on what a move does (rule 4).
3. Its two notification actions (`<app>.thread_activity`, `<app>.mentioned`) with copy in both formatters.
4. A client adapter, and `ThreadPanel` mounted where the subject is shown.
5. Optional: field changes for the activity log, and field labels in the adapter.

## Follow-ups this design makes possible

- Docs threads on `thread_index` and `ThreadEntry` push, retiring the 4 s poll; later Docs and Chat as subject types of the shared service.
- Threads in another app, such as Notes, through the checklist above.
- Docs mentions stored the way Chat stores them, which unblocks the `docs.mentioned` notice.
- Activity entries for Docs (resolved, renamed) and for Chat channels (topic changed).
- A product decision on rule 4 for Docs (threads following a document to another owner).
