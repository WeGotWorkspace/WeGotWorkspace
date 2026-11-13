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
| Collection | one per channel or DM (`chat-…`, `dm-…`) | `docs-threads` pool per owner | `task-threads` pool per owner |
| Subject key | the channel | the document path, which moves with the doc | list `calendarid` + task UID |
| Access | channel membership | Drive share (`mayView` / `mayComment`) | the task's current list (read access can comment) |
| Edit / delete | the author / tombstone | none | the author / tombstone |
| Mentions stored | yes | no (regex for subscribing only) | yes |
| Activity entries | no | no | yes (server-written) |
| Live updates | `ChatMessage` push | 4 s polling | `ThreadEntry` push |
| Index | read-time | `docs_thread_index` | `thread_index` |

## Shared code

- **Backend:** `App\Services\Threads`, built in #2173 chunk A.
  - `ThreadEntryJournal` is the converter core, for the properties in rule 1.
  - `ThreadReactions` toggles a reaction.
  - `ThreadAuthorNames` resolves display names.
  - `thread_index` is the generic index (`subject_type`, `subject_key`).
  - Domain converters wrap the core with their own properties: Docs anchors, path and resolved state; Chat attachments.
- **Frontend:**
  - the chat-ui composer, mention menu, message and reaction bar;
  - the shared `reaction-picker` and `user-avatar`;
  - `thread-ui` (new in #2173) for the timeline and activity rows.

  Docs cards still have their own reply input. Moving them onto the chat composer is a follow-up.

## Follow-ups this design makes possible

- Docs threads on `thread_index` and `ThreadEntry` push, retiring the 4 s poll.
- Docs mentions stored the way Chat stores them, which unblocks the `docs.mentioned` notice.
- Activity entries for Docs (resolved, renamed) and for Chat channels (topic changed).
- A product decision on rule 4 for Docs (threads following a document to another owner).
