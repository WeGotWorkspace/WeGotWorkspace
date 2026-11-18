Source: #2172 (body-hash: 868f59a5)
Goal: WeGotWorkspace/Product#60

# Assign people to a task

Technical translation of Epic #2172. Written against `origin/main` at `db6a4f161` (2026-11-14); every line reference in plan.md is pinned to that commit. Sibling Epic #2173 (task threads and activity log) builds on the task change set from this Epic.

## Goal

- **Assignees are VTODO `ATTENDEE`s.** The JMAP-shaped `participants` map already reads and writes `ORGANIZER`/`ATTENDEE`. This Epic turns it into a real feature:
  - Each person on the instance gets a **stable participant id** (`u:<username>`) instead of the positional `att1`, `att2`. A patch can then add or remove one assignee without touching the others.
  - Each assignee is written as `ATTENDEE;CN=<display name>;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;X-WGW-USERNAME=<username>:mailto:<email>`.
  - `X-WGW-USERNAME` keeps the mapping when someone's email changes.
  - **The organizer** (product owner, 2026-11-18). The first time a VTODO gets an `ATTENDEE` and has no `ORGANIZER`, the server sets `ORGANIZER` to the acting user: their address, with `CN` = display name. It is always a person, never a Team. This happens in the REST and MCP write path, so the web app, REST and MCP behave the same. A CalDAV PUT is stored as the client sent it when no `ORGANIZER` is stored: the server adds none, and keeps one the client wrote. Once an `ORGANIZER` is stored, from any client, it stays: REST and MCP cannot change it, and a CalDAV PUT that changes or drops it gets the stored line back (see Technical constraints, Validation). The one exception is a REST or MCP move to another list whose audience the organizer is not in; the mover then becomes the organizer.
- **The list audience.** One server-side resolver answers who can see a list, with their access level:
  - the owner;
  - every member of an owning Team;
  - every visible sharee, whether shared directly with a person or with a Team (expanded to its members).

  The resolver backs three things: the assignee picker endpoint, assignee validation and notification recipients. Epic #2173 reuses it for mentions.
- **Who can be assigned.** Only people in the list audience **with write access**, so an assignee can tick the task off. The product owner confirmed this on 2026-11-16: someone who can only view the list cannot be assigned. Over REST and MCP the server rejects a **newly added** assignee outside that set with 422; attendees the task already has are not re-checked while the task stays in its list; a move to another list drops the ones outside the new list's audience (see Technical constraints, Validation). Over CalDAV the server never rejects an `ATTENDEE`, so third-party clients keep working. Such an attendee is simply never notified (see Edge cases).
- **Task change set.** A pure diff of a task before and after a write. The input is two JMAP-shaped task arrays from `TaskMapper`. The output is a list of field changes, with assignees added and removed as person ids.
  - REST and MCP writes compute it in `TaskRepository`.
  - CalDAV `PUT`s compute it in a new DAV plugin: it reads the stored object before the write and the new one after a successful write.
  - Everything that reacts to task changes reads the change set. That is this Epic's `tasks.assigned` notification, and Epic #2173's activity log.
- **Notification `tasks.assigned`.** It goes to each newly added assignee who is in the list audience, except the actor. It uses the existing pipeline: `EventDispatch::fireMutation` → `NotifyListener` allow-list → `notifications` row. Details:
  - `dedupe_key` is per task and assignee, with `supersede`, so a reassign after an unassign replaces the old notice.
  - The copy reads "{actor} assigned you {summary}".
  - `navigate` opens the task.
- **UI:**
  - an **Assignee** row in the task detail view, whose value (avatar and name, stacked avatars and "{N} people", or "Unassigned") opens a picker limited to the list audience (people with read-only access are shown disabled);
  - assignee avatars (up to three, then "+N") with the other marks of each list row;
  - an **Assigned to me** item in the top section of the Tasks sidebar, after Overdue. It filters the in-memory, cross-list task set on the current user's participant id and email, and shows open tasks only.

## Non-goals

