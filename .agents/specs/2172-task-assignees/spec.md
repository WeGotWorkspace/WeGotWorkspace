Source: #2172 (body-hash: 658e4631)
Goal: WeGotWorkspace/Product#60

# Assign people to a task

Technical translation of Epic #2172. Written against `origin/main` at `db6a4f161` (2026-11-14); every line reference in plan.md is pinned to that commit. Sibling Epic #2173 (task threads and activity log) builds on the task change set from this Epic.

## Goal

- **Assignees are VTODO `ATTENDEE`s.** The JMAP-shaped `participants` map already reads and writes `ORGANIZER`/`ATTENDEE`. This Epic turns it into a real feature:
  - Each person on the instance gets a **stable participant id** (`u:<username>`) instead of the positional `att1`, `att2`. A patch can then add or remove one assignee without touching the others.
  - Each assignee is written as `ATTENDEE;CN=<display name>;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;X-WGW-USERNAME=<username>:mailto:<email>`.
  - `X-WGW-USERNAME` keeps the mapping when someone's email changes.
  - Assignment never adds or changes `ORGANIZER`. An existing `ORGANIZER` from another client is kept as is.
- **The list audience.** One server-side resolver answers who can see a list, with their access level:
  - the owner;
  - every member of an owning Team;
  - every visible sharee, whether shared directly with a person or with a Team (expanded to its members).

  The resolver backs three things: the assignee picker endpoint, assignee validation and notification recipients. Epic #2173 reuses it for mentions.
- **Who can be assigned.** Only people in the list audience **with write access**, so an assignee can tick the task off. Over REST and MCP the server rejects a **newly added** assignee outside that set with 422; attendees the task already has are never re-checked (see Technical constraints, Validation). Over CalDAV the server never rejects an `ATTENDEE`, so third-party clients keep working. Such an attendee is simply never notified (see Edge cases).
- **Task change set.** A pure diff of a task before and after a write. The input is two JMAP-shaped task arrays from `TaskMapper`. The output is a list of field changes, with assignees added and removed as person ids.
  - REST and MCP writes compute it in `TaskRepository`.
  - CalDAV `PUT`s compute it in a new DAV plugin: it reads the stored object before the write and the new one after a successful write.
  - Everything that reacts to task changes reads the change set. That is this Epic's `tasks.assigned` notification, and Epic #2173's activity log.
- **Notification `tasks.assigned`.** It goes to each newly added assignee who is in the list audience, except the actor. It uses the existing pipeline: `EventDispatch::fireMutation` → `NotifyListener` allow-list → `notifications` row. Details:
  - `dedupe_key` is per task and assignee, with `supersede`, so a reassign after an unassign replaces the old notice.
  - The copy reads "{actor} assigned you {summary}".
  - `navigate` opens the task.
- **UI:**
  - an **Assignees** row in the task detail view: avatars plus an add button, with a picker limited to the list audience (people with read-only access are shown disabled);
  - assignee avatars (up to three, then "+N") at the end of each list row;
  - an **Assigned to me** item in the top section of the Tasks sidebar, after Overdue. It filters the in-memory, cross-list task set on the current user's participant id and email, and shows open tasks only.

## Non-goals