- Sharing a list by assigning someone. The assignee must already have write access (Product#56 shares lists).
- Guests and external email addresses as assignees from the web app
- Mail, push or iMIP on assignment. RFC 5546 defines iTIP for VTODO, but Sabre does not run it for VTODO (see plan.md, What exists). We deliberately choose no iTIP for tasks: the `ORGANIZER` only records who assigned first, or who moved the task out of that person's reach.
- Per-assignee progress, accept or decline
- Changing #798's status-change recipients
- An "assigned by" view in the app. The `ORGANIZER` is stored (see Goal) but not shown yet.
- Activity entries for assignment changes. They are in Epic #2173, which reads this Epic's change set.

## Affected packages

- `packages/api`:
  - `Services/Tasks/Conversion/TaskConversionSupport.php` (stable ids, attendee writing);
  - new `Services/Tasks/TaskListAudience.php` and `Services/Tasks/TaskChangeSet.php`;
  - `TaskRepository` (validation, change set, notify);
  - new `Services/Notify/TaskAssignedNotify.php`;
  - `NotifyListener` allow-list and default title;
  - `NotificationCopyFormatter`;
  - new `Dav/Server/TaskChangeObserverPlugin.php`;
  - new route `GET /api/v1/tasks/tasklists/{id}/members`;
  - OpenAPI;
  - PHPUnit.
- `packages/apps`:
  - `tasks-core` (detail row, list row avatars, sidebar item, view filter, labels);
  - `notifications-core/format-notification-copy.ts`;
  - `lib/models/tasks-types.ts` (members operation);
  - mock API;
  - Storybook;
  - Vitest.
- `docs`: `docs/architecture/tasks.md` (a new decision for assignees and the property-mapping row), `docs/architecture/notifications.md` (the new action).

## Technical constraints

### Storage and ids

- `participantsFromVtodo` reads ids as follows:
  - an `ATTENDEE` with `X-WGW-USERNAME` reads as `u:<username>`;
  - an `ATTENDEE` whose `mailto:` is the email of someone **in the list audience** reads as that person's `u:<username>`. An address of anyone outside the audience is never looked up, so a task cannot tell whether an address has an account here (security review of 2026-11-18);
  - any other attendee reads as `e:<lowercased email>`;
  - a `u:` participant who is in the list audience reads with the name and email of their own profile, whatever the stored line says. This protects what the web app, REST and MCP show: a CalDAV client cannot make them show one person under another's name. CalDAV clients read the stored lines and can still show a spoofed `CN` there; rewriting those lines on a CalDAV PUT is out of scope (product owner decision pending, see plan.md, Open decisions). A `u:` participant outside the audience reads as stored; no profile is looked up for them;
  - `ORGANIZER` keeps the id `org`.

  `writeParticipantsToVtodo` writes them back in the same form.
- Ids are stable across reads, so the per-entry merge patch (a `null` entry removes it) works per person.
- Unknown parameters on an `ATTENDEE` (`RSVP`, `SCHEDULE-AGENT`, `DELEGATED-*`, `X-*`) survive an edit. This is the in-place patch from #1392. Assigning or unassigning one person does not rewrite the other `ATTENDEE` lines.
- The OpenAPI `TaskParticipant` gains a read-only `username` (null for `e:` ids). Its `roles` stay as they are. An assignee is any participant with role `attendee`.

### Validation

- The server checks only the attendee ids that **this write adds**. That set is the participant ids with role `attendee` in the merged result, minus those in the stored task before the write. On a create there is no stored task, so every attendee counts as added.
- An added attendee is a **user** when its id is `u:<username>`, or its email is the email of someone in the **target** list's audience (that is how a read would show it). Each added user must be in that audience with write access, and must be the actor, the list owner, or someone the actor shares a Team with (`TeamColleagues::sharesTeamIgnoringAdminRole`), the same rule as the picker. The target is the list the task is in after the write, so a move is checked against the new list. Otherwise the write fails with 422 `invalid_participant` and one fixed sentence that names nobody, so a refusal tells nothing about who has an account or profile (product owner, 2026-11-18, review finding 4).
- An added attendee that is **not a user** (`e:<email>` for any address that is no one's in the target audience, whether or not it has an account elsewhere) passes, on creates and edits alike. This keeps today's behaviour for API callers and native-client data. Such an attendee is never notified. The web app's picker offers no way to add one.
- For a user, the server writes the `mailto:` and the `CN` from the user's own principal (email and display name). It ignores any email or name in the payload, so a caller cannot send `u:alice` with someone else's address.
- The organizer (`roles: ["owner"]`, id `org`) is set by the server, never by the payload. A REST or MCP write cannot add one or replace it: a new owner entry is 422 `invalid_participant`, and a resent or omitted `org` keeps the stored values. With no stored organizer, the first write that adds an attendee adds `org` = the actor (profile display name; profile email, or the username when there is none, as for an assignee). A write that adds no attendee names no organizer, so renaming a task whose attendees came from CalDAV does not make the editor its organizer. A PUT without `participants` drops the assignees but keeps the organizer. On a move, an organizer whose address is no one's in the target audience (an email or, for someone without one, a username) is replaced by the actor; if the actor is not in that audience either, the stored organizer stays. On CalDAV:
  - A PUT with no stored `ORGANIZER` is stored as sent. The server adds no `ORGANIZER` when a CalDAV client adds the first `ATTENDEE`, and keeps an `ORGANIZER` the client wrote; that one is then fixed like any other.
  - A PUT that replaces a stored VTODO gets the stored `ORGANIZER` line back on every VTODO of the same `UID` and `RECURRENCE-ID`; when the client changed the `UID` or added a `RECURRENCE-ID`, so no component matches, the stored master's `ORGANIZER` goes on the incoming master (the only VTODO, or the only one without a `RECURRENCE-ID`). The rest of the body is kept, and the PUT is never refused for it. `TaskOrganizerPinPlugin` does this in `beforeWriteContent` and sets Sabre's `$modified` flag, so the response carries no `ETag` (RFC 4791 §5.3.4) and the client fetches the stored copy. It runs after DAVACL, which checks the write privilege in `beforeMethod`. A create (`beforeCreateFile`) has no stored organizer, so it is not touched.
  - A CalDAV `MOVE` moves the object as it is: it neither replaces the organizer nor drops assignees. Only a REST or MCP move does (see below).
- An ICS import removes `X-WGW-USERNAME` from every `ATTENDEE`, so a file names people by address only and reads through the audience rule above.
- **Rescue of parked writes** (`rescueBody` in `tasks-parked-writes.ts`) creates a task anew in another list, often after the person lost access to the old one. Before posting, it keeps only `u:` attendees in the target list's audience with write access (from the audience cache of chunk C; with no cached audience, only the person's own `u:` entry). Everything else is dropped: `e:` addresses (they would carry an address from the old list to a new audience, product owner 2026-11-18, review finding 6), positional `attN` ids from a task parked before chunk A, and the organizer. The parked snapshot can be older than the deploy, so the server must never see an id it would treat as an unchecked user. The cached audience can be stale: a kept `u:` may have left the audience, or no longer share a Team with the person, since it was cached. The server then answers 422 `invalid_participant`. Rescue retries once with no attendees except the person's own `u:` entry if the parked task had one (it never adds the person), which is always allowed in a list they can write to. It reads no ids from the error, so any number of such people costs one retry, not a task parked for good; the price is that the other attendees are not carried over. A Thunderbird (`e:`) attendee is never carried over by a rescue.
- Attendees the task already has pass through unchecked within its list:
  - `e:` attendees from native clients;
  - people who lost access.
- A REST or MCP **move to another list** (each task list is its own CalDAV collection, so this is any change of `taskListIds`) keeps only the assignees in the target list's audience, including an `e:` address that is the email of someone in it (it then reads as that person). Everyone else is dropped with their name and address, `e:` addresses included, so nothing about them reaches the new audience (product owner, 2026-11-18, review finding 6). This follows live text, whose state does not move, and threads, whose messages stay with the source list.
- So a full `PUT` that resends the stored `participants`, a move, and a save of a task that carries a Thunderbird attendee all succeed.
- A patch that uses a positional `attN` key gets 422 `stale_participant_id`. No client sends one today, because there is no assignee UI, so only third-party API callers can hit this.

### Audience resolver

- `TaskListAudience::forList(CalendarInstance $list): list<{username, displayName, email, access: 'read'|'write'}>`. It is built from:
  - the owner rows;
  - Team members for a Team-owned list, via `GroupMembershipResolver`;
  - `CalendarShareInvites::shareWithForOwner` grants, with Team grants expanded to their members.

  Hidden grants are left out, because `shareWithForOwner` already drops grants that fail `grantIsVisible`. When the same person comes from two sources, the highest access wins.
- Disabled accounts are left out.
- The resolver is per request and is not cached across requests. Team membership changes must show on the next call.
- `GET /api/v1/tasks/tasklists/{id}/members`:
  - It answers only a caller with **write** access to the list, the only people who can assign. A caller who cannot see the list gets 404, the same as an unknown list. A read-only caller gets 403. Assignee names on a task come from the task's own participants, so readers do not need this endpoint.
  - Validation uses the same rule as the picker list (see Validation), so the API refuses an assignee the picker hides, with a refusal that names nobody.
  - It returns the audience **filtered to people the caller may see** under the Teams rule (#1915): `TeamColleagues::sharesTeamIgnoringAdminRole`, plus the caller and the list owner. Without this filter, a person sharee who is not in the owning Team would get the names and emails of Team members they share no Team with. That is the "DM rail and share dialogs" row of the surface table in `TeamColleagues`, not the attendee-picker row.
  - It never lists people outside the audience. Admins get no wider list here. The "finds everyone" rule (#1915) applies to invite pickers, not to assignees.

### Change set

- `TaskChangeSet::between(?array $before, ?array $after): TaskChangeSet` is pure, with no I/O, so it can be unit-tested.
- It reports changes to these fields:
  - `title`, `workflowStatus`, `priority`, `start`, `due`, `showWithoutTime`;
  - `categories`, as added and removed sets;
  - `description`, as a changed flag only;
  - `assignees`, as added and removed participant ids;
  - `taskListId`, as moved;
  - `created`, when `before` is null;
  - `deleted`, when `after` is null.

  Epic #2173 renders the same set as activity.
- `TaskRepository::create`, `update`, `patch` and `delete` compute it once per write. The existing `notifyStatusChanged` keeps its own logic and recipients (invariant). Moving it onto the change set is allowed only if its tests stay green unchanged.
- **The CalDAV observer.**
  - It runs only for objects in a `task_list` collection.
  - It reads the old object in `beforeWriteContent` and `beforeUnbind` (no DB writes), keyed by path.
  - It acts only in `afterMethod:PUT` or `afterMethod:DELETE` with a 2xx status and an authenticated actor. It never acts on a failed or unauthorized write (see `.agents/review-findings.md`, 2026-10-18 row).
  - A CalDAV `MOVE` between task lists produces no change set in this Epic. It adds no assignee, so nobody is owed a `tasks.assigned` notice. Epic #2173 chunk B extends this plugin to turn such a `MOVE` into a `moved` change set for the activity log.
  - It never fails the write; exceptions are logged, as in `EventDispatchPlugin`.
  - Multi-VTODO files (Decision 9 in tasks.md) produce one change set per VTODO UID.

### Notifications

- `tasks.assigned` is added in four places:
  - the `NotifyListener::ALLOW_LIST`;
  - its default title;
  - `NotificationCopyFormatter`;
  - the TypeScript `format-notification-copy.ts`.
- Recipients are the change set's added assignees, mapped to usernames, minus the actor, and only those who are in `TaskListAudience` with write access at the moment of the write. An attendee who is not a user on this instance, or is outside the audience, gets nothing.
- It fires the same way for REST, MCP and CalDAV writes.

### UI

- **Detail view.** A new field row in the existing `DetailFieldList`, using the `TasksDetailField` pattern. The product owner's mockup of 2026-11-16 (the image is kept with Epic #2173's spec) puts it first, above Status; the points below describe it fully, so this spec does not depend on the image:
  - The row has a person icon and the label "Assignee". With one assignee the value is their avatar and name with a chevron; with two or more it is up to three stacked avatars and "{N} people". Clicking the value opens the picker.
  - With nobody assigned the value reads "Unassigned".
  - The picker is a popover listing the audience with a search box.
  - It reuses `UserAvatar` and the list/row primitives from `packages/apps/src/ui`. It does not reuse the share dialog's principal search, which searches every colleague, not the list audience.
  - Read-only people are shown disabled with "Can only view this list".
  - Saving goes through the existing detail autosave as a `participants` patch.
- **List row.** Avatars only, in `TasksListRowMarks` (the row's marks, top right), after the alarm and priority marks. The mockup draws those marks on the meta line; this spec keeps them where the row puts them today and only adds the avatars. No names, which are too wide in narrow lists. Hovering shows each name.
- **Sidebar.** `state:assigned-to-me` is a new view in `filterTasksByView`.
  - A task matches when one of its participants has the id `u:<me>`, or role `attendee` and the current user's email.
  - Done and cancelled tasks are left out, like Today.
  - It does **not** go through `filterTasksByHiddenLists`. The view shows every open task assigned to the user in every list they can see, including lists they turned off in the sidebar, because the Epic asks for "every open task … across the lists they can see".
  - The view needs no new fetch, because the task set is already cross-list.
- **Offline.** Assigning edits `participants` through the existing task outbox.
  - Today the client's offline merge replaces `participants` whole (`applyTaskPatch`, `coalesceTaskPatches`), and only `alerts` merge per id. Chunk C changes both functions to merge `participants` per id, as the server does, where a `null` entry removes one.
  - Without that change, assigning Bob and then Carol while offline would queue a patch holding only Carol, and the optimistic task would show a `null` entry after an unassign.
  - The picker needs the audience, so it is cached per list in the Tasks Dexie store and refreshed when the list is opened online. When offline, the cached audience is used. A list never opened online shows "Connect to load people".

## Edge cases

- **An assignee later loses access.** They left the Team, or the share was removed. They stay on the task, because the data is kept for native clients and for when they get access back. The UI shows them greyed with "No longer has access". They get no further notifications, and the task drops out of their "Assigned to me" because they can't see the list.
- **A task moves to another list.** Assignees in the new list's audience stay; the rest are removed, with their name and address. Moving sends no new `tasks.assigned` notice, because nobody was newly added.
- **Notice volume.** `tasks.assigned` is rate limited per actor, per recipient, and per actor and recipient pair, so assigning someone over and over, or creating many tasks for them (over REST, MCP or CalDAV), cannot flood them. Notices over the limit are dropped; the assignment itself is stored.
- **Self-assign** is allowed. No notification is sent, because the actor is skipped.
- **An assignee in a native client.** Thunderbird or jtx Board adds an `ATTENDEE` with an unknown email. The server stores it and the web app shows the email as the name. No notification, and the web app's picker can remove it.
- **The same person written twice** (same email, different case): reading merges them into one `u:` entry, which takes its parameters from the first of those lines in file order. An unrelated edit leaves both lines as they are. Only when that person is unassigned or reassigned from the web app are their lines rewritten. The first line's parameters survive, and the duplicate is removed.
- **Recurring tasks.** Assignees live on the master. Assignment from the web app edits the master, not overrides. If an override carries its own `ATTENDEE` from another client, it is kept and not shown.
- **Removing an assignee** sends no notification. Epic #2173's activity log records it.
- **An admin who is not in the Team** cannot be assigned. Neither can a Team-hidden colleague. Both are outside the audience.
- **Apple Reminders** neither shows nor writes `ATTENDEE`. It keeps them on edit, which an interop fixture proves (plan.md, chunk E).