- Sharing a list by assigning someone. The assignee must already have write access (Product#56 shares lists).
- Guests and external email addresses as assignees from the web app
- Mail, push or iMIP on assignment. There is no iTIP for VTODO, see plan.md, What exists.
- Per-assignee progress, accept or decline
- Changing #798's status-change recipients
- An `ORGANIZER` model for tasks ("assigned by")
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
  - an `ATTENDEE` with `X-WGW-USERNAME`, or whose `mailto:` matches a principal email, reads as `u:<username>`;
  - any other attendee reads as `e:<lowercased email>`;
  - `ORGANIZER` keeps the id `org`.

  `writeParticipantsToVtodo` writes them back in the same form.
- Ids are stable across reads, so the per-entry merge patch (a `null` entry removes it) works per person.
- Unknown parameters on an `ATTENDEE` (`RSVP`, `SCHEDULE-AGENT`, `DELEGATED-*`, `X-*`) survive an edit. This is the in-place patch from #1392. Assigning or unassigning one person does not rewrite the other `ATTENDEE` lines.
- The OpenAPI `TaskParticipant` gains a read-only `username` (null for `e:` ids). Its `roles` stay as they are. An assignee is any participant with role `attendee`.

### Validation

- The server checks only the attendee ids that **this write adds**. That set is the participant ids with role `attendee` in the merged result, minus those in the stored task before the write. On a create there is no stored task, so every attendee counts as added.
- An added attendee is a **user** when its id is `u:<username>`, or its email matches a user's email (that is how a read would show it). Each added user must be in the audience of the **target** list with write access. The target is the list the task is in after the write, so a move is checked against the new list. Otherwise the write fails with 422 `invalid_participant`, naming the id.
- An added attendee that is **not a user** (`e:<email>` for an address no account has) passes, on creates and edits alike. This keeps today's behaviour for API callers and native-client data. Such an attendee is never notified. The web app's picker offers no way to add one.
- For a user, the server writes the `mailto:` and the `CN` from the user's own principal (email and display name). It ignores any email or name in the payload, so a caller cannot send `u:alice` with someone else's address.
- **Rescue of parked writes** (`rescueBody` in `tasks-parked-writes.ts`) creates a task anew in another list, often after the person lost access to the old one. Before posting, it drops every `u:` attendee who is not in the target list's audience with write access, using the audience cache from chunk C. When there is no cached audience for the target, it keeps only the person's own `u:` entry. `e:` attendees are kept. The rescue create therefore never hits `invalid_participant`, and a task with a Thunderbird attendee is still rescued.
- Attendees the task already has pass through unchecked, whatever they are:
  - `e:` attendees from native clients;
  - people who lost access;
  - assignees who are outside the new list's audience after a move.
- So a full `PUT` that resends the stored `participants`, a move to a list where an assignee has no access, and a save of a task that carries a Thunderbird attendee all succeed.
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
  - The picker list is deliberately narrower than validation, which accepts the whole audience with write access. The API therefore still accepts an assignee the picker hides (another client may add them), and implementers should not "fix" that mismatch.
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

- **Detail view.** A new field row after Priority, in the existing `DetailFieldList`, using the `TasksDetailField` pattern.
  - The picker is a popover listing the audience with a search box.
  - It reuses `UserAvatar` and the list/row primitives from `packages/apps/src/ui`. It does not reuse the share dialog's principal search, which searches every colleague, not the list audience.
  - Read-only people are shown disabled with "Can only view this list".
  - Saving goes through the existing detail autosave as a `participants` patch.
- **List row.** Avatars only. No names, which are too wide in narrow lists. Hovering shows each name.
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
- **A task moves to another list.** Assignees stay. Those not in the new list's audience show as "No longer has access". Moving sends no new `tasks.assigned` notice, because nobody was newly added.
- **Self-assign** is allowed. No notification is sent, because the actor is skipped.
- **An assignee in a native client.** Thunderbird or jtx Board adds an `ATTENDEE` with an unknown email. The server stores it and the web app shows the email as the name. No notification, and the web app's picker can remove it.
- **The same person written twice** (same email, different case): reading merges them into one `u:` entry, which takes its parameters from the first of those lines in file order. An unrelated edit leaves both lines as they are. Only when that person is unassigned or reassigned from the web app are their lines rewritten. The first line's parameters survive, and the duplicate is removed.
- **Recurring tasks.** Assignees live on the master. Assignment from the web app edits the master, not overrides. If an override carries its own `ATTENDEE` from another client, it is kept and not shown.
- **Removing an assignee** sends no notification. Epic #2173's activity log records it.
- **An admin who is not in the Team** cannot be assigned. Neither can a Team-hidden colleague. Both are outside the audience.
- **Apple Reminders** neither shows nor writes `ATTENDEE`. It keeps them on edit, which an interop fixture proves (plan.md, chunk E).
